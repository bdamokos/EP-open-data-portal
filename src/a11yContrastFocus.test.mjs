import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {contrast,paintedBackground,schemes,themeCss,tokenValue} from './test-support/themeStyles.mjs';

const styles = await Promise.all([
  'References.css', 'ParliamentHeader.css', 'explorer.css', 'Insights.css',
  'SpeechCloud.css', 'ExplorerLayout.css', 'base.css', 'focus.css',
].map(file => readFile(new URL(file, import.meta.url), 'utf8')));

async function page(t, markup, scheme) {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  window.document.head.innerHTML = [themeCss(scheme), ...styles].map(css => `<style>${css}</style>`).join('');
  window.document.body.innerHTML = markup;
  return window;
}
function focusContrast(window, element, scheme) {
  element.focus();
  const style = window.getComputedStyle(element);
  assert.equal(element, window.document.activeElement);
  assert.equal(style.outlineStyle, 'solid');
  assert(parseFloat(style.outlineWidth) >= 3);
  const behind = paintedBackground(window, element.parentElement, scheme);
  assert(contrast(style.outlineColor, behind) >= 3,
    `${scheme}: ${element.outerHTML}: ${style.outlineColor} must contrast with ${behind}`);
}

for (const scheme of schemes) {
  for (const shell of ['explorer', 'explorer-insights']) {
    test(`current navigation is readable and marked in ${shell} (${scheme})`, async t => {
      const window = await page(t, `<main class="${shell}"><header class="parliament-header"><nav>
        <button aria-current="page">Questions</button><button>Members</button>
      </nav></header></main>`, scheme);
      const [current, other] = window.document.querySelectorAll('button');
      focusContrast(window, current, scheme);
      const style = window.getComputedStyle(current);
      assert(contrast(style.color, paintedBackground(window, current, scheme)) >= 4.5);
      assert(contrast(window.getComputedStyle(other).color, paintedBackground(window, other, scheme)) >= 4.5);
      assert.notEqual(style.fontWeight, window.getComputedStyle(other).fontWeight, 'the current page is not marked by colour alone');
    });
  }

  for (const panel of ['explorer-profile-body', 'explorer-saved-view']) {
    test(`all reader control types have contrasting focus on ${panel} (${scheme})`, async t => {
      const window = await page(t, `<main class="explorer"><section class="${panel}">
        <div class="insight-inline-reader"><button>Read</button><a href="#source">Source</a>
        <input aria-label="Search"><select aria-label="Language"><option>EN</option></select>
        <details><summary>Sources</summary></details></div>
      </section></main>`, scheme);
      for (const control of window.document.querySelectorAll('button,a,input,select,summary')) focusContrast(window, control, scheme);
    });
  }

  test(`video controls keep contrasting focus in member and insight panels (${scheme})`, async t => {
    for (const shell of ['explorer', 'explorer-insights']) {
      const window = await page(t, `<main class="${shell}"><section class="explorer-video">
        <div class="explorer-video-actions"><button>Original audio</button><button aria-pressed="true">Selected audio</button></div>
        <a href="#source">Source recording</a>
      </section></main>`, scheme);
      for (const control of window.document.querySelectorAll('button,a')) focusContrast(window, control, scheme);
    }
  });

  test(`speech cloud focus contrasts in member and insight views (${scheme})`, async t => {
    for (const shell of ['explorer', 'explorer-insights']) {
      const window = await page(t, `<main class="${shell}"><section class="explorer-cloud"><button>Topic</button></section></main>`, scheme);
      focusContrast(window, window.document.querySelector('button'), scheme);
    }
  });

  test(`a directory error retry has contrasting focus outside the profile panel (${scheme})`, async t => {
    const window = await page(t, '<main class="explorer"><section class="explorer-wall"><div class="explorer-notice"><button>Try again</button></div></section></main>', scheme);
    focusContrast(window, window.document.querySelector('button'), scheme);
  });

  test(`programmatic focus in insight readers uses the shared focus token (${scheme})`, async t => {
    for (const panel of ['', ' class="insight-trend"']) {
      const window = await page(t, `<main class="explorer-insights"><section${panel}>
        <div class="insight-inline-reader" tabindex="-1">Reading destination</div>
      </section></main>`, scheme);
      const reader = window.document.querySelector('.insight-inline-reader');
      focusContrast(window, reader, scheme);
      assert.equal(window.getComputedStyle(reader).outlineColor, tokenValue(scheme, 'focus'));
    }
  });
}

test('page titles take focus without a visible outline while other focused headings keep one', async t => {
  for (const markup of [
    '<main class="explorer"><section class="explorer-profile"><div class="explorer-profile-header"><h1 tabindex="-1">Name</h1></div><h2 tabindex="-1">Speeches</h2></section></main>',
    '<main class="explorer"><section class="explorer-saved-view"><h1 tabindex="-1">Following</h1><h2 tabindex="-1">Saved items</h2></section></main>',
    '<main class="explorer-insights"><section><h1 tabindex="-1">Plenary agenda</h1><h2 tabindex="-1">Contributions</h2></section></main>',
  ]) {
    const window = await page(t, markup, 'light');
    const [title, heading] = window.document.querySelectorAll('h1,h2');
    title.focus();
    assert.equal(window.document.activeElement, title);
    assert.equal(window.getComputedStyle(title).outlineStyle, 'none');
    heading.focus();
    assert.equal(window.getComputedStyle(heading).outlineStyle, 'solid');
  }
});

test('insight page titles stay unoutlined when the lazy insight layout loads after the focus styles', async t => {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const [focus, layout] = await Promise.all(['focus.css', 'ExplorerLayout.css'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  window.document.head.innerHTML = `<style>${themeCss('light')}</style><style>${focus}</style><style>${layout}</style>`;
  window.document.body.innerHTML = '<main class="explorer-insights"><h1 tabindex="-1">Questions</h1><h2 tabindex="-1">Results</h2></main>';
  const [title, heading] = window.document.querySelectorAll('h1,h2');
  title.focus();
  assert.equal(window.getComputedStyle(title).outlineStyle, 'none');
  heading.focus();
  assert.equal(window.getComputedStyle(heading).outlineStyle, 'solid');
});
