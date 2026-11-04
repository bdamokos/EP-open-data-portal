import {speechRecheckCadence} from './speech-recheck.mjs';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {absolutePathFromEnvironment} from './config.mjs';
import {validDay} from './source-availability.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {outsideSpeech} from './outside-model.mjs';
import {EU_PROTOCOL_ORDER} from './language-order.mjs';
import {collectorPaused,collectorRetry} from './collector-retry.mjs';

const DAY=86400_000;
export function trimPublishedRole(value){
 if(typeof value!=='string')return null;
 let role=value.replace(/^[\s.,;:–—-]+|[\s,;:–—-]+$/gu,'');
 // A separated full stop is header punctuation; an abbreviation's last dot
 // belongs to the published title (including U.S. and single-word Dr.).
 role=role.replace(/\s+\.$/u,'').trim();
 if(role.endsWith('.')&&!/(?:\b\p{L}\.){2,}$|\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr)\.$/u.test(role))role=role.slice(0,-1).trim();
 return role||null;
}
export const listOrCategoryRole=role=>/^(?:(?:category|kategorie|catégorie|categoria|categoría|kategória|kategori|kategoria|kategorija|categorie)\s*:|(?:(?:anexo|annex|annexe)\s*:\s*)?(?:lista\s+(?:de|dos|das|över)|liste\s+(?:des|der|de)|list\s+of|lijst\s+van)\b)/iu.test(role||'');
const select=(observations,language)=>observations.find(o=>o.fragmentKey===language)||observations.find(o=>o.fragmentKey==='mul'&&o.languageTag===language);
export function roleObservation(observation,language,source,observations=[]){
 if(!observation||observation.fragmentKey!==language&&!(observation.fragmentKey==='mul'&&observation.languageTag===language))return null;
 const title=trimPublishedRole(observation.role),tag=observation.languageTag;
 const reference=/^[a-z]{2}$/.test(tag||'')&&tag!==language?trimPublishedRole(select(observations,tag)?.role):null;
 const rejected=title&&listOrCategoryRole(title)?'list-or-category':title&&reference&&title.toLowerCase()===reference.toLowerCase()?'untranslated':null;
 return {role:rejected?null:title,languageTag:tag,machineTranslated:observation.machineTranslated??(/(?:^|-)mtec(?:-|$)/.test(tag||'')?true:null),source,rejected};
}
function mergePeople(people,incoming){
 const result=structuredClone(people||{});
 for(const [person,observations]of Object.entries(incoming)){
  const byKey=new Map((result[person]||[]).map(o=>[o.fragmentKey,o]));
  for(const o of observations){
   const old=byKey.get(o.fragmentKey),revision=o.parserRevision||0,oldRevision=old?.parserRevision||0;
   // Correctly re-derived held XML beats a newer projection from an old parser.
   if(!old||revision>oldRevision||revision===oldRevision&&(!Number.isFinite(Date.parse(old.source?.fetchedAt))||Date.parse(o.source?.fetchedAt)>=Date.parse(old.source?.fetchedAt)))byKey.set(o.fragmentKey,o);
  }
  result[person]=[...byKey.values()];
 }
 return result;
}
export function seedOutsideRoles(store,appearance,person){
 const saved=store.db.prepare('SELECT body FROM outside_role_speech_reads WHERE speech=?').get(appearance.id);
 const body=saved?JSON.parse(saved.body):{people:{},fullRead:false};
 const incoming=(appearance.header?.observations||[]).map(o=>({...o,source:appearance.headerSource||appearance.source}));
 body.people=mergePeople(body.people,{[person]:incoming});
 if(saved)store.db.prepare('UPDATE outside_role_speech_reads SET body=? WHERE speech=?').run(JSON.stringify(body),appearance.id);
 else store.db.prepare('INSERT INTO outside_role_speech_reads VALUES (?,?,0,0,?)').run(appearance.id,appearance.date,JSON.stringify(body));
}
function rolesFor(observations){
 return Object.fromEntries(EU_PROTOCOL_ORDER.map(language=>{const o=select(observations,language);return [language,roleObservation(o,language,o?.source,observations)];}).filter(([,r])=>r));
}
export function publishedOutsideRoles(store,speech,person){
 const row=store.db.prepare('SELECT body FROM outside_role_speech_reads WHERE speech=?').get(speech);
 return rolesFor(row?JSON.parse(row.body).people[person]||[]:[]);
}
function displayedRoles(people){
 // Provenance, parser revisions and translation diagnostics do not change the
 // story. Null/missing/rejected roles all render the same country fallback.
 return JSON.stringify(Object.entries(people).sort(([a],[b])=>a.localeCompare(b)).map(([person,observations])=>[person,Object.entries(rolesFor(observations)).filter(([,r])=>r.role).map(([language,r])=>[language,r.role,r.languageTag])]));
}
let missingCorpusLogged=false;
export function outsideRolesDue(store,now){
 const pending=Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outside_role_speech_reads'").get()&&store.db.prepare('SELECT 1 FROM outside_role_speech_reads WHERE next_read<=? LIMIT 1').get(now));
 if(!pending)return false;
 if(!absolutePathFromEnvironment('CORPUS_DIR')){
  if(!missingCorpusLogged){console.warn('[outside-roles] Title collection disabled: CORPUS_DIR is unset.');missingCorpusLogged=true;}
  return false;
 }
 // The scheduler must see pending rows while collection is pacing, so it
 // does not publish a partial batch. Dispatch enforces the request gap.
 return true;
}
export function nextRoleRead(date,now){if(now-Date.parse(date)<=7*DAY)return now+DAY;return now+(speechRecheckCadence(date,new Date(now).toISOString().slice(0,10))?.verification||7*DAY);}
export function outsideRoleRetry(error,attempts,now){
 if(collectorPaused(error))return collectorRetry(error,attempts,now);
 if(error?.code==='outside_role_identity')return {next:null,attempts:attempts+1};
 for(let e=error,n=0;e&&n<4;e=e.cause,n++)if([404,410].includes(e.status)||[404,410].includes(e.sourceStatus))return {next:null,attempts:attempts+1};
 // Optional enrichment has a finite failure budget. A persistent 500 stops
 // after seven reads rather than settling into steady weekly traffic.
 const delays=[DAY,3*DAY,7*DAY,30*DAY,90*DAY,180*DAY];
 return {next:attempts<delays.length?Math.max(now+delays[attempts],Number(error.retryAt)||0,now+(Number(error.retryAfter)||0)*1000):null,attempts:attempts+1};
}
function project(activity,people,source,compactKeys=new Set()){
 const speech=outsideSpeech(activity,source.fetchedAt,source.url),result={};
 for(const person of people)result[person]=(speech?.headers.find(h=>h.personId===person)?.observations||[]).map(o=>({...o,...(compactKeys.has(o.fragmentKey)&&!o.machineTranslated?{machineTranslated:null}:{}),source}));
 return result;
}
export function heldOutsideRoles(corpus,{speech,date},people){
 const metadata=corpus.speechMetadata(speech),retained=corpus.retainedSpeechFragments(speech);
 const fragments={...(metadata?.interventionHeaders||{}),...retained.fragments};
 const activity={...metadata?.activity,activity_id:speech,activity_date:date,had_activity_type:'PLENARY_DEBATE_SPEECH',had_participation:people.map(person=>({had_participant_person:['person/'+person]})),recorded_in_a_realization_of:[{'api:xmlFragment':fragments}]};
 const projected=project(activity,people,{},new Set(Object.keys(metadata?.interventionHeaders||{}).filter(key=>!retained.fragments[key])));
 for(const observations of Object.values(projected))for(const o of observations){
  const row=corpus.db.prepare(`SELECT t.source_url,t.fetched_at FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=? AND t.raw IS NOT NULL`).get(speech,o.fragmentKey);
  const candidates=(metadata?.headerSources||[]).filter(source=>{try{return new URL(source.url).searchParams.get('language')===o.fragmentKey;}catch{return false;}});
  o.source=row?{url:row.source_url,fetchedAt:row.fetched_at}:metadata?.interventionHeaderSources?.[o.fragmentKey]||candidates.at(-1)||{url:null,fetchedAt:null,headerSources:metadata?.headerSources||[]};
 }
 return projected;
}
function readHeld(row,people){
 const directory=absolutePathFromEnvironment('CORPUS_DIR');
 if(!directory)return {};
 if(!existsSync(path.join(directory,'corpus-v1.sqlite')))return {};
 const corpus=new CorpusStore(directory,{readOnly:true});
 try{return heldOutsideRoles(corpus,row,people);}finally{corpus.close();}
}
export async function collectOutsideRoles(worker,{held=readHeld}={}){
 const {store}=worker;store.assertWriter();
 if(worker.requests>=worker.budget||worker.controller.signal.aborted||!outsideRolesDue(store,worker.clock())||(store.get('outsideRoleNextRequest')||0)>worker.clock())return false;
 const row=store.db.prepare('SELECT * FROM outside_role_speech_reads WHERE next_read<=? ORDER BY next_read,speech LIMIT 1').get(worker.clock());
 const body=JSON.parse(row.body),people=Object.keys(body.people),before=displayedRoles(body.people);
 const markChanged=()=>{if(displayedRoles(body.people)!==before)store.set('storyProjectionDirty',true);};
 try{
  let local={},heldFailed=false;
  try{local=held(row,people);}catch{heldFailed=true;worker.controller.signal.throwIfAborted();store.assertWriter();}
  // A local cache/parser failure is not a verdict from the source. Continue
  // through the normal bounded API read instead of retiring the row.
  body.people=mergePeople(body.people,local);
  const corpusComplete=people.every(person=>EU_PROTOCOL_ORDER.every(language=>select(local[person]||[],language)));
  const heldComplete=!heldFailed&&!body.fullRead&&people.every(person=>EU_PROTOCOL_ORDER.every(language=>select(body.people[person]||[],language)));
  if(!corpusComplete&&!heldComplete){
   // One all-language read per speech, serialized by the activity writer and
   // paced across restarts. The existing optional allocation and background
   // limiter reserve visitor traffic; Retry-After remains authoritative.
   store.set('outsideRoleNextRequest',worker.clock()+5000);
   const record=await worker.request('/speeches/'+row.speech,{'include-output':'xml_fragment'},{backgroundLow:true});
   worker.controller.signal.throwIfAborted();store.assertWriter();
   const works=record.payload?.data;
   if(!Array.isArray(works))throw TypeError('Outside role response has no data array.');
   const activity=works.find(a=>a?.activity_id===row.speech);
   const identity=()=>Object.assign(Error('Outside role speech identity does not match the request.'),{code:'outside_role_identity'});
   if(!activity){
    if(works.some(a=>/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(a?.activity_id||'')))throw identity();
    throw Error('Outside role response has no speech activity.');
   }
   if(!validDay(activity.activity_date))throw TypeError('Outside role response has no valid date.');
   if(activity.activity_date!==row.date)throw identity();
   body.people=mergePeople(body.people,project(activity,people,{url:record.url,fetchedAt:record.fetchedAt}));body.fullRead=true;
  }
  store.assertWriter();
  store.db.prepare('UPDATE outside_role_speech_reads SET body=?,next_read=?,attempts=0 WHERE speech=?').run(JSON.stringify(body),nextRoleRead(row.date,worker.clock()),row.speech);
  markChanged();
 }catch(error){
  if(worker.controller.signal.aborted)throw error;
  store.assertWriter();
  const retry=outsideRoleRetry(error,row.attempts,worker.clock());
  markChanged();
  store.db.prepare('UPDATE outside_role_speech_reads SET body=?,next_read=?,attempts=? WHERE speech=?').run(JSON.stringify(body),retry.next,retry.attempts,row.speech);
 }
 return true;
}
