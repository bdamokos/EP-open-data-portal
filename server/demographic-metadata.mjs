import {ODP_BASE} from './odp.mjs';

const fields=['bday','hasGender','api:country-of-representation'];
const iso=value=>typeof value==='number'?new Date(value).toISOString():value;
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const values=value=>(Array.isArray(value)?value:[value]).filter(v=>v!==undefined&&v!==null&&v!=='');
export function demographicPerson(node,id) {
  const reference=String(node?.id||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
  return /^[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id))&&(!node.identifier||String(node.identifier)===id)&&(!reference||reference==='person/'+id)&&(reference==='person/'+id||String(node.identifier)===id);
}
export function demographicObservation(node,{id,url,retrievedAt,language=null,kind='profile'}) {
  if(!demographicPerson(node,id)||!Number.isFinite(Date.parse(iso(retrievedAt))))throw Error('Invalid exact demographic observation.');
  return {id,kind,url,label:node.label||null,groupCode:kind==='roster'?node['api:political-group']||null:null,retrievedAt:iso(retrievedAt),language,fields:Object.fromEntries(fields.map(field=>[field,values(node[field])]))};
}
function writeObservation(store,generation,key,kind,observation,at) {
  store.assertWriter();
  if(JSON.stringify(store.source(generation,key)?.work)===JSON.stringify(observation))return;
  store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,key,kind,JSON.stringify(observation),at);
  store.set('demographicRevision',(store.get('demographicRevision')||0)+1);
}
export function retainDemographicRecord(store,generation,id,record,{kind='profile'}={}) {
  const person=record.payload?.data?.find(node=>demographicPerson(node,id));
  if(!person)throw Error('Missing exact demographic person.');
  const observation=demographicObservation(person,{id,url:record.url,retrievedAt:record.fetchedAt,kind});
  store.transaction(()=>{
    const prior=store.source(generation,`demographic:${kind}:${id}`)?.work;
    if(prior&&Date.parse(prior.retrievedAt)>Date.parse(observation.retrievedAt))return;
    writeObservation(store,generation,`demographic:${kind}:${id}`,'demographic',observation,observation.retrievedAt);
    const attempt=store.source(generation,'demographic:attempt:'+id)?.work;
    if(kind==='profile'&&(!attempt||Date.parse(attempt.at)<Date.parse(observation.retrievedAt)))writeObservation(store,generation,'demographic:attempt:'+id,'demographic-attempt',{id,url:record.url,status:'success',at:observation.retrievedAt},observation.retrievedAt);
  });
}
export function retainDemographicAttempt(store,generation,id,{url=ODP_BASE+'/meps/'+id,status='fetch_failed',at=new Date(store.clock()).toISOString()}={}) {
  store.transaction(()=>writeObservation(store,generation,'demographic:attempt:'+id,'demographic-attempt',{id,url,status,at},at));
}
export function retainRosterAttempt(store,generation,{url,status,at=new Date(store.clock()).toISOString()}) {
  store.transaction(()=>writeObservation(store,generation,'demographic:roster-attempt','demographic-roster-attempt',{id:null,url,status,at},at));
}
export function demographicMetadata(id,observations=[],attempt=null,rosterAttempt=null) {
  const result={},provenance={};
  for(const field of fields) {
    // Country is representation on the roster, never citizenship on a profile.
    const relevant=observations.filter(o=>field!=='api:country-of-representation'||o.kind==='roster');
    const sources=relevant.map(o=>({url:o.url,retrievedAt:o.retrievedAt,language:o.language,field,values:o.fields[field]||[]}));
    const supplied=[...new Set(sources.flatMap(s=>s.values))];
    const valid=value=>field==='bday'?validDay(value):field==='hasGender'?typeof value==='string'&&/\/(?:FEMALE|MALE)$/.test(value):typeof value==='string'&&/^[A-Z]{2}$/.test(value);
    const profileObserved=relevant.some(o=>o.kind==='profile'),isAcquired=field==='api:country-of-representation'?relevant.length>0:profileObserved;
    const fieldAttempt=field==='api:country-of-representation'?rosterAttempt:attempt;
    const status=supplied.length>1?'conflict':supplied.length&&!valid(supplied[0])?'invalid':supplied.length?'available':isAcquired?'source_omission':fieldAttempt?.status==='fetch_failed'?'fetch_failed':'missing_acquisition';
    const value=status==='available'?supplied[0]:null;
    provenance[field]={status,value,sources,lastAttempt:fieldAttempt};
    if(value!==null)result[field]=value;
  }
  const dates=observations.map(o=>o.retrievedAt).sort();
  return {...result,label:observations.find(o=>o.kind==='profile')?.label||observations.find(o=>o.kind==='roster')?.label||null,'api:political-group':observations.find(o=>o.kind==='roster')?.groupCode||null,demographicProvenance:provenance,metadataFetchedAt:dates.at(-1)||null,rosterMetadataFetchedAt:observations.find(o=>o.kind==='roster')?.retrievedAt||null};
}
export function retainedDemographicMetadata(store,members) {
  const generation=store.get('working')?.generation||store.status().servingGeneration;
  const rows=store.db.prepare("SELECT body FROM sources WHERE generation=? AND key>='demographic:' AND key<'demographic;' AND kind IN ('demographic','demographic-attempt','demographic-roster-attempt')").all(generation);
  const observations=new Map(),attempts=new Map();let rosterAttempt=null;
  for(const row of rows) {
    const value=JSON.parse(row.body);
    if(value.id===null)rosterAttempt=value;
    else if(value.status)attempts.set(value.id,value);
    else observations.set(value.id,[...(observations.get(value.id)||[]),value]);
  }
  return new Map([...members.keys()].map(id=>[id,{observations:observations.get(id)||[],attempt:attempts.get(id)||null,rosterAttempt}]));
}
