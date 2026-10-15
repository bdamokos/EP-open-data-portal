import test from 'node:test';
import assert from 'node:assert/strict';
import { createPocClient } from './pocClient.mjs';

test('deduplicates pending reads while preserving each route', async () => {
  const calls = [];
  const client = createPocClient(async route => { calls.push(route); await new Promise(r => setTimeout(r, 5)); return { route }; });
  const [a, b, c] = await Promise.all([client.get('latest/1?lang=en'), client.get('latest/1?lang=en'), client.get('latest/2?lang=en')]);
  assert.deepEqual(calls, ['latest/1?lang=en', 'latest/2?lang=en']);
  assert.equal(a, b); assert.notEqual(a, c);
});

test('retains saved rows during refresh and after a failed refresh', async () => {
  let fail = false;
  const client = createPocClient(async () => { if (fail) throw new Error('Unavailable'); return { items: ['saved'] }; });
  const saved = await client.get('activities'); fail = true;
  const refresh = client.get('activities', { force: true });
  assert.equal(client.peek('activities'), saved);
  await assert.rejects(refresh, /Unavailable/);
  assert.equal(client.peek('activities'), saved);
});

test('bounds a stalled request even when the loader ignores abort', async () => {
  const client = createPocClient(() => new Promise(() => {}), { timeoutFor: () => 10 });
  await assert.rejects(client.get('speech'), /took too long/);
  assert.equal(client.peek('speech'), null);
});

test('bounds the cache and clears data when access expires', async () => {
  let expired = false;
  const client = createPocClient(async route => { if (expired) throw Object.assign(new Error('Sign in'), { status: 401 }); return route; }, { maxEntries: 2 });
  await client.get('one'); await client.get('two'); await client.get('three');
  assert.equal(client.peek('one'), null);
  expired = true;
  await assert.rejects(client.get('three', { force: true }), /Sign in/);
  assert.equal(client.peek('three'), null);
});
