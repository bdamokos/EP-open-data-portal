import {createHash} from 'node:crypto';
import {amendmentGeneration} from './amendments-store.mjs';
import {adoptedTextProjectionVersion,spId,validateTA} from './commission-followups-model.mjs';
import {ODP_BASE} from './odp.mjs';

// Capture one bounded generation before asynchronous reader work. Older
// projections discarded URI relationships, so their empty array is unknown.
export function retainedCommissionFollowups(store,{id},{reads,metadataBytes}) {
  if(!store?.readSnapshot||!store.db)return null;
  return store.readSnapshot(()=>{
    const generations=[...new Set([store.get('working')?.generation,amendmentGeneration(store),store.get('active')].filter(Number.isInteger))];
    for(const generation of generations) {
      let bytes=0;
      const records=[],epoch=store.get('marksEpoch');
      const read=endpoint=>{
        const row=store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND key=? AND kind='document'").get(generation,endpoint);
        if(!row)return null;
        const at=Date.parse(row.fetched_at),invalidDate=!Number.isFinite(at);
        bytes+=Buffer.byteLength(row.body);
        if(bytes>metadataBytes)throw Object.assign(new Error('Retained follow-up metadata exceeds the reader bound.'),{code:'followup_metadata_budget',endpoint});
        const work=JSON.parse(row.body),payload={data:[work]},raw=JSON.stringify(payload);
        const refreshError=store.db.prepare('SELECT error FROM refresh_gaps WHERE generation=? AND key=?').get(generation,endpoint)?.error||null;
        const source={url:ODP_BASE+endpoint+'?format=application%2Fld%2Bjson',fetchedAt:invalidDate?null:new Date(at).toISOString(),stale:true,refreshInProgress:false,refreshError,
          contentHash:createHash('sha256').update(raw).digest('hex'),representation:'retained-index-projection',generation,epoch};
        return {endpoint,source,invalidDate,record:{payload,fetchedAt:invalidDate?null:at,url:source.url,stale:true,refreshInProgress:false,refreshError}};
      };
      try {
        const root=read('/adopted-texts/'+id);if(!root)continue;
        try{validateTA(root.record.payload,id);if(root.invalidDate)throw Error('Unknown retained retrieval date.');}catch{return {generation,epoch,records:[root],unverifiedRoot:true};}
        records.push(root);
        const work=root.record.payload.data[0];
        if(work.adoptionProjectionVersion===adoptedTextProjectionVersion&&Array.isArray(work.followupRelationships)) {
          const ids=[...new Set(work.followupRelationships.map(spId).filter(Boolean))].slice(0,reads);
          for(const reply of ids){const saved=read('/external-documents/'+reply);if(saved?.record.payload.data[0].followupProjectionVersion===1)records.push(saved);}
        }
        return {generation,epoch,records};
      }catch(error){if(error.code==='followup_metadata_budget')return {generation,epoch,metadataBudget:records.length===0,budgetEndpoint:error.endpoint,records};throw error;}
    }
    return null;
  });
}
