import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement, act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('priority changes preserve requests and decoded portraits, and can start a waiting portrait', async t => {
  const window = new Window({url: 'http://localhost/'});
  const observers = [], requests = [], revoked = [];
  class Observer {
    constructor(callback) {this.callback = callback; observers.push(this);}
    observe() {}
    disconnect() {}
  }
  window.IntersectionObserver = Observer;
  const globals = {window, document: window.document, HTMLElement: window.HTMLElement, IntersectionObserver: Observer, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  let vite, root, nextBlob = 0;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    if (vite) await vite.close();
    await window.happyDOM.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  });
  t.mock.method(URL, 'createObjectURL', () => `blob:portrait-${++nextBlob}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  vite = await createServer({configFile: false, server: {middlewareMode: true, hmr: false, watch: null}, optimizeDeps: {noDiscovery: true}, oxc: {jsx: {runtime: 'automatic'}}});
  const {portraitLoader} = await vite.ssrLoadModule('/src/portraitLoader.mjs');
  t.mock.method(portraitLoader, 'load', (url, {signal}) => new Promise(resolve => requests.push({url, signal, resolve})));
  const {usePortraitImage} = await vite.ssrLoadModule('/src/usePortraitImage.ts');
  function Portrait({url, lazy}) {
    const image = usePortraitImage(url, '/placeholder.svg', lazy);
    return createElement('img', {ref: image.imageRef, src: image.src, onLoad: image.onLoad, 'data-status': image.status});
  }
  const {createRoot} = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  const render = (lazy, url = '/api/portrait/1') => act(async () => root.render(createElement(Portrait, {url, lazy})));
  const image = () => container.querySelector('img');

  await render(true);
  assert.equal(requests.length, 0);
  await act(async () => observers.at(-1).callback([{isIntersecting: true}]));
  assert.equal(requests.length, 1);
  await render(false);
  await render(true);
  assert.equal(requests.length, 1, 'priority changes must not restart active work');
  assert.equal(requests[0].signal.aborted, false);
  await act(async () => requests[0].resolve(new Blob(['portrait'])));
  await act(async () => image().dispatchEvent(new window.Event('load')));
  assert.equal(image().getAttribute('data-status'), 'loaded');
  const displayed = image().getAttribute('src');
  await render(false);
  await render(true);
  assert.equal(image().getAttribute('src'), displayed, 'loaded image stays displayed across priority changes');
  assert.equal(image().getAttribute('data-status'), 'loaded');
  assert.equal(requests.length, 1);
  assert.deepEqual(revoked, []);

  await render(true, '/api/portrait/2');
  assert.equal(image().getAttribute('src'), '/placeholder.svg');
  assert.deepEqual(revoked, [displayed], 'changing source releases the old blob');
  assert.equal(requests.length, 1, 'new lazy source waits for proximity');
  await render(false, '/api/portrait/2');
  assert.equal(requests.length, 2, 'promotion starts a waiting source without an intersection');
  assert.equal(requests[1].url, '/api/portrait/2');
  await act(async () => requests[1].resolve(new Blob(['next portrait'])));
  const second = image().getAttribute('src');
  await act(async () => root.unmount()); root = null;
  assert.deepEqual(revoked, [displayed, second], 'unmount releases the remaining blob');
  assert.equal(requests[1].signal.aborted, true);
});
