import {readFile} from 'node:fs/promises';
import {writeCacheFile} from './cache-publication.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { boundedUpstream } from './odp.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';

// Public ContentEvent interface used by Parliament's published player. No event
// password, cookie or browser Origin is supplied; only published records qualify.
export const CONTENT_SOCKET_URL = 'wss://websockets.services.eup.glcloud.eu/content-manager/api/v1/socket.io/?EIO=4&transport=websocket';
export const PLAYER_CODE_SOURCE = {
  url: 'https://webstreaming.europarl.europa.eu/content-manager/content-page/chunk-PZD5RX7C.js',
  sha256: 'f92f0b25dd9abc50fffbea7bd3b844a79c34da0ce8984a8b5381067a69b98813',
};
// Order from the player's getLanguageMap/Se implementation. Mapping-array index
// is the channel slot. Its separate `sort` property is only a display order.
export const PRIVATE_CHANNEL_CODES = ['qbf','qbd','qbb','qbc','qbe','qaf','qax','qat','qay','qaq','qav','qan','qai','qao','qak','qad','qaw','qba','qau','qap','qas','qam','qal','qah','qag','qae','qaz','qab','qaa','qaj','qar','qac'];
const supported = new Set(['or','uk','bg','es','cs','da','de','et','el','en','fr','ga','hr','it','lv','lt','hu','mt','nl','pl','pt','ro','sk','sl','fi','sv']);
const LIMIT = 2 * 1024 * 1024, DAY = 86400000;
const memory = new Map(), pending = new Map(), failures = new Map();
const validId = id => /^\d{8}-[A-Z0-9-]{1,80}$/.test(id);

export function validatePlayerContent(content, id) {
  if (!validId(id) || content?.commonId !== id || content.visibility !== 'PUBLISHED' || !Number.isFinite(Date.parse(content.startDate)) || !Number.isFinite(Date.parse(content.endDate)) || Date.parse(content.endDate) <= Date.parse(content.startDate) || !Array.isArray(content.languageMapping) || content.languageMapping.length > PRIVATE_CHANNEL_CODES.length) throw new Error('Invalid or unpublished player content metadata.');
  const languages = new Set();
  for (const channel of content.languageMapping) {
    if (channel === null) continue;
    if (!channel || typeof channel.lang !== 'string' || !/^[A-Z]{2}$/.test(channel.lang) || !Number.isInteger(channel.sort) || channel.sort < 0 || channel.sort > 100) throw new Error('Invalid player language mapping.');
    if (languages.has(channel.lang)) throw new Error('Ambiguous player language mapping.');
    languages.add(channel.lang);
  }
  return content;
}

export function fetchPlayerContent(id, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 15000 } = {}) {
  if (!validId(id) || typeof WebSocketImpl !== 'function') return Promise.reject(new Error('Player content interface unavailable.'));
  return new Promise((resolve, reject) => {
    let socket, finished = false, connected = false, joined = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(deadline);
      try { socket?.close(); } catch { /* This request owns only this connection. */ }
      error ? reject(error) : resolve(value);
    };
    const deadline = setTimeout(() => finish(new Error('Player content metadata timed out.')), timeoutMs);
    try { socket = new WebSocketImpl(CONTENT_SOCKET_URL); }
    catch { finish(new Error('Player content connection failed.')); return; }
    socket.addEventListener('error', () => finish(new Error('Player content connection failed.')));
    socket.addEventListener('close', () => finish(new Error('Player content connection closed before its response.')));
    socket.addEventListener('message', event => {
      if (finished) return;
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > LIMIT) return finish(new Error('Invalid or oversized player content response.'));
      const packet = event.data;
      try {
        if (packet.startsWith('0{') && !connected) {
          JSON.parse(packet.slice(1)); connected = true; socket.send('40/content,');
        } else if (packet === '2') socket.send('3');
        else if (packet.startsWith('40/content,') && connected && !joined) {
          joined = true; socket.send('42/content,0' + JSON.stringify(['join:event', { commonId: id }]));
        } else if (packet.startsWith('43/content,0') && joined) {
          const answer = JSON.parse(packet.slice('43/content,0'.length));
          if (!Array.isArray(answer) || answer.length !== 1) throw new Error('Invalid player content acknowledgement.');
          finish(null, validatePlayerContent(answer[0]?.contentEvent, id));
        } else if (packet.startsWith('44/content,')) finish(new Error('Player content namespace refused the request.'));
      } catch (error) { finish(new Error(String(error.message).slice(0, 200))); }
    });
  });
}

function cacheRecordValid(record, id) {
  if (record?.url !== CONTENT_SOCKET_URL || record.namespace !== '/content' || record.event !== 'join:event' || !Number.isFinite(Date.parse(record.fetchedAt))) return false;
  try { validatePlayerContent(record.payload, id); return true; } catch { return false; }
}

async function refresh(id, directory, key, fetchContent, priority) {
  if (pending.has(key)) return waitForRequest(pending.get(key));
  const operation = sharedRequest(signal=>boundedUpstream(async () => {
    const payload = validatePlayerContent(await fetchContent(id), id);
    signal.throwIfAborted();
    const record = { url: CONTENT_SOCKET_URL, namespace: '/content', event: 'join:event', fetchedAt: new Date().toISOString(), payload };
    if (Buffer.byteLength(JSON.stringify(record)) > LIMIT) throw new Error('Player content metadata exceeded size limit.');
    if (directory) {
      const file = path.join(directory, 'content', id + '.json');
      await writeCacheFile(file,JSON.stringify(record),{signal});
    }
    signal.throwIfAborted();
    memory.delete(key); memory.set(key, record);
    if (memory.size > 256) memory.delete(memory.keys().next().value);
    failures.delete(key);
    return { ...record, stale: false, refreshError: null };
  }, { priority,signal })).catch(error => {
    if(!isLocalRequestFailure(error))failures.set(key, { retryAt: Date.now() + 3600000, message: String(error.message).slice(0, 200) });
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, operation); return waitForRequest(operation);
}

export async function playerContent(id, directory, { fetchContent = fetchPlayerContent } = {}) {
  requestSignal()?.throwIfAborted();
  if (!validId(id)) throw new Error('Invalid recording identifier.');
  const key = (directory || '') + '|' + id;
  let saved = memory.get(key);
  if (!saved && directory) {
    try {
      const text = await readFile(path.join(directory, 'content', id + '.json'), 'utf8');
      if (Buffer.byteLength(text) <= LIMIT) saved = JSON.parse(text);
    } catch { /* Missing or malformed cache requires a normal public query. */ }
  }
  requestSignal()?.throwIfAborted();
  if (cacheRecordValid(saved, id)) {
    const stale = Date.now() - Date.parse(saved.fetchedAt) >= DAY;
    memory.set(key, saved);
    if (stale && (!failures.has(key) || failures.get(key).retryAt <= Date.now())) void refresh(id, directory, key, fetchContent, 'background').catch(() => {});
    return { ...saved, stale, refreshError: failures.get(key)?.message || null };
  }
  if (failures.get(key)?.retryAt > Date.now()) throw new Error(failures.get(key).message);
  return refresh(id, directory, key, fetchContent, 'interactive');
}

export function playerAudioMapping(record) {
  const content = validatePlayerContent(record.payload, record.payload?.commonId);
  return {
    schemaVersion: 1,
    channels: content.languageMapping.flatMap((item, slot) => item && supported.has(item.lang.toLowerCase()) ? [{ slot, language: item.lang.toLowerCase(), providerCode: PRIVATE_CHANNEL_CODES[slot] }] : []),
    source: { url: record.url, namespace: '/content', event: 'join:event', recordingId: content.commonId, sourceFetchedAt: record.fetchedAt, stale: Boolean(record.stale), refreshError: record.refreshError || null, payloadSha256: createHash('sha256').update(JSON.stringify(content)).digest('hex') },
    codeOrderSource: PLAYER_CODE_SOURCE,
  };
}
