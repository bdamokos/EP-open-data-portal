import {createHash} from 'node:crypto';
import {spId,validateReply,adoptedTextProjectionVersion} from './commission-followups-model.mjs';
import {array,tail} from './activity-index-model.mjs';

// Internal queue-admission revision, not a public response schema version.
const discoveryRevision=1;
export {adoptedTextProjectionVersion} from './commission-followups-model.mjs';
const markerKey='adoptedTextDiscovery';
const yearOf=now=>new Date(now).getUTCFullYear();
const currentMarker=marker=>marker?.version===discoveryRevision&&Number.isInteger(marker.throughYear)&&marker.throughYear>=2024;

export function adoptedTextDiscoveryDue(store,now=store.clock()) {
  const marker=store.get(markerKey);
  return !currentMarker(marker)||marker.throughYear<yearOf(now);
}

// Admission is versioned; normal durable catalogue/detail tasks own completion
// and failures. No source request or independent collector runs here.
export function scheduleAdoptedTexts(worker,cycle) {
  const {store}=worker,now=worker.clock();
  if(!adoptedTextDiscoveryDue(store,now))return false;
  return store.transaction(()=>{
    store.assertWriter();
    if(store.get('working')?.generation!==cycle.generation)throw new Error('Adopted-text discovery requires a working generation.');
    const marker=store.get(markerKey),throughYear=yearOf(now);
    const firstYear=currentMarker(marker)?Math.max(2024,marker.throughYear+1):2024;
    for(let year=firstYear;year<=throughYear;year++)store.enqueue(cycle.generation,`catalog:adopted-texts:v${discoveryRevision}:${year}`,'catalog',{
      endpoint:'/adopted-texts',params:{year,'parliamentary-term':10,'work-type':'TEXT_ADOPTED'},offset:0,deltaOnly:true,
    },100);
    store.set(markerKey,{version:discoveryRevision,throughYear,scheduledAt:new Date(now).toISOString()});
    return true;
  });
}

const reference=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export function validateAdoptedText(endpoint,work) {
  const id=endpoint.match(/^\/adopted-texts\/(TA-10-\d{4}-\d{4,6})$/)?.[1];
  if(!id||work?.identifier!==id||reference(work.id)!=='eli/dl/doc/'+id||tail(work.work_type)!=='TEXT_ADOPTED')
    throw new Error('Invalid exact adopted-text identity or type.');
  const terms=array(work.parliamentary_term);
  if(terms.some(term=>reference(term)!=='org/ep-10'))throw new Error('Invalid adopted-text parliamentary term.');
  return work;
}

export function adoptedTextRecord(endpoint,records) {
  const id=endpoint.slice('/adopted-texts/'.length),identity='eli/dl/doc/'+id;
  const matches=records.filter(work=>work?.identifier===id||reference(work?.id)===identity);
  if(matches.length!==1)throw new Error('Invalid or conflicting exact adopted-text records.');
  return validateAdoptedText(endpoint,matches[0]);
}

const legacyWhere=`source.generation=? AND source.kind='document' AND source.key GLOB '/adopted-texts/TA-10-*'
  AND COALESCE(json_extract(source.body,'$.adoptionProjectionVersion'),0)<>${adoptedTextProjectionVersion}
  AND NOT EXISTS(SELECT 1 FROM refresh_gaps gap WHERE gap.generation=source.generation AND gap.key=source.key)
  AND NOT EXISTS(SELECT 1 FROM tasks task WHERE task.generation=source.generation AND task.key=source.key AND (task.done IS NULL OR task.done<>1))
  AND NOT EXISTS(SELECT 1 FROM amendment_jobs task WHERE task.generation=source.generation AND task.key=source.key AND (task.done IS NULL OR task.done<>1))`;
export function adoptedTextDeferredKeys(store,generation) {
  const checkpoint=store.source(generation,'amendment:continuations')?.work;
  return new Set([...(checkpoint?.tasks||[]),...(checkpoint?.discovery||[])].map(task=>task.key));
}
export function adoptedTextOwnedElsewhere(store,generation,key,deferred=adoptedTextDeferredKeys(store,generation)) {
  return deferred.has(key)||Boolean(store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,key));
}
function repairCandidates(store,generation,limit) {
  if(!store.db.prepare('SELECT 1 FROM sources source WHERE '+legacyWhere+' LIMIT 1').get(generation))return [];
  const reserved=adoptedTextDeferredKeys(store,generation);
  const selected=[];
  for(const row of store.db.prepare('SELECT source.key FROM sources source WHERE '+legacyWhere+' ORDER BY source.key').iterate(generation)) {
    if(reserved.has(row.key))continue;
    selected.push(row.key);if(selected.length>=limit)break;
  }
  return selected;
}
export const adoptedTextRepairDue=(store,generation)=>repairCandidates(store,generation,1).length>0;

// A legacy writer can complete known detail jobs while dropping adopts. Repair
// those projections once through the normal queue, including after rollback.
// A current projection may legitimately omit adopts and is never reopened here.
export function scheduleAdoptedTextRepairs(worker,cycle) {
  const {store}=worker;
  return store.transaction(()=>{
    store.assertWriter();
    if(store.get('working')?.generation!==cycle.generation)throw new Error('Adopted-text repair requires a working generation.');
    const keys=repairCandidates(store,cycle.generation,100);
    for(const key of keys)store.enqueue(cycle.generation,key,'document',{endpoint:key},101,true);
    return keys.length;
  });
}

// A bounded cursor keeps every declared relationship owned by the parent detail
// task until its child admissions are durable. No requests run during admission.
export function scheduleAdoptedFollowups(worker,task,work) {
  const {store}=worker,generation=task.generation,relationships=work.followupRelationships;store.assertWriter();
  if(!Array.isArray(relationships))return null;
  const hash=createHash('sha256').update(JSON.stringify(relationships)).digest('hex');
  const offset=task.body.followupHash===hash&&Number.isSafeInteger(task.body.followupOffset)&&task.body.followupOffset>=0?task.body.followupOffset:0;
  const end=Math.min(relationships.length,offset+100),reserved=adoptedTextDeferredKeys(store,generation),now=worker.clock();
  for(const value of relationships.slice(offset,end)) {
    const id=spId(value);if(!id)continue;
    const key='/external-documents/'+id;
    if(adoptedTextOwnedElsewhere(store,generation,key,reserved))continue;
    if(store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key))continue;
    if(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,key))continue;
    const saved=store.source(generation,key);
    if(saved?.work.followupProjectionVersion===1&&Number.isFinite(Date.parse(saved.fetchedAt))&&now-Date.parse(saved.fetchedAt)<7*86400_000) {
      try{validateReply({data:[saved.work]},id,work.identifier);continue;}catch{/* A conflicting projection needs normal verification. */}
    }
    store.enqueue(generation,key,'document',{endpoint:key,adoptedId:work.identifier},101,true);
  }
  return end<relationships.length?{...task.body,stage:'followups',followupHash:hash,followupOffset:end}:null;
}
