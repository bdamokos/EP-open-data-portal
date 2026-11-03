import {outsideOfficeDate} from './outside-office-date.mjs';
import {boundedUpstream,backoffUpstream,upstreamResponseError} from './odp.mjs';
import {retryAfterSeconds} from './upstream-queue.mjs';
import {userAgent} from './user-agent.mjs';
import {normalizeOutsideName} from './outside-speaker-country.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
export const OUTSIDE_WIKIDATA_LIMITS=Object.freeze({names:5,items:20,rows:1000,bytes:1024*1024,timeout:25_000,pattern:8192});
const prefix='PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX p: <http://www.wikidata.org/prop/> PREFIX ps: <http://www.wikidata.org/prop/statement/> PREFIX pq: <http://www.wikidata.org/prop/qualifier/> PREFIX pqv: <http://www.wikidata.org/prop/qualifier/value/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX skos: <http://www.w3.org/2004/02/skos/core#> PREFIX wikibase: <http://wikiba.se/ontology#>';
// CirrusSearch's inlabel phrase searches labels and aliases in all languages.
// Discovery may return a superset; rank/score never enter the identity decision.
// Full exact NFC/whitespace/casefold equality is checked against returned terms.
export function outsideNameSearchUrl(name){
 if(!String(name).trim()||String(name).length>160)throw Error('Invalid outside speaker name.');
 const phrase=String(name).normalize('NFC').replace(/\s+/gu,' ').trim().replace(/["\\]/g,'\\$&');
 return 'https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'query',list:'search',srsearch:'haswbstatement:P31=Q5 inlabel:"'+phrase+'"',srnamespace:'0',srlimit:'50',srprop:'',srinfo:'totalhits',format:'json',maxlag:'5'});
}
export function outsideNamesUrl(ids){
 if(!ids.length||ids.length>OUTSIDE_WIKIDATA_LIMITS.items||ids.some(id=>!/^Q[1-9]\d{0,11}$/.test(id)))throw Error('Invalid candidate batch.');
 return 'https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbgetentities',ids:ids.join('|'),props:'labels|aliases|info',format:'json',maxlag:'5'});
}
const itemPattern=/^Q[1-9]\d{0,11}$/;
export function outsideEvidenceQuery(ids){
 if(!ids.length||ids.length>OUTSIDE_WIKIDATA_LIMITS.items||ids.some(id=>!itemPattern.test(id)))throw Error('Invalid candidate batch.');
 return `${prefix} SELECT DISTINCT ?item ?kind ?occupation ?politician ?statement ?position ?start ?startFull ?startPrecision ?startCalendar ?end ?endFull ?endPrecision ?endCalendar ?country ?countryCode ?jurisdiction ?jurisdictionCode ?international ?citizenship ?citizenshipCode WHERE {
 VALUES ?item { ${ids.map(id=>'wd:'+id).join(' ')} }
 { ?item wdt:P31 wd:Q5 . BIND("human" AS ?kind) }
 UNION { ?item wdt:P106 ?occupation . BIND(EXISTS { ?occupation wdt:P279* wd:Q82955 } AS ?politician) BIND("occupation" AS ?kind) }
 UNION { ?item p:P39 ?statement . ?statement ps:P39 ?position ; wikibase:rank ?rank . FILTER(?rank!=wikibase:DeprecatedRank)
 OPTIONAL { ?statement pq:P580 ?start . OPTIONAL { ?statement pqv:P580 ?startNode . ?startNode wikibase:timeValue ?startFull ; wikibase:timePrecision ?startPrecision ; wikibase:timeCalendarModel ?startCalendar FILTER(?startFull = ?start) } }
 OPTIONAL { ?statement pq:P582 ?end . OPTIONAL { ?statement pqv:P582 ?endNode . ?endNode wikibase:timeValue ?endFull ; wikibase:timePrecision ?endPrecision ; wikibase:timeCalendarModel ?endCalendar FILTER(?endFull = ?end) } }
 OPTIONAL { ?position wdt:P17 ?country . OPTIONAL { ?country wdt:P298 ?countryCode } }
 OPTIONAL { ?position wdt:P1001 ?jurisdiction . OPTIONAL { ?jurisdiction wdt:P298 ?jurisdictionCode } }
 BIND(EXISTS { ?position wdt:P2389/(wdt:P361|wdt:P749)*/wdt:P31/wdt:P279* wd:Q484652 } AS ?international) BIND("position" AS ?kind) }
 UNION { ?item wdt:P27 ?citizenship . OPTIONAL { ?citizenship wdt:P298 ?citizenshipCode } BIND("citizenship" AS ?kind) }
 } LIMIT ${OUTSIDE_WIKIDATA_LIMITS.rows+1}`;
}
export const outsideWikidataUrl=query=>'https://query.wikidata.org/sparql?'+new URLSearchParams({query,format:'json'});
export async function outsideWikidataRequest(url,{signal,fetchImpl=globalThis.fetch}={}){
 const target=new URL(url),sparql=target.hostname==='query.wikidata.org'&&target.pathname==='/sparql',api=target.hostname==='www.wikidata.org'&&target.pathname==='/w/api.php',query=target.searchParams.get('query')||'';
 if(target.protocol!=='https:'||target.username||target.password||target.port||target.hash||url.length>64000||!(sparql&&query.includes('VALUES ')&&query.endsWith('LIMIT '+(OUTSIDE_WIKIDATA_LIMITS.rows+1))||api&&['query','wbgetentities'].includes(target.searchParams.get('action'))&&target.searchParams.get('maxlag')==='5'))throw Error('Unsupported or unbounded Wikidata request.');
 return boundedUpstream(async()=>{
  const active=signal?AbortSignal.any([signal,AbortSignal.timeout(OUTSIDE_WIKIDATA_LIMITS.timeout)]):AbortSignal.timeout(OUTSIDE_WIKIDATA_LIMITS.timeout);
  const r=await fetchImpl(url,{headers:{Accept:sparql?'application/sparql-results+json':'application/json','User-Agent':userAgent('outside speaker name corroboration; +https://github.com/bdamokos/EP-open-data-portal')},signal:active,redirect:'error',credentials:'omit'});
  const limited=upstreamResponseError(r,{source:'wikidata'});if(limited){await r.body?.cancel();throw limited;}
  if(!r.ok||!/(?:application\/json|application\/sparql-results\+json)/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();throw Error('Wikidata unavailable.');}
  if(Number(r.headers.get('content-length'))>OUTSIDE_WIKIDATA_LIMITS.bytes){await r.body?.cancel();throw Error('Wikidata size cap exceeded.');}
  const reader=r.body?.getReader();if(!reader)throw Error('Wikidata unavailable.');let size=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>OUTSIDE_WIKIDATA_LIMITS.bytes)throw Error('Wikidata size cap exceeded.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(body.error){const retryAfter=Math.max(60,retryAfterSeconds(r.headers.get('retry-after')));backoffUpstream(retryAfter,{source:'wikidata'});throw Object.assign(Error('Wikidata '+(body.error.code||'unavailable')),{retryAfter});}
  return {body,url,fetchedAt:new Date().toISOString()};
 },{source:'wikidata',priority:'background',backgroundRank:1,signal});
}
export async function readOutsideWikidata(query,options){const record=await outsideWikidataRequest(outsideWikidataUrl(query),options);const rows=record.body?.results?.bindings;if(!Array.isArray(rows)||rows.length>OUTSIDE_WIKIDATA_LIMITS.rows)throw Error('Wikidata result cap exceeded or response incomplete.');return {...record,rows};}
export async function resolveOutsideWikidata(names,{request=outsideWikidataRequest,signal}={}){
 if(!names.length||names.length>OUTSIDE_WIKIDATA_LIMITS.names)throw Error('Invalid outside speaker name batch.');
 const sources=[],get=async url=>{const r=await request(url,{signal});sources.push({url:r.url,fetchedAt:r.fetchedAt});return r.body;};
 const wanted=new Set(names.map(normalizeOutsideName)),ids=new Set();
 for(const name of names){const result=await get(outsideNameSearchUrl(name)),rows=result?.query?.search,total=result?.query?.searchinfo?.totalhits;
  if(!Array.isArray(rows)||!Number.isSafeInteger(total)||total<0||total!==rows.length||rows.length>50||result.continue||result['query-continue'])throw Error('Wikidata search is incomplete or exceeds candidate cap.');
  for(const r of rows){if(!/^Q[1-9]\d{0,11}$/.test(r.title||''))throw Error('Invalid discovery identity.');ids.add(r.title);}
 }
 if(ids.size>OUTSIDE_WIKIDATA_LIMITS.items)throw Error('Wikidata candidate cap exceeded.');
 if(!ids.size)return {status:'none',candidates:[],sources,urls:sources.map(s=>s.url),fetchedAt:sources.at(-1)?.fetchedAt};
 const metadata=await get(outsideNamesUrl([...ids]));if(!metadata?.entities||Object.keys(metadata.entities).some(id=>!ids.has(id)))throw Error('Wikidata name metadata unavailable.');
 const discovery=[],revisions=new Map();
 for(const id of ids){const e=metadata.entities[id];if(e?.id!==id||!Number.isSafeInteger(e.lastrevid))throw Error('Wikidata candidate metadata missing.');revisions.set(id,e.lastrevid);
  for(const [kind,terms] of [['label',Object.values(e.labels||{})],['alias',Object.values(e.aliases||{}).flat()]])for(const term of terms){const key=normalizeOutsideName(term.value);if(wanted.has(key))discovery.push({key:{type:'literal',value:key},item:{type:'uri',value:'http://www.wikidata.org/entity/'+id},value:{type:'literal',value:term.value},language:{type:'literal',value:term.language||''},property:{type:'uri',value:kind==='label'?'http://www.w3.org/2000/01/rdf-schema#label':'http://www.w3.org/2004/02/skos/core#altLabel'}});}
 }
 const exactIds=[...new Set(discovery.map(r=>r.item.value.split('/').at(-1)))];if(!exactIds.length)return {status:'none',candidates:[],sources,urls:sources.map(s=>s.url),fetchedAt:sources.at(-1)?.fetchedAt};
 const facts=await get(outsideWikidataUrl(outsideEvidenceQuery(exactIds))),evidence=facts?.results?.bindings;if(!Array.isArray(evidence)||evidence.length>OUTSIDE_WIKIDATA_LIMITS.rows)throw Error('Wikidata evidence is incomplete or exceeds row cap.');
 const candidates=outsideCandidateEvidence(discovery,evidence).map(c=>({...c,revision:revisions.get(c.qid)}));
 return {status:'available',dateVersion:1,candidates,sources,urls:sources.map(s=>s.url),fetchedAt:sources.at(-1)?.fetchedAt};
}
const literal=b=>b?.type==='literal'&&typeof b.value==='string'?b.value:null;
const qid=b=>b?.type==='uri'?String(b.value).match(/^http:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d{0,11})$/)?.[1]||null:null;
// Wikidata represents an explicitly unknown value as a stable genid URI.
// Preserve its presence without turning it into a country or a missing fact.
const entityOrUnknown=b=>Boolean(qid(b)||b?.type==='uri'&&/^http:\/\/www\.wikidata\.org\/\.well-known\/genid\/[a-zA-Z0-9]+$/.test(b.value));
const code=b=>{const v=literal(b);return /^[A-Z0-9]{3}$/.test(v||'')?countryIdentity(v)?.id||null:null;};
const date=(value,precision,calendar,full)=>!value?outsideOfficeDate(null,null,null,'absent'):entityOrUnknown(value)&&!qid(value)||value.type==='bnode'?outsideOfficeDate(null,null,null,'unknown'):outsideOfficeDate(literal(full),literal(precision),calendar?.value||null);

export function outsideCandidateEvidence(discovery,evidence){
 const byId=new Map();for(const r of discovery){const id=qid(r.item),value=literal(r.value),key=literal(r.key),kind=r.property?.value==='http://www.w3.org/2000/01/rdf-schema#label'?'label':r.property?.value==='http://www.w3.org/2004/02/skos/core#altLabel'?'alias':null;
  if(!id||!value||!key||normalizeOutsideName(value)!==key||!kind)throw Error('Wikidata discovery identity mismatch.');
  let c=byId.get(id);if(!c){c={qid:id,human:false,politician:false,occupations:[],names:[],positions:[],citizenships:[]};byId.set(id,c);}const language=literal(r.language)||null;if(!c.names.some(n=>n.value===value&&n.kind===kind&&n.language===language))c.names.push({value,kind,language});
 }
 if(byId.size>OUTSIDE_WIKIDATA_LIMITS.items)throw Error('Wikidata candidate cap exceeded.');
 for(const r of evidence){const id=qid(r.item),c=byId.get(id),kind=literal(r.kind);if(!c)throw Error('Unexpected Wikidata candidate.');
  if(kind==='human')c.human=true;
  else if(kind==='occupation'){if(!qid(r.occupation)||!['true','false'].includes(literal(r.politician)))throw Error('Invalid occupation evidence.');c.politician ||= literal(r.politician)==='true';const value={id:qid(r.occupation),politician:literal(r.politician)==='true'};if(!c.occupations.some(o=>o.id===value.id))c.occupations.push(value);}
  else if(kind==='citizenship'){const citizenship=qid(r.citizenship);if(!citizenship)throw Error('Invalid citizenship evidence.');const v={id:citizenship,country:code(r.citizenshipCode)};if(!c.citizenships.some(x=>x.id===v.id&&x.country===v.country))c.citizenships.push(v);}
  else if(kind==='position'){const id=qid(r.position),statement=r.statement?.type==='uri'&&/^http:\/\/www\.wikidata\.org\/entity\/statement\/[qQ][1-9]\d*-[A-Za-z0-9-]+$/.test(r.statement.value)?r.statement.value:null;if(!id||!statement||!['true','false'].includes(literal(r.international))||r.country&&!entityOrUnknown(r.country)||r.jurisdiction&&!entityOrUnknown(r.jurisdiction))throw Error('Invalid office evidence.');
   const value={id,statement,start:date(r.start,r.startPrecision,r.startCalendar,r.startFull),end:date(r.end,r.endPrecision,r.endCalendar,r.endFull),countries:code(r.countryCode)?[code(r.countryCode)]:[],jurisdictions:code(r.jurisdictionCode)?[code(r.jurisdictionCode)]:[],hasCountry:Boolean(r.country),hasJurisdiction:Boolean(r.jurisdiction),international:literal(r.international)==='true'};
   const old=c.positions.find(p=>p.statement===statement&&JSON.stringify([p.start,p.end])===JSON.stringify([value.start,value.end]));if(old){old.countries=[...new Set([...old.countries,...value.countries])];old.jurisdictions=[...new Set([...old.jurisdictions,...value.jurisdictions])];old.hasCountry ||= value.hasCountry;old.hasJurisdiction ||= value.hasJurisdiction;old.international ||= value.international;}else c.positions.push(value);
  }else throw Error('Invalid Wikidata evidence kind.');
 }
 if([...byId.values()].some(c=>!c.human))throw Error('Wikidata human evidence missing or changed.');return [...byId.values()];
}
