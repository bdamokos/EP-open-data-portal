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
  return {window, versionedPortraitUrl, root, image: () => container.querySelector('img'), render: (lazy = true, url = '/api/portrait/1') => act(async () => root.render(createElement(Portrait, {url, lazy})))};
}

test('real photo URLs render immediately and stay stable through loading priority and member changes', async t => {
  const h = await harness(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('portraits use native images'));
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

test('an opaque native image failure shows a silhouette without a retry that could ignore Retry-After', async t => {
  const h = await harness(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('native errors must not trigger a second GET'));
  await h.render(false);
  await act(async () => h.image().dispatchEvent(new h.window.Event('error')));
  assert.equal(h.image().getAttribute('src'), '/placeholder.svg');
  await act(async () => h.image().dispatchEvent(new h.window.Event('load')));
  assert.equal(h.image().dataset.status, 'error', 'a loaded fallback is still unavailable');
  await h.render(true);
  assert.equal(h.image().dataset.status, 'error', 'priority changes do not retry failures');
  await h.render(false, '/api/portrait/2');
  assert.equal(h.image().getAttribute('src'), h.versionedPortraitUrl('/api/portrait/2'));
  assert.equal(h.image().dataset.status, 'loading');
});

test('ordinary image URLs and placeholders retain their original paths', async t => {
  const h = await harness(t);
  for (const url of ['/assets/person.jpg', 'https://www.europarl.europa.eu/mepphoto/43.jpg', '/assets/portrait-placeholder.svg']) {
    await h.render(false, url);
    assert.equal(h.image().getAttribute('src'), url);
    await act(async () => h.image().dispatchEvent(new h.window.Event('load')));
    assert.equal(h.image().dataset.status, 'loaded');
  }
});
