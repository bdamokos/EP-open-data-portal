import path from 'node:path';
import {InsightViewCache} from './insights-view-cache.mjs';
import {HttpError} from './http-utils.mjs';

const baseId=value=>/^\d{4}-\d{4}[A-Z]?$/.test(value||'')?value:null;
export function eurovocQuery(ids,language) {
  if(!ids.length||ids.length>50||ids.some(id=>!baseId(id))||!/^[a-z]{2}$/.test(language))throw new HttpError(400,'invalid_topics','Invalid dossier selection.');
  const tuples=[...new Set(ids)].sort().map(id=>{const [year,number]=id.split('-');return `("${year}"^^xsd:gYear "${number}"^^xsd:string)`;}).join(' ');
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX skos:<http://www.w3.org/2004/02/skos/core#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?reference ?dossier ?work ?concept ?label WHERE {
 VALUES (?year ?number) { ${tuples} }
 ?dossier cdm:procedure_code_interinstitutional_year_procedure ?year;
 cdm:procedure_code_interinstitutional_number_procedure ?number;
 cdm:procedure_code_interinstitutional_reference_procedure ?reference;
 cdm:dossier_initiated_by_act_preparatory ?work.
 OPTIONAL { ?work cdm:work_is_about_concept_eurovoc ?concept.
  OPTIONAL { GRAPH <http://eurovoc.europa.eu/100141> {
   ?concept skos:prefLabel ?label. FILTER(lang(?label) IN ("en","${language}"))
  } }
 }
} LIMIT 3000`;
}
export function parseEurovoc(data,ids,language) {
  const rows=data?.results?.bindings;if(!Array.isArray(rows)||rows.length>=3000)throw new HttpError(502,'topic_source_shape','The official topic catalogue could not be read.');
  const groups=new Map(ids.map(id=>[id,new Map()]));
  for(const row of rows) {
    const reference=row.reference?.value,match=reference?.match(/^(\d{4})\/(\d{4}[A-Z]?)\/([A-Z]{2,8})$/);
    if(!match)continue;const id=match[1]+'-'+match[2];if(!groups.has(id))continue;
    if(![row.dossier,row.work].every(value=>value?.type==='uri'&&/^http:\/\/publications\.europa\.eu\/resource\/cellar\/[a-f0-9-]{36}$/.test(value.value)))continue;
    const alternatives=groups.get(id),key=reference+'|'+row.dossier.value+'|'+row.work.value;
    let group=alternatives.get(key);if(!group){group={reference:match[1]+'/'+match[2]+'('+match[3]+')',dossier:row.dossier.value,work:row.work.value,concepts:new Map()};alternatives.set(key,group);}
    if(!row.concept)continue;
    if(row.concept.type!=='uri'||!/^http:\/\/eurovoc\.europa\.eu\/[0-9]{1,8}$/.test(row.concept.value))continue;
    let concept=group.concepts.get(row.concept.value);if(!concept){concept={id:row.concept.value,labels:{}};group.concepts.set(concept.id,concept);}
    const label=row.label,lang=label?.['xml:lang'];if(label?.type==='literal'&&[language,'en'].includes(lang)&&typeof label.value==='string'&&label.value.length<=240)concept.labels[lang]=label.value;
  }
  return new Map([...groups].map(([id,alternatives])=>{
    // A year/number alone is not enough if CELLAR returns different procedures or initiating acts.
    if(alternatives.size!==1)return [id,{id,state:alternatives.size?'ambiguous':'unmapped',reference:null,concepts:[]}];
    const group=[...alternatives.values()][0],concepts=[...group.concepts.values()].filter(c=>c.labels[language]||c.labels.en).map(c=>({id:c.id,label:c.labels[language]||c.labels.en,language:c.labels[language]?language:'en'})).sort((a,b)=>a.id.localeCompare(b.id));
    return [id,{id,state:concepts.length?'mapped':'unmapped',...group,concepts}];
  }));
}

class CatalogCache extends InsightViewCache {
  async prune(){} // A batch is one write transaction for retention purposes.
  async pruneBatch(){return super.prune();}
}
export class EurovocCatalog {
  constructor(sources,{clock=Date.now,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'eurovoc-catalog-v1')}={}) {
    Object.assign(this,{sources,clock});this.cache=new CatalogCache({directory,clock,maxEntries:800,maxBytes:16*1024*1024,freshMs:7*86400_000});this.pending=new Map();
  }
  key(id,language){return this.cache.key(['eurovoc-v1',id,language]);}
  async known(ids,language) {
    const result=new Map();for(const id of ids){const record=await this.cache.stored(this.key(id,language));if(record?.value?.id===id)result.set(id,{...record.value,stale:this.clock()-record.at>7*86400_000});}return result;
  }
  async load(ids,language) {
    const key=JSON.stringify([language,[...ids].sort()]);if(this.pending.has(key))return this.pending.get(key);
    const job=(async()=>{
      const url=new URL('https://publications.europa.eu/webapi/rdf/sparql');url.searchParams.set('query',eurovocQuery(ids,language));url.searchParams.set('format','application/sparql-results+json');
      const source=await this.sources.get(url.href),parsed=parseEurovoc(source.data,ids,language);
      const values=await Promise.all([...parsed].map(async([id,value])=>{const result={...value,source:{url:source.url,fetchedAt:source.fetchedAt,stale:Boolean(source.viewCache?.stale)}};await this.cache.save(this.key(id,language),result);return [id,result];}));if(this.cache.directory)await this.cache.pruneBatch().catch(()=>{});return new Map(values);
    })().finally(()=>this.pending.delete(key));this.pending.set(key,job);return job;
  }
}
