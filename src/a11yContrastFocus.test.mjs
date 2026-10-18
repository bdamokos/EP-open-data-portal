import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';

const styles = await Promise.all([
  'References.css', 'ParliamentHeader.css', 'explorer.css', 'Insights.css',
  'SpeechCloud.css', 'ExplorerLayout.css', 'base.css', 'focus.css',
].map(file => readFile(new URL(file, import.meta.url), 'utf8')));

function luminance(color) {
  const channels = color.startsWith('#')
    ? color.slice(1).match(color.length === 4 ? /./g : /../g).map(v => parseInt(v.length === 1 ? v + v : v, 16))
    : color.match(/[\d.]+/g).slice(0, 3).map(Number);
  return channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}
async function page(t, markup) {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  window.document.head.innerHTML = styles.map(css => `<style>${css}</style>`).join('');
  window.document.body.innerHTML = markup;
  return window;
}
function focusContrast(window, element, surface) {
  element.focus();
  const style = window.getComputedStyle(element);
  assert.equal(element, window.document.activeElement);
  assert.equal(style.outlineStyle, 'solid');
  assert(parseFloat(style.outlineWidth) >= 3);
  assert(contrast(style.outlineColor, window.getComputedStyle(surface).backgroundColor) >= 3,
    `${element.outerHTML}: ${style.outlineColor} must contrast with its surrounding surface`);
}

for (const shell of ['explorer', 'explorer-insights']) {
  test(`current navigation is readable and keeps its yellow border in ${shell}`, async t => {
    const window = await page(t, `<main class="${shell}"><header class="parliament-header"><nav>
      <button aria-current="page">Questions</button><button>Members</button>
    </nav></header></main>`);
    const [current, other] = window.document.querySelectorAll('button');
    focusContrast(window, current, window.document.querySelector('header'));
    const style = window.getComputedStyle(current);
    assert(contrast(style.color, style.backgroundColor) >= 4.5);
    assert.notEqual(style.borderColor, window.getComputedStyle(other).borderColor);
    assert(contrast(style.borderColor, style.backgroundColor) >= 3);
  });
}

for (const panel of ['explorer-profile-body', 'explorer-saved-view']) {
  test(`all reader control types have contrasting focus on ${panel}`, async t => {
    const window = await page(t, `<main class="explorer"><section class="${panel}">
      <div class="insight-inline-reader"><button>Read</button><a href="#source">Source</a>
      <input aria-label="Search"><select aria-label="Language"><option>EN</option></select>
      <details><summary>Sources</summary></details></div>
    </section></main>`);
    const surface = window.document.querySelector('section');
    for (const control of window.document.querySelectorAll('button,a,input,select,summary')) {
      focusContrast(window, control, surface);
    }
  });
}

test('video controls retain contrasting focus in light member and dark insight panels', async t => {
  for (const shell of ['explorer', 'explorer-insights']) {
    const window = await page(t, `<main class="${shell}"><section class="explorer-video">
      <div class="explorer-video-actions"><button>Original audio</button><button aria-pressed="true">Selected audio</button></div>
      <a href="#source">Source recording</a>
    </section></main>`);
    const surface = window.document.querySelector('section');
    for (const control of window.document.querySelectorAll('button,a')) focusContrast(window, control, surface);
  }
});

test('speech cloud focus follows the light member and dark insight surfaces', async t => {
  for (const shell of ['explorer', 'explorer-insights']) {
    const window = await page(t, `<main class="${shell}"><section class="explorer-cloud"><button>Topic</button></section></main>`);
    const surface = window.document.querySelector(shell === 'explorer' ? 'section' : 'main');
    focusContrast(window, window.document.querySelector('button'), surface);
  }
});

test('a directory error retry has contrasting focus outside the profile panel', async t => {
  const window = await page(t, '<main class="explorer"><section class="explorer-wall"><div class="explorer-notice"><button>Try again</button></div></section></main>');
  focusContrast(window, window.document.querySelector('button'), window.document.querySelector('.explorer-notice'));
});

test('programmatic focus uses the local surface token and keeps yellow on dark insight readers', async t => {
  for (const light of [false, true]) {
    const window = await page(t, `<main class="explorer-insights"><section ${light ? 'style="--focus-outline-color:var(--signal-blue);background:#fff"' : ''}>
      <div class="insight-inline-reader" tabindex="-1">Reading destination</div>
    </section></main>`);
    const reader = window.document.querySelector('.insight-inline-reader');
    const surface = window.document.querySelector(light ? 'section' : 'main');
    focusContrast(window, reader, surface);
    assert.equal(window.getComputedStyle(reader).outlineColor, light ? '#1e6cff' : '#fff200');
  }
});

test('the opened member name takes focus without a visible outline while other focused headings keep one', async t => {
  const window = await page(t, '<main class="explorer"><section class="explorer-profile"><div class="explorer-profile-header"><h1 tabindex="-1">Name</h1></div><h2 tabindex="-1">Speeches</h2></section></main>');
  const [name, heading] = window.document.querySelectorAll('h1,h2');
  name.focus();
  assert.equal(window.document.activeElement, name);
  assert.equal(window.getComputedStyle(name).outlineStyle, 'none');
  heading.focus();
  assert.equal(window.getComputedStyle(heading).outlineStyle, 'solid');
});
