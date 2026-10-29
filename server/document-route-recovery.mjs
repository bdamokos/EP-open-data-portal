import {projectDocument} from './activity-index-model.mjs';
import {AMENDMENT_DISTRIBUTION_PROOF_VERSION,distributionEvidenceFor} from './amendments.mjs';
import {amendmentListDocumentId,documentRouteOwned,documentRouteDeferredOwners,retainedAmendmentListObservation} from './document-detail-routing.mjs';

const marker='amendmentDocumentRouteRepair',metadataBytes=8*1024*1024;
const stateFor=(store,generation)=>{
  const value=store.get(marker);
  return value?.version===1&&value.generation===generation&&typeof value.complete==='boolean'&&typeof value.afterKey==='string'&&value.afterKey.length<=180&&Number.isSafeInteger(value.resolved)&&value.resolved>=0&&Number.isSafeInteger(value.oversized)&&value.oversized>=0
    ?value:{version:1,generation,afterKey:'',complete:false,resolved:0,oversized:0};
};

// This retires an obsolete collection-route error only after newer, exact
// metadata is durably retained. It never advances a source retrieval date.
export function reconcileAmendmentDocumentGap(worker,generation,id,source=null,{deferred}={}) {
  const {store}=worker;if(store.get('working')?.generation!==generation)return false;
  store.assertWriter();const key='/plenary-documents/'+id;
  if(amendmentListDocumentId(key)!==id)return false;
  const gap=store.db.prepare(`SELECT failed_at FROM refresh_gaps WHERE generation=? AND key=? AND kind='document' AND error=?
    AND json_extract(body,'$.endpoint')=key AND json_extract(body,'$.stage') IS NULL AND json_extract(body,'$.offset') IS NULL`).get(generation,key,`EP API returned 404 at ${key}.`);
  if(!gap||documentRouteOwned(store,generation,key,deferred,{ignoreGapKey:key}))return false;
  const endpoint='/documents/'+id;
  const canonicalBytes=store.db.prepare('SELECT length(CAST(body AS BLOB)) bytes FROM sources WHERE generation=? AND key=?').get(generation,endpoint)?.bytes||0;
  if(canonicalBytes>metadataBytes)return false;
  if(!source) {
    const row=store.db.prepare('SELECT length(CAST(body AS BLOB)) bytes FROM sources WHERE generation=? AND key=? AND kind=\'amendment-list\'').get(generation,'amendment:list:'+id);
    if(!row||row.bytes+canonicalBytes>metadataBytes)return false;
    source=store.source(generation,'amendment:list:'+id);
  }
  const observation=retainedAmendmentListObservation(source,id,gap.failed_at,{now:worker.clock()});if(!observation)return false;
  const distribution=source.work.distributionEvidence;
  if(distribution?.version!==AMENDMENT_DISTRIBUTION_PROOF_VERSION||distribution.source?.url!==observation.url||Date.parse(distribution.source?.fetchedAt)!==Date.parse(observation.fetchedAt))return false;
  const actual=distributionEvidenceFor(source.work,distribution.source);
  if(actual.state!==distribution.state||JSON.stringify(actual.descriptors)!==JSON.stringify(distribution.descriptors))return false;
  if(observation.basis==='expanded-target'&&(source.work.amendmentDistributionDeclared!==true||source.work.languageVersionsObserved!==true||distribution.state!=='available'))return false;
  const projected=projectDocument(source.work);
  projected.inverse_answers_to=[];
  projected.metadataObservation={representation:'retained-amendment-list-projection',...observation,retainedSourceKey:'amendment:list:'+id};
  const existing=store.source(generation,endpoint);
  if(existing&&Date.parse(existing.fetchedAt)>=Date.parse(observation.fetchedAt)) {
    if(existing.fetchedAt!==observation.fetchedAt||JSON.stringify(existing.work.metadataObservation)!==JSON.stringify(projected.metadataObservation))return false;
  } else store.putSource(generation,endpoint,'document',projected,observation.fetchedAt,[],{sourceUrl:observation.url,acquisition:'baseline'});
  store.finishTask({generation,key,kind:'document',body:{}});
  return true;
}

export function amendmentDocumentRouteRepairPending(store,generation) {
  return !stateFor(store,generation).complete&&Boolean(store.db.prepare("SELECT 1 FROM refresh_gaps WHERE generation=? AND kind='document' AND key GLOB '/plenary-documents/*-AM-*-*' LIMIT 1").get(generation));
}

// Bound keys before reading any retained body, and retain the cursor across
// iterations. Unavailable/older metadata leaves the original retry untouched.
export function reconcileAmendmentDocumentGaps(worker,generation,{restart=false}={}) {
  const {store}=worker;if(store.get('working')?.generation!==generation)return 0;
  store.assertWriter();let state=stateFor(store,generation);
  if(restart&&state.complete)state={version:1,generation,afterKey:'',complete:false,resolved:0,oversized:0};
  if(state.complete)return 0;
  const rows=store.db.prepare(`SELECT gap.key,COALESCE(length(CAST(source.body AS BLOB)),0)+COALESCE(length(CAST(canonical.body AS BLOB)),0) bytes FROM refresh_gaps gap
    LEFT JOIN sources source ON source.generation=gap.generation AND source.key='amendment:list:'||substr(gap.key,length('/plenary-documents/')+1)
    LEFT JOIN sources canonical ON canonical.generation=gap.generation AND canonical.key='/documents/'||substr(gap.key,length('/plenary-documents/')+1)
    WHERE gap.generation=? AND gap.kind='document' AND gap.key GLOB '/plenary-documents/*-AM-*-*' AND gap.key>?
    ORDER BY gap.key LIMIT 25`).all(generation,state.afterKey);
  const deferred=documentRouteDeferredOwners(store,generation);
  let bytes=0,resolved=0,stopped=false;
  for(const row of rows) {
    if(row.bytes>metadataBytes){state.oversized++;state.afterKey=row.key;continue;}
    if(bytes+(row.bytes||0)>metadataBytes){stopped=true;break;}
    bytes+=row.bytes||0;
    const id=amendmentListDocumentId(row.key);
    if(id&&reconcileAmendmentDocumentGap(worker,generation,id,null,{deferred}))resolved++;
    state.afterKey=row.key;
  }
  state.complete=!stopped&&rows.length<25;state.resolved+=resolved;store.set(marker,state);
  return resolved;
}
