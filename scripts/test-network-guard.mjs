import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';

function checkHost(host) {
  const name = String(host ?? 'localhost').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(name)) {
    throw new Error(`tests must not reach the network: ${host}`);
  }
}
function checkConnection(args, tlsOptions) {
  // net.createConnection passes Socket.connect its normalized [options, callback].
  if (Array.isArray(args[0])) args = args[0];
  const first = args[0];
  let options;
  if (first && typeof first === 'object') {
    options = first;
  // Match Node's net.normalizeArgs pipe/port distinction, including numeric
  // strings such as '443.0', '+443' and '0x1bb'. Native port validation follows.
  } else if (typeof first === 'string' && !(Number(first) >= 0)) options = {path: first};
  else options = {port: first, host: typeof args[1] === 'string' ? args[1] : undefined};
  // TLS merges its optional options object after normalizing positional args;
  // options.host can override a positional host. Do not mutate caller options.
  if (tlsOptions) options = {...options, ...(args[1] !== null && typeof args[1] === 'object' ? args[1] : args[2])};
  if (options.path) return; // Node gives explicit IPC paths precedence over host.
  checkHost(options.host);
}
function guard(original, tlsOptions = false) {
  return function (...args) {
    checkConnection(args, tlsOptions);
    return Reflect.apply(original, this, args);
  };
}
net.Socket.prototype.connect = guard(net.Socket.prototype.connect);
net.connect = guard(net.connect);
net.createConnection = guard(net.createConnection);
tls.connect = guard(tls.connect, true);
syncBuiltinESMExports();
// Catch fetch before DNS, including environments with a pre-existing undici pool.
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol === 'http:' || url.protocol === 'https:') checkHost(url.hostname);
  return originalFetch(input, init);
};
