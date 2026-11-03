import {brusselsDay} from './analysis-period.mjs';
import {normalizeOutsideName,resolveOutsideSpeaker} from './outside-speaker-country.mjs';
import {outsideSpeakerAppearances} from './story-outside-speakers.mjs';
import {resolveOutsideWikidata,outsideWikidataRequest,OUTSIDE_WIKIDATA_LIMITS} from './outside-wikidata-source.mjs';
const DAY=86400_000;
export const OUTSIDE_WIKIDATA_POLICY='unique-human-politician-or-office-v2';
const generationOf=s=>s.get('working')?.generation||s.get('active');
const dueSql=`SELECT DISTINCT o.person FROM outside_contributions o LEFT JOIN sources s ON s.generation=o.generation AND s.key='wikidata:person:'||o.person
 WHERE o.generation=? AND o.date<=? AND json_extract(o.body,'$.term')=10 AND (COALESCE(json_extract(s.body,'$.nextRead'),0)<=? OR COALESCE(json_extract(s.body,'$.policy'),'')<>? OR o.date>substr(s.fetched_at,1,10)) ORDER BY o.person LIMIT 1`;
export function outsideWikidataDue(store,now){const g=generationOf(store);return Boolean(g&&store.db.prepare(dueSql).get(g,brusselsDay(now),now,OUTSIDE_WIKIDATA_POLICY));}
export async function collectOutsideWikidata(worker,{request=outsideWikidataRequest}={}){
 const s=worker.store,generation=generationOf(s),now=worker.clock();if(!generation||worker.budget-worker.requests<OUTSIDE_WIKIDATA_LIMITS.names+2||worker.controller.signal.aborted)return false;
 s.assertWriter();const row=s.db.prepare(dueSql).get(generation,brusselsDay(now),now,OUTSIDE_WIKIDATA_POLICY);if(!row)return false;
 const personId=row.person,prior=s.source(generation,'wikidata:person:'+personId)?.work;
 const appearances=outsideSpeakerAppearances(s,generation,personId).filter(a=>a.term===10&&a.date<=brusselsDay(now));
 const pending=new Set(resolveOutsideSpeaker(personId,appearances).unavailable),names=[...new Map(appearances.filter(a=>pending.has(a.id)&&a.header?.name).map(a=>[normalizeOutsideName(a.header.name),a.header.name])).values()];
 const save=value=>{s.putSource(generation,'wikidata:person:'+personId,'wikidata-person',value,value.fetchedAt);s.set('storyProjectionDirty',true);};
 const common={policy:OUTSIDE_WIKIDATA_POLICY,personId,names:names.map(normalizeOutsideName),fetchedAt:new Date(now).toISOString()};
 if(!pending.size){save({...common,status:'not-needed',candidates:[],nextRead:now+7*DAY});return true;}
 // An unresolved EP name is an input gap, never a known empty candidate set.
 if(!names.length||names.length>OUTSIDE_WIKIDATA_LIMITS.names){save({...common,status:'unavailable',reason:'ep-name-unavailable',nextRead:now+7*DAY});return true;}
 save({...common,status:'unavailable',reason:'pending-read',nextRead:now+60_000});
 const sources=[];
 try{
  const result=await resolveOutsideWikidata(names,{signal:worker.controller.signal,request:async(url,options)=>{
   if(worker.requests>=worker.budget||worker.runDeadline&&worker.monotonic()>=worker.runDeadline)throw Error('Wikidata background budget exhausted.');worker.requests++;const r=await request(url,options);sources.push({url:r.url,fetchedAt:r.fetchedAt});return r;
  }});worker.controller.signal.throwIfAborted();s.assertWriter();save({...common,...result,nextRead:now+7*DAY});
 }catch(error){if(worker.controller.signal.aborted)throw error;s.assertWriter();const attempts=(prior?.attempts||0)+1,delay=Math.max(Math.min(7*DAY,60_000*2**Math.min(attempts-1,13)),(Number(error.retryAfter)||0)*1000,(Number(error.retryAt)||now)-now);save({...common,status:'unavailable',candidates:[],sources,urls:sources.map(r=>r.url),reason:String(error.message).slice(0,160),attempts,nextRead:now+delay});}
 return true;
}
