import assert from 'node:assert/strict';

// Run against a local Vite server in Chromium and WebKit; no API or corpus needed.
export async function verifyAgendaTitleLayout(page, {baseUrl = 'http://127.0.0.1:5173'} = {}) {
  const originalViewport = page.viewportSize();
  const checkCards = async () => {
    const rows = await page.locator('.insight-agenda button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect(), style = getComputedStyle(button);
      const range = document.createRange(); range.selectNodeContents(button.querySelector('strong'));
      const lines = [...range.getClientRects()];
      return {
        title: button.textContent,
        inside: lines.every(line => line.top >= box.top && line.bottom <= box.bottom - parseFloat(style.paddingBottom) + 1
          && line.left >= box.left && line.right <= box.right + 1),
        top: box.top, bottom: box.bottom, height: box.height,
      };
    }));
    assert(rows.length > 1, 'Exercise multiple wrapped agenda titles');
    for (const [index, row] of rows.entries()) {
      assert(row.inside, `Title must stay inside its card: ${row.title}`);
      assert(row.height >= 44, 'Cards retain their minimum pointer target');
      if (index) assert(row.top >= rows[index - 1].bottom, 'Cards must not overlap');
    }
  };
  try {
    await page.setViewportSize({width: 1280, height: 900});
    await page.goto(new URL('/src/agendaTitleLayout.test.html', baseUrl).href);
    await checkCards();
    // WebKit previously kept the wider layout's row heights after narrowing.
    for (const width of [1001, 1100, 1920, 1280, 1001]) {
      await page.setViewportSize({width, height: 900});
      await checkCards();
    }
    await page.locator('.insight-agenda button').last().focus();
    assert(await page.locator('.insight-agenda button').last().evaluate(button => {
      const card = button.getBoundingClientRect(), pane = button.closest('aside').getBoundingClientRect();
      return document.activeElement === button && card.bottom <= pane.bottom + 1 && card.top >= pane.top;
    }), 'Keyboard focus reveals the last card in the scroll pane');
    const enlarged = await page.addStyleTag({content: '.insight-agenda button {font-size:32px;line-height:1.5;letter-spacing:.12em;}'});
    await checkCards();
    await enlarged.evaluate(element => element.remove());
    for (const width of [320, 390, 1000]) {
      await page.setViewportSize({width, height: 844});
      assert(await page.locator('.insight-agenda').isVisible(), 'Narrow screens start with agenda cards');
      assert(await page.locator('.insight-topic-detail').isHidden(), 'No empty detail prompt');
      assert(await page.locator('.insight-agenda-navigation').isHidden());
      await checkCards();
      assert(await page.locator('.insight-agenda').evaluate(agenda => agenda.clientHeight >= agenda.scrollHeight), 'Agenda uses page scrolling without a nested scroll pane');
      await page.locator('.insight-agenda-view').evaluate(view => view.dataset.topicSelected = 'true');
      assert(await page.locator('.insight-agenda').isHidden());
      assert(await page.locator('.insight-agenda-select select').isVisible());
      assert(await page.getByRole('button', {name:'Back to agenda'}).isVisible());
      assert(await page.locator('.insight-topic-detail').isVisible());
      await page.locator('.insight-agenda-view').evaluate(view => view.dataset.topicSelected = 'false');
      assert(await page.evaluate(() => document.querySelector('main').scrollWidth <= innerWidth), 'No horizontal page overflow');
    }
    return {resize: true, wrappedTitles: true, keyboardScroll: true, enlargedText: true, mobileAgendaAndPicker: true};
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
