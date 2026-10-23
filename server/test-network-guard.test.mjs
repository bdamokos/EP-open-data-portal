import {test} from 'node:test';
import assert from 'node:assert/strict';
import net, {connect} from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import dns from 'node:dns';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loopback} from './test-support/loopback.mjs';

const portForms = port => [String(port), `${port}.0`, `+${port}`, `0x${port.toString(16)}`, ` ${port} `, `${port}e0`, `0b${port.toString(2)}`, `0o${port.toString(8)}`];

function stubLookup(t) {
  return t.mock.method(dns, 'lookup', (_host, options, callback) => {
    if (typeof options === 'function') callback = options;
    queueMicrotask(() => callback(Object.assign(new Error('lookup sentinel'), {code: 'ENOTFOUND'})));
  });
}

const entryPoints = [
  (...args) => net.connect(...args),
  (...args) => connect(...args),
  (...args) => net.createConnection(...args),
  (...args) => new net.Socket().connect(...args),
  (...args) => tls.connect(...args),
];

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

test('numeric string port overloads reject external targets before lookup', t => {
  const lookup = stubLookup(t);
  for (const port of portForms(443)) {
    for (const open of entryPoints) {
      let socket;
      try {
        assert.throws(() => {
          socket = open(port, 'network-guard.invalid');
          socket.on('error', () => {});
        }, /tests must not reach the network: network-guard.invalid/, port);
      } finally {socket?.destroy();}
    }
    for (const args of [
      [port, {host: 'network-guard.invalid'}],
      [port, 'localhost', {host: 'network-guard.invalid'}],
      [{port, host: 'localhost'}, {host: 'network-guard.invalid'}],
    ]) {
      assert.throws(() => tls.connect(...args), /tests must not reach the network: network-guard.invalid/, port);
    }
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test('numeric string port overloads permit localhost lookup and honor TLS host overrides', async t => {
  const lookup = stubLookup(t);
  for (const port of portForms(443)) {
    for (const open of entryPoints) {
      const before = lookup.mock.callCount();
      const socket = open(port, 'localhost');
      try {
        const [error] = await once(socket, 'error');
        assert.equal(error.message, 'lookup sentinel');
        assert.equal(lookup.mock.callCount(), before + 1, port);
        assert.equal(lookup.mock.calls.at(-1).arguments[0], 'localhost');
      } finally {socket.destroy();}
    }
    const socket = tls.connect(port, 'network-guard.invalid', {host: 'localhost'});
    try {assert.equal((await once(socket, 'error'))[0].message, 'lookup sentinel');}
    finally {socket.destroy();}
  }
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

test('numeric loopback ports and IPC path overloads reach local endpoints', loopback, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'guard-ipc-'));
  const peers = new Set();
  const accept = socket => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => peers.delete(socket));
  };
  const tcp = net.createServer(accept);
  const ipc = net.createServer(accept);
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await Promise.all([tcp, ipc].map(server => new Promise(resolve => server.close(resolve))));
    await rm(directory, {recursive: true, force: true});
  });
  await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\guard-ipc-${process.pid}` : path.join(directory, '443.0.sock');
  await new Promise(resolve => ipc.listen(socketPath, resolve));
  async function reaches(server, open, args) {
    const accepted = once(server, 'connection', {signal: AbortSignal.timeout(10000)});
    accepted.catch(() => {});
    let socket;
    try {
      socket = open(...args);
      socket.on('error', () => {}); // A TLS client is closed before its handshake.
      const [peer] = await accepted;
      peer.destroy();
    } finally {socket?.destroy();}
  }
  for (const port of portForms(tcp.address().port)) {
    for (const open of entryPoints) await reaches(tcp, open, [port, '127.0.0.1']);
  }
  // IPC paths remain paths, including a host field which Node ignores for IPC.
  for (const open of entryPoints) {
    for (const args of [[socketPath], [{path: socketPath, host: 'network-guard.invalid'}]]) {
      await reaches(ipc, open, args);
    }
  }
});
