import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';

function checkHost(host) {
  const name = String(host ?? 'localhost').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(name)) {
    throw new Error(`tests must not reach the network: ${host}`);
  }
}
function checkConnection(args) {
  // net.createConnection passes Socket.connect its normalized [options, callback].
  if (Array.isArray(args[0])) args = args[0];
  const first = args[0];
  if (first && typeof first === 'object') {
    if (first.path && !first.host) return; // Local IPC sockets are not outbound TCP.
    checkHost(first.host);
  } else if (typeof first === 'string' && !/^\d+$/.test(first)) return;
  else checkHost(typeof args[1] === 'string' ? args[1] : undefined);
}
function guard(original) {
  return function (...args) {
    checkConnection(args);
    return Reflect.apply(original, this, args);
  };
}
net.Socket.prototype.connect = guard(net.Socket.prototype.connect);
net.connect = guard(net.connect);
net.createConnection = guard(net.createConnection);
tls.connect = guard(tls.connect);
syncBuiltinESMExports();
// Catch fetch before DNS, including environments with a pre-existing undici pool.
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol === 'http:' || url.protocol === 'https:') checkHost(url.hostname);
  return originalFetch(input, init);
};
