import {test} from 'node:test';
import assert from 'node:assert/strict';
import net, {connect} from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import {loopback} from './test-support/loopback.mjs';

// Deliberately do not import the guard: these assertions also prove that the
// runner's --import preload reaches each isolated Node test child.
test('network preload blocks external fetch before DNS and permits fetch mocks', async () => {
  await assert.rejects(fetch('https://network-guard.invalid/'), /tests must not reach the network: network-guard.invalid/);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('fixture');
    assert.equal(await (await fetch('https://network-guard.invalid/')).text(), 'fixture');
  } finally {globalThis.fetch = original;}
});

test('network preload covers TCP and TLS connection entry points', () => {
  for (const open of [
    () => net.connect(443, 'network-guard.invalid'),
    () => connect({port: 443, host: 'network-guard.invalid'}),
    () => net.createConnection({port: 443, host: 'network-guard.invalid'}),
    () => new net.Socket().connect({port: 443, host: 'network-guard.invalid'}),
    () => tls.connect({port: 443, host: 'network-guard.invalid'}),
  ]) assert.throws(open, /tests must not reach the network: network-guard.invalid/);
});

test('network preload permits loopback fetch and blocks outbound redirects', loopback, async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, {Location: 'https://network-guard.invalid/'}).end();
    } else response.end('local fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base)).text(), 'local fixture');
  await assert.rejects(fetch(`${base}/redirect`), error => /tests must not reach the network: network-guard.invalid/.test(error.cause?.message));
});
