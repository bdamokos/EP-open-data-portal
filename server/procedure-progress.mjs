import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {procedureReference} from './official-context.mjs';
import {eurLexUrl} from './legal-reference-text.mjs';

export const PROCEDURE_PROGRESS_VERSION=1;
export const PROGRESS_LIMITS=Object.freeze({events:300,eventRows:1201,documentRows:2401,freshMs:3600_000});
const endpoint='https://publications.europa.eu/webapi/rdf/sparql';
const cellar='http://publications.europa.eu/resource/cellar/';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const workPattern=new RegExp('^'+cellar.replaceAll('.','\\.')+uuid+'$');
const eventPattern=new RegExp('^'+cellar.replaceAll('.','\\.')+uuid+'(?:\\.\\d{4,8})?$');
const uri=(binding,pattern)=>binding?.type==='uri'&&pattern.test(binding.value||'')?binding.value:null;
const literal=binding=>binding?.type==='literal'&&typeof binding.value==='string'?binding.value:null;
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const code=(binding,scheme)=>uri(binding,new RegExp('^http://publications\\.europa\\.eu/resource/authority/'+scheme+'/[A-Za-z0-9_-]{1,100}$'));
const milestones=new Set(['ADP_REP_byEP_CMT','ADP_PROPLEG_byCOM','ADP_APPRGEN_byCONSIL','ADP_MAND_NGT_INST_COREPER_byCONSIL','ENDORSE_AGRPROV_COREPER_byCONSIL','APR_AGRPROV_CONSIL_byEP_CMT','REF_toCMT_NGTINST_byEP_PLEN','AMEND_R1_byEP','ADP_R1_POS_byEP','APR_R1_byCONSIL','SIGN_byEP_CONSIL','PUB_OJ']);

export function procedureProgressQuery(search) {
  for(const key of search.keys())if(!['reference','lang','detail'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated legislative progress parameter.');
  const reference=procedureReference(search.get('reference')),language=odpLanguage(search.get('lang')||'en'),detail=search.get('detail')??'events';
  if(!['events','documents'].includes(detail))throw new HttpError(400,'invalid_detail','Choose events or documents.');
  return {reference,language,detail};
}
const sourceReference=reference=>procedureReference(reference).replace(/\(([A-Z]{2,8})\)$/,'/$1');
export function progressSparql({reference,language,detail='events'}) {
  const ref=sourceReference(reference);odpLanguage(language);
  if(!['events','documents'].includes(detail))throw new HttpError(400,'invalid_detail','Choose events or documents.');
  const identity=`?dossier cdm:procedure_code_interinstitutional_reference_procedure "${ref}"^^xsd:string.`;
  const fields=detail==='documents'?`?event cdm:event_legal_contains_work ?work.
 OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
 OPTIONAL { ?work owl:sameAs ?alias }
 OPTIONAL { ?expression cdm:expression_belongs_to_work ?work; cdm:expression_title ?title. FILTER(lang(?title) IN ("${language}","en")) }`:
 `OPTIONAL { ?event cdm:event_legal_date ?date }
 OPTIONAL { ?event cdm:event_legal_has_type_concept_type_event_legal ?type.
  OPTIONAL { ?type skos:prefLabel ?label. FILTER(lang(?label) IN ("${language}","en")) } }
 OPTIONAL { ?event cdm:event_legal_has-status_event-status ?status.
  OPTIONAL { ?status skos:prefLabel ?statusLabel. FILTER(lang(?statusLabel) IN ("${language}","en")) } }
 OPTIONAL { ?event cdm:event_legal_initiated_by_institution ?institution.
  OPTIONAL { ?institution skos:prefLabel ?institutionLabel. FILTER(lang(?institutionLabel) IN ("${language}","en")) } }
 OPTIONAL { ?event cdm:event_legal_contains_work ?work }`;
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
PREFIX skos:<http://www.w3.org/2004/02/skos/core#>
PREFIX owl:<http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?kind ?reference ?dossier ?event ?date ?type ?label ?status ?statusLabel ?institution ?institutionLabel ?work ?celex ?alias ?title WHERE {
 { { SELECT DISTINCT ?dossier WHERE { ${identity} } LIMIT 3 } BIND("0" AS ?kind) }
 UNION { { SELECT DISTINCT ?dossier ?event WHERE { ${identity} ?event cdm:event_legal_part_of_dossier ?dossier. } ORDER BY ?event LIMIT ${PROGRESS_LIMITS.events+1} }
 BIND("1" AS ?kind) ${fields} }
 BIND("${ref}" AS ?reference)
} ORDER BY ?kind ?dossier ?event ?work ?date ?type ?institution ?label ?alias ?title LIMIT ${detail==='documents'?PROGRESS_LIMITS.documentRows:PROGRESS_LIMITS.eventRows}`;
}
function labels(map,id,binding,language) {
  if(!id)return;
  if(!map.has(id))map.set(id,new Map());
  const lang=binding?.['xml:lang'],value=literal(binding);
  if([language,'en'].includes(lang)&&value&&value.length<=1200){const values=map.get(id);if(!values.has(lang))values.set(lang,new Set());values.get(lang).add(value);}
}
function labelled(map,language) {
  return [...map].map(([id,names])=>{
    const actual=names.get(language)?.size===1?language:names.get('en')?.size===1?'en':null;
    return {id,code:id.split('/').at(-1),label:actual?[...names.get(actual)][0]:null,language:actual};
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
function envelope(data,query) {
  const rows=data?.results?.bindings;if(!Array.isArray(rows))throw new HttpError(502,'progress_source_shape','Legislative progress could not be read.');
  const limit=query.detail==='documents'?PROGRESS_LIMITS.documentRows:PROGRESS_LIMITS.eventRows;
  if(rows.length>limit)throw new HttpError(502,'progress_source_shape','Legislative progress exceeded its source limit.');
  const ref=sourceReference(query.reference),dossiers=new Set();let invalidRows=0;
  const valid=[];
  for(const row of rows){
    const dossier=uri(row.dossier,workPattern),kind=literal(row.kind);
    if(literal(row.reference)!==ref||!dossier||!['0','1'].includes(kind)){invalidRows++;continue;}
    if(kind==='0')dossiers.add(dossier);
    valid.push(row);
  }
  // Mapping rows sort before events, so a capped event response cannot hide an alternative identity.
  if(rows.length&&!dossiers.size)throw new HttpError(502,'progress_source_identity','The official procedure identity could not be verified.');
  const state=dossiers.size===1?'mapped':dossiers.size?'ambiguous':'unmapped';
  return {rows:valid,dossier:state==='mapped'?[...dossiers][0]:null,state,coverage:{limited:rows.length===limit,invalidRows,incompleteEvents:0}};
}
export function parseProgress(data,query) {
  const {rows,...base}=envelope(data,{...query,detail:'events'}),groups=new Map();
  if(base.state==='mapped')for(const row of rows.filter(row=>literal(row.kind)==='1')) {
    const id=uri(row.event,eventPattern);
    if(row.dossier.value!==base.dossier||!id){base.coverage.invalidRows++;continue;}
    if(!groups.has(id))groups.set(id,{id,dates:new Set(),types:new Map(),statuses:new Map(),institutions:new Map(),works:new Set(),invalidDate:false});
    const e=groups.get(id),rawDate=literal(row.date),validDate=date(rawDate);
    if(rawDate&&!validDate)e.invalidDate=true;if(validDate)e.dates.add(validDate);
    labels(e.types,code(row.type,'event'),row.label,query.language);
    labels(e.statuses,code(row.status,'event-status'),row.statusLabel,query.language);
    labels(e.institutions,code(row.institution,'corporate-body'),row.institutionLabel,query.language);
    const work=uri(row.work,workPattern);if(work)e.works.add(work);
    if(row.status&&!code(row.status,'event-status'))e.invalidStatus=true;
  }
  if(groups.size>PROGRESS_LIMITS.events)base.coverage.limited=true;
  const events=[...groups.values()].slice(0,PROGRESS_LIMITS.events).map(e=>{
    const types=labelled(e.types,query.language),statuses=labelled(e.statuses,query.language),institutions=labelled(e.institutions,query.language);
    const status=e.invalidStatus||statuses.length>1?'unknown':!statuses.length?'recorded':statuses[0].code==='PROJECTED'?'projected':['CANCELLED','ANNULLED'].includes(statuses[0].code)?'cancelled':'unknown';
    const issues=[...(e.dates.size!==1||e.invalidDate?['date']:[]),...(!types.length?['type']:[]),...(types.length!==1||!types[0].label?['label']:[]),...(e.invalidStatus||statuses.length>1?['status']:[])];
    if(issues.length)base.coverage.incompleteEvents++;
    return {id:e.id,date:e.dates.size===1&&!e.invalidDate?[...e.dates][0]:null,dates:[...e.dates].sort(),types,statuses,status,institutions,works:[...e.works].sort(),label:types.length===1?types[0].label:null,labelLanguage:types.length===1?types[0].language:null,milestone:types.some(t=>milestones.has(t.code)),issues};
  }).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id));
  return {...base,events};
}
const celexPattern=/^[0-9][0-9A-Z()/._-]{4,40}$/;
export function readableDocumentUrl({celex},language) {
  if(celex.length===1&&celexPattern.test(celex[0]))return eurLexUrl(celex[0],language);
  // A Council metadata alias does not establish a publicly served PDF. Keep
  // unsupported identifiers as provenance instead of constructing a dead link.
  return null;
}
export function parseProgressDocuments(data,query) {
  const {rows,...base}=envelope(data,{...query,detail:'documents'}),groups=new Map();
  if(base.state==='mapped')for(const row of rows.filter(row=>literal(row.kind)==='1')) {
    const event=uri(row.event,eventPattern),work=uri(row.work,workPattern);
    if(row.dossier.value!==base.dossier||!event||!work){base.coverage.invalidRows++;continue;}
    const key=event+'|'+work;
    if(!groups.has(key))groups.set(key,{event,work,celex:new Set(),aliases:new Set(),titles:new Map()});
    const d=groups.get(key),celex=literal(row.celex),alias=row.alias?.type==='uri'?row.alias.value:null;
    if(celexPattern.test(celex||''))d.celex.add(celex);
    const exact=alias?.match(/^http:\/\/publications\.europa\.eu\/resource\/celex\/(.+)$/)?.[1];
    if(celexPattern.test(exact||''))d.celex.add(exact);
    if(alias)d.aliases.add(alias);
    labels(d.titles,work,row.title,query.language);
  }
  const documents=[...groups.values()].map(d=>{
    const title=labelled(d.titles,query.language)[0],celex=[...d.celex].sort(),aliases=[...d.aliases].sort();
    return {event:d.event,work:d.work,celex,aliases,title:title?.label||null,titleLanguage:title?.language||null,url:readableDocumentUrl({celex,aliases},title?.language||'en')};
  });
  return {...base,documents};
}
export class ProcedureProgress {
  constructor(sources){this.sources=sources;}
  async query(query) {
    const url=new URL(endpoint);url.searchParams.set('query',progressSparql(query));url.searchParams.set('format','application/sparql-results+json');
    const source=await this.sources.get(url.href,{freshMs:PROGRESS_LIMITS.freshMs});
    const parsed=query.detail==='documents'?parseProgressDocuments(source.data,query):parseProgress(source.data,query);
    return {view:'procedure-progress',version:PROCEDURE_PROGRESS_VERSION,reference:query.reference,language:query.language,detail:query.detail,...parsed,source:{name:'EU Publications Office',url:source.url,fetchedAt:source.fetchedAt,stale:Boolean(source.viewCache?.stale),refreshInProgress:Boolean(source.viewCache?.refreshInProgress),refreshError:source.viewCache?.refreshError||null}};
  }
}
