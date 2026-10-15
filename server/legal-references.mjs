import path from 'node:path';
import {HttpError} from './http-utils.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {documentEndpoint} from './activities.mjs';
import {referenceKey,documentCelexCandidates,questionCandidates,cellarProcedureReference,eurLexUrl} from './legal-reference-text.mjs';

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
export function celexQuery(celexNumbers,language) {
  if(!celexNumbers.length||celexNumbers.some(celex=>!/^[35]\d{4}[A-Z]{1,2}\d{4}$/.test(celex)))throw new HttpError(400,'invalid_references','Invalid CELEX selection.');
  const wanted=[...new Set(['ENG',languages[language]||'ENG'])].map(code=>`<${authority}${code}>`).join(',');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?work ?date ?force ?proc ?lang ?title WHERE {
 VALUES ?celex { ${[...new Set(celexNumbers)].sort().map(celex=>`"${celex}"^^xsd:string`).join(' ')} }
 ?work cdm:resource_legal_id_celex ?celex.
 OPTIONAL { ?work cdm:work_date_document ?date }
 OPTIONAL { ?work cdm:resource_legal_in-force ?force }
 OPTIONAL { ?dossier cdm:dossier_contains_work ?work. ?dossier cdm:procedure_code_interinstitutional_reference_procedure ?proc }
 OPTIONAL { ?expression cdm:expression_belongs_to_work ?work; cdm:expression_uses_language ?lang; cdm:expression_title ?title. FILTER(?lang IN (${wanted})) }
} LIMIT 2000`;
}
// One exact CELEX number must identify one work. Absent fields remain null rather than false.
export function parseCelex(data,celexNumbers,language) {
  const rows=data?.results?.bindings;
  if(!Array.isArray(rows)||rows.length>=2000)throw new HttpError(502,'reference_source_shape','The official reference catalogue could not be read.');
  const works=new Map(celexNumbers.map(celex=>[celex,new Map()]));
  for(const row of rows) {
    const celex=row.celex?.value,work=row.work?.value;
    if(!works.has(celex)||row.work?.type!=='uri'||!/^http:\/\/publications\.europa\.eu\/resource\/cellar\/[a-f0-9-]{36}$/.test(work||''))continue;
    let item=works.get(celex).get(work);if(!item){item={work,dates:new Set(),force:new Set(),procedures:new Set(),titles:{}};works.get(celex).set(work,item);}
    if(/^\d{4}-\d{2}-\d{2}$/.test(row.date?.value||''))item.dates.add(row.date.value);
    if(['1','0','true','false'].includes(row.force?.value))item.force.add(['1','true'].includes(row.force.value));
    const procedure=cellarProcedureReference(row.proc?.value);if(procedure)item.procedures.add(procedure);
    const code=String(row.lang?.value||'').replace(authority,''),title=text(row.title?.value);
    if(title&&code&&!item.titles[code])item.titles[code]=title.slice(0,REFERENCE_LIMITS.titleLength);
  }
  return new Map(celexNumbers.map(celex=>{
    const found=[...works.get(celex).values()];
    if(found.length!==1)return [celex,{status:found.length?'ambiguous':'not-found',celex}];
    const item=found[0],local=languages[language],title=item.titles[local]||item.titles.ENG||null;
    return [celex,{status:'found',celex,work:item.work,title,titleLanguage:item.titles[local]?language:item.titles.ENG?'en':null,
      date:item.dates.size===1?[...item.dates][0]:null,inForce:item.force.size===1?[...item.force][0]:null,
      procedure:item.procedures.size===1?[...item.procedures][0]:null,eurLexUrl:eurLexUrl(celex,language)}];
  }));
}
function questionTitle(work,language) {
  const titles=work?.title_dcterms||{};
  const value=text(titles[language])||text(titles.en)||text(Object.values(titles)[0]);
  return {title:value||null,titleLanguage:titles[language]?language:titles.en?'en':Object.keys(titles)[0]||null};
}
const noRecord=error=>/\((?:404|410)\)/.test(String(error?.message||''));

class BatchCache extends InsightViewCache {
  async prune(){} // A resolved batch prunes once.
  async pruneBatch(){return super.prune();}
}
export class LegalReferences {
  constructor(sources,{clock=Date.now,request=odp,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'legal-references-v1')}={}) {
    Object.assign(this,{sources,clock,request});
    this.cache=new BatchCache({directory,clock,maxEntries:3000,maxBytes:8*1024*1024,freshMs:REFERENCE_LIMITS.freshMs});
  }
  cacheKey(key,language){return this.cache.key(['legal-reference-v1',key,language]);}
  fresh(record){return record&&this.clock()-record.at<(record.value.status==='found'?REFERENCE_LIMITS.freshMs:REFERENCE_LIMITS.missingFreshMs);}
  async query({keys,language}) {
    const saved=new Map();
    for(const key of keys){const record=await this.cache.stored(this.cacheKey(key,language));if(record?.value?.key===key)saved.set(key,record);}
    const missing=keys.filter(key=>!this.fresh(saved.get(key))),resolved=new Map();
    const documents=missing.filter(key=>key.startsWith('celex:')||documentCelexCandidates(key).length);
    if(documents.length)try {
      const candidates=new Map(documents.map(key=>[key,key.startsWith('celex:')?[key.slice(6)]:documentCelexCandidates(key)]));
      const url=new URL(sparqlEndpoint);url.searchParams.set('query',celexQuery([...candidates.values()].flat(),language));url.searchParams.set('format','application/sparql-results+json');
      const source=await this.sources.get(url.href),parsed=parseCelex(source.data,[...candidates.values()].flat(),language);
      const provenance={name:'Publications Office knowledge graph',url:sparqlEndpoint,fetchedAt:source.fetchedAt};
      for(const [key,celexNumbers] of candidates) {
        const found=celexNumbers.map(celex=>parsed.get(celex)).filter(item=>item.status!=='not-found');
        const value=found.length===1?found[0]:{status:found.length?'ambiguous':'not-found',celex:null};
        resolved.set(key,{key,kind:/^celex:3/.test(key)?'act':'document',...value,source:provenance});
      }
    }catch(error){for(const key of documents)resolved.set(key,{key,kind:/^celex:3/.test(key)?'act':'document',status:'unavailable',reason:String(error.message).slice(0,200)});}
    for(const key of missing.filter(key=>key.startsWith('question:'))) {
      const outcomes=await Promise.all(questionCandidates(key).map(async id=>{
        try {
          const record=await this.request(documentEndpoint(id),{},{staleWhileRevalidate:true,priority:'interactive'});
          const work=record.payload.data.find(node=>node.identifier===id);
          return work?{id,work,apiUrl:record.url||'https://data.europarl.europa.eu/api/v2'+documentEndpoint(id),fetchedAt:new Date(record.fetchedAt).toISOString()}:{id,absent:true};
        }catch(error){return noRecord(error)?{id,absent:true}:{id,error:String(error.message).slice(0,200)};}
      }));
      const found=outcomes.filter(outcome=>outcome.work);
      // A failed lookup could hide a second candidate, so it never resolves a term-boundary year.
      if(found.length===1&&!outcomes.some(outcome=>outcome.error)) {
        const {id,work,apiUrl,fetchedAt}=found[0],answers=Array.isArray(work.inverse_answers_to)?work.inverse_answers_to:[];
        resolved.set(key,{key,kind:'question',status:'found',id,...questionTitle(work,language),date:work.document_date||null,answerIds:answers.map(a=>a?.identifier).filter(id=>typeof id==='string').slice(0,5),source:{name:'European Parliament Open Data API v2',url:apiUrl,fetchedAt}});
      }
      else resolved.set(key,{key,kind:'question',status:found.length>1?'ambiguous':outcomes.some(outcome=>outcome.error)?'unavailable':'not-found',id:null});
    }
    // A procedure number is opened directly; its summary request checks it against OEIL.
    for(const key of missing.filter(key=>key.startsWith('procedure:')))resolved.set(key,{key,kind:'procedure',status:'found',procedure:key.slice(10)});
    for(const [key,value] of resolved)if(value.status!=='unavailable')await this.cache.save(this.cacheKey(key,language),value);
    if(resolved.size&&this.cache.directory)await this.cache.pruneBatch().catch(()=>{});
    const references=keys.map(key=>{
      const value=resolved.get(key);
      if(value?.status==='unavailable'&&saved.has(key))return {...saved.get(key).value,stale:true};
      return value||saved.get(key).value;
    });
    return {view:'legal-references',language,references,attribution:'Publications Office of the European Union (EUR-Lex, Cellar) and European Parliament Open Data API v2, CC BY 4.0'};
  }
}
