import { HttpError } from "./http-utils.mjs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { transcriptLanguage } from "./transcript-language.mjs";
import { speechWebsite, languageCode } from "./ep-links.mjs";
import { UpstreamQueue, retryAfterSeconds } from './upstream-queue.mjs';
import {speechSpeakers,speakerNameIsSpecific} from './speech-speakers.mjs';
import {PortraitCache} from './portrait-cache.mjs';
import {interventionMetadata} from './speech-interventions.mjs';

export const ODP_BASE = "https://data.europarl.europa.eu/api/v2";
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
const pending = new Map();
const upstreamQueue = new UpstreamQueue();
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
const slot = priority => upstreamQueue.acquire(priority);
export async function boundedUpstream(operation, {priority='interactive'}={}) {
  const release = await slot(priority);
  try { return await operation(); } finally { release(); }
}
export function backoffUpstream(seconds) {
  upstreamQueue.backoff(Math.min(1800, Math.max(30, seconds)));
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
const dayOf = (timestamp) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
const today = () => dayOf(Date.now());
export async function odp(
  endpoint,
  params = {},
  { force = false, ttl = TTL, daily = false, staleWhileRevalidate = false, priority='interactive' } = {},
) {
  const url = new URL(ODP_BASE + endpoint);
  for (const [key, value] of Object.entries({
    ...params,
    format: "application/ld+json",
  }))
    url.searchParams.set(key, String(value));
  const key = url.href;
  let stored = cache.get(key);
  if (!stored && cacheDir && !force) {
    try {
      const oldName=Buffer.from(key).toString('base64url')+'.json';
      const raw=await readFile(filename(key),'utf8').catch(e=>oldName.length<=255?readFile(path.join(cacheDir,oldName),'utf8'):Promise.reject(e));
      const record=JSON.parse(raw);
      if(record.url===key && Number.isFinite(record.fetchedAt) && Array.isArray(record.payload?.data)) {stored=record;cache.set(key,record);}
    } catch { /* Missing or invalid reproducible cache. */ }
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
      void odp(endpoint,params,{force:true,ttl,daily,priority:'background'}).catch(()=>{});
    return {...stored,stale:true,refreshInProgress:pending.has(key),refreshError:failure?.message || null};
  }
  const shared=pending.get(key);
  if(shared)return priority!=='background'&&shared.priority==='background'?upstreamQueue.joinBackground(shared.promise):shared.promise;
  const job = (async () => {
    let release;
    try {
      let response;
      let retryAfter;
      for (let attempt = 0; attempt < (priority==='background'?3:1); attempt++) {
        release = await slot(priority);
        response = await fetch(url, {
          headers: {
            Accept: "application/ld+json",
            "User-Agent":
              "Parliament-Explorer/0.1 (public parliamentary data)",
          },
          signal: AbortSignal.timeout(25_000),
        });
        retryAfter=undefined;
        if (response.status !== 429 && response.status !== 503) break;
        const seconds = retryAfterSeconds(response.headers.get("retry-after"));
        retryAfter=seconds;
        backoffUpstream(seconds);
        await response.body?.cancel();
        release();release=null;
      }
      if(retryAfter&&!response.ok)throw Object.assign(new HttpError(503,'odp_rate_limited','Parliament is temporarily limiting requests. Please try again after the pause.'),{retryAfter,retryAt:Date.now()+retryAfter*1000});
      if (!response.ok)
        throw new HttpError(
          502,
          "odp_unavailable",
          `Parliament data is unavailable (${response.status}). Please try again.`,
        );
      if (response.status === 204)
        throw new HttpError(502, "odp_no_content", "Parliament supplied no content for this request.");
      if (!response.headers.get("content-type")?.includes("json"))
        throw new HttpError(
          502,
          "odp_invalid",
          "Parliament returned an unexpected response.",
        );
      const text = await response.text();
      if (text.length > 12 * 1024 * 1024)
        throw new HttpError(
          502,
          "odp_size",
          "Parliament response exceeded the allowed size.",
        );
      const payload = JSON.parse(text);
      if (!Array.isArray(payload.data))
        throw new HttpError(
          502,
          "odp_invalid",
          "Parliament returned an unexpected data structure.",
        );
      const record = { url: key, fetchedAt: Date.now(), payload };
      refreshFailures.delete(key);
      cache.set(key, record);
      if (cache.size > 1800) cache.delete(cache.keys().next().value);
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        const temp=filename(key)+'.'+process.pid+'.tmp';
        await writeFile(temp, JSON.stringify(record)).then(()=>rename(temp,filename(key))).catch(() => {});
      }
      return record;
    } catch(error) {
      refreshFailures.set(key,{retryAt:Date.now()+60*60*1000,message:String(error.message).slice(0,250)});
      throw error;
    } finally {
      release?.();
    }
  })();
  pending.set(key, {promise:job,priority});
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
async function list(endpoint, params = {}) {
  const nodes = [];
  const sources = [];
  let fetchedAt = Date.now();
  for (let offset = 0; offset < 10000; offset += 1000) {
    const record = await odp(
      endpoint,
      { ...params, limit: 1000, offset },
      { daily: endpoint.endsWith("/show-current"), staleWhileRevalidate: true },
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
  return (person.hasMembership || [])
    .filter((m) =>
      String(m.membershipClassification || "").includes(
        "/COMMITTEE_PARLIAMENTARY_",
      ),
    )
    .map((m) => ({
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
    countryCode: p["api:country-of-representation"] || "",
    groupCode: p["api:political-group"] || "",
    imageUrl:
      p.img ||
      `https://www.europarl.europa.eu/mepphoto/${Number(p.identifier)}.jpg`,
    gender: firstString(p.hasGender).endsWith("/FEMALE") ? "f" : "m",
    hasCv: false,
    hasEmail: Boolean(p.hasEmail),
    hasNews: false,
    hasVideo: false,
  };
}
let directory;
let directoryPromise;
let directoryCheckedAt = 0;
let directoryStale = false;
let directorySources = [];
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
    ((directory.day === day && !directoryStale && Date.now() - directory.fetchedAt < TTL) ||
      Date.now() - directoryCheckedAt < 60_000)
  )
    return directory;
  if (directoryPromise) return directory || directoryPromise;
  directoryCheckedAt = Date.now();
  directoryPromise = (async () => {
    const [roster, bodies] = await Promise.all([
      list("/meps/show-current"),
      list("/corporate-bodies/show-current"),
    ]);
    const selected = bodies.nodes.filter((b) => activeCommittee(b, day));
    const committees = [];
    const sources = [...roster.sources, ...bodies.sources];
    // Queue in small batches to leave capacity for interactive requests.
    for (let i = 0; i < selected.length; i += 2) {
      committees.push(
        ...(await Promise.all(
          selected.slice(i, i + 2).map(async (b) => {
            const record = await odp(`/corporate-bodies/${b.identifier}`, {}, {staleWhileRevalidate:true});
            sources.push(record);
            const full = record.payload.data[0];
            if (!full || !activeCommittee(full, day)) return null;
            return {
              id: b.identifier,
              code: b.label,
              names: full.prefLabel || {},
              classification: tail(b.classification),
              start: full.temporal?.startDate,
              end: full.temporal?.endDate,
            };
          }),
        )),
      );
    }
    directory = {
      day,
      fetchedAt: Math.min(...sources.map(source => source.fetchedAt)),
      members: roster.nodes
        .map(memberSummary)
        .sort((a, b) => a.sortName.localeCompare(b.sortName)),
      committees: committees.filter(Boolean).sort((a, b) => a.code.localeCompare(b.code)),
    };
    directorySources = sources.map(source => source.url);
    directoryStale = sources.some(source => source.stale);
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
  })().catch(error => {
    directoryError = String(error.message);
    throw error;
  }).finally(() => {
    directoryPromise = null;
  });
  if (directory) {
    void directoryPromise.catch(() => {});
    return directory;
  }
  return directoryPromise;
}
export async function odpProfile(id, force = false, {priority='interactive'}={}) {
  const record = await odp(
    `/meps/${id}`,
    {},
    { force, ttl: 7 * 24 * 60 * 60 * 1000, priority },
  );
  const person = record.payload.data[0];
  if (!person)
    throw new HttpError(
      404,
      "mep_not_found",
      "This MEP profile is unavailable.",
    );
  const result = {
    ...memberSummary(person),
    birthDate: person.bday,
    birthPlace: person.placeOfBirth,
    email: firstString(person.hasEmail).replace(/^mailto:/, ""),
    memberships: memberships(person),
    accounts: (person.account || []).map((a) => a.id),
    fetchedAt: new Date(record.fetchedAt).toISOString(),
  };
  profileIndex.set(Number(id), result);
  return result;
}
function startIndex() {
  if (indexPromise || indexState.complete) return;
  indexPromise = (async () => {
    const failed = [];
    for (let i = 0; i < directory.members.length; i += 2) {
      await Promise.all(
        directory.members.slice(i, i + 2).map(async (m) => {
          try {
            await odpProfile(m.id,false,{priority:'background'});
          } catch (e) {
            failed.push(m.id);
            console.warn(`[odp] membership ${m.id}: ${e.message}`);
          }
        }),
      );
      indexState = {
        ...indexState,
        loaded: directory.members.filter((m) => profileIndex.has(m.id)).length,
        failed: failed.length,
      };
    }
    indexState = {
      ...indexState,
      complete: failed.length === 0,
      error: failed.length
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
export async function odpDirectory() {
  const d = await directoryData();
  startIndex();
  if (indexState.complete) scheduleSync();
  return {
    ...d,
    committees: d.committees.filter(body => activeCommittee({ classification: body.classification, temporal: { startDate: body.start, endDate: body.end } })),
    fetchedAt: new Date(d.fetchedAt).toISOString(),
    source: "European Parliament Open Data API v2",
    index: { ...indexState },
    sync: { ...syncState },
    directoryCache: {
      computedAt: new Date(directoryCheckedAt).toISOString(),
      stale: directoryStale || d.day !== today() || Date.now() - d.fetchedAt >= TTL,
      refreshInProgress: Boolean(directoryPromise) || directorySources.some(key => pending.has(key)),
      refreshError: directoryError || directorySources.map(key => refreshFailures.get(key)?.message).find(Boolean) || null,
    },
    members: d.members.map((m) => ({
      ...m,
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
  return {
    ...speechWebsite(doc),
    id: activity.activity_id,
    date: activity.activity_date,
    start: activity.activity_start_date || null,
    end: activity.activity_end_date || null,
    titles: activity.activity_label || {},
    kind: tail(activity.had_activity_type),
    reference: doc.number || "",
    originalLanguages: doc.originalLanguage || doc.originalLanguageURI || [],
    participants: activity.had_participation?.had_participant_person || [],
    intervention: interventionMetadata(activity),
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
  const record = await odp(`/speeches/${id}`, {
    "include-output": "xml_fragment",
  }, {staleWhileRevalidate:true});
  const activity = record.payload.data.find(item=>item.activity_id===id);
  if (!activity)
    throw new HttpError(404, "speech_not_found", "This speech is unavailable.");
  const docs = activity.recorded_in_a_realization_of || [];
  const selected=chooseTranscript(docs,language);
  return {
    ...speechSummary(activity),
    ...selected,
    speakers:speechSpeakers(activity,selected.xml).map(speaker=>{
      const person=profileIndex.get(Number(speaker.id))||directory?.members.find(member=>String(member.id)===speaker.id);
      const name=person&&[person.firstName,person.lastName].filter(Boolean).join(' ');
      return {...speaker,...(name?{name,nameSource:'ODP person record'}:{}),role:speaker.role||(!speakerNameIsSpecific(speaker.name)&&/president|chair/i.test(speaker.name)?'Chairing the sitting':null)};
    }),
    textCache:{sourceFetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError || null,availableLanguages:selected.availableTextLanguages,coverage:'returned-languages-only'},
    video: {
      available: false,
      reason:
        "A recording lookup and interpretation-track API is not available in the documented speech service.",
    },
    fetchedAt: new Date(record.fetchedAt).toISOString(),
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
  const release = await slot('background');
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/atom+xml",
        "User-Agent":
          "Parliament-Explorer/0.1 (public update feed)",
      },
      signal: AbortSignal.timeout(25000),
    });
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
  } finally {
    release();
  }
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
const SYNC_MS = 60 * 60 * 1000;
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
  if (
    !force &&
    syncState.lastAttempt &&
    Date.now() - Date.parse(syncState.lastAttempt) < SYNC_MS
  )
    return syncState;
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
      for (const update of bodies) {
        const body = d.committees.find((c) => c.id === update.id);
        if (!body) continue;
        const prior = await odp(`/corporate-bodies/${update.id}`,{}, {priority:'background'});
        if (Date.parse(update.updated) > prior.fetchedAt) {
          const fresh = (
            await odp(`/corporate-bodies/${update.id}`, {}, { force: true,priority:'background' })
          ).payload.data[0];
          body.names = fresh.prefLabel || {};
          body.code = fresh.label;
          body.classification = tail(fresh.classification);
          body.start = fresh.temporal?.startDate;
          body.end = fresh.temporal?.endDate;
          changedCommittees++;
        }
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
  if (!indexState.complete)
    throw new Error(indexState.error || "Membership preload is incomplete.");
  const sync = await syncOdpFeeds({ force: true });
  if (sync.error) throw new Error(sync.error);
  return odpDirectory();
}

const portraits = new PortraitCache();
export async function odpPortrait(id) {
  return portraits.get(id, async (memberId, {priority}) => (await odpProfile(memberId, false, {priority})).imageUrl);
}
