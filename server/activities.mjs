import {sourceTitles} from './source-titles.mjs';
import {booleanFromEnvironment} from './config.mjs';
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import {readFile} from "node:fs/promises";
import {writeCacheFile} from './cache-publication.mjs';
import path from "node:path";
import { HttpError } from "./http-utils.mjs";
import { boundedUpstream, upstreamResponseError, odp, odpProfile } from "./odp.mjs";
import { languageCode } from "./ep-links.mjs";
import { documentText } from './document-text.mjs';
import { documentAuthorIdentities, documentCoAuthors } from './document-authors.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {browserCompatibleUserAgent} from './user-agent.mjs';

const rssCache = new Map();
const rssPending = new Map();
const TTL = 60 * 60 * 1000;
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === "string" ? value : String(value?.["#text"] || "");
const tail = value => String(value || "").split("/").at(-1);

function publicationUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "www.europarl.europa.eu" || u.username || u.password || u.port) return null;
    if (!/^\/(doceo\/document\/|plenary\/[a-z]{2}\/vod\.html)/.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}
export function parseActivities(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported feed declarations.");
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid activity feed XML.");
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  if (!root.rss?.channel) throw new Error("Parliament returned an invalid activity feed.");
  const seen = new Set();
  return array(root.rss.channel.item).flatMap(item => {
    const id = text(item.guid);
    const url = publicationUrl(text(item.link));
    const published = Date.parse(text(item.pubDate));
    if (!id || !url || !Number.isFinite(published) || seen.has(id)) return [];
    seen.add(id);
    const category = array(item.category).find(c => c?.["@_domain"] === "type");
    const doc = new URL(url).pathname.match(/\/doceo\/document\/([A-Z0-9-]+)_[A-Z]{2}\.(?:html|pdf)$/)?.[1] || null;
    const speech = id.match(/^(?:VD-ORAPL_|CRPLORA_CRE-\d+-\d{4}-\d{2}-\d{2}-INT-)(\d+)/)?.[1] || null;
    return [{ id, title: text(item.title), category: text(category).replace(/^pinion /, "Opinion ") || "Parliamentary publication", origin: id.split("_")[0], url, documentId: doc, detailsAvailable: Boolean(doc && documentEndpoint(doc)), speechNumber: speech, publishedAt: new Date(published).toISOString() }];
  }).sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function activityFeedUrl(email, language) {
  const alias = String(email || "").replace(/^mailto:/, "").match(/^([a-z0-9][a-z0-9._-]*)@europarl\.europa\.eu$/i)?.[1];
  return alias ? `https://www.europarl.europa.eu/rss/mep/${alias.toLowerCase()}/${language}.xml` : null;
}

export async function recentActivities(id, language) {
  requestSignal()?.throwIfAborted();
  const profile = await odpProfile(id);
  const url = activityFeedUrl(profile.email, language);
  if (!url) throw new HttpError(404, "activity_feed_unavailable", "An activity feed could not be resolved for this MEP.");
  const stored = rssCache.get(url);
  if (stored && Date.now() - stored.fetchedAt < TTL) return stored.result;
  if (rssPending.has(url)) return waitForRequest(rssPending.get(url));
  const job = sharedRequest(async signal => {
    const cacheDir = process.env.ODP_CACHE_DIR;
    const name = cacheDir && path.join(cacheDir, "rss-" + createHash("sha256").update(url).digest("hex") + ".json");
    if (name) {
      try {
        const record = JSON.parse(await readFile(name, "utf8"));
        if (record.url === url && Date.now() - record.fetchedAt < TTL && typeof record.xml === "string") {
          const result = { items: parseActivities(record.xml).slice(0,25), sourceUrl: url, limit: 25, fetchedAt: new Date(record.fetchedAt).toISOString() };
          signal.throwIfAborted();
          rssCache.set(url, { fetchedAt: record.fetchedAt, result });
          return result;
        }
      } catch { /* Absent or expired reproducible feed cache. */ }
    }
    signal.throwIfAborted();
    const record = await boundedUpstream(async signal => {
      const response = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml", "User-Agent": browserCompatibleUserAgent("MEP activity feeds") }, signal: AbortSignal.any([AbortSignal.timeout(25_000),...(signal?[signal]:[])]), redirect: "error" });
      const limited=upstreamResponseError(response,{source:'website'});
      if(limited){await response.body?.cancel();throw limited;}
      if (response.status !== 200 || !/xml/.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel();
        throw new HttpError(502, "activity_feed_unavailable", "Parliament’s activity feed is unavailable. Please try again.");
      }
      const xml = await response.text();
      if (xml.length > 2 * 1024 * 1024) throw new HttpError(502, "activity_feed_size", "Parliament’s activity feed exceeded the supported size.");
      return { url, fetchedAt: Date.now(), xml };
    },{source:'website',signal});
    let items;
    try { items = parseActivities(record.xml); }
    catch { throw new HttpError(502, "activity_feed_invalid", "Parliament’s activity feed could not be read."); }
    const result = { items: items.slice(0,25), sourceUrl: url, limit: 25, fetchedAt: new Date(record.fetchedAt).toISOString() };
    signal.throwIfAborted();
    rssCache.set(url, { fetchedAt: record.fetchedAt, result });
    if (rssCache.size > 500) rssCache.delete(rssCache.keys().next().value);
    if (name)await writeCacheFile(name,JSON.stringify(record),{signal}).catch(()=>{});
    signal.throwIfAborted();
    return result;
  }).finally(() => rssPending.delete(url));
  rssPending.set(url, job);
  return waitForRequest(job);
}

export function documentEndpoint(id) {
  if (/^[EOP]-\d+-\d{4}-\d+(?:-ASW)?$/.test(id)) return `/parliamentary-questions/${id.replace(/-ASW$/, "")}`;
  if (/^(?:A|B|RC)-\d+-\d{4}-\d+$/.test(id)) return `/plenary-documents/${id}`;
  if (/^TA-\d+-\d{4}-\d+$/.test(id)) return `/adopted-texts/${id}`;
  if (/^[A-Z]{3,5}-(?:AD|AL|AM|PA|PR)-\d+(?:-\d+)*$/.test(id)) return `/committee-documents/${id}`;
  return null;
}
function files(work) {
  return array(work.is_realized_by).flatMap(expression => array(expression.is_embodied_by).flatMap(m => {
    const value = m.is_exemplified_by;
    if (typeof value !== "string") return [];
    const u = new URL(value, "https://data.europarl.europa.eu/");
    if (u.protocol !== "https:" || u.hostname !== "data.europarl.europa.eu" || u.port || !u.pathname.startsWith("/distribution/") || u.username || u.password) return [];
    return [{ url: u.href, language: languageCode(expression.language), format: tail(m.format) || "File" }];
  }));
}
export function documentSummary(work, person) {
  return {
    id: work.identifier || tail(work.id),
    titles: sourceTitles(work.title_dcterms || Object.assign({}, ...array(work.is_realized_by).map(e => e.title || {}))),
    date: work.document_date || null,
    kind: tail(work.work_type),
    roles: array(work.workHadParticipation).filter(p => array(p.had_participant_person).includes(`person/${person}`)).map(p => tail(p.participation_role)),
    files: files(work),
    answers: array(work.inverse_answers_to).filter(a => typeof a === "object").map(a => ({ id: a.identifier || tail(a.id), date: a.document_date || null, titles: sourceTitles(a.title_dcterms), files: files(a) })),
  };
}
export async function activityDocument(id, person, language, {request=odp,readText=documentText}={}) {
  const endpoint = documentEndpoint(id);
  if (!endpoint) throw new HttpError(400, "unsupported_document", "This publication has no supported document-detail API. Open it on Parliament’s website.");
  let record, store;
  if(booleanFromEnvironment('ACTIVITY_INDEX_ENABLED')) {
    const {activityIndex}=await import('./activity-index-worker.mjs');
    store=activityIndex().store;
    const saved=store.source(store.status().servingGeneration,endpoint);
    if(saved)record={payload:{data:[saved.work]},fetchedAt:Date.parse(saved.fetchedAt)};
  }
  record ||= await request(endpoint,{}, {staleWhileRevalidate:true});
  if (!record.payload.data[0]) throw new HttpError(404, "document_unavailable", "This document is unavailable in the Open Data API.");
  const work=record.payload.data[0];
  const authorIds=documentAuthorIdentities(work);
  const memberQuery=store?.db.prepare('SELECT body FROM members WHERE id=?');
  const members=authorIds.flatMap(author=>{
    const row=memberQuery?.get(String(author.id));
    return row?[JSON.parse(row.body)]:[];
  });
  const selected=id.endsWith('-ASW')?array(work.inverse_answers_to).find(a=>(a.identifier || tail(a.id))===id):work;
  const selectedText=selected?await readText(selected,language):{status:'unavailable',paragraphs:[],textLanguage:null,requestedLanguage:language,availableTextLanguages:[],translationType:null,sourceFormat:null,sourceUrl:null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:'The requested answer is not supplied by this question record.',extraction:null};
  let authorText=id.endsWith('-ASW')?null:selectedText;
  // Ordering is optional enrichment. Never start a second download or hide a
  // readable answer because its question text is unavailable.
  if(id.endsWith('-ASW')&&authorIds.length>1&&members.length===authorIds.length&&members.every(member=>typeof member.name==='string'&&member.name.trim())) {
    try { authorText=await readText(work,language,{cacheOnly:true}); }
    catch { requestSignal()?.throwIfAborted(); }
  }
  const coAuthorData=documentCoAuthors(work,{members,selectedDocumentId:id,documentApiUrl:'https://data.europarl.europa.eu/api/v2'+endpoint,documentFetchedAt:new Date(record.fetchedAt).toISOString(),rosterFetchedAt:store?.get('rosterFetchedAt') || null,authorText});
  const summary=documentSummary(work,person);
  return { ...summary, ...coAuthorData,relatedQuestion:id.endsWith('-ASW')?{id:summary.id,titles:summary.titles,date:summary.date}:null, selectedDocumentId:id,selectedDocumentDate:selected?.document_date||null,selectedText,requestedLanguage: language, fetchedAt: new Date(record.fetchedAt).toISOString(),sourceCache:{stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null} };
}
