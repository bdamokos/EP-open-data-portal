const origin='https://data.europarl.europa.eu';
const relative=value=>typeof (value?.id||value)==='string'?String(value?.id||value).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
const array=value=>Array.isArray(value)?value:value==null?[]:[value];
const listPattern='((?:A|B|RC)-10-\\d{4}-\\d{4,6}-AM-\\d{1,5}-\\d{1,5})';
const listEndpoint=new RegExp('^/(?:plenary-documents|documents)/'+listPattern+'$');
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

export function documentRouteOwned(store,generation,endpoint,deferred,{ignoreGapKey=null}={}) {
  const id=amendmentListDocumentId(endpoint);if(!id)return false;
  const keys=['/plenary-documents/'+id,'/documents/'+id];
  for(const key of keys) {
    if(key!==ignoreGapKey&&store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key))return true;
    if(store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(generation,key))return true;
    for(const table of ['tasks','amendment_jobs'])if(store.db.prepare(`SELECT 1 FROM ${table} WHERE generation=? AND key=? AND (done IS NULL OR done<>1)`).get(generation,key))return true;
  }
  for(const table of ['tasks','amendment_jobs'])if(store.db.prepare(`SELECT 1 FROM ${table} WHERE generation=? AND key GLOB ? AND (done IS NULL OR done<>1) LIMIT 1`).get(generation,'amendment:discover:*:'+id))return true;
  if(!deferred) {
    const saved=store.source(generation,'amendment:continuations')?.work||{};
    deferred=new Set([...(saved.tasks||[]),...(saved.discovery||[])].map(task=>task.key));
  }
  return [...deferred].some(key=>keys.includes(key)||key.startsWith('amendment:discover:')&&key.endsWith(':'+id));
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
