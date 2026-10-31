import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {createUiI18n} from './uiI18n.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

test('React bindings scope locales, preserve rich nodes and escape message HTML', async t => {
  const load = await freshLoader({configFile: false, server: {middlewareMode: true, hmr: false, ws: false, watch: null},
    optimizeDeps: {noDiscovery: true}, oxc: {jsx: {runtime: 'automatic'}}});
  t.after(() => load.close());
  const {UiI18nProvider, UiMessage, useUiI18n} = await load('/src/UiI18nReact.tsx');
  const i18n = createUiI18n({source: {hello: 'Hello {name}', rich: 'Read {link} <script>bad</script>'},
    translations: {hu: {hello: 'Szia {name}', rich: '<b>Szöveg</b>: {link}'}}});
  function Greeting() {return h('p', null, useUiI18n().t('hello', {name: 'Ágnes'}));}
  const provider = (language, ...children) => h(UiI18nProvider, {i18n, language}, ...children);
  assert.equal(renderToStaticMarkup(provider('en', h(Greeting), provider('hu', h(Greeting)), h(Greeting))),
    '<p>Hello Ágnes</p><p>Szia Ágnes</p><p>Hello Ágnes</p>');
  const link = h('a', {href: '/document/A-10-2026-0175', lang: 'el'}, 'Δημόσιο έγγραφο');
  assert.equal(renderToStaticMarkup(provider('hu', h(UiMessage, {id: 'rich', values: {link}}))),
    '&lt;b&gt;Szöveg&lt;/b&gt;: <a href="/document/A-10-2026-0175" lang="el">Δημόσιο έγγραφο</a>');
  assert.match(renderToStaticMarkup(provider('en', h(UiMessage, {id: 'rich', values: {link}}))), /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.equal(renderToStaticMarkup(h(Greeting)), '<p>hello</p>'); // Standalone components use the immutable English default.
  assert.equal(renderToStaticMarkup(provider('hu', h(Greeting))), '<p>Szia Ágnes</p>');
  assert.equal(renderToStaticMarkup(provider('en', h(Greeting))), '<p>Hello Ágnes</p>');
});

test('mounted consumers update for language and catalogue changes without changing source content', async t => {
  const window = new Window({url: 'http://localhost/'});
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  let root, load;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    if (load) await load.close();
    await window.happyDOM.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  load = await freshLoader({configFile: false, server: {middlewareMode: true, hmr: false, ws: false, watch: null},
    optimizeDeps: {noDiscovery: true}, oxc: {jsx: {runtime: 'automatic'}}});
  const {UiI18nProvider, UiMessage, useUiI18n} = await load('/src/UiI18nReact.tsx');
  const {createRoot} = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  const source = {heading: 'Document {id}', sentence: 'Read {link}'};
  const i18n = createUiI18n({source, translations: {fr: {heading: 'Document public {id}', sentence: '{link} : lire'}}});
  function View() {
    const {t} = useUiI18n();
    return h('section', null, h('h2', null, t('heading', {id: 'A-10-2026-0175'})),
      h(UiMessage, {id: 'sentence', values: {link: h('a', {href: '/document', lang: 'el'}, 'Ελληνικά')}}));
  }
  const render = (language, catalogue = i18n) => act(async () => root.render(h(UiI18nProvider, {i18n: catalogue, language}, h(View))));
  await render('en');
  assert.equal(container.textContent, 'Document A-10-2026-0175Read Ελληνικά');
  await render('fr');
  assert.equal(container.textContent, 'Document public A-10-2026-0175Ελληνικά : lire');
  assert.equal(container.querySelector('a').getAttribute('lang'), 'el');
  assert.equal(container.querySelector('a').getAttribute('href'), '/document');
  await render('fr', createUiI18n({source, translations: {fr: {heading: 'Dossier {id}'}}}));
  assert.equal(container.textContent, 'Dossier A-10-2026-0175Read Ελληνικά');
  await render('en');
  assert.equal(container.textContent, 'Document A-10-2026-0175Read Ελληνικά');
});
