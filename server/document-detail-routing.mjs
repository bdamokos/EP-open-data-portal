const origin='https://data.europarl.europa.eu';
const relative=value=>typeof (value?.id||value)==='string'?String(value?.id||value).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
const array=value=>Array.isArray(value)?value:value==null?[]:[value];
const listPattern='((?:A|B|RC)-10-\\d{4}-\\d{4,6}-AM-\\d{1,5}-\\d{1,5}|[A-Z][A-Z0-9]{2,5}-AM-\\d{4,9}(?:-\\d{1,4})*)';
const listEndpoint=new RegExp('^/(?:plenary-documents|committee-documents|documents)/'+listPattern+'$');
export const amendmentListDocumentId=endpoint=>listEndpoint.exec(endpoint)?.[1]||null;
export const documentDetailEndpoint=endpoint=>{
  const id=amendmentListDocumentId(endpoint);return id?'/documents/'+id:endpoint;
};

export function validateAmendmentListMetadata(payload,id) {
  const records=Array.isArray(payload?.data)?payload.data.filter(work=>work?.identifier===id||relative(work?.id)==='eli/dl/doc/'+id):[];
  const work=records[0];
  if(records.length!==1||work.identifier!==id||relative(work.id)!=='eli/dl/doc/'+id||relative(work.work_type)!=='def/ep-document-types/AMENDMENT_LIST'||array(work.parliamentary_term).some(term=>relative(term)!=='org/ep-10'))throw new Error('Invalid or conflicting exact amendment-list metadata.');
  return work;
}

// Read owner identities and clocks only, never the retained task bodies.
export function documentRouteDeferredOwners(store,generation) {
  const owners=new Map();
  for(const bucket of ['tasks','discovery'])for(const row of store.db.prepare(`SELECT json_extract(entry.value,'$.key') key,COALESCE(json_extract(entry.value,'$.retry_at'),0) retryAt
    FROM sources source,json_each(source.body,'$.${bucket}') entry WHERE source.generation=? AND source.key='amendment:continuations'
    AND COALESCE(json_extract(entry.value,'$.done'),0)<>1`).iterate(generation))if(typeof row.key==='string')owners.set(row.key,Math.max(owners.get(row.key)||0,row.retryAt));
  return owners;
}

export function documentRouteBlocker(store,generation,endpoint,deferred,{ignoreGapKey=null,executingTask=null,allowDueGaps=false,allowDueLegacyGap=false,now=store.clock()}={}) {
  const id=amendmentListDocumentId(endpoint);if(!id)return null;
  const keys=['/plenary-documents/'+id,'/committee-documents/'+id,'/documents/'+id];
  const executingTable=executingTask?.amendmentJob?'amendment_jobs':'tasks';
  for(const table of ['tasks','amendment_jobs']) {
    const own=row=>executingTask?.generation===generation&&executingTable===table&&executingTask.key===row.key;
    for(const key of keys) {
      const row=store.db.prepare(`SELECT key,retry_at FROM ${table} WHERE generation=? AND key=? AND (done IS NULL OR done<>1)`).get(generation,key);
      if(row&&!own(row))return {key:row.key,retryAt:row.retry_at};
    }
    for(const row of store.db.prepare(`SELECT key,retry_at FROM ${table} WHERE generation=? AND key GLOB ? AND (done IS NULL OR done<>1)`).iterate(generation,'amendment:discover:*:'+id))if(!own(row))return {key:row.key,retryAt:row.retry_at};
  }
  for(const key of keys) {
    if(key!==executingTask?.key&&store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(generation,key))return {key,retryAt:0};
    if(key===ignoreGapKey)continue;
    const gap=store.db.prepare('SELECT retry_at FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key);
    // Once an unadmitted alias gap is due, the same canonical request can run.
    // Admission gives the canonical route precedence when both gaps are due.
    if(gap&&!(gap.retry_at<=now&&(allowDueGaps||allowDueLegacyGap&&key===keys[0])))return {key,retryAt:gap.retry_at};
  }
  deferred??=documentRouteDeferredOwners(store,generation);
  for(const key of deferred.keys())if(keys.includes(key)||key.startsWith('amendment:discover:')&&key.endsWith(':'+id))return {key,retryAt:deferred instanceof Map?deferred.get(key):0};
  return null;
}
export const documentRouteOwned=(...args)=>Boolean(documentRouteBlocker(...args));

// Fresh public input cannot supply the provenance reserved for stored copies.
// Stored reprojection deliberately retains it through projectDocument.
export function sanitizeFreshDocument(work) {
  const result=structuredClone(work),pending=[result];
  while(pending.length) {
    const value=pending.pop();if(!value||typeof value!=='object')continue;
    delete value.metadataObservation;
    for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);
  }
  return result;
}

export function retainedAmendmentListObservation(source,id,failedAt,{now=Date.now()}={}) {
  const work=source?.work,proof=work?.relationshipEvidence;
  try{validateAmendmentListMetadata({data:[work]},id);}catch{return null;}
  const fetched=Date.parse(proof?.fetchedAt),failed=Date.parse(failedAt),target=work.targetDocumentId;
  if(!Number.isFinite(fetched)||!Number.isFinite(failed)||fetched<=failed||fetched>now||typeof target!=='string'||relative(proof.targetReference)!=='eli/dl/doc/'+target||relative(proof.listReference)!=='eli/dl/doc/'+id||!array(work.foresees_change_of).some(ref=>relative(ref)==='eli/dl/doc/'+target))return null;
  if(proof.basis==='list-detail'&&Date.parse(work.metadataCheckedAt)!==fetched)return null;
  let url;try{url=new URL(proof.url);}catch{return null;}
  const path=proof.basis==='list-detail'?'/api/v2/documents/'+id:proof.basis==='expanded-target'?'/api/v2/plenary-documents/'+target:null;
  if(url.origin!==origin||url.pathname!==path||url.username||url.password||url.hash||[...url.searchParams].length!==1||url.searchParams.get('format')!=='application/ld+json')return null;
  return {basis:proof.basis,url:proof.url,fetchedAt:proof.fetchedAt,retainedSourceFetchedAt:source.fetchedAt,directMetadataCheckedAt:work.metadataCheckedAt||null};
}
