// Start Vite on port 5210, then run this file with the Playwright browser tool's
// browser_run_code_unsafe({filename: '<absolute path to this file>'}).
// It receives a task-owned Playwright Page; no browser dependency is added.
// Font doubling and text spacing below are CSS diagnostics, not native zoom/AT acceptance.
async function checkPortraitEnlargement(page) {
  const fixture = 'http://127.0.0.1:5210/src/overflowTextMotion.test.html';
  const originalViewport = page.viewportSize();
  const timeout = 5000, rounding = 1 / 32;
  const names = ['Marie-Agnes STRACK-ZIMMERMANN', 'Isabel GARCÍA MUÑOZ', 'Kinga GÁL', 'Juan Fernando LÓPEZ AGUILAR'];
  const labels = ['Marie-Agnes', 'STRACK-ZIMMERMANN', 'Isabel', 'GARCÍA MUÑOZ', 'Kinga', 'GÁL', 'Juan Fernando', 'LÓPEZ AGUILAR'];
  // Accepted 28cbf418 layout, using its wrapped reduced-motion presentation in both media.
  const legacyCSS = `
    .explorer-portrait-item { container-type: normal !important; }
    .explorer .explorer-portrait-item .portrait {
      display: block !important; aspect-ratio: 4 / 5 !important;
      grid-template-rows: none !important; min-height: 44px !important;
    }
    .explorer-portrait-item .portrait::before { content: none !important; }
    .explorer-portrait-item .portrait img {
      position: static !important; inset: auto !important; height: 100% !important;
      aspect-ratio: auto !important; grid-area: auto !important; align-self: auto !important;
    }
    .explorer-portrait-item .portrait__label {
      position: absolute !important; inset: auto 0 0 !important; width: auto !important;
      min-width: auto !important; grid-area: auto !important; align-self: auto !important;
    }`;
  let context = 'Portrait fixture';
  const assert = (condition, message) => {if (!condition) throw new Error(`${context}: ${message}`);};
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const inside = (inner, outer, tolerance = 0) => inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
  const removeStyle = async style => {await style.evaluate(element => element.remove()); await style.dispose();};
  const browserErrors = [];
  const onPageError = error => browserErrors.push(error.message);
  page.on('pageerror', onPageError);

  const settle = reduced => page.waitForFunction(async expected => {
    const portraits = [...document.querySelectorAll('.portrait')];
    const ready = portraits.length === 4 && document.querySelectorAll('.overflow-text').length === 8
      && document.fonts.status === 'loaded'
      && portraits.every(element => {
        const image = element.querySelector('img');
        return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      })
      && matchMedia('(prefers-reduced-motion: reduce)').matches === expected;
    if (!ready) return false;
    await Promise.all(portraits.map(element => element.querySelector('img').decode()));
    return true;
  }, reduced, {timeout});
  const snapshot = () => page.evaluate(() => {
    const elements = selector => [...document.querySelectorAll(selector)];
    const grid = document.querySelector('.explorer-portraits'), gridBox = grid.getBoundingClientRect();
    const gridStyle = getComputedStyle(grid);
    const wallBox = grid.parentElement.getBoundingClientRect();
    // Grid content coordinates stay comparable after focus or scrolling moves a scroller.
    const rect = element => {
      const {x, y, width, height} = element.getBoundingClientRect?.() ?? element;
      return {x: x - gridBox.x + grid.scrollLeft, y: y - gridBox.y + grid.scrollTop, width, height};
    };
    return {
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      buttons: elements('.portrait').map(element => ({
        name: element.getAttribute('aria-label'), text: element.textContent,
        tag: element.tagName, type: element.type, disabled: element.disabled, tabIndex: element.tabIndex,
      })),
      geometry: {
        grid: {x: gridBox.x - wallBox.x, y: gridBox.y - wallBox.y, width: gridBox.width, height: gridBox.height,
          clientWidth: grid.clientWidth, paddingLeft: parseFloat(gridStyle.paddingLeft),
          paddingRight: parseFloat(gridStyle.paddingRight), gap: parseFloat(gridStyle.columnGap)},
        columns: gridStyle.gridTemplateColumns,
        cards: elements('.explorer-portrait-item').map(rect),
        portraits: elements('.portrait').map(rect),
        images: elements('.portrait img').map(rect),
        captions: elements('.portrait__label').map(rect),
      },
      photos: elements('.portrait img').map(image => {
        const box = image.getBoundingClientRect(), style = getComputedStyle(image);
        const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
        return {src: image.currentSrc, fit: style.objectFit, position: style.objectPosition,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          renderedWidth: image.naturalWidth * scale, renderedHeight: image.naturalHeight * scale};
      }),
      horizontalOverflow: elements('html, body, #root, .explorer, .explorer-wall, .explorer-portraits')
        .filter(element => element.scrollWidth > element.clientWidth).map(element => element.className || element.tagName),
      animations: document.getAnimations().length,
      labels: elements('.overflow-text').map(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          bounds: [...range.getClientRects()].map(rect),
          singleCopy: element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE,
          animation: style.animationName, transform: style.transform,
          fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight),
          letterSpacing: parseFloat(style.letterSpacing) || 0, wordSpacing: parseFloat(style.wordSpacing) || 0,
        };
      }),
    };
  });
  const assertStatic = (state, reduced, tolerance = 0) => {
    assert(state.reduced === reduced, 'The requested motion preference must actually match');
    assert(equal(state.buttons.map(button => button.name), names), 'Complete accessible button names must remain intact');
    assert(state.buttons.every((button, index) => button.tag === 'BUTTON' && button.type === 'button'
      && !button.disabled && button.tabIndex === 0 && button.text === labels[index * 2] + labels[index * 2 + 1]),
    'Four enabled keyboard buttons must contain exactly one copy of each name');
    assert(equal(state.labels.map(label => label.text), labels), 'All eight visible name parts must remain intact');
    assert(state.animations === 0 && state.labels.every(label => label.singleCopy
      && label.animation === 'none' && label.transform === 'none'), 'Names must stay static and appear once in both media');
    state.labels.forEach((label, index) => {
      const portrait = state.geometry.portraits[Math.floor(index / 2)], caption = state.geometry.captions[Math.floor(index / 2)];
      assert(label.bounds.length > 0 && label.bounds.every(box => box.width > 0 && box.height > 0
        && inside(box, caption, tolerance) && inside(box, portrait, tolerance)), `${label.text} must fit inside its caption and portrait`);
    });
    assert(state.labels[1].bounds.length > 1, 'The long surname must wrap');
    assert(state.horizontalOverflow.length === 0, `No grid or page horizontal overflow: ${state.horizontalOverflow.join(', ')}`);
    state.geometry.portraits.forEach((portrait, index) => {
      const image = state.geometry.images[index], caption = state.geometry.captions[index];
      assert(image.x === portrait.x && image.y === portrait.y && image.width === portrait.width
        && Math.abs(image.height - portrait.width * 1.25) <= Math.max(tolerance, 1 / 64)
        && caption.y - portrait.y >= portrait.width * .75 - tolerance,
      'The image must keep its 4:5 size while leaving at least a 4:3 photo window above the caption');
      assert(state.photos[index].naturalWidth > 0 && state.photos[index].naturalHeight > 0
        && state.photos[index].fit === 'cover' && state.photos[index].position === '50% 0%',
      'Decoded photos must preserve their dimensions and center-top cover crop');
    });
  };
  const assertGeometry = (state, baseline, message) => assert(equal(state.geometry, baseline.geometry), message);
  const typography = state => state.labels.map(label => [label.fontSize, label.lineHeight, label.letterSpacing, label.wordSpacing]);
  const compareLegacy = async state => {
    const style = await page.addStyleTag({content: legacyCSS});
    try {
      await page.emulateMedia({reducedMotion: 'reduce'});
      await settle(true);
      const legacy = await snapshot();
      const {portraits, captions, ...fixed} = state.geometry;
      const {portraits: oldPortraits, captions: oldCaptions, ...oldFixed} = legacy.geometry;
      assert(equal(fixed, oldFixed), 'Ordinary grid, cards and images must exactly match the accepted wrapped layout');
      // Container units can round differently from aspect-ratio by a fraction of a layout pixel.
      portraits.forEach((portrait, index) => {
        const old = oldPortraits[index], caption = captions[index], oldCaption = oldCaptions[index];
        assert(portrait.x === old.x && portrait.width === old.width
          && Math.abs(portrait.y - old.y) <= 1 / 64 && Math.abs(portrait.height - old.height) <= 1 / 64
          && caption.x === oldCaption.x && caption.width === oldCaption.width && caption.height === oldCaption.height
          && Math.abs(caption.y - oldCaption.y) <= 1 / 64,
        'Ordinary widths and caption heights must match exactly; portrait position/height and caption position may round by at most 1/64px');
      });
      assert(equal(typography(state), typography(legacy)), 'Ordinary font size and spacing must exactly match the accepted wrapped layout');
      assert(equal(state.photos, legacy.photos), 'Ordinary photos must preserve their original source, rendered scale and center-top crop');
    } finally {
      await removeStyle(style);
      await page.emulateMedia({reducedMotion: state.reduced ? 'reduce' : 'no-preference'});
    }
    await settle(state.reduced);
    assertGeometry(await snapshot(), state, 'Removing the legacy override must return exact ordinary geometry');
  };
  const assertEnlarged = (state, baseline, reduced, spaced) => {
    assertStatic(state, reduced, rounding);
    const columns = state.geometry.columns.split(/\s+/).map(parseFloat);
    const grid = state.geometry.grid;
    assert(columns.length === baseline.geometry.columns.split(/\s+/).length,
      'Enlargement must preserve the number of columns');
    // A vertical scrollbar can reduce available width; verify the current tracks and cells.
    assert(Math.abs(columns.reduce((sum, width) => sum + width, 0) + grid.gap * (columns.length - 1)
      - (grid.clientWidth - grid.paddingLeft - grid.paddingRight)) <= columns.length * rounding,
    'Columns must fill the current grid width without horizontal overflow');
    state.labels.forEach((label, index) => {
      assert(label.fontSize === baseline.labels[index].fontSize * 2, `${label.text} must have a computed font size of exactly 2×`);
      if (spaced) assert(Math.abs(label.lineHeight - label.fontSize * 1.5) < .001
        && Math.abs(label.letterSpacing - label.fontSize * .12) < .001
        && Math.abs(label.wordSpacing - label.fontSize * .16) < .001, 'Computed text spacing must apply to every name');
    });
    state.geometry.cards.forEach((card, index) => {
      const column = index % columns.length;
      const left = grid.paddingLeft + columns.slice(0, column).reduce((sum, width) => sum + width, 0) + grid.gap * column;
      assert(Math.abs(card.x - left) <= rounding && Math.abs(card.width - columns[column]) <= rounding,
        'Cards must remain aligned with the current grid columns');
      for (const group of ['portraits', 'images', 'captions']) assert(state.geometry[group][index].x === card.x
        && state.geometry[group][index].width === card.width, `${group} must preserve their card width and column position`);
    });
    state.geometry.portraits.forEach((portrait, index) => {
      const caption = state.geometry.captions[index];
      assert(Math.abs(portrait.height - Math.max(portrait.width * 5 / 4, portrait.width * .75 + caption.height)) <= rounding,
        `${names[index]} height must equal the greater of the 4:5 minimum and photo minimum plus caption, within fractional rounding`);
      assert(inside(caption, portrait, rounding), 'The caption must fit below the separate photo region');
    });
    const cards = state.geometry.cards;
    cards.forEach(a => cards.forEach(b => {
      if (b.y > a.y) assert(a.y + a.height <= b.y + rounding, 'Adjacent card rows must not overlap');
    }));
  };
  const activate = async (name, key) => {
    const button = page.getByRole('button', {name, exact: true});
    await page.keyboard.press('Tab');
    await button.focus({timeout});
    assert(await button.evaluate(element => document.activeElement === element && element.matches(':focus-visible')),
      'Keyboard focus must visibly reach the portrait');
    await page.keyboard.press(key);
    await page.waitForFunction(expected => document.querySelector('output').textContent === expected, name, {timeout});
  };
  const checkFinalScroll = async width => {
    await page.setViewportSize({width, height: 240});
    try {
      await settle(true);
      await page.getByRole('button', {name: names[3], exact: true}).focus({timeout});
      assert(await page.evaluate(() => {
        const scroller = document.querySelector('.explorer');
        if (scroller.scrollHeight <= scroller.clientHeight) return false;
        scroller.scrollTop = scroller.scrollHeight;
        return scroller.scrollTop > 0;
      }), 'The short viewport must exercise actual scrolling');
      await page.waitForFunction(() => {
        const scroller = document.querySelector('.explorer').getBoundingClientRect();
        const last = [...document.querySelectorAll('.overflow-text')].at(-1);
        const range = document.createRange(); range.selectNodeContents(last);
        const line = [...range.getClientRects()].at(-1);
        return line && line.top >= Math.max(0, scroller.top) && line.bottom <= Math.min(innerHeight, scroller.bottom)
          && line.left >= 0 && line.right <= innerWidth;
      }, undefined, {timeout});
      assertStatic(await snapshot(), true, rounding);
    } finally {
      await page.setViewportSize({width, height: 900});
      await settle(true);
    }
  };

  const results = [];
  try {
    for (const width of [320, 1280]) {
      context = `${width}px ordinary`;
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await page.goto(fixture, {timeout: 15000});
      await settle(false);
      const ordinary = await snapshot();
      assertStatic(ordinary, false);
      await compareLegacy(ordinary);
      await page.emulateMedia({reducedMotion: 'reduce'});
      await settle(true);
      const reduced = await snapshot();
      assertStatic(reduced, true);
      assertGeometry(reduced, ordinary, 'Ordinary static geometry must match across motion preferences');
      await compareLegacy(reduced);
      await page.reload({timeout: 15000});
      await settle(true);
      assertStatic(await snapshot(), true);
      assertGeometry(await snapshot(), reduced, 'Loading directly with reduced motion must preserve ordinary geometry');
      await activate(names[0], 'Enter');

      context = `${width}px CSS enlargement diagnostic`;
      const enlargement = await page.addStyleTag({content: `
        .explorer .portrait__label { font-size: 34px !important; }
        @media (max-width: 767px) { .explorer .portrait__label { font-size: 30px !important; } }`});
      try {
        await settle(true);
        assertEnlarged(await snapshot(), reduced, true, false);
        const spacing = await page.addStyleTag({content: `
          .explorer .portrait__label { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }`});
        try {
          const enlarged = await snapshot();
          assertEnlarged(enlarged, reduced, true, true);
          const grown = enlarged.geometry.portraits.findIndex((portrait, index) => portrait.height > reduced.geometry.portraits[index].height + rounding);
          assert(grown >= 0, 'The diagnostic must actually grow a portrait beyond its photo ratio');
          const other = names[(grown + 1) % names.length];
          for (const key of ['Enter', 'Space']) {
            await activate(other, 'Enter');
            await activate(names[grown], key);
          }
          await page.emulateMedia({reducedMotion: 'no-preference'});
          await settle(false);
          assertEnlarged(await snapshot(), ordinary, false, true);
          assertGeometry(await snapshot(), enlarged, 'Switching media while enlarged must preserve static geometry');
          await page.emulateMedia({reducedMotion: 'reduce'});
          await settle(true);
          assertEnlarged(await snapshot(), reduced, true, true);
        } finally {await removeStyle(spacing);}
      } finally {await removeStyle(enlargement);}

      context = `${width}px restored without reload`;
      await settle(true);
      const restored = await snapshot();
      assertStatic(restored, true);
      assertGeometry(restored, reduced, 'Removing enlargement and spacing must restore exact ordinary geometry without reload');
      assert(equal(typography(restored), typography(reduced)), 'Ordinary font size and text spacing must return without reload');
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await settle(false);
      const noPreference = await snapshot();
      assertStatic(noPreference, false);
      assertGeometry(noPreference, ordinary, 'The restored no-preference presentation must remain static with exact ordinary geometry');
      assert(equal(typography(noPreference), typography(ordinary)), 'Restored typography must remain unchanged across media');
      // Exercise the short-screen scroll route separately from typography restoration.
      const scrolling = await page.addStyleTag({content: `
        .explorer .portrait__label { font-size: 34px !important; line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }
        @media (max-width: 767px) { .explorer .portrait__label { font-size: 30px !important; } }`});
      try {
        await page.emulateMedia({reducedMotion: 'reduce'});
        await checkFinalScroll(width);
      } finally {await removeStyle(scrolling);}
      results.push({width, staticInBothMedia: true, acceptedOrdinaryGeometry: true, ordinaryRoundingLimitPx: 1 / 64,
        doubledFontAndSpacing: true, keyboardAndFinalScroll: true, restoredWithoutReload: true});
    }
    assert(browserErrors.length === 0, `No page errors: ${browserErrors.join('; ')}`);
    return results;
  } finally {
    page.off('pageerror', onPageError);
    await page.emulateMedia({reducedMotion: null});
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
