import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement, useState} from 'react';
import {Window} from 'happy-dom';
import {sourceAvailability} from '../server/source-availability.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

test('question trends expose measures and retain keyboard and select filtering', async t => {
  const window = new Window({url: 'http://localhost/'});
  class ResizeObserver {observe() {} disconnect() {}}
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement, ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  let loadModule, root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    if (loadModule) await loadModule.close();
    await window.happyDOM.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  loadModule = await freshLoader({configFile: false, server: {middlewareMode: true, hmr: false, watch: null}, optimizeDeps: {noDiscovery: true}, oxc: {jsx: {runtime: 'automatic'}}});
  const {QuestionTrend} = await loadModule('/src/InsightCharts.tsx');
  const {createRoot} = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  const bins = [
    {start: '2026-10-01', end: '2026-10-07', count: 3, total: 8, share: 37.5},
    {start: '2026-10-08', end: '2026-10-14', count: 0, total: 5, share: 0},
    {start: '2026-10-15', end: '2026-10-16', count: 0, total: 0, share: null},
  ];
  const changes = [];
  function Trend({interactive = true, selected = true, comparison = true, countryFiltered = false, language = 'en'}) {
    const [range, setRange] = useState(null);
    return createElement(QuestionTrend, {data: {interval: 'week', bins,sources:[sourceAvailability({sourceKey:'questions',start:'2026-10-01',end:'2026-10-16',latestObservedDate:'2026-10-14'})]}, language, selected, comparison, countryFiltered, scope: 'Water', range,
      onRange: interactive ? value => {changes.push(value); setRange(value);} : undefined});
  }
  const render = props => act(async () => root.render(createElement(Trend, props)));
  const points = () => [...container.querySelectorAll('svg [role="button"]')];
  const select = () => container.querySelector('select');
  const press = (element, key) => act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})));
  const clickMeasure = label => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === label).click());

  await render();
  assert.equal(container.querySelector('svg').getAttribute('role'), 'group', 'the chart must expose its interactive descendants');
  assert.match(container.querySelector('svg').getAttribute('aria-label'), /Water: Question counts by week/);
  assert.equal(points().length, 3);
  assert.match(points()[0].getAttribute('aria-label'), /Oct 1, 2026–Oct 7, 2026: 3 questions, 8 total/);
  assert.equal(container.querySelectorAll('svg path[data-series=all]').length, 2, 'count mode retains the all-question baseline');
  await press(points()[0], 'Enter');
  assert.deepEqual(changes.at(-1), {start: bins[0].start, end: bins[0].end});
  assert.equal(points()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(select().value, bins[0].start);
  await press(points()[0], ' ');
  assert.equal(changes.at(-1), null, 'Space clears an already selected period');

  await clickMeasure('Share of questions');
  assert.match(container.querySelector('svg').getAttribute('aria-label'), /Share of questions/);
  assert.match(points()[0].getAttribute('aria-label'), /37\.5% of questions\. 3 questions, 8 total/);
  assert.match(points()[1].getAttribute('aria-label'), /0% of questions\. 0 questions, 5 total/);
  assert.equal(points().length, 2, 'unavailable share is not plotted as zero');
  assert.match(select().options[3].textContent, /Share unavailable\. 0 questions, 0 total/);
  await act(async () => {select().value = bins[2].start; select().dispatchEvent(new window.Event('change', {bubbles: true}));});
  assert.deepEqual(changes.at(-1), {start: bins[2].start, end: bins[2].end}, 'the alternative selector retains every period, including a missing share');
  await act(async () => {select().value = ''; select().dispatchEvent(new window.Event('change', {bubbles: true}));});
  assert.equal(changes.at(-1), null);

  await render({language: 'de'});
  assert.match(points()[0].getAttribute('aria-label'), /37,5%/);
  await press(points()[0], 'Enter');
  await render({comparison: false});
  const shareButton=[...container.querySelectorAll('button')].find(button=>button.textContent==='Share of questions');
  assert.equal(shareButton.disabled,true);
  assert.match(document.getElementById(shareButton.getAttribute('aria-describedby')).textContent,/Choose a topic or word above to see its share/);
  assert.equal(select().value,bins[0].start,'clearing the topic preserves the selected week');
  await clickMeasure('Share of questions');
  assert.match(container.querySelector('svg').getAttribute('aria-label'), /Question counts/);
  assert.equal(points().length, 3, 'clearing the topic restores counts even when a country or week remains selected');

  await render({countryFiltered: true});
  assert.equal(shareButton.disabled,false);
  assert.match(container.querySelector('svg').getAttribute('aria-label'),/Question counts/,'reselecting a topic starts in count mode');
  await clickMeasure('Share of questions');
  assert.match(container.querySelector('.insight-chart-caption').textContent,/within the selected MEP election country/);
  assert.doesNotMatch(container.textContent,/Choose a topic or word above/);
  await render({comparison:false,selected:false});
  assert.match(container.querySelector('svg').getAttribute('aria-label'),/Question counts/);

  await render({interactive: false});
  assert.equal(points().length, 0, 'read-only trends do not advertise inert filter buttons');
  assert.equal(container.querySelectorAll('svg [tabindex]').length, 0);
  assert.match(container.querySelector('svg [role="img"]').getAttribute('aria-label'), /3 questions, 8 total/);
  assert.equal(select(), null);
  bins[1].availability = 'partial';
  bins[2] = {...bins[2], availability: 'unavailable', count: null, total: null};
  await render({interactive: true, selected: false});
  assert.equal(points().length, 2, 'unavailable counts are not plotted at zero');
  assert.match(select().options[2].textContent, /Partial\./);
  assert.match(select().options[3].textContent, /Unavailable/);
  assert.doesNotMatch(select().options[3].textContent, /0 questions/);
  assert.equal(container.querySelector('svg path').getAttribute('d').split('L').length, 2, 'baseline stops at the frontier');
  assert.match(container.textContent, /Later dates unavailable/);
});
