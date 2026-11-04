import {speechRecheckCadence} from './speech-recheck.mjs';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {absolutePathFromEnvironment} from './config.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {outsideSpeech} from './outside-model.mjs';
import {EU_PROTOCOL_ORDER} from './language-order.mjs';
import {collectorRetry} from './collector-retry.mjs';

const DAY=86400_000;
export const trimPublishedRole=value=>typeof value==='string'?value.replace(/^[\s.,;:–—-]+|[\s.,;:–—-]+$/gu,'')||null:null;
export function roleObservation(observation,language,source){
 if(!observation||observation.fragmentKey!==language&&observation.languageTag?.split('-')[0]!==language)return null;
 // Translation tags describe the original first (sl-t-en-mtec). The fragment
 // key is the publication language; never infer it from that original prefix.
 if(observation.fragmentKey!==language&&observation.languageTag?.includes('-t-'))return null;
 return {role:trimPublishedRole(observation.role),languageTag:observation.languageTag,machineTranslated:/(?:^|-)mtec(?:-|$)/.test(observation.languageTag||''),source};
}
export function seedOutsideRoles(store,appearance,person){
 const insert=store.db.prepare('INSERT OR IGNORE INTO outside_role_jobs(speech,language,person,next_read,body) VALUES (?,?,?,?,?)');
 for(const language of EU_PROTOCOL_ORDER){
  const observation=appearance.header?.observations?.find(o=>o.fragmentKey===language)||appearance.header?.observations?.find(o=>!o.languageTag?.includes('-t-')&&o.languageTag===language);
  const role=roleObservation(observation,language,appearance.headerSource||appearance.source);
  insert.run(appearance.id,language,person,role?null:0,JSON.stringify({appearance,role}));
  if(role)store.db.prepare('UPDATE outside_role_jobs SET body=?,next_read=NULL,attempts=0 WHERE speech=? AND language=? AND person=?').run(JSON.stringify({appearance,role}),appearance.id,language,person);
 }
}
export function publishedOutsideRoles(store,speech,person){
 return Object.fromEntries(store.db.prepare('SELECT language,body FROM outside_role_jobs WHERE speech=? AND person=?').all(speech,person).map(r=>[r.language,JSON.parse(r.body).role]).filter(([,r])=>r));
}
export function outsideRolesDue(store,now){
 if((store.get('outsideRoleNextRequest')||0)>now)return false;
 return Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outside_role_jobs'").get()&&store.db.prepare('SELECT 1 FROM outside_role_jobs WHERE next_read<=? LIMIT 1').get(now));
}
// Reuse the corpus verification windows: weekly for recent translations,
// then 90/180/365 days. Successful held language reads never go upstream again.
function nextMissingRead(date,now){
 const today=new Date(now).toISOString().slice(0,10);
 return now+(speechRecheckCadence(date,today)?.verification||7*DAY);
}
export function heldOutsideRole(store,appearance,person,language){
 const metadata=store.speechMetadata(appearance.id),retained=store.retainedSpeechFragments(appearance.id);
 const fragments={...(metadata?.interventionHeaders||{}),...retained.fragments};
 const projected=outsideSpeech({...metadata?.activity,activity_id:appearance.id,activity_date:appearance.date,had_activity_type:'PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/'+person]}],recorded_in_a_realization_of:[{'api:xmlFragment':fragments}]},metadata?.fetchedAt);
 const observations=projected?.headers.find(h=>h.personId===person)?.observations||[];
 const observation=observations.find(o=>o.fragmentKey===language)||observations.find(o=>o.languageTag===language);
 if(!observation)return null;
 const row=store.db.prepare(`SELECT t.source_url,t.fetched_at FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=? AND t.raw IS NOT NULL`).get(appearance.id,observation.fragmentKey);
 return roleObservation(observation,language,row?{url:row.source_url,fetchedAt:row.fetched_at}:{url:metadata.sourceUrl,fetchedAt:metadata.fetchedAt,headerSources:metadata.headerSources});
}
export async function collectOutsideRoles(worker,{held=heldOutsideRole}={}){
 const {store}=worker;store.assertWriter();
 if(worker.requests>=worker.budget||worker.controller.signal.aborted||!outsideRolesDue(store,worker.clock()))return false;
 // Durable single-flight pacing, also across short runs and restarts. These
 // optional reads share the collector allocation and visitor-reserved limiter.
 if((store.get('outsideRoleNextRequest')||0)>worker.clock())return false;
 const row=store.db.prepare('SELECT * FROM outside_role_jobs WHERE next_read<=? ORDER BY next_read,speech,language,person LIMIT 1').get(worker.clock());
 const {appearance}=JSON.parse(row.body);let corpus,role;
 try{
  const directory=absolutePathFromEnvironment('CORPUS_DIR');
  if(directory&&existsSync(path.join(directory,'corpus-v1.sqlite'))){
   corpus=new CorpusStore(directory,{readOnly:true});
   role=held(corpus,appearance,row.person,row.language);
  }
  if(!role){
   store.set('outsideRoleNextRequest',worker.clock()+5000);
   const record=await worker.request('/speeches/'+row.speech,{'include-output':'xml_fragment',language:row.language},{backgroundLow:true});
   worker.controller.signal.throwIfAborted();store.assertWriter();
   const activity=record.payload?.data?.find(a=>a.activity_id===row.speech);
   if(!activity)throw Error('Outside role speech identity does not match the request.');
   const speech=outsideSpeech(activity,record.fetchedAt,record.url);
   const observations=speech?.headers.find(h=>h.personId===row.person)?.observations||[];
   role=roleObservation(observations.find(o=>o.fragmentKey===row.language),row.language,{url:record.url,fetchedAt:record.fetchedAt});
  }
  store.db.prepare('UPDATE outside_role_jobs SET body=?,next_read=?,attempts=0 WHERE speech=? AND language=? AND person=?').run(JSON.stringify({appearance,role}),role?null:nextMissingRead(appearance.date,worker.clock()),row.speech,row.language,row.person);
  if(role)store.set('storyProjectionDirty',true);
 }catch(error){
  if(worker.controller.signal.aborted)throw error;
  const retry=collectorRetry(error,row.attempts,worker.clock());
  store.db.prepare('UPDATE outside_role_jobs SET next_read=?,attempts=? WHERE speech=? AND language=? AND person=?').run(retry.next,retry.attempts,row.speech,row.language,row.person);
 }finally{corpus?.close();}
 return true;
}
