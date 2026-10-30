import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement, act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

async function harness(t) {
  const window = new Window({url: 'http://localhost/'});
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const load = await freshLoader({configFile: false, server: {middlewareMode: true, hmr: false, ws: false, watch: null}, optimizeDeps: {noDiscovery: true}, oxc: {jsx: {runtime: 'automatic'}}});
  const {portraitLoader} = await load('/src/portraitLoader.mjs');
  const {usePortraitImage} = await load('/src/usePortraitImage.ts');
  const {versionedPortraitUrl} = await load('/server/portrait-version.mjs');
  const {createRoot} = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount()); await load.close(); await window.happyDOM.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  function Portrait({url, lazy}) {
    const image = usePortraitImage(url, '/placeholder.svg', lazy);
    return createElement('img', {ref: image.imageRef, src: image.src, loading: image.loading, onLoad: image.onLoad, onError: image.onError, 'data-status': image.status});
  }
  return {window, portraitLoader, versionedPortraitUrl, root, image: () => container.querySelector('img'), render: (lazy = true, url = '/api/portrait/1') => act(async () => root.render(createElement(Portrait, {url, lazy})))};
}

test('real photo URLs render immediately and stay stable through loading priority and member changes', async t => {
  const h = await harness(t);
  t.mock.method(h.portraitLoader, 'load', () => assert.fail('normal image loading must not wait for a JavaScript fetch'));
  t.mock.method(URL, 'createObjectURL', () => assert.fail('normal images must retain browser-cache URLs'));
  await h.render();
  assert.equal(h.image().getAttribute('src'), h.versionedPortraitUrl('/api/portrait/1'));
  assert.equal(h.image().loading, 'lazy');
  await act(async () => h.image().dispatchEvent(new h.window.Event('load')));
  assert.equal(h.image().dataset.status, 'loaded');
  await h.render(false); assert.equal(h.image().loading, 'eager');
  assert.equal(h.image().dataset.status, 'loaded');
  await h.render(true, '/api/portrait/2');
  assert.equal(h.image().getAttribute('src'), h.versionedPortraitUrl('/api/portrait/2'));
  assert.equal(h.image().dataset.status, 'loading');
});

test('a failed native request uses bounded recovery and only then shows the silhouette', async t => {
  const h = await harness(t); let reject, calls = 0;
  t.mock.method(h.portraitLoader, 'load', () => {calls++; return new Promise((_, no) => {reject = no;});});
  await h.render(false);
  await act(async () => h.image().dispatchEvent(new h.window.Event('error')));
  assert.equal(calls, 1);
  await act(async () => h.image().dispatchEvent(new h.window.Event('error')));
  assert.equal(calls, 1, 'duplicate image errors cannot create overlapping retries');
  await act(async () => reject(new Error('unavailable')));
  assert.equal(h.image().getAttribute('src'), '/placeholder.svg');
  await act(async () => h.image().dispatchEvent(new h.window.Event('load')));
  assert.equal(h.image().dataset.status, 'error', 'a loaded fallback is still unavailable');
});

test('late recovery cannot replace a different member and decoded retry URLs are released', async t => {
  const h = await harness(t); const requests = [], revoked = [];
  t.mock.method(h.portraitLoader, 'load', (url, {signal}) => new Promise(resolve => requests.push({resolve, signal})));
  t.mock.method(URL, 'createObjectURL', () => 'blob:recovered');
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  await h.render(false);
  await act(async () => h.image().dispatchEvent(new h.window.Event('error')));
  await h.render(false, '/api/portrait/2');
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => requests[0].resolve(new Blob(['old'])));
  assert.equal(h.image().getAttribute('src'), h.versionedPortraitUrl('/api/portrait/2'));
  await act(async () => h.image().dispatchEvent(new h.window.Event('error')));
  await act(async () => requests[1].resolve(new Blob(['new'])));
  assert.equal(h.image().getAttribute('src'), 'blob:recovered');
  await act(async () => h.image().dispatchEvent(new h.window.Event('load')));
  assert.equal(h.image().dataset.status, 'loaded');
  await h.render(false, '/api/portrait/3');
  assert.deepEqual(revoked, ['blob:recovered']);
});
