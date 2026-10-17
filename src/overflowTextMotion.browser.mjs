// Start Vite on port 5204, then run this file with the Playwright browser tool's
// browser_run_code_unsafe({filename: '<absolute path to this file>'}).
// It receives a task-owned Playwright Page; no browser dependency is added.
async function checkPortraitMotion(page) {
  const fixture = 'http://127.0.0.1:5204/src/overflowTextMotion.test.html';
  const originalViewport = page.viewportSize();
  const names = ['Marie-Agnes STRACK-ZIMMERMANN', 'Isabel GARCÍA MUÑOZ', 'Kinga GÁL', 'Juan Fernando LÓPEZ AGUILAR'];
  const labels = ['Marie-Agnes', 'STRACK-ZIMMERMANN', 'Isabel', 'GARCÍA MUÑOZ', 'Kinga', 'GÁL', 'Juan Fernando', 'LÓPEZ AGUILAR'];
  const assert = (condition, message) => {if (!condition) throw new Error(message);};
  const snapshot = () => page.evaluate(() => {
    const rect = element => {
      const {x, y, width, height} = element.getBoundingClientRect();
      return {x, y, width, height};
    };
    const elements = selector => [...document.querySelectorAll(selector)];
    return {
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      names: elements('.portrait').map(element => element.getAttribute('aria-label')),
      geometry: {
        grid: rect(document.querySelector('.explorer-portraits')),
        cards: elements('.explorer-portrait-item').map(rect),
        portraits: elements('.portrait').map(rect),
        images: elements('.portrait img').map(rect),
      },
      labels: elements('.running-text').map(element => {
        const track = element.firstElementChild, text = track.firstElementChild;
        const range = document.createRange(); range.selectNodeContents(text);
        const viewport = element.getBoundingClientRect();
        const portrait = element.closest('.portrait').getBoundingClientRect();
        const caption = element.closest('.portrait__label').getBoundingClientRect();
        const clipsVertically = getComputedStyle(element).overflowY !== 'visible';
        const bounds = [...range.getClientRects()];
        return {
          text: text.textContent,
          lines: bounds.length,
          visible: bounds.length > 0 && bounds.every(r =>
            r.left >= viewport.left - .5 && r.right <= viewport.right + .5
            && r.top >= Math.max(portrait.top, caption.top, clipsVertically ? viewport.top : -Infinity) - .5
            && r.bottom <= Math.min(portrait.bottom, caption.bottom, clipsVertically ? viewport.bottom : Infinity) + .5),
          animation: getComputedStyle(track).animationName,
          transform: getComputedStyle(track).transform,
          copies: [...track.children].filter(child => getComputedStyle(child).display !== 'none').length,
          duplicateHidden: track.children.length < 2 || track.children[1].getAttribute('aria-hidden') === 'true',
        };
      }),
    };
  });
  const settle = reduced => page.waitForFunction(expected => {
    if (document.querySelectorAll('.portrait').length !== 4
      || matchMedia('(prefers-reduced-motion: reduce)').matches !== expected) return false;
    return expected ? !document.querySelector('.is-running') : Boolean(document.querySelector('.is-running'));
  }, reduced);
  const sameGeometry = (before, after) => JSON.stringify(before.geometry) === JSON.stringify(after.geometry);
  const assertReduced = (state, baseline) => {
    assert(state.reduced, 'Browser must actually request reduced motion');
    assert(sameGeometry(state, baseline), 'Reduced motion must preserve grid, cards, portraits and images');
    assert(JSON.stringify(state.names) === JSON.stringify(names), 'Complete portrait button names must remain intact');
    assert(JSON.stringify(state.labels.map(label => label.text)) === JSON.stringify(labels), 'All visible name text must remain intact');
    assert(state.labels.every(label => label.visible && label.animation === 'none' && label.copies === 1),
      'Every name must be fully visible, static and shown only once under reduced motion');
    assert(state.labels.find(label => label.text === 'STRACK-ZIMMERMANN').lines > 1, 'The long surname must wrap');
  };
  const assertMoving = async baseline => {
    assert(!baseline.reduced, 'Browser must actually request no preference');
    assert(baseline.labels.some(label => label.animation === 'running-text-loop'), 'Overflowing names must retain the default marquee');
    assert(baseline.labels.every(label => label.duplicateHidden), 'Moving duplicates must stay hidden from assistive technology');
    await page.waitForFunction(previous => [...document.querySelectorAll('.running-text')].some((element, index) =>
      previous[index].animation === 'running-text-loop'
      && getComputedStyle(element.firstElementChild).transform !== previous[index].transform), baseline.labels);
  };
  const results = [];
  try {
    for (const width of [320, 1280]) {
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await page.goto(fixture);
      await page.evaluate(() => document.fonts.ready);
      await settle(false);
      const baseline = await snapshot();
      await assertMoving(baseline);

      await page.emulateMedia({reducedMotion: 'reduce'});
      await settle(true);
      assertReduced(await snapshot(), baseline);

      await page.emulateMedia({reducedMotion: 'no-preference'});
      await settle(false);
      const restored = await snapshot();
      assert(sameGeometry(restored, baseline), 'Switching back must preserve outer geometry');
      await assertMoving(restored);

      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await settle(true);
      assertReduced(await snapshot(), baseline);
      await page.getByRole('button', {name: names[0], exact: true}).focus();
      await page.keyboard.press('Enter');
      assert(await page.locator('output').textContent() === names[0], 'Keyboard portrait activation must retain the full name');
      results.push({width, reducedMotion: true, fullNamesVisible: true, geometryUnchanged: true, defaultMarqueeRestored: true});
    }
    return results;
  } finally {
    await page.emulateMedia({reducedMotion: null});
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
