import {sourceTitle} from './source-titles.mjs';
import path from 'node:path';
import {HttpError} from './http-utils.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {documentEndpoint} from './activities.mjs';
import {referenceKey,documentCelexCandidates,questionCandidates,cellarProcedureReference,eurLexUrl} from './legal-reference-text.mjs';
import {createRequestBudget,requestSignal,runWithRequestSignal,waitForRequest} from './request-budget.mjs';

export const REFERENCE_LIMITS=Object.freeze({keys:40,titleLength:1200,freshMs:7*86400_000,missingFreshMs:86400_000});
const authority='http://publications.europa.eu/resource/authority/language/';
const languages={bg:'BUL',es:'SPA',cs:'CES',da:'DAN',de:'DEU',et:'EST',el:'ELL',en:'ENG',fr:'FRA',ga:'GLE',hr:'HRV',it:'ITA',lv:'LAV',lt:'LIT',hu:'HUN',mt:'MLT',nl:'NLD',pl:'POL',pt:'POR',ro:'RON',sk:'SLK',sl:'SLV',fi:'FIN',sv:'SWE'};
const sparqlEndpoint='https://publications.europa.eu/webapi/rdf/sparql';
const text=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';

export function referencesQuery(search) {
  for(const key of search.keys())if(!['keys','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated reference query.');
  const raw=(search.get('keys')||'').split(',').filter(Boolean);
  if(!raw.length||raw.length>REFERENCE_LIMITS.keys)throw new HttpError(400,'invalid_references',`Request between 1 and ${REFERENCE_LIMITS.keys} references.`);
  const keys=raw.map(referenceKey);
  if(keys.some(key=>!key))throw new HttpError(400,'invalid_references','A reference key is not recognised.');
  return {keys:[...new Set(keys)],language:odpLanguage(search.get('lang')||'en')};
}
const cellarWork=uuid=>`http://publications.europa.eu/resource/cellar/${uuid}`;
const workFields=wanted=>` OPTIONAL { ?work cdm:work_date_document ?date }
 OPTIONAL { ?work cdm:resource_legal_in-force ?force }
 OPTIONAL { ?dossier cdm:dossier_contains_work ?work. ?dossier cdm:procedure_code_interinstitutional_reference_procedure ?proc }
 OPTIONAL { ?expression cdm:expression_belongs_to_work ?work; cdm:expression_uses_language ?lang; cdm:expression_title ?title. FILTER(?lang IN (${wanted})) }`;
const wantedLanguages=language=>[...new Set(['ENG',languages[language]||'ENG'])].map(code=>`<${authority}${code}>`).join(',');
export function celexQuery(celexNumbers,language) {
  if(!celexNumbers.length||celexNumbers.some(celex=>!/^[35]\d{4}[A-Z]{1,2}\d{4}(?:\(\d{2}\))?$/.test(celex)))throw new HttpError(400,'invalid_references','Invalid CELEX selection.');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?work ?date ?force ?proc ?lang ?title WHERE {
 VALUES ?celex { ${[...new Set(celexNumbers)].sort().map(celex=>`"${celex}"^^xsd:string`).join(' ')} }
 ?work cdm:resource_legal_id_celex ?celex.
${workFields(wantedLanguages(language))}
} LIMIT 2000`;
}
// A Cellar link names the work itself. It must exist as a work; its CELEX number is read, not assumed.
export function cellarQuery(uuids,language) {
  if(!uuids.length||uuids.some(uuid=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)))throw new HttpError(400,'invalid_references','Invalid Cellar selection.');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?work ?celex ?date ?force ?proc ?lang ?title WHERE {
 VALUES ?work { ${[...new Set(uuids)].sort().map(uuid=>`<${cellarWork(uuid)}>`).join(' ')} }
 ?work a cdm:work.
 OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
${workFields(wantedLanguages(language))}
} LIMIT 2000`;
}
function rowsOf(data) {
  const rows=data?.results?.bindings;
  if(!Array.isArray(rows)||rows.length>=2000)throw new HttpError(502,'reference_source_shape','The official reference catalogue could not be read.');
  return rows;
}
function collect(rows,ids,idOf) {
  const works=new Map(ids.map(id=>[id,new Map()]));
  for(const row of rows) {
    const id=idOf(row),work=row.work?.value;
    if(!works.has(id)||row.work?.type!=='uri'||!/^http:\/\/publications\.europa\.eu\/resource\/cellar\/[a-f0-9-]{36}$/.test(work||''))continue;
    let item=works.get(id).get(work);if(!item){item={work,celex:new Set(),dates:new Set(),force:new Set(),procedures:new Set(),titles:{}};works.get(id).set(work,item);}
    if(/^[0-9][0-9A-Z()/._-]{4,40}$/.test(row.celex?.value||''))item.celex.add(row.celex.value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(row.date?.value||''))item.dates.add(row.date.value);
    if(['1','0','true','false'].includes(row.force?.value))item.force.add(['1','true'].includes(row.force.value));
    const procedure=cellarProcedureReference(row.proc?.value);if(procedure)item.procedures.add(procedure);
    const code=String(row.lang?.value||'').replace(authority,''),title=text(row.title?.value);
    if(title&&code&&!item.titles[code])item.titles[code]=title.slice(0,REFERENCE_LIMITS.titleLength);
  }
  return works;
}
// Absent fields remain null rather than false; several values for one field are not chosen between.
function describe(item,celex,language) {
  const local=languages[language],title=item.titles[local]||item.titles.ENG||null;
  return {status:'found',celex,work:item.work,title,titleLanguage:item.titles[local]?language:item.titles.ENG?'en':null,
    date:item.dates.size===1?[...item.dates][0]:null,inForce:item.force.size===1?[...item.force][0]:null,
    procedure:item.procedures.size===1?[...item.procedures][0]:null,eurLexUrl:celex?eurLexUrl(celex,language):null};
}
// One exact CELEX number must identify one work.
export function parseCelex(data,celexNumbers,language) {
  const works=collect(rowsOf(data),celexNumbers,row=>row.celex?.value);
  return new Map(celexNumbers.map(celex=>{
    const found=[...works.get(celex).values()];
    return [celex,found.length===1?describe(found[0],celex,language):{status:found.length?'ambiguous':'not-found',celex}];
  }));
}
export function parseCellar(data,uuids,language) {
  const works=collect(rowsOf(data),uuids,row=>String(row.work?.value||'').split('/').pop());
  return new Map(uuids.map(uuid=>{
    const item=works.get(uuid).get(cellarWork(uuid));
    return [uuid,item?describe(item,item.celex.size===1?[...item.celex][0]:null,language):{status:'not-found',celex:null}];
  }));
}
const kindOf=celex=>/^5/.test(celex||'')?'document':'act';
function questionTitle(work,language) {
  const titles=work?.title_dcterms||{};
  const value=text(titles[language])||text(titles.en)||text(Object.values(titles)[0]);
  return {title:sourceTitle(value)||null,titleLanguage:titles[language]?language:titles.en?'en':Object.keys(titles)[0]||null};
}
const noRecord=error=>/\((?:404|410)\)/.test(String(error?.message||''));

class BatchCache extends InsightViewCache {
  async prune(){} // A resolved batch prunes once.
  async pruneBatch(){return super.prune();}
}
export class LegalReferences {
  constructor(sources,{clock=Date.now,request=odp,requestBudgetMs=28_000,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'legal-references-v1')}={}) {
    Object.assign(this,{sources,clock,request,requestBudgetMs});
    this.cache=new BatchCache({directory,clock,maxEntries:3000,maxBytes:8*1024*1024,freshMs:REFERENCE_LIMITS.freshMs});
  }
  cacheKey(key,language){return this.cache.key(['legal-reference-v1',key,language]);}
  fresh(record){return record&&this.clock()-record.at<(record.value.status==='found'?REFERENCE_LIMITS.freshMs:REFERENCE_LIMITS.missingFreshMs);}
  async query(query) {
    const budget=createRequestBudget(this.requestBudgetMs),parent=requestSignal();
    const signal=parent?AbortSignal.any([parent,budget.signal]):budget.signal;
    try{return await runWithRequestSignal(signal,()=>this.resolve(query,signal));}finally{budget.dispose();}
  }
  async resolve({keys,language},signal) {
    const saved=new Map();
    // Collect every available memory record before a disk wait can expire.
    for(const key of keys){const record=this.cache.cache.get(this.cacheKey(key,language));if(record?.value?.key===key&&Number.isFinite(record.at))saved.set(key,record);}
    for(const key of keys){
      if(signal.aborted)break;
      if(saved.has(key))continue;
      try{const record=await waitForRequest(this.cache.stored(this.cacheKey(key,language)),signal);if(record?.value?.key===key)saved.set(key,record);}
      catch(error){if(signal.aborted)break;throw error;}
    }
    const missing=keys.filter(key=>!this.fresh(saved.get(key))),resolved=new Map();
    const documents=missing.filter(key=>key.startsWith('celex:')||documentCelexCandidates(key).length);
    if(documents.length&&!signal.aborted)try {
      const candidates=new Map(documents.map(key=>[key,key.startsWith('celex:')?[key.slice(6)]:documentCelexCandidates(key)]));
      const url=new URL(sparqlEndpoint);url.searchParams.set('query',celexQuery([...candidates.values()].flat(),language));url.searchParams.set('format','application/sparql-results+json');
      const source=await waitForRequest(this.sources.get(url.href),signal),parsed=parseCelex(source.data,[...candidates.values()].flat(),language);
      const provenance={name:'Publications Office knowledge graph',url:sparqlEndpoint,fetchedAt:source.fetchedAt},stale=Boolean(source.viewCache?.stale);
      for(const [key,celexNumbers] of candidates) {
        const found=celexNumbers.map(celex=>parsed.get(celex)).filter(item=>item.status!=='not-found');
        const value=found.length===1?found[0]:{status:found.length?'ambiguous':'not-found',celex:null};
        resolved.set(key,{key,kind:/^celex:3/.test(key)?'act':'document',...value,source:provenance,...(stale?{stale:true}:{})});
      }
    }catch(error){for(const key of documents)resolved.set(key,{key,kind:/^celex:3/.test(key)?'act':'document',status:'unavailable',reason:String(error.message).slice(0,200)});}
    const cellar=missing.filter(key=>key.startsWith('cellar:'));
    if(cellar.length&&!signal.aborted)try {
      const uuids=cellar.map(key=>key.slice(7)),url=new URL(sparqlEndpoint);url.searchParams.set('query',cellarQuery(uuids,language));url.searchParams.set('format','application/sparql-results+json');
      const source=await waitForRequest(this.sources.get(url.href),signal),parsed=parseCellar(source.data,uuids,language);
      const stale=Boolean(source.viewCache?.stale);
      for(const key of cellar){const value=parsed.get(key.slice(7));resolved.set(key,{key,kind:kindOf(value.celex),...value,source:{name:'Publications Office knowledge graph',url:sparqlEndpoint,fetchedAt:source.fetchedAt},...(stale?{stale:true}:{})});}
    }catch(error){for(const key of cellar)resolved.set(key,{key,kind:'act',status:'unavailable',reason:String(error.message).slice(0,200)});}
    for(const key of missing.filter(key=>key.startsWith('question:'))) {
      if(signal.aborted)break;
      const outcomes=await Promise.all(questionCandidates(key).map(async id=>{
        try {
          const record=await waitForRequest(this.request(documentEndpoint(id),{},{staleWhileRevalidate:true,priority:'interactive'}),signal);
          const work=record.payload.data.find(node=>node.identifier===id);
          return work?{id,work,stale:Boolean(record.stale),apiUrl:record.url||'https://data.europarl.europa.eu/api/v2'+documentEndpoint(id),fetchedAt:new Date(record.fetchedAt).toISOString()}:{id,absent:true,stale:Boolean(record.stale)};
        }catch(error){return noRecord(error)?{id,absent:true}:{id,error:String(error.message).slice(0,200)};}
      }));
      const found=outcomes.filter(outcome=>outcome.work);
      // A failed lookup could hide a second candidate, so it never resolves a term-boundary year.
      if(found.length===1&&!outcomes.some(outcome=>outcome.error)) {
        const {id,work,apiUrl,fetchedAt}=found[0],stale=outcomes.some(outcome=>outcome.stale),answers=Array.isArray(work.inverse_answers_to)?work.inverse_answers_to:[];
        resolved.set(key,{key,kind:'question',status:'found',id,...questionTitle(work,language),date:work.document_date||null,answerIds:answers.map(a=>a?.identifier).filter(id=>typeof id==='string').slice(0,5),source:{name:'European Parliament Open Data API v2',url:apiUrl,fetchedAt},...(stale?{stale:true}:{})});
      }
      else resolved.set(key,{key,kind:'question',status:found.length>1?'ambiguous':outcomes.some(outcome=>outcome.error)?'unavailable':'not-found',id:null,...(outcomes.some(outcome=>outcome.stale)?{stale:true}:{})});
    }
    // A procedure number is opened directly; its summary request checks it against OEIL.
    for(const key of missing.filter(key=>key.startsWith('procedure:')))resolved.set(key,{key,kind:'procedure',status:'found',procedure:key.slice(10)});
    // A result built from a stale upstream copy is shown as such and never saved as a fresh result.
    for(const [key,value] of resolved){
      if(signal.aborted)break;
      if(value.status!=='unavailable'&&!value.stale)try{await waitForRequest(this.cache.save(this.cacheKey(key,language),value),signal);}catch(error){if(signal.aborted)break;throw error;}
    }
    if(resolved.size&&this.cache.directory&&!signal.aborted)await waitForRequest(this.cache.pruneBatch(),signal).catch(()=>{});
    const references=keys.map(key=>{
      const value=resolved.get(key);
      if(value?.status==='unavailable'&&saved.has(key))return {...saved.get(key).value,stale:true};
      if(value)return value;
      if(saved.has(key))return {...saved.get(key).value,...(!this.fresh(saved.get(key))?{stale:true}:{})};
      return {key,kind:key.startsWith('question:')?'question':key.startsWith('procedure:')?'procedure':key.startsWith('cellar:')||key.startsWith('celex:3')?'act':'document',status:'unavailable',reason:signal.reason?.message||'Reference details are temporarily unavailable.'};
    });
    return {view:'legal-references',language,references,attribution:'Publications Office of the European Union (EUR-Lex, Cellar) and European Parliament Open Data API v2, CC BY 4.0'};
  }
}
