import {createHash} from 'node:crypto';
import {amendmentGeneration} from './amendments-store.mjs';
import {canonicalEPReference} from './amendments.mjs';
import {array} from './activity-index-model.mjs';
import {validateAdoptedText} from './adopted-text-index.mjs';
import {HttpError} from './http-utils.mjs';
import {ODP_BASE} from './odp.mjs';

const typeOf=work=>String(work?.work_type?.id||work?.work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const expected=id=>'def/ep-document-types/'+(id.startsWith('TA-')?'TEXT_ADOPTED':id.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':id.startsWith('B-')?'RESOLUTION_MOTION':'REPORT_PLENARY');

// Copy one bounded read snapshot before any asynchronous source/body work.
// Retained projections are usable observations, never a fresh source census.
export function retainedDocumentContext(store,query,{adoptedCandidates,metadataBytes}) {
  if(!store?.readSnapshot||!store.db||!query.adopted&&!query.id.startsWith('TA-'))return null;
  return store.readSnapshot(()=>{
    const generations=[...new Set([store.get('working')?.generation,amendmentGeneration(store),store.get('active')].filter(Number.isInteger))];
    const endpoint=(query.id.startsWith('TA-')?'/adopted-texts/':'/plenary-documents/')+query.id;
    let bytes=0;
    const observation=(key,work,fetchedAt,generation)=>{
      if(!Number.isFinite(Date.parse(fetchedAt)))return null;
      const payload={data:[work]},serialized=JSON.stringify(payload);bytes+=Buffer.byteLength(serialized);
      if(bytes>metadataBytes)throw new HttpError(502,'document_source_budget','The linked document records are too large to read together.');
      const refreshError=store.db.prepare('SELECT error FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key)?.error||null;
      const source={url:ODP_BASE+key+'?format=application%2Fld%2Bjson',fetchedAt:new Date(fetchedAt).toISOString(),stale:true,refreshInProgress:false,refreshError,
        contentHash:createHash('sha256').update(serialized).digest('hex'),representation:'retained-index-projection',generation,epoch:store.get('epoch')};
      return {endpoint:key,work,source,record:{payload,fetchedAt:source.fetchedAt,url:source.url,stale:true,refreshInProgress:false,refreshError}};
    };
    for(const generation of generations) {
      const saved=store.source(generation,endpoint),work=saved?.work;
      if(!work)continue;
      if(work.identifier!==query.id||canonicalEPReference(work.id)!=='eli/dl/doc/'+query.id||typeOf(work)!==expected(query.id))return null;
      if(query.id.startsWith('TA-'))try{validateAdoptedText(endpoint,work);}catch{return null;}
      const root=observation(endpoint,work,saved.fetchedAt,generation);if(!root)return null;
      if(!query.adopted)return {root,related:[],truncated:false};
      const reference='eli/dl/doc/'+query.id;
      const rows=store.db.prepare(`SELECT key,body,fetched_at FROM sources source WHERE generation=? AND kind='document'
        AND key GLOB '/adopted-texts/TA-10-*' AND EXISTS(SELECT 1 FROM json_each(source.body,'$.adopts') adoption
          WHERE (CASE WHEN adoption.type='object' THEN json_extract(adoption.value,'$.id') ELSE adoption.value END) IN (?,?,?))
        ORDER BY key LIMIT ?`).all(generation,reference,'https://data.europarl.europa.eu/'+reference,'http://data.europarl.europa.eu/'+reference,adoptedCandidates+1);
      const related=[];
      for(const row of rows.slice(0,adoptedCandidates)) {
        const adopted=JSON.parse(row.body);
        try{validateAdoptedText(row.key,adopted);}catch{continue;}
        if(!array(adopted.adopts).some(value=>canonicalEPReference(value)===reference))continue;
        const saved=observation(row.key,adopted,row.fetched_at,generation);if(saved)related.push(saved);
      }
      if(related.length)return {root,related,truncated:rows.length>adoptedCandidates};
      // A retained empty set cannot establish source-wide absence. Continue
      // ordinary on-demand discovery when no exact retained choice is usable.
      return null;
    }
    return null;
  });
}
