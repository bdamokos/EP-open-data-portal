import { HttpError } from "./http-utils.mjs";
import {createReadStream} from "node:fs";
import {readFile,writeFile} from "node:fs/promises";
import {writeCacheFile} from './cache-publication.mjs';
import path from "node:path";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { transcriptLanguage } from "./transcript-language.mjs";
import { speechWebsite, languageCode } from "./ep-links.mjs";
import { UpstreamQueue, retryAfterSeconds } from './upstream-queue.mjs';
import {speechSpeakerDetails} from './speech-speakers.mjs';
import {SpeakerIdentities} from './speaker-identity.mjs';
import {PortraitCache} from './portrait-cache.mjs';
import {createCommitteeMembershipReader} from './committee-memberships.mjs';
import {parliamentaryService} from './parliamentary-service.mjs';
import {profileMemberships,createProfileMembershipReader,reference} from './profile-memberships.mjs';
import {interventionMetadata} from './speech-interventions.mjs';
import {requestSignal,runWithRequestSignal,waitForRequest,cancelledRequest,createRequestBudget,sharedRequest,isLocalRequestFailure} from './request-budget.mjs';
import {userAgent} from './user-agent.mjs';
import {compareMembers} from '../src/memberOrder.mjs';

export const ODP_BASE = "https://data.europarl.europa.eu/api/v2";
const TTL = 6 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
// JSON number normalization can expand a valid wire value (1e20 becomes 21 digits).
const MAX_DISK_RECORD_BYTES = 6 * MAX_SOURCE_BYTES + 64 * 1024;
const MAX_CACHE_ENTRIES = 1800;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map();
let cacheBytes = 0;
const pending = new Map();
// The published 500/5min endpoint ceiling is conservatively shared across ALL
// API v2 paths/IDs/queries. Reserve 50 starts for readers as a local fairness rule.
export const ODP_RATE_LIMIT=Object.freeze({maximum:500,windowMs:300_000,foregroundReserve:50});
const upstreamQueue = new UpstreamQueue({rateLimit:ODP_RATE_LIMIT});
const sourceQueues=new Map([['odp',upstreamQueue]]);
function sourceQueue(source) {
  if(!['odp','website','documents','multimedia','player'].includes(source))throw new Error('Unknown upstream source.');
  if(!sourceQueues.has(source))sourceQueues.set(source,new UpstreamQueue());
  return sourceQueues.get(source);
}
export const upstreamStatus=()=>upstreamQueue.snapshot();
const refreshFailures = new Map();
const cacheDir = process.env.ODP_CACHE_DIR;
const allowedLanguages = new Set(
  "bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv".split(
    " ",
  ),
);
export function odpLanguage(value) {
  if (!allowedLanguages.has(value))
    throw new HttpError(
      400,
      "invalid_language",
      "Choose a supported interface language.",
    );
  return value;
}
export async function boundedUpstream(operation, {source='odp',priority='interactive',signal=priority==='background'?undefined:requestSignal()}={}) {
  return sourceQueue(source).run(operation,{priority,signal});
}
export function backoffUpstream(seconds,{source='odp'}={}) {
  sourceQueue(source).backoff(seconds);
}
export function upstreamResponseError(response,{source='odp'}={}) {
  if(![429,503].includes(response.status??response.statusCode))return null;
  const seconds=retryAfterSeconds(response.headers?.get?response.headers.get('retry-after'):response.headers?.['retry-after']);
  backoffUpstream(seconds,{source});
  return Object.assign(new HttpError(503,'upstream_busy','The public source is temporarily limiting requests. Please try again after the pause.'),{retryAfter:seconds,retryAt:Date.now()+seconds*1000});
}
const firstString = (value) =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.find((x) => typeof x === "string") || ""
      : "";
function filename(key) {
  return path.join(
    cacheDir,
    createHash("sha256").update(key).digest("hex") + ".json",
  );
}
// Disk and upstream records share one count and serialized-byte budget.
function rememberSource(key, record, serialized = JSON.stringify(record)) {
  const bytes = Buffer.byteLength(serialized);
  const previous = cache.get(key);
  if (previous) {
    cacheBytes -= previous.bytes;
    cache.delete(key);
  }
  if (bytes > MAX_CACHE_BYTES) return;
  cache.set(key, {record, bytes});
  cacheBytes += bytes;
  while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).bytes;
    cache.delete(oldest);
  }
}
// Single reads and batch seeds may publish the same key concurrently. Each
// key's compare-and-publish runs alone and compares against the record on
// disk, so an older record never replaces a newer one in memory or on disk.
const sourceLocks = new Map();
function withSourceLock(key, operation) {
  const prior = sourceLocks.get(key);
  const run = (async () => { await prior; return operation(); })();
  const settled = run.catch(() => {});
  sourceLocks.set(key, settled);
  void settled.finally(() => {if (sourceLocks.get(key) === settled) sourceLocks.delete(key);});
  return run;
}
async function readDiskSource(key, signal) {
  if (!cacheDir) return null;
  try {
    const record = JSON.parse(await readSourceRecord(filename(key), signal));
    return record.url === key && Number.isFinite(record.fetchedAt) && Array.isArray(record.payload?.data) ? record : null;
  } catch { signal?.throwIfAborted(); return null; }
}
// The latest of the memory record and a record just read from disk. Memory may
// have advanced while the disk read was pending.
function newestSource(key, record) {
  const held = cache.get(key)?.record;
  return held && (!record || held.fetchedAt >= record.fetchedAt) ? held : record;
}
// Inside a lock the write itself is never cancelled: the lock is released only
// once the file is published, and a cancelled caller merely stops waiting.
const publishLocked = (key, serialized) => writeCacheFile(filename(key), serialized, {signal:null}).catch(() => {});
function publishSourceFile(key, record, serialized, signal) {
  return waitForRequest(withSourceLock(key, async () => {
    const disk = await readDiskSource(key, signal);
    if (disk && disk.fetchedAt >= record.fetchedAt || signal?.aborted) return;
    await publishLocked(key, serialized);
  }), signal ?? null);
}
async function readSourceRecord(file, signal) {
  signal?.throwIfAborted();
  // The inclusive end permits one overflow byte without trusting a prior stat.
  const stream = createReadStream(file, {start: 0, end: MAX_DISK_RECORD_BYTES, signal});
  const parts = [];
  let bytes = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > MAX_DISK_RECORD_BYTES) throw new Error('Saved Parliament source exceeds the allowed size.');
    parts.push(chunk);
  }
  signal?.throwIfAborted();
  return Buffer.concat(parts, bytes).toString('utf8');
}
// Every cache check formats a day; constructing the formatter dominates that.
const brusselsDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayOf = (timestamp) => brusselsDay.format(new Date(timestamp));
const today = () => dayOf(Date.now());
function observeSource(entry,priority,signal) {
  if(priority==='background'){
    if(!entry.backgroundOwner){
      entry.backgroundOwner=true;entry.budget.dispose();
      // Existing readers gain their own bounded background wait. Their departure
      // or the old foreground job deadline must not cancel the new durable owner.
      for(const follow of entry.foregroundWaiters)follow();
    }
    upstreamQueue.reprioritize(entry,entry.readers>0?'interactive':'background');
    return entry.promise;
  }
  entry.readers++;
  if(entry.backgroundOwner)upstreamQueue.reprioritize(entry,'interactive');
  let follow;
  const read=entry.backgroundOwner?upstreamQueue.joinBackground(entry.promise,{signal}):new Promise((resolve,reject)=>{
    follow=()=>upstreamQueue.joinBackground(entry.promise,{signal}).then(resolve,reject);
    entry.foregroundWaiters.add(follow);
    waitForRequest(entry.promise,signal).then(resolve,reject);
  });
  return read.finally(()=>{
    if(follow)entry.foregroundWaiters.delete(follow);
    entry.readers--;
    if(entry.backgroundOwner&&entry.readers===0)upstreamQueue.reprioritize(entry,'background');
    if(!entry.settled&&!entry.backgroundOwner&&entry.readers===0)entry.budget.abort(signal?.reason||cancelledRequest());
  });
}
export async function odp(
  endpoint,
  params = {},
  { force = false, ttl = TTL, daily = false, staleWhileRevalidate = false, cachedOnly=false, validate, retain=true, priority='interactive',signal=priority==='background'?undefined:requestSignal() } = {},
) {
  signal?.throwIfAborted();
  const url = new URL(ODP_BASE + endpoint);
  for (const [key, value] of Object.entries({
    ...params,
    format: "application/ld+json",
  }))
    url.searchParams.set(key, String(value));
  const key = url.href;
  let stored = cache.get(key)?.record;
  if (!stored && cacheDir && !force) {
    try {
      const oldName=Buffer.from(key).toString('base64url')+'.json';
      const raw=await readSourceRecord(filename(key),signal).catch(error=>{
        signal?.throwIfAborted();
        return oldName.length<=255?readSourceRecord(path.join(cacheDir,oldName),signal):Promise.reject(error);
      });
      signal?.throwIfAborted();
      const record=JSON.parse(raw);
      if(record.url===key && Number.isFinite(record.fetchedAt) && Array.isArray(record.payload?.data)) {
        stored=newestSource(key,record);
        if(stored===record)rememberSource(key,record);
      }
    } catch { /* Missing or invalid reproducible cache. */ }
  }
  signal?.throwIfAborted();
  if(stored&&validate) {
    try {validate(stored.payload);} catch {stored=undefined;}
  }
  if(cachedOnly) {
    if(!stored)throw new HttpError(404,'odp_cache_miss','This source record is not retained.');
    return {...stored,stale:Date.now()-stored.fetchedAt>=ttl || daily&&dayOf(stored.fetchedAt)!==today()};
  }
  if (
    !force &&
    stored &&
    Date.now() - stored.fetchedAt < ttl &&
    (!daily || dayOf(stored.fetchedAt) === today())
  )
    return stored;
  if (!force && stored && staleWhileRevalidate) {
    const failure=refreshFailures.get(key);
    if (!pending.has(key) && (!failure || failure.retryAt<=Date.now()))
      void odp(endpoint,params,{force:true,ttl,daily,validate,priority:'background'}).catch(()=>{});
    return {...stored,stale:true,refreshInProgress:pending.has(key),refreshError:failure?.message || null};
  }
  signal?.throwIfAborted();
  const shared=pending.get(key);
  if(shared){if(validate)shared.validators.add(validate);return observeSource(shared,priority,signal);}
  // Cold interactive work includes admission and body in one bounded job.
  // Background retries retain their owner while waiting through upstream pauses.
  const budget=priority==='background'?{signal:undefined,abort:()=>{},dispose:()=>{}}:createRequestBudget(30_000);
  const entry={priority,budget,backgroundOwner:priority==='background',readers:0,foregroundWaiters:new Set(),validators:new Set(validate?[validate]:[]),settled:false,promise:null};
  const job = runWithRequestSignal(undefined,async () => {
    let rateFailures=0;
    for(;;){
      let release;
      let rateLimitError;
      const reschedule=new AbortController();
      try {
        // Each attempt is admitted separately, including background retries.
        const response = await upstreamQueue.runHeld(releaseSlot=>{
          // Retain the connection through status handling and body consumption.
          release=releaseSlot;
          return fetch(url, {
          headers: {
            Accept: "application/ld+json",
            "User-Agent":
              userAgent("parliamentary data"),
          },
          signal: AbortSignal.any([reschedule.signal,AbortSignal.timeout(25_000),...(budget.signal?[budget.signal]:[])]),
          redirect: 'error',
          });
        },{priority:entry.readers>0||!entry.backgroundOwner?'interactive':'background',signal:budget.signal,owner:entry,backgroundOwner:entry.backgroundOwner,yieldBackground:()=>reschedule.abort()});
        if(response.status===429||response.status===503){
          const retryAfter=retryAfterSeconds(response.headers.get('retry-after'));
          rateFailures++;
          rateLimitError=Object.assign(new HttpError(503,'odp_rate_limited','Parliament is temporarily limiting requests. Please try again after the pause.'),{retryAfter,retryAt:Date.now()+retryAfter*1000});
          backoffUpstream(retryAfter);
          await response.body?.cancel();
          if(rateFailures>=(entry.backgroundOwner?3:1))throw rateLimitError;
          // Body cancellation may have yielded this operation. Always enter the
          // next admission with a fresh controller and the consumed failure count.
          continue;
        }
        if (!response.ok) {
          let source=null,responseBytes=0;
          if(response.status===404){
            // Preserve the actual HTTP observation. Only a domain reader can
            // decide whether a missing child collection means an empty one.
            const hash=createHash('sha256');
            if(response.body)for await(const chunk of response.body){responseBytes+=chunk.byteLength;if(responseBytes>MAX_SOURCE_BYTES)throw new HttpError(502,'odp_size','Parliament response exceeded the allowed size.');hash.update(chunk);}
            reschedule.signal.throwIfAborted();budget.signal?.throwIfAborted();
            source={url:key,fetchedAt:Date.now(),contentHash:hash.digest('hex'),httpStatus:404};
          }else await response.body?.cancel();
          throw Object.assign(new HttpError(
            502,
            "odp_unavailable",
            `Parliament data is unavailable (${response.status}). Please try again.`,
          ),{upstreamStatus:response.status,source,responseBytes});
        }
        if (response.status === 204)
          throw new HttpError(502, "odp_no_content", "Parliament supplied no content for this request.");
        if (!response.headers.get("content-type")?.includes("json")) {
          await response.body?.cancel();
          throw new HttpError(
            502,
            "odp_invalid",
            "Parliament returned an unexpected response.",
          );
        }
        const parts=[];let bytes=0;
        for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>MAX_SOURCE_BYTES)throw new HttpError(502,'odp_size','Parliament response exceeded the allowed size.');parts.push(chunk);}
        reschedule.signal.throwIfAborted();
        release?.();release=null;
        budget.signal?.throwIfAborted();
        const text=Buffer.concat(parts).toString('utf8');
        const payload = JSON.parse(text);
        if (!Array.isArray(payload.data))
          throw new HttpError(
            502,
            "odp_invalid",
            "Parliament returned an unexpected data structure.",
          );
        for(const validate of entry.validators)validate(payload);
        const record = { url: key, fetchedAt: Date.now(), payload };
        const serialized = JSON.stringify(record);
        refreshFailures.delete(key);
        if (retain) rememberSource(key, record, serialized);
        if (retain && cacheDir && Buffer.byteLength(serialized) <= MAX_DISK_RECORD_BYTES) {
          await publishSourceFile(key,record,serialized,budget.signal);
        }
        budget.signal?.throwIfAborted();
        return record;
      } catch(error) {
        // Losing the last foreground reader must leave a retained owner, but not
        // a second background connection. Its replacement spends a real quota
        // start and waits for background capacity without a foreground deadline.
        if(!budget.signal?.aborted){
          if(rateLimitError&&rateFailures>=(entry.backgroundOwner?3:1))error=rateLimitError;
          else if(reschedule.signal.aborted&&entry.backgroundOwner)continue;
        }
        if(!budget.signal?.aborted&&!isLocalRequestFailure(error)) {
          refreshFailures.delete(key);
          refreshFailures.set(key,{retryAt:Date.now()+60*60*1000,message:String(error.message).slice(0,250)});
          while(refreshFailures.size>MAX_CACHE_ENTRIES)refreshFailures.delete(refreshFailures.keys().next().value);
        }
        throw error;
      } finally {
        release?.();
      }
    }
  });
  entry.promise=job.finally(()=>{entry.settled=true;budget.dispose();if(pending.get(key)===entry)pending.delete(key);});
  pending.set(key,entry);
  return observeSource(entry,priority,signal);
}
export const speakerIdentities=new SpeakerIdentities({request:odp});
export const cachedSpeakerIdentities=new SpeakerIdentities({request:(endpoint,params,options)=>odp(endpoint,params,{...options,cachedOnly:true})});
async function list(endpoint, params = {}, {priority='interactive'}={}) {
  const nodes = [];
  const sources = [];
  let fetchedAt = Date.now();
  for (let offset = 0; offset < 10000; offset += 1000) {
    const record = await odp(
      endpoint,
      { ...params, limit: 1000, offset },
      { daily: endpoint.endsWith("/show-current"), staleWhileRevalidate: true, priority },
    );
    sources.push(record);
    nodes.push(...record.payload.data);
    fetchedAt = Math.min(fetchedAt, record.fetchedAt);
    if (record.payload.data.length < 1000) return { nodes, fetchedAt, sources };
  }
  throw new HttpError(
    502,
    "odp_pagination",
    "Parliament data exceeds the supported page count.",
  );
}
// Profiles name dozens of corporate bodies, and each single read takes seconds
// upstream. /corporate-bodies/{id,id,...} returns the same elements as the
// single reads, so one batch seeds the exact per-ID records the validated
// readers already use. A seeded record keeps its per-ID cache key as `url` and
// names the request that actually returned it in `retrievedFrom`. Omitted or
// ambiguous elements fall back to single reads.
const BODY_BATCH = 100;
// Bodies rarely change, and the daily feed sync refreshes those Parliament
// republishes. The age limit is only a backstop for missed feed entries.
const BODY_TTL = 7 * 24 * 60 * 60 * 1000;
const bodyId = /^(?:[1-9]\d*|ep-[1-9]\d*)$/;
const bodyEndpoint = id => `/corporate-bodies/${id}`;
const sourceKey = endpoint => {
  const url = new URL(ODP_BASE + endpoint);
  url.searchParams.set('format', 'application/ld+json');
  return url.href;
};
// Reads a retained record. Only a profile's own bodies are promoted into the
// memory cache; a warmup over every body must not evict profile and roster records.
async function peekSource(key, signal, remember = false) {
  const held = cache.get(key)?.record;
  if (held) return held;
  const record = newestSource(key, await readDiskSource(key, signal));
  if (remember && record && !cache.has(key)) rememberSource(key, record);
  return record;
}
// A single read in flight, or a newer record in memory or on disk, keeps its
// record; the comparison and both publications happen under the key's lock.
function seedSource(key, record, {memory, signal}) {
  return waitForRequest(withSourceLock(key, async () => {
    const disk = await readDiskSource(key, signal);
    const latest = cache.get(key)?.record;
    if (signal?.aborted || pending.has(key) || [disk, latest].some(held => held && held.fetchedAt >= record.fetchedAt)) return;
    const serialized = JSON.stringify(record);
    refreshFailures.delete(key);
    if (memory || latest) rememberSource(key, record, serialized);
    if (cacheDir && Buffer.byteLength(serialized) <= MAX_DISK_RECORD_BYTES) await publishLocked(key, serialized);
  }), signal ?? null);
}
// `updates` maps body IDs to feed publication times; an older retained record
// is refreshed even within its age limit.
export async function prefetchCorporateBodies(ids, {signal = requestSignal(), priority = 'interactive', memory = true, updates} = {}) {
  const wanted = [...new Set(ids.map(String))].filter(id => bodyId.test(id));
  for (let i = 0; i < wanted.length; i += BODY_BATCH) {
    const chunk = wanted.slice(i, i + BODY_BATCH);
    const missing = [];
    await Promise.all(chunk.map(async id => {
      const key = sourceKey(bodyEndpoint(id));
      // A recent single-read failure keeps its cooldown; the reader decides.
      if ((refreshFailures.get(key)?.retryAt || 0) > Date.now()) return;
      const held = await peekSource(key, signal, memory);
      if (!held || Date.now() - held.fetchedAt >= BODY_TTL || held.fetchedAt < (updates?.get(id) ?? -Infinity)) missing.push(id);
    }));
    signal?.throwIfAborted();
    if (!missing.length) continue;
    missing.sort();
    // A batch of one is the single read itself, so it is retained normally. Every
    // selected body is missing, expired or republished, so cached data never answers.
    const batch = await odp(bodyEndpoint(missing.join(',')), {}, {signal, priority, retain:missing.length === 1, force:true});
    const found = new Map();
    for (const element of batch.payload.data) {
      const id = String(element?.id || '').replace(/^(?:https:\/\/data\.europarl\.europa\.eu\/)?org\//, '');
      if (!missing.includes(id) || /^\d+$/.test(id) && String(element.identifier) !== id) continue;
      found.set(id, found.has(id) ? null : element);
    }
    const context = batch.payload['@context'];
    await Promise.all([...found].filter(([, element]) => element).map(([id, element]) => {
      const key = sourceKey(bodyEndpoint(id));
      return seedSource(key, {url:key, retrievedFrom:batch.url, fetchedAt:batch.fetchedAt, payload:{data:[element], ...(context === undefined ? {} : {'@context':context})}}, {memory, signal});
    }));
  }
}
let bodyWarmup = null;
// Keeps every corporate body retained on disk so a profile's first view reads
// locally. The catalogue page and batches run in the background queue.
export function startCorporateBodyWarmup({intervalMs = 24 * 60 * 60 * 1000} = {}) {
  const run = () => {
    if (!cacheDir || bodyWarmup) return;
    bodyWarmup = (async () => {
      // Offset pages of this catalogue skip bodies; one page returns all of them.
      const all = await odp('/corporate-bodies', {limit:10000}, {priority:'background', staleWhileRevalidate:true});
      await prefetchCorporateBodies(all.payload.data.map(node => node?.identifier), {priority:'background', memory:false, signal:undefined});
    })().catch(() => {}).finally(() => {bodyWarmup = null;});
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
export function validDuring(period, day = today()) {
  return Boolean(
    period?.startDate &&
    period.startDate <= day &&
    (!period.endDate || period.endDate >= day),
  );
}
export function activeCommittee(body, day = today()) {
  return /COMMITTEE_PARLIAMENTARY_(STANDING|SUB|TEMPORARY|SPECIAL)$/.test(body.classification || "") &&
    (!body.temporal?.startDate || body.temporal.startDate <= day) &&
    (!body.temporal?.endDate || body.temporal.endDate >= day);
}
const tail = (value) =>
  String(value || "")
    .split("/")
    .at(-1);
export function memberships(person, day) {
  return (Array.isArray(person.hasMembership)?person.hasMembership:[])
    .filter((m) =>
      String(m?.membershipClassification || "").includes(
        "/COMMITTEE_PARLIAMENTARY_",
      ),
    )
    .map((m) => ({
      membershipId: m.id || null,
      id: tail(m.organization),
      role: tail(m.role),
      classification: tail(m.membershipClassification),
      start: m.memberDuring?.startDate || null,
      end: m.memberDuring?.endDate || null,
      current: validDuring(m.memberDuring, day),
    }));
}
export function memberSummary(p) {
  return {
    id: Number(p.identifier),
    firstName: p.givenName || "",
    lastName: p.familyName || p.label,
    sortName: p.sortLabel || p.familyName,
    countryCode: firstString(p["api:country-of-representation"]).trim() || null,
    groupCode: firstString(p["api:political-group"]).trim() || null,
    imageUrl:
      p.img ||
      `https://www.europarl.europa.eu/mepphoto/${Number(p.identifier)}.jpg`,
    gender: firstString(p.hasGender).endsWith("/FEMALE") ? "f" : "m",
    hasCv: null,
    hasEmail: p.hasEmail == null ? null : Boolean(firstString(p.hasEmail).replace(/^mailto:/, "").trim()),
    hasNews: null,
    hasVideo: null,
  };
}
let directory;
let directoryPromise;
let directoryCheckedAt = 0;
let directoryStale = false;
let directorySources = [];
let directoryDetailsPromise;
let directoryDetailWork;
let committeeDetails = {complete:false,loaded:0,total:0,failed:0,error:null};
export const DIRECTORY_VERSION = 2;
export const PROFILE_VERSION = 6;
let directoryError = null;
let indexPromise;
let indexState = {
  complete: false,
  loaded: 0,
  total: 0,
  failed: 0,
  error: null,
};
const profileIndex = new Map();
async function directoryData() {
  const day = today();
  if (
    directory &&
    ((directory.day === day && !directoryStale && Date.now() - directory.listedAt < TTL) ||
      Date.now() - directoryCheckedAt < 60_000)
  )
    return directory;
  if (directoryPromise) return directory || waitForRequest(directoryPromise);
  directoryCheckedAt = Date.now();
  directoryPromise = sharedRequest(async () => {
    const [roster, bodies] = await Promise.all([
      list("/meps/show-current"),
      list("/corporate-bodies/show-current"),
    ]);
    const selected = bodies.nodes.filter((b) => activeCommittee(b, day));
    const sources = [...roster.sources, ...bodies.sources];
    const retained = directoryDetailWork?.details;
    const details = new Map();
    // Read retained details locally first. Missing optional names must not hold
    // the current roster and committee identifiers behind upstream requests.
    await Promise.all(selected.map(async body => {
      try {
        const record = await odp(`/corporate-bodies/${body.identifier}`, {}, {cachedOnly:true, ttl:BODY_TTL});
        if (committeeRecord(body, record)) {details.set(body.identifier, record);sources.push(record);}
      } catch { /* The public catalogue remains usable without a detail record. */ }
      if (!details.has(body.identifier) && retained?.has(body.identifier)) {
        const record = {...retained.get(body.identifier),stale:true};
        details.set(body.identifier,record);sources.push(record);
      }
    }));
    requestSignal()?.throwIfAborted();
    directory = {
      day,
      fetchedAt: Math.min(...sources.map(source => source.fetchedAt)),
      // Committee details follow the body age limit; the roster and catalogue
      // listings alone decide the directory's own freshness.
      listedAt: Math.min(...[...roster.sources, ...bodies.sources].map(source => source.fetchedAt)),
      members: roster.nodes
        .map(memberSummary)
        .sort(compareMembers),
      committees: selected.map(body => committeeSummary(body, details.get(body.identifier)?.payload.data[0], day)).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code)),
    };
    directorySources = sources;
    directoryStale = sources.some(source => source.stale);
    committeeDetails = {complete:details.size === selected.length,loaded:details.size,total:selected.length,failed:0,error:null};
    directoryDetailWork = {target:directory, selected, details, invalid:new Set(), errors:new Set()};
    startDirectoryDetails(directoryDetailWork);
    directoryError = null;
    const ids = new Set(directory.members.map(member => member.id));
    for (const id of profileIndex.keys()) if (!ids.has(id)) profileIndex.delete(id);
    const loaded = directory.members.filter(member => profileIndex.has(member.id)).length;
    indexState = {
      complete: loaded === directory.members.length,
      loaded,
      total: directory.members.length,
      failed: 0,
      error: null,
    };
    return directory;
  },120_000).catch(error => {
    directoryError = String(error.message);
    throw error;
  }).finally(() => {
    directoryPromise = null;
  });
  if (directory) {
    void directoryPromise.catch(() => {});
    return directory;
  }
  return waitForRequest(directoryPromise);
}
function committeeRecord(body, record) {
  const full = record?.payload.data[0];
  return full && String(full.identifier) === String(body.identifier) && full.classification ? full : null;
}
function committeeSummary(body, full = body, day = today()) {
  if (!activeCommittee(full, day)) return null;
  return {
    id: body.identifier,
    code: full.label || body.label,
    names: full.prefLabel || body.prefLabel || {},
    classification: tail(full.classification),
    start: full.temporal?.startDate,
    end: full.temporal?.endDate,
  };
}
function publishCommitteeRecord(target, body, record) {
  if (directory !== target) return;
  const prior = directorySources.find(source => source.url === record.url);
  if (prior && prior.fetchedAt > record.fetchedAt) return;
  if (directoryDetailWork?.target === target) directoryDetailWork.details.set(body.identifier,record);
  directorySources = directorySources.filter(source => source.url !== record.url).concat(record);
  const summary = committeeSummary(body,record.payload.data[0],target.day);
  target.committees = target.committees.filter(value => value.id !== body.identifier).concat(summary || []).sort((a,b) => a.code.localeCompare(b.code));
  target.fetchedAt = Math.min(...directorySources.map(source => source.fetchedAt));
  directoryStale = directorySources.some(source => source.stale);
}
function detailCoverage({target, selected, details, errors}) {
  if (directory === target) committeeDetails = {
    complete:details.size === selected.length,loaded:details.size,total:selected.length,failed:errors.size,
    error:errors.size ? 'Some committee details are unavailable. Showing retained names or committee codes.' : null,
  };
}
function startDirectoryDetails(work, {retry=false}={}) {
  if (directoryDetailsPromise) return;
  const {target, selected, details, invalid, errors} = work;
  const missing = selected.filter(body => {
    if (details.has(body.identifier) && !details.get(body.identifier).stale) return false;
    const url = new URL(ODP_BASE + `/corporate-bodies/${body.identifier}`);
    url.searchParams.set('format','application/ld+json');
    const failure = refreshFailures.get(url.href);
    if (failure) errors.add(body.identifier);
    // Preserve the source client's failure cooldown on automatic polling. A
    // malformed retained record requires an explicit refresh rather than loops.
    return retry || !invalid.has(body.identifier) && (!failure || failure.retryAt <= Date.now());
  });
  detailCoverage(work);
  if (!missing.length) return;
  // This uses the existing source writer and background queue. Readers never
  // wait for optional enrichment, and a failed detail never discards the roster.
  directoryDetailsPromise = (async () => {
    for (let i = 0; i < missing.length; i += 2) {
      await Promise.all(missing.slice(i, i + 2).map(async body => {
        try {
          const record = await odp(`/corporate-bodies/${body.identifier}`, {}, {priority:'background',ttl:BODY_TTL,force:invalid.has(body.identifier)});
          if (!committeeRecord(body, record)) {invalid.add(body.identifier);throw new Error('Committee details are unavailable.');}
          invalid.delete(body.identifier);errors.delete(body.identifier);
          publishCommitteeRecord(target,body,record);
        } catch {
          errors.add(body.identifier);
        }
        detailCoverage(work);
      }));
    }
  })().finally(() => {directoryDetailsPromise = null;});
}
// Exact raw profile-cache lookup only: no network request and no stale record.
export async function readCachedMepRecord(id,{now=Date.now(),signal}={}) {
  if(!/^[1-9]\d{0,8}$/.test(id))throw new Error('Invalid MEP identifier.');
  try {
    const record=await odp(`/meps/${id}`,{},{cachedOnly:true,ttl:7*24*60*60*1000,signal});
    if(record.fetchedAt>now||now-record.fetchedAt>=7*24*60*60*1000)return null;
    return record;
  }catch(error){if(signal?.aborted)throw error;return null;}
}
async function mepRecord(id, force = false, {priority='interactive'}={}) {
  const validate=payload=>{
    if(payload?.data?.length!==1||String(payload.data[0]?.identifier)!==String(id))
      throw new HttpError(404,'mep_not_found','This MEP profile is unavailable.');
  };
  const record = await odp(
    `/meps/${id}`,
    {},
    { force, ttl: 7 * 24 * 60 * 60 * 1000, priority, validate },
  );
  const person = record.payload.data[0];
  if (!person || String(person.identifier) !== String(id))
    throw new HttpError(
      404,
      "mep_not_found",
      "This MEP profile is unavailable.",
    );
  return record;
}
async function loadProfile(id, force = false, {priority='interactive'}={}) {
  const record = await mepRecord(id,force,{priority});
  const person = record.payload.data[0];
  // The per-person record carries country URIs and dated organization IDs,
  // not the current roster's codes. Use only an exact roster identifier join.
  const day = today();
  let roster, affiliationError = null;
  try { roster = await list("/meps/show-current", {}, {priority}); }
  catch (error) {
    requestSignal()?.throwIfAborted();
    affiliationError = 'Current roster affiliation is unavailable.';
  }
  const matches = roster?.nodes.filter(member => String(member.identifier) === String(person.identifier)) || [];
  if (matches.length > 1) affiliationError = 'Current roster affiliation is ambiguous.';
  const current = matches.length === 1 ? memberSummary(matches[0]) : null;
  const sourceSummary = source => ({url:source.url,fetchedAt:new Date(source.fetchedAt).toISOString(),stale:Boolean(source.stale)});
  const affiliationSources = (roster?.sources || []).map(sourceSummary);
  const result = {
    ...memberSummary(person),
    countryCode: current?.countryCode ?? null,
    groupCode: current?.groupCode ?? null,
    currentAffiliation: {
      day, personId:String(person.identifier),
      status:affiliationError ? 'unavailable' : current ? 'matched' : 'not-current',
      sources:affiliationSources, error:affiliationError,
    },
    birthDate: person.bday,
    birthPlace: person.placeOfBirth,
    parliamentaryService: parliamentaryService(person,day,affiliationError?'unavailable':current?'matched':'not-current'),
    email: firstString(person.hasEmail).replace(/^mailto:/, ""),
    memberships: memberships(person),
    accounts: (person.account || []).map((a) => a.id),
    fetchedAt: new Date(record.fetchedAt).toISOString(),
    sources: [sourceSummary(record), ...affiliationSources],
  };
  profileIndex.set(Number(id), result);
  return {profile:result,record};
}
export async function odpProfile(id, force = false, options={}) {
  return (await loadProfile(id,force,options)).profile;
}
const bodyRequest = (endpoint, params, options) => odp(endpoint, params, {ttl:BODY_TTL, ...options});
const readCommitteeMemberships = createCommitteeMembershipReader({request:bodyRequest});
const readProfileMemberships = createProfileMembershipReader({request:bodyRequest});
const rejectedProfileObservations = new Set();
export async function odpProfileWithMemberships(id) {
  let {profile,record} = await loadProfile(id);
  const parentSignal=requestSignal();
  if(rejectedProfileObservations.has(String(id))) {
    try {({profile,record}=await loadProfile(id,true));}
    catch {
      parentSignal?.throwIfAborted();
      record={...record,stale:true,refreshError:true};
    }
  }
  const observations=profileMemberships(record.payload.data[0],record);
  if(observations.observationComplete)rejectedProfileObservations.delete(String(id));
  else {
    rejectedProfileObservations.delete(String(id));rejectedProfileObservations.add(String(id));
    if(rejectedProfileObservations.size>256)rejectedProfileObservations.delete(rejectedProfileObservations.values().next().value);
  }
  const optionalSignal=AbortSignal.timeout(8000);
  const signal=AbortSignal.any([optionalSignal,...(parentSignal?[parentSignal]:[])]);
  // One batched read replaces dozens of serial body reads on a cold cache. The
  // readers below still validate every body and read singly what is missing.
  const organizations=Array.isArray(record.payload.data[0].hasMembership)?record.payload.data[0].hasMembership.map(row=>reference(row?.organization).replace(/^(?:https:\/\/data\.europarl\.europa\.eu\/)?org\//,'')):[];
  await prefetchCorporateBodies(organizations,{signal:AbortSignal.any([AbortSignal.timeout(5000),signal])}).catch(()=>{parentSignal?.throwIfAborted();});
  const membershipHistory=await readProfileMemberships(observations,{signal,parentSignal});
  const committeeMemberships=await readCommitteeMemberships(profile,today(),{signal:parentSignal,optionalSignal:signal});
  if(!membershipHistory.observationComplete) {
    committeeMemberships.complete=false;
    committeeMemberships.error=membershipHistory.observationAvailable?'Some membership records are incomplete. Available committee history is shown.':'Committee membership information is unavailable.';
  }
  const currentRosterMatched=profile.currentAffiliation.status==='matched';
  return {...profile,
    memberships:currentRosterMatched?profile.memberships:profile.memberships.map(row=>({...row,current:false})),
    membershipHistory,
    committeeMemberships:currentRosterMatched?committeeMemberships:{...committeeMemberships,items:committeeMemberships.items.map(card=>({...card,roles:[],periods:card.periods.map(period=>({...period,current:false}))}))},
  };
}
function startIndex() {
  if (indexPromise || indexState.complete) return;
  // Successful profiles remain usable when another profile fails. Retrying a
  // partial index only reads missing exact IDs, rather than the whole roster.
  const missing = directory.members.filter(member => !profileIndex.has(member.id));
  indexPromise = (async () => {
    const failed = new Set();
    for (let i = 0; i < missing.length; i += 2) {
      await Promise.all(
        missing.slice(i, i + 2).map(async (m) => {
          try {
            await odpProfile(m.id,false,{priority:'background'});
          } catch (e) {
            failed.add(m.id);
            console.warn(`[odp] membership ${m.id}: ${e.message}`);
          } finally {
            indexState = {
              ...indexState,
              loaded: directory.members.filter(m => profileIndex.has(m.id)).length,
              failed: directory.members.filter(m => failed.has(m.id) && !profileIndex.has(m.id)).length,
            };
          }
        }),
      );
    }
    const loaded = directory.members.filter(m => profileIndex.has(m.id)).length;
    indexState = {
      ...indexState, loaded, total:directory.members.length,
      complete: loaded === directory.members.length,
      error: loaded < directory.members.length
        ? "Some membership profiles could not be loaded. Retry the membership index."
        : null,
    };
  })()
    .catch(() => {
      indexState.error = "Membership loading failed. Please retry.";
    })
    .finally(() => {
      indexPromise = null;
    });
}
export async function odpDirectory({retryCommitteeDetails=false}={}) {
  const d = await directoryData();
  if (directoryDetailWork) startDirectoryDetails(directoryDetailWork,{retry:retryCommitteeDetails});
  startIndex();
  if (indexState.complete) scheduleSync();
  return {
    ...d,
    committees: d.committees.filter(body => activeCommittee({ classification: body.classification, temporal: { startDate: body.start, endDate: body.end } })),
    fetchedAt: new Date(d.fetchedAt).toISOString(),
    source: "European Parliament Open Data API v2",
    index: { ...indexState },
    committeeDetails: { ...committeeDetails },
    sync: { ...syncState },
    directoryCache: {
      computedAt: new Date(directoryCheckedAt).toISOString(),
      stale: directoryStale || d.day !== today() || Date.now() - d.listedAt >= TTL,
      refreshInProgress: Boolean(directoryPromise || directoryDetailsPromise) || directorySources.some(source => pending.has(source.url)),
      refreshError: directoryError || directorySources.map(source => refreshFailures.get(source.url)?.message).find(Boolean) || null,
    },
    members: d.members.map((m) => ({
      ...m,
      hasEmail: profileIndex.get(m.id)?.hasEmail ?? m.hasEmail,
      birthDate: profileIndex.get(m.id)?.birthDate,
      gender: profileIndex.get(m.id)?.gender || m.gender,
      memberships: profileIndex.get(m.id)?.memberships.map(membership => ({
        ...membership,
        current: validDuring({startDate:membership.start,endDate:membership.end}),
      })) ?? null,
    })),
  };
}
export function speechSummary(activity) {
  const doc =
    activity.recorded_in_a_realization_of?.find((x) => typeof x === "object") ||
    {};
  const intervention=interventionMetadata(activity);
  return {
    ...(intervention.type==='procedure'?{websiteUrl:null,websiteLanguage:null}:speechWebsite(doc)),
    id: activity.activity_id,
    date: activity.activity_date,
    start: activity.activity_start_date || null,
    end: activity.activity_end_date || null,
    titles: activity.activity_label || {},
    kind: tail(activity.had_activity_type),
    reference: doc.number || "",
    originalLanguages: doc.originalLanguage || doc.originalLanguageURI || [],
    participants: activity.had_participation?.had_participant_person || [],
    intervention,
  };
}
export function orderedSpeeches(payload) {
  const nodes = new Map(payload.data.map((n) => [n.id, n]));
  const hits = payload.searchResults?.hits;
  const activities = hits?.length
    ? hits.map((h) => nodes.get(h.id)).filter(Boolean)
    : payload.data;
  return activities
    .map(speechSummary)
    .sort(
      (a, b) => Date.parse(b.start || b.date) - Date.parse(a.start || a.date),
    );
}
export async function odpSpeeches(id, language, offset) {
  const record = await odp("/speeches", {
    "person-id": id,
    "parliamentary-term": 10,
    "activity-type": "PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT",
    "sort-by": "sitting-date:desc",
    limit: 50,
    offset,
  });
  return {
    items: orderedSpeeches(record.payload),
    total: record.payload.meta?.total ?? record.payload.data.length,
    offset,
    fetchedAt: new Date(record.fetchedAt).toISOString(),
  };
}
export function chooseTranscript(docs, language) {
  const fragments = Object.assign(
    {},
    ...docs
      .filter((x) => x && typeof x === "object")
      .map((d) => d["api:xmlFragment"] || {}),
  );
  const sourceKeys=Object.fromEntries(Object.keys(fragments).map(key=>[key,key]));
  // Some originals are stored under `mul` even when the XML identifies one
  // actual language. Expose that language to the reader without losing its key.
  if(typeof fragments.mul==='string') {
    const info=transcriptLanguage(fragments.mul);
    const actual=info.tags.length===1&&allowedLanguages.has(info.tags[0])&&!info.machine?info.tags[0]:null;
    if(actual) {
      if(!fragments[actual] || transcriptLanguage(fragments[actual]).machine){fragments[actual]=fragments.mul;sourceKeys[actual]='mul';}
      delete fragments.mul;delete sourceKeys.mul;
    }
  }
  const entries = Object.entries(fragments).filter(
    ([, xml]) => typeof xml === "string" && xml,
  );
  const infos = entries.map(([, xml]) => transcriptLanguage(xml));
  const declaredSource = docs.flatMap(doc => {
    const value = doc?.originalLanguage || doc?.originalLanguageURI || [];
    return Array.isArray(value) ? value : [value];
  }).map(languageCode).find(Boolean);
  const sourceLanguage = declaredSource || infos.flatMap((info) => info.tags)
    .find((tag) => tag.includes("-t-"))?.split("-t-")[0] ||
    infos.map((info) => info.originalLanguage).find(Boolean);
  const original = sourceLanguage && entries.find(([key, xml]) => {
    const info = transcriptLanguage(xml);
    return (info.tags.length || Boolean(declaredSource)) &&
      !info.tags.some((tag) => tag.includes("-t-")) &&
      key === sourceLanguage;
  })?.[0];
  const textLanguage =
    typeof fragments[language] === "string" && fragments[language]
      ? language
      : original ||
        Object.keys(fragments).find(
          (k) => typeof fragments[k] === "string" && fragments[k],
        ) ||
        null;
  const selectedInfo = transcriptLanguage(textLanguage ? fragments[textLanguage] : null);
  return {
    textLanguage,
    xml: textLanguage ? fragments[textLanguage] : null,
    languageTags: selectedInfo.tags,
    translationType: !textLanguage ? null : selectedInfo.machine ? "machine" :
      textLanguage === original ? "original" : "unspecified",
    availableTextLanguages: Object.keys(fragments).filter(
      (k) => typeof fragments[k] === "string" && fragments[k],
    ),
    ...(textLanguage&&sourceKeys[textLanguage]!==textLanguage?{sourceFragmentKey:sourceKeys[textLanguage]}:{}),
  };
}
export async function odpSpeech(id, language) {
  const {speechTranscript}=await import('./speech-transcript.mjs');
  try {
    const retained=await speechTranscript(id,language);
    if(retained.available&&retained.metadata)return {...retained.metadata,xml:retained.xml};
  }catch {requestSignal()?.throwIfAborted();}
  const record = await odp(`/speeches/${id}`, {
    "include-output": "xml_fragment",
  }, {staleWhileRevalidate:true});
  const activity = record.payload.data.find(item=>item.activity_id===id);
  if (!activity)
    throw new HttpError(404, "speech_not_found", "This speech is unavailable.");
  const docs = activity.recorded_in_a_realization_of || [];
  const selected=chooseTranscript(docs,language);
  const details=speechSpeakerDetails(activity);
  const speakers=await speakerIdentities.enrich(details,activity.activity_date,{chairs:details.filter(person=>person.sittingRole==='chair').map(person=>person.id),profileIds:details.map(person=>person.id)});
  return {
    ...speechSummary(activity),
    ...selected,
    speakers,
    textCache:{sourceFetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError || null,availableLanguages:selected.availableTextLanguages,coverage:'returned-languages-only'},
    video: {
      available: false,
      reason:
        "A recording lookup and interpretation-track API is not available in the documented speech service.",
    },
    fetchedAt: new Date(record.fetchedAt).toISOString(),
    metadataSource:{url:record.url,fetchedAt:new Date(record.fetchedAt).toISOString()},
  };
}

export function parseFeed(xml, entity) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new HttpError(502, "feed_invalid", "Unexpected feed declaration.");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
    parseTagValue: false,
  }).parse(xml);
  if (!Object.hasOwn(parsed, "feed"))
    throw new HttpError(
      502,
      "feed_invalid",
      "Parliament returned an invalid update feed.",
    );
  const entries = parsed.feed?.entry ? [parsed.feed.entry].flat() : [];
  const updates = new Map();
  for (const entry of entries) {
    const match = String(entry.id || "").match(
      new RegExp(`^https://data\\.europarl\\.europa\\.eu/${entity}/([0-9]+)$`),
    );
    if (!match || !Number.isFinite(Date.parse(entry.updated))) continue;
    const existing = updates.get(match[1]);
    if (!existing || entry.updated > existing.updated)
      updates.set(match[1], { id: match[1], updated: entry.updated });
  }
  return [...updates.values()];
}
async function feed(endpoint, params, entity) {
  const url = new URL(ODP_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return boundedUpstream(async()=>{
    const r = await fetch(url, {
      headers: {
        Accept: "application/atom+xml",
        "User-Agent":
          userAgent("update feed"),
      },
      signal: AbortSignal.timeout(25000),
      redirect: 'error',
    });
    const limited=upstreamResponseError(r);
    if(limited){await r.body?.cancel();throw limited;}
    if (r.status === 204) return [];
    if (!r.ok)
      throw new HttpError(
        502,
        "feed_unavailable",
        `Parliament update feed unavailable (${r.status}).`,
      );
    const xml = await r.text();
    if (xml.length > 12 * 1024 * 1024)
      throw new HttpError(
        502,
        "feed_size",
        "Parliament update feed exceeded the allowed size.",
      );
    return parseFeed(xml, entity);
  },{priority:'background'});
}
let syncState = {
  lastSuccess: null,
  lastAttempt: null,
  changedMeps: 0,
  changedCommittees: 0,
  error: null,
};
let syncPromise;
let syncLoaded = false;
// Parliament republishes its records nightly; a daily check is enough, except
// during a plenary sitting and two hours after it, when records change hourly.
const SYNC_MS = 24 * 60 * 60 * 1000;
const PLENARY_SYNC_MS = 60 * 60 * 1000;
const PLENARY_TAIL_MS = 2 * 60 * 60 * 1000;
// The sitting's agenda blocks bound its hours: from the first block start to
// the last block end plus the tail. No timed block means no window.
export function plenarySyncWindow(rows, day) {
  const values = value => Array.isArray(value) ? value : value == null ? [] : [value];
  const times = (Array.isArray(rows) ? rows : [])
    .filter(row => String(row?.had_activity_type || '').endsWith('/MEETING_PART') && String(row.activity_id || '').startsWith(`MTG-PL-${day}-TF-`))
    .flatMap(row => [...values(row.activity_start_date), ...values(row.activity_end_date)])
    .map(value => Date.parse(value)).filter(Number.isFinite);
  return times.length ? {start:Math.min(...times), end:Math.max(...times) + PLENARY_TAIL_MS} : null;
}
const sittingWindows = new Map();
async function sittingWindow(day) {
  const saved = sittingWindows.get(day);
  // Today's agenda may be published or revised during the day, so every answer
  // about today, including an empty one, is rechecked hourly. A past day's read
  // agenda is final; an unavailable one is retried after an hour.
  if (saved && (saved.known && day !== dayOf(Date.now()) || Date.now() - saved.checkedAt < PLENARY_SYNC_MS)) return saved.window;
  let window = null, known = true;
  try {
    const rows = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const record = await odp(`/meetings/MTG-PL-${day}/foreseen-activities`, {limit:50, offset}, {priority:'background', signal:undefined, ttl:PLENARY_SYNC_MS});
      rows.push(...record.payload.data);
      if (record.payload.data.length < 50) break;
    }
    window = plenarySyncWindow(rows, day);
  } catch (error) { if (error?.code !== 'odp_no_content') known = false; }
  sittingWindows.set(day, {checkedAt:Date.now(), window, known});
  for (const key of sittingWindows.keys()) if (sittingWindows.size > 4) sittingWindows.delete(key);
  return window;
}
// The Brussels calendar day before `day`; 24 hours earlier is wrong across DST.
export const previousDay = day => new Date(Date.parse(day + 'T12:00:00Z') - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
async function inPlenaryWindow(now = Date.now()) {
  // A late sitting's tail can cross midnight, so yesterday's window counts too.
  for (const day of [dayOf(now), previousDay(dayOf(now))]) {
    const window = await sittingWindow(day);
    if (window && now >= window.start && now <= window.end) return true;
  }
  return false;
}
async function loadSyncState() {
  if (syncLoaded) return;
  syncLoaded = true;
  if (cacheDir)
    try {
      const saved = JSON.parse(
        await readFile(path.join(cacheDir, "sync-state.json"), "utf8"),
      );
      if (saved.lastSuccess && Number.isFinite(Date.parse(saved.lastSuccess)))
        syncState = { ...syncState, ...saved };
    } catch {}
}
export async function syncOdpFeeds({ force = false } = {}) {
  await loadSyncState();
  if (syncPromise) return syncPromise;
  if (!force && syncState.lastAttempt) {
    const elapsed = Date.now() - Date.parse(syncState.lastAttempt);
    if (elapsed < PLENARY_SYNC_MS || elapsed < SYNC_MS && !(await inPlenaryWindow().catch(() => false))) return syncState;
    if (syncPromise) return syncPromise;
  }
  syncPromise = (async () => {
    const d = await directoryData();
    const began = new Date().toISOString();
    const start = new Date(
      (syncState.lastSuccess
        ? Date.parse(syncState.lastSuccess)
        : Date.now() - 30 * 24 * 60 * 60 * 1000) -
        24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    syncState = { ...syncState, lastAttempt: began, error: null };
    try {
      const people = await feed(
        "/meps/feed",
        { timeframe: "custom", "start-date": start },
        "person",
      );
      const bodies = await feed("/corporate-bodies/feed", {}, "org");
      let changedMeps = 0,
        changedCommittees = 0;
      const current = new Set(d.members.map((m) => String(m.id)));
      for (const update of people.filter((p) => current.has(p.id))) {
        const p = await odpProfile(update.id,false,{priority:'background'});
        if (Date.parse(update.updated) > Date.parse(p.fetchedAt)) {
          await odpProfile(update.id,true,{priority:'background'});
          changedMeps++;
        }
      }
      // Retained bodies follow the feed in background batches on disk. A failure
      // leaves them for the next sync, whose feed still lists them.
      await prefetchCorporateBodies(bodies.map(update => update.id), {priority:'background', memory:false, signal:undefined,
        updates:new Map(bodies.map(update => [update.id, Date.parse(update.updated)]))}).catch(() => {});
      for (const update of bodies) {
        const body = d.committees.find((c) => c.id === update.id);
        if (!body) continue;
        let record = await odp(`/corporate-bodies/${update.id}`,{}, {priority:'background',ttl:BODY_TTL});
        if (Date.parse(update.updated) > record.fetchedAt)
          record = await odp(`/corporate-bodies/${update.id}`, {}, {force:true,priority:'background'});
        // The directory shows a committee's details until a newer record exists.
        const shown = directorySources.find(source => source.url === record.url);
        if (shown && shown.fetchedAt >= record.fetchedAt) continue;
        const catalogue = {identifier:body.id,label:body.code};
        if (!committeeRecord(catalogue,record)) throw new Error('Committee details are unavailable.');
        publishCommitteeRecord(d,catalogue,record);
        if (directoryDetailWork?.target === d) {
          directoryDetailWork.invalid.delete(body.id);directoryDetailWork.errors.delete(body.id);
          detailCoverage(directoryDetailWork);
        }
        changedCommittees++;
      }
      syncState = {
        lastSuccess: began,
        lastAttempt: began,
        changedMeps,
        changedCommittees,
        error: null,
      };
      if (cacheDir)
        await writeFile(
          path.join(cacheDir, "sync-state.json"),
          JSON.stringify(syncState),
        );
    } catch (e) {
      syncState = { ...syncState, error: e.message };
    }
    return syncState;
  })();
  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}
function scheduleSync() {
  void syncOdpFeeds().catch(() => {});
}
export async function preloadOdp() {
  await odpDirectory();
  if (indexPromise) await indexPromise;
  if (directoryDetailsPromise) await directoryDetailsPromise;
  if (!committeeDetails.complete)
    throw new Error(committeeDetails.error || "Committee detail preload is incomplete.");
  if (!indexState.complete)
    throw new Error(indexState.error || "Membership preload is incomplete.");
  const sync = await syncOdpFeeds({ force: true });
  if (sync.error) throw new Error(sync.error);
  return odpDirectory();
}

const portraits = new PortraitCache();
export async function odpPortrait(id) {
  // Portraits need only the person record, not current roster enrichment.
  return portraits.get(id, async (memberId, {priority}) => memberSummary((await mepRecord(memberId,false,{priority})).payload.data[0]).imageUrl);
}
