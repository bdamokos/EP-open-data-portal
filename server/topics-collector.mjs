import {procedurePageHints,procedureRefresh} from './topic-refresh.mjs';
import {collectorRetry} from './collector-retry.mjs';
import {projectProcedure} from './activity-index-model.mjs';
import {classifyProcedure} from './insights-legislation-model.mjs';
import {getSharedOfficialContextSources,parseProcedurePage} from './official-context.mjs';
import {topicCollectorTables} from './topics-project.mjs';
export async function collectTopicProcedure(worker,{sources=worker.officialContext?.sources||getSharedOfficialContextSources()}={}){
 const s=worker.store;topicCollectorTables(s.db);s.assertWriter();const now=worker.clock();
 if(worker.requests>=worker.budget||worker.controller.signal.aborted)return false;
 const row=s.db.prepare('SELECT * FROM topic_procedure_queue WHERE next_read<=? ORDER BY next_read,id LIMIT 1').get(now);if(!row)return false;
 // A full retained-source store pauses admission; it is not a source failure.
 if(sources.cache?.capacity&&(await sources.cache.capacity()).state!=='ready'){s.db.prepare('UPDATE topic_procedure_queue SET next_read=? WHERE id=?').run(now+60_000,row.id);return false;}
 const attempts=s.db.prepare('SELECT attempts FROM topic_procedure_attempts WHERE id=?').get(row.id)?.attempts||0;
 // Persist the in-flight retry before reading; a crash cannot spin on this ID.
 s.db.prepare('UPDATE topic_procedure_queue SET next_read=? WHERE id=?').run(now+86400_000,row.id);
 try{
 if(!row.reference){
  const record=await worker.request('/procedures/'+row.id,{}, {backgroundLow:true}),identity=value=>String(value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''),expected='eli/dl/proc/'+row.id;
  const matches=(record.payload?.data||[]).filter(w=>identity(w.id)===expected);if(matches.length!==1)throw Error('Procedure identity unavailable.');const work=matches[0];if(work['@id']&&identity(work['@id'])!==expected||work.process_id&&work.process_id!==row.id)throw Error('Conflicting procedure identity.');
  const code=classifyProcedure(work).code,reference=typeof work.label==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]+\)$/.test(work.label)?work.label:code?row.id.replace('-','/')+'('+code+')':null;if(!reference)throw Error('Procedure reference unavailable.');
  s.transaction(()=>{s.assertWriter();s.db.prepare('INSERT OR REPLACE INTO topic_procedure_metadata VALUES (?,?,?,?)').run(row.id,JSON.stringify({...projectProcedure(work),...Object.fromEntries(['process_status','procedure_status','status','stage','process_stage'].filter(k=>work[k]!==undefined).map(k=>[k,work[k]]))}),record.url,typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt);s.db.prepare('UPDATE topic_procedure_queue SET reference=?,next_read=0 WHERE id=?').run(reference,row.id);s.db.prepare('DELETE FROM topic_procedure_attempts WHERE id=?').run(row.id);s.set('topicProjectionDirty',true);});return true;
 }
 const url='https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference:row.reference});
 const raw=s.db.prepare('SELECT body,fetched_at FROM topic_procedure_metadata WHERE id=?').get(row.id),active=s.source(s.get('active'),'/procedures/'+row.id),metadata=active&&(!raw||Date.parse(active.fetchedAt)>Date.parse(raw.fetched_at))?active.work:raw?JSON.parse(raw.body):{};
 const prior=s.db.prepare('SELECT body FROM topic_procedure_pages WHERE id=?').get(row.id),saved=prior?JSON.parse(prior.body):null;
 let policy=procedureRefresh(metadata,saved?.state==='unavailable'?{}:saved||{},now);
 if(saved&&saved.state!=='unavailable'&&(policy.completed||!policy.changed&&policy.next>now)){s.db.prepare('UPDATE topic_procedure_queue SET next_read=? WHERE id=?').run(policy.next,row.id);return false;}
 const held=sources.cache?.stored?await sources.cache.stored(sources.cache.key(['official-context-v1',url])):null;
 let page;
 if(held?.value?.html){const hints=procedurePageHints(held.value.html,row.reference);policy=procedureRefresh(metadata,{...hints,source:{fetchedAt:held.value.fetchedAt}},now);if(policy.completed||!policy.changed&&policy.next>now)page=held.value;}
 if(!page){worker.requests++;page=await sources.get(url,{priority:'background',freshMs:policy.changed?0:policy.freshMs,waitForFresh:true});}
 worker.controller.signal.throwIfAborted();s.assertWriter();if(page.viewCache?.stale)return true;
 let parsed;try{parsed=parseProcedurePage(page.html,row.reference,'en');}catch(error){if(error.code)throw error;throw Object.assign(new Error(error.message),{code:'official_document_invalid',cause:error});}
 const hints=procedurePageHints(page.html,row.reference),source={url:page.url,fetchedAt:page.fetchedAt};policy=procedureRefresh(metadata,{...hints,source},now);
 s.transaction(()=>{s.assertWriter();s.db.prepare('INSERT OR REPLACE INTO topic_procedure_pages VALUES (?,?,?)').run(row.id,row.reference,JSON.stringify({subjects:parsed.subjects,language:parsed.language,url:page.url,source,...hints}));s.db.prepare('UPDATE topic_procedure_queue SET next_read=? WHERE id=?').run(policy.next,row.id);s.db.prepare('DELETE FROM topic_procedure_attempts WHERE id=?').run(row.id);s.set('topicProjectionDirty',true);});
 }catch(error){
  if(worker.controller.signal.aborted)throw error;s.assertWriter();
  const retry=collectorRetry(error,attempts,worker.clock());
  s.transaction(()=>{s.assertWriter();
   s.db.prepare('UPDATE topic_procedure_queue SET next_read=? WHERE id=?').run(retry.next,row.id);
   if(!retry.paused)s.db.prepare('INSERT OR REPLACE INTO topic_procedure_attempts VALUES (?,?,?)').run(row.id,retry.attempts,String(error.message).slice(0,200));
   if(retry.permanent){const url=row.reference?'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference:row.reference}):'https://data.europarl.europa.eu/api/v2/procedures/'+row.id;s.db.prepare('INSERT OR REPLACE INTO topic_procedure_pages VALUES (?,?,?)').run(row.id,row.reference,JSON.stringify({state:'unavailable',reason:error.code==='official_source_size'?'source-too-large':error.code||'source-unavailable',subjects:[],url,checkedAt:new Date(worker.clock()).toISOString(),retryAt:retry.next}));s.set('topicProjectionDirty',true);}
  });
 }

 return true;
}

export function topicCollectionDue(store,now){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='topic_procedure_queue'").get())return false;
 return Boolean(store.db.prepare('SELECT 1 FROM topic_procedure_queue WHERE next_read<=? LIMIT 1').get(now));
}
