import {readFile} from 'node:fs/promises';
import {writeCacheFile} from './cache-publication.mjs';
import path from 'node:path';
import { boundedUpstream, odp, speechSummary } from './odp.mjs';
import { activityIndex } from './activity-index-worker.mjs';
import { HttpError } from './http-utils.mjs';
import { playerContent, playerAudioMapping } from './player-content.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {userAgent} from './user-agent.mjs';
import {retainedSpeechMetadata} from './corpus-speeches.mjs';

export const MMC_BASE = 'https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0';
const DAY = 86400000;
const root = () => process.env.ODP_CACHE_DIR ? path.join(process.env.ODP_CACHE_DIR, 'mmc') : null;
const pending = new Map();
const memory = new Map();
const failures = new Map();
const idPattern = /^\d{8}-[A-Z0-9-]{1,80}$/;
const speechPattern = /^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/;
const reason = {
  'catalogue-missing': 'The recording catalogue has not been loaded for this date.',
  'catalogue-invalid': 'The saved recording catalogue could not be verified.',
  'missing-times': 'This contribution has no usable video start and end times.',
  'invalid-duration': 'The returned speech duration exceeds the one-hour prototype clip limit.',
  'not-recorded-speech': 'This contribution is not a recorded oral speech.',
  'metadata-unavailable': 'Recording details are temporarily unavailable.',
  'outside-recording': 'The speech is outside the returned recording coverage.',
  'ambiguous': 'More than one recording covers this speech; the match needs checking.',
  'audio-unverified': 'This recording’s requested language track has not been verified.',
  'audio-unavailable': 'This recording does not offer the requested language track.',
  'audio-selection-unverified': 'Automatic selection of this recording’s requested language track has not been verified.',
  'audio-metadata-unavailable': 'The recording’s audio mapping is temporarily unavailable.',
  'audio-metadata-mismatch': 'The player audio metadata does not match the recording’s identity and coverage.',
};

export function validateCatalogue(value) {
  if (value?.schemaVersion !== 1 || value.term !== 10 || !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.records) || value.records.length > 1000 || value.records.length !== value.total || !Array.isArray(value.sourcePages)) throw new Error('Invalid catalogue.');
  const ids = new Set();
  for (const row of value.records) {
    if (!idPattern.test(row.id) || ids.has(row.id) || !/^\d{4}-\d{2}-\d{2} /.test(row.start) || !/^\d{4}-\d{2}-\d{2} /.test(row.end)) throw new Error('Invalid catalogue record.');
    ids.add(row.id);
  }
  for (const page of value.sourcePages) {
    const url = new URL(page.url);
    if (url.origin !== new URL(MMC_BASE).origin || url.pathname !== new URL(MMC_BASE + '/search').pathname || page.status !== 200) throw new Error('Invalid catalogue source.');
  }
  return value;
}

async function smallJson(filename, limit = 2 * 1024 * 1024) {
  const text = await readFile(filename, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new Error('Metadata exceeded size limit.');
  return JSON.parse(text);
}

export function officialEmbed(detail, id) {
  if (detail?.mediaBusinessId !== id) return null;
  for (const asset of detail.mediaAssets || []) {
    try {
      const url = new URL(asset.url);
      if (url.origin === 'https://webstreaming.europarl.europa.eu' && !url.username && !url.password && !url.hash && url.pathname === '/ep/embed/embed.html' && url.searchParams.getAll('event').length === 1 && url.searchParams.get('event') === id) return url.href;
    } catch { /* Unknown assets are not embeds. */ }
  }
  return null;
}

async function freshDetail(id, directory) {
  if (pending.has(id)) return waitForRequest(pending.get(id));
  const task = sharedRequest(signal=>boundedUpstream(async () => {
    const url = MMC_BASE + '/media/' + id;
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent('recording metadata') }, signal: AbortSignal.any([signal,AbortSignal.timeout(25000)]), redirect: 'error' });
    if (!response.ok) {await response.body?.cancel();throw new Error(`Multimedia recording details unavailable (${response.status}).`);}
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Multimedia metadata exceeded size limit.');
    const payload = JSON.parse(text), detail = payload.resultJSON?.content;
    signal.throwIfAborted();
    if (!officialEmbed(detail, id) || !Number.isFinite(Date.parse(detail.meetingStartDate)) || Date.parse(detail.meetingEndDate) <= Date.parse(detail.meetingStartDate)) throw new Error('Multimedia returned invalid recording details.');
    const record = { url, fetchedAt: new Date().toISOString(), payload };
    memory.set(id, record);
    failures.delete(id);
    if (directory) {
      const filename = path.join(directory, 'recordings', id + '.json');
      await writeCacheFile(filename,JSON.stringify(record),{signal});
    }
    signal.throwIfAborted();
    return { ...record, stale: false };
  },{signal})).catch(error=>{if(!isLocalRequestFailure(error))failures.set(id,{retryAt:Date.now()+3600000,message:String(error.message).slice(0,200)});throw error;}).finally(() => pending.delete(id));
  pending.set(id, task);
  return waitForRequest(task);
}

export async function recordingDetail(id, directory) {
  requestSignal()?.throwIfAborted();
  if (!idPattern.test(id)) throw new Error('Invalid recording identifier.');
  let saved = memory.get(id);
  if (!saved && directory) {
    try { saved = await smallJson(path.join(directory, 'recordings', id + '.json')); } catch { /* Cold cache. */ }
  }
  requestSignal()?.throwIfAborted();
  if (saved && saved.url === MMC_BASE + '/media/' + id && officialEmbed(saved.payload?.resultJSON?.content, id) && Number.isFinite(Date.parse(saved.fetchedAt))) {
    memory.set(id, saved);
    const stale = Date.now() - Date.parse(saved.fetchedAt) >= DAY;
    if (stale && (!failures.has(id) || failures.get(id).retryAt<=Date.now())) void freshDetail(id, directory).catch(() => {});
    return { ...saved, stale, refreshError: failures.get(id)?.message || null };
  }
  if (failures.get(id)?.retryAt>Date.now()) throw new Error(failures.get(id).message);
  return freshDetail(id, directory);
}

export function clipUrl(base, language, audio, start, end) {
  const url = new URL(base);
  url.searchParams.delete('start');
  url.searchParams.delete('end');
  url.searchParams.set('language', language);
  url.searchParams.set('audio', audio);
  url.searchParams.set('autoplay', 'false');
  url.searchParams.set('analytics', 'false');
  // The published embed parser rejects percent-encoded ISO colons.
  return url.href + '&start=' + start + '&end=' + end;
}

export function matchRecording(speech, details) {
  const start = Date.parse(speech.start), end = Date.parse(speech.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { status: 'missing-times' };
  const matches = details.filter(record => {
    const detail = record.payload.resultJSON.content;
    return start >= Date.parse(detail.meetingStartDate) && end <= Date.parse(detail.meetingEndDate);
  });
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'outside-recording' };
  return { status: 'matched', record: matches[0], startUtc: new Date(Math.floor(start / 1000) * 1000).toISOString().replace('.000Z', 'Z'), endUtc: new Date(Math.ceil(end / 1000) * 1000).toISOString().replace('.000Z', 'Z') };
}

async function speechForMedia(id) {
  if (!speechPattern.test(id)) throw new HttpError(400, 'invalid_speech', 'Invalid speech identifier.');
  if (process.env.ACTIVITY_INDEX_ENABLED === 'true') {
    const store = activityIndex().store;
    const saved = store.db.prepare('SELECT body FROM items WHERE generation=? AND source_key=? LIMIT 1').get(store.status().servingGeneration, '/speeches/' + id);
    if (saved) {
      const row=JSON.parse(saved.body);
      return { id:row.sourceId, date:row.date, start:row.start, end:row.end, kind:row.speechKind };
    }
  }
  const retained=await retainedSpeechMetadata(id);
  if(retained)return retained.summary;
  const result = await odp('/speeches/' + id);
  const activity = result.payload.data.find(row => row.activity_id === id);
  if (!activity) throw new HttpError(404, 'speech_not_found', 'This speech is unavailable.');
  return speechSummary(activity);
}

export async function speechMedia(id, language, audio = language, dependencies = {}) {
  const directory = dependencies.directory ?? root();
  const speech = await (dependencies.speech || speechForMedia)(id);
  const base = { speechId: id, available: false, embedUrl: null, originalEmbedUrl: null, requestedAudio: audio, initialAudio: 'or', availableAudioLanguages: [], audioVerification: 'unverified', selectionMethod: null, selectionVerifiedLanguages: [], requiresAudioCheck: true, audioMapping: null, recording: null, clip: null, provenance: { documentedSpeechApi: true, documentedMediaApi: false, documentedPlayerControl: false, documentedAudioContentApi: false, htmlScraping: false, catalogueRefresh: 'Explicit source snapshot; automatic server search remains blocked.' } };
  const fail = (status, additions = {}) => ({ ...base, ...additions, status, reason: reason[status] });
  if (!['PLENARY_DEBATE_SPEECH', 'VOTE_EXPLANATION_ORAL', 'PLENARY_PROCEEDING_SPEECH', 'PLENARY_CHAIR_SPEECH'].includes(speech.kind)) return fail('not-recorded-speech');
  if (!Number.isFinite(Date.parse(speech.start)) || !Number.isFinite(Date.parse(speech.end)) || Date.parse(speech.end) <= Date.parse(speech.start)) return fail('missing-times');
  if (Date.parse(speech.end)-Date.parse(speech.start)>3600000) return fail('invalid-duration');
  let catalogue;
  try { catalogue = validateCatalogue(dependencies.catalogue || await smallJson(path.join(directory || '', 'catalogue-v1.json'))); }
  catch (error) { return fail(error.code === 'ENOENT' || !directory ? 'catalogue-missing' : 'catalogue-invalid'); }
  base.provenance.catalogue = { fetchedAt: catalogue.fetchedAt, dateFrom: catalogue.dateFrom, dateTo: catalogue.dateTo, total: catalogue.total, sourcePages: catalogue.sourcePages.map(page => page.url), acquisition: catalogue.acquisition };
  const candidates = catalogue.records.filter(row => row.start.slice(0, 10) === speech.date && row.status === 'RECORDED');
  if (!candidates.length) return fail('catalogue-missing');
  const results = await Promise.allSettled(candidates.map(row => (dependencies.detail || recordingDetail)(row.id, directory)));
  // A failed candidate could overlap the successful one; do not silently choose it.
  if (results.some(result => result.status === 'rejected')) return fail('metadata-unavailable');
  const match = matchRecording(speech, results.map(result => result.value));
  if (match.status !== 'matched') return fail(match.status);
  const detail = match.record.payload.resultJSON.content, official = officialEmbed(detail, detail.mediaBusinessId);
  const additions = {
    originalEmbedUrl: clipUrl(official, language, 'or', match.startUtc, match.endUtc),
    recording: { id: detail.mediaBusinessId, start: detail.meetingStartDate, end: detail.meetingEndDate, websiteUrl: 'https://multimedia.europarl.europa.eu/' + language + '/webstreaming/plenary-session_' + detail.mediaBusinessId, officialEmbedUrl: official, sourceUrl: match.record.url, sourceFetchedAt: match.record.fetchedAt, stale: match.record.stale || false, refreshError:match.record.refreshError || null },
    clip: { startUtc: match.startUtc, endUtc: match.endUtc, speechStart: speech.start, speechEnd: speech.end, precision: 'UTC seconds rounded outward; streaming segments may add padding, not frame exact.' },
  };
  let content;
  try { content = await (dependencies.content || playerContent)(detail.mediaBusinessId, directory); }
  catch { return fail('audio-metadata-unavailable', additions); }
  if (content.payload?.commonId !== detail.mediaBusinessId || Date.parse(content.payload.startDate) !== Date.parse(detail.meetingStartDate) || Date.parse(content.payload.endDate) !== Date.parse(detail.meetingEndDate)) return fail('audio-metadata-mismatch', additions);
  let mapping;
  try { mapping = playerAudioMapping(content); }
  catch { return fail('audio-metadata-unavailable', additions); }
  Object.assign(additions, {
    audioMapping: mapping,
    availableAudioLanguages: mapping.channels.map(channel => channel.language),
    audioVerification: 'official-content-map-runtime-check-required',
    selectionMethod: 'iframe-inventory-and-adaptation',
  });
  if (!additions.availableAudioLanguages.includes(audio)) return fail('audio-unavailable', additions);
  // Always start paused on original. The client checks actual tracks and their
  // adaptation/quality events before playing the separately requested language.
  return { ...base, ...additions, status: 'matched', available: true, reason: null, embedUrl: clipUrl(official, language, 'or', match.startUtc, match.endUtc) };
}
