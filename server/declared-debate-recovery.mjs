import {observeRuleGap} from './refresh-policy.mjs';
import {sourceRuleError} from './source-retry.mjs';
import {array} from './activity-index-model.mjs';
import {groupVoiceJobKey} from './group-voices-store.mjs';
import {createHash} from 'node:crypto';

const marker='declaredDebateRecovery',batch=100,week=7*86400_000,relationshipBytes=8*1024*1024;
const childId=/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/;
const debateId=/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/;
const relative=value=>typeof value==='string'?value.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
const eventId=value=>relative(typeof value==='object'?value?.id:value)?.match(/^eli\/dl\/event\/([A-Z0-9-]{1,100})$/)?.[1]||null;
const type=value=>relative(value)?.match(/^def\/ep-activities\/([A-Z][A-Z0-9_]+)$/)?.[1]||null;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const eventUrl=id=>'https://data.europarl.europa.eu/api/v2/events/'+id+'?format=application%2Fld%2Bjson';
const validSaved=(work,id)=>work?.classificationVersion===1&&work.id===id&&/^[A-Z][A-Z0-9_]+$/.test(work.kind)&&work.source?.url===eventUrl(id)&&Number.isFinite(Date.parse(work.source?.fetchedAt));
export const declaredSpeechType=kind=>['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].includes(kind);
const sameParent=(node,parent)=>node.inverse_consists_of===undefined||array(node.inverse_consists_of).length>0&&array(node.inverse_consists_of).every(ref=>eventId(ref)===parent);
const currentTermSpeech=(node,id,now)=>node.activity_id===id&&validDate(node.activity_date)&&node.activity_date>='2024-07-16'&&node.activity_date<=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))&&(node.parliamentary_term==null||array(node.parliamentary_term).length>0&&array(node.parliamentary_term).every(term=>relative(typeof term==='object'?term?.id:term)==='org/ep-10'));
const state=(store,generation)=>{
  const saved=store.get(marker);
  return saved?.version===1&&saved.generation===generation&&typeof saved.afterKey==='string'&&saved.afterKey.length<=180&&typeof saved.complete==='boolean'?saved:{version:1,generation,afterKey:'',complete:false};
};
export function declaredDebateRecoveryDue(store,generation) {
  return !state(store,generation).complete&&!store.db.prepare("SELECT 1 FROM tasks INDEXED BY task_pending_kind WHERE generation=? AND kind='debate-links' AND (done IN (-1,0) OR done IS NULL) LIMIT 1").get(generation)&&Boolean(store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND kind='procedure' LIMIT 1").get(generation));
}
// The scan reads keys only. Each procedure's saved relationship page is handled
// separately, so one large procedure cannot fan out an unbounded queue here.
export function scheduleDeclaredDebateRecovery(worker,generation) {
  const {store}=worker;if(store.get('working')?.generation!==generation)return;
  const saved=state(store,generation);if(saved.complete)return;
  // Keep a single bounded scan slice queued; resume after its local work ends.
  if(store.db.prepare("SELECT 1 FROM tasks INDEXED BY task_pending_kind WHERE generation=? AND kind='debate-links' AND (done IN (-1,0) OR done IS NULL) LIMIT 1").get(generation))return;
  store.transaction(()=>{
    store.assertWriter();
    const rows=store.db.prepare("SELECT key FROM sources WHERE generation=? AND kind='procedure' AND key>? ORDER BY key LIMIT ?").all(generation,saved.afterKey,batch);
    for(const {key} of rows)store.enqueue(generation,'debate-links:'+key,'debate-links',{endpoint:key,offset:0},102);
    store.set(marker,{...saved,afterKey:rows.at(-1)?.key||saved.afterKey,complete:rows.length<batch});
  });
}
function deferredOwned(store,generation,keys) {
  return ['tasks','discovery'].some(bucket=>Boolean(store.db.prepare(`SELECT 1 FROM sources source,json_each(source.body,?) entry
    WHERE source.generation=? AND source.key='amendment:continuations'
    AND json_extract(entry.value,'$.key') IN (${keys.map(()=>'?').join(',')}) LIMIT 1`).get('$.'.concat(bucket),generation,...keys)));
}
function speechOwned(store,generation,id) {
  const keys=['/speeches/'+id,'recovery:/speeches/'+id,'outside:detail:'+id,'outside:english:'+id,'outside:upgrade:'+id];
  for(const key of keys) {
    if(store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key))return true;
    if(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,key))return true;
    if(store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,key))return true;
  }
  if(store.db.prepare('SELECT 1 FROM group_voice_jobs WHERE generation=? AND key=? AND done<>1').get(generation,groupVoiceJobKey('recovery',id)))return true;
  // Publication checkpoints own displaced cursors just as the live queue does.
  return deferredOwned(store,generation,keys);
}
function enqueueEvent(worker,generation,id,role,parent=null) {
  const {store}=worker;
  if(store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,'/events/'+id))return;
  if(deferredOwned(store,generation,['/events/'+id]))return;
  if(role==='child'&&(validSaved(store.source(generation,'/events/'+id)?.work,id)||store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND key=? AND kind='speech'").get(generation,'/speeches/'+id)||speechOwned(store,generation,id)))return;
  store.enqueue(generation,'/events/'+id,'declared-event',{id,role,...(parent?{parent}:{} )},103,role==='debate');
}
function root(record,id) {
  const nodes=record.payload.data.filter(node=>eventId(node)===id||node.activity_id===id);
  if(nodes.length!==1||eventId(nodes[0])!==id||nodes[0].activity_id!==undefined&&nodes[0].activity_id!==id||!type(nodes[0].had_activity_type))throw sourceRuleError('Declared event detail has no unique exact typed record.');
  return nodes[0];
}
export function currentSpeechDetail(record,id,now=Date.now()) {
  const node=root(record,id);
  if(!childId.test(id)||!declaredSpeechType(type(node.had_activity_type))||!currentTermSpeech(node,id,now))throw sourceRuleError('Speech detail conflicts with its exact identity, current-term date or type.');
  return node;
}
export function declaredSpeechDetail(record,id,parent,now=Date.now()) {
  const node=currentSpeechDetail(record,id,now);
  if(!debateId.test(parent)||!sameParent(node,parent))throw sourceRuleError('Declared speech detail conflicts with its parent.');
  return node;
}
export async function declaredDebateTask(worker,task) {
  const {store}=worker,{generation,body}=task;
  if(store.get('working')?.generation!==generation)throw new Error('Declared event recovery requires the working generation.');
  store.assertWriter();worker.controller.signal.throwIfAborted();
  if(task.kind==='debate-links') {
    if(!/^\/procedures\/\d{4}-\d{4}[A-Z]?$/.test(body.endpoint)||!Number.isSafeInteger(body.offset)||body.offset<0)throw new Error('Invalid declared debate cursor.');
    // Hash the bounded relationship observation, not unrelated procedure roles.
    // Page this captured value so the hash and rows describe the same snapshot.
    const source=store.db.prepare(`SELECT fetched_at,CASE WHEN json_type(body,'$.consists_of')='array'
      AND length(CAST(json_extract(body,'$.consists_of') AS BLOB))<=? THEN json_extract(body,'$.consists_of') END relationships
      FROM sources WHERE generation=? AND key=? AND kind='procedure'`).get(relationshipBytes,generation,body.endpoint);
    if(typeof source?.relationships!=='string')throw new Error('Saved procedure relationship observation is unavailable or exceeds 8 MiB.');
    const procedureObservation=createHash('sha256').update(JSON.stringify([body.endpoint,source.fetched_at])).update('\0').update(source.relationships).digest('hex');
    const offset=body.procedureObservation===procedureObservation?body.offset:0;
    const rows=store.db.prepare(`SELECT entry.key ordinal,CASE WHEN entry.type='object' THEN json_extract(entry.value,'$.id') END id,
      CASE WHEN entry.type='object' THEN json_extract(entry.value,'$.had_activity_type') END kind
      FROM json_each(?) entry WHERE entry.key>=? ORDER BY entry.key LIMIT ?`).all(source.relationships,offset,batch);
    for(const row of rows) {const id=eventId(row.id);if(type(row.kind)==='PLENARY_DEBATE'&&debateId.test(id))await observeRuleGap(worker,generation,'/events/'+id);}
    store.transaction(()=>{
      store.assertWriter();
      for(const row of rows){const id=eventId(row.id);if(type(row.kind)==='PLENARY_DEBATE'&&debateId.test(id))enqueueEvent(worker,generation,id,'debate');}
      if(rows.length<batch)store.finishTask(task);else store.taskProgress(task,{...body,offset:rows.at(-1).ordinal+1,procedureObservation});
    });
    return;
  }
  if(!['debate','child'].includes(body.role)||!(body.role==='debate'?debateId:childId).test(body.id)||body.role==='child'&&!debateId.test(body.parent))throw new Error('Invalid declared event identifier.');
  // An owner acquired after admission must also win at execution. Completing
  // this redundant check is not a source acquisition; its real owner survives.
  const admittedElsewhere=!task.amendmentJob&&store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=? AND (done IS NULL OR done<>1)').get(generation,task.key);
  if(admittedElsewhere||body.role==='child'&&speechOwned(store,generation,body.id)) {
    store.transaction(()=>{
      store.assertWriter();
      // Transfer service to the existing owner without pretending that this
      // endpoint's earlier failure acquired metadata or closed its gap.
      if(store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,task.key)) {
        store.db.prepare(`UPDATE ${task.amendmentJob?'amendment_jobs':'tasks'} SET done=1 WHERE generation=? AND key=?`).run(generation,task.key);
        if(!admittedElsewhere)store.db.prepare('DELETE FROM refresh_gap_admissions WHERE generation=? AND key=?').run(generation,task.key);
      } else store.finishTask(task);
    });return;
  }
  const key='/events/'+body.id,retained=store.source(generation,key);
  let saved=retained?.work;
  if(body.role==='child'||!validSaved(saved,body.id)||saved.kind!=='PLENARY_DEBATE'||!Array.isArray(saved.children)||saved.children.some(id=>!childId.test(id))||worker.clock()-Date.parse(retained.fetchedAt)>=week) {
    const record=await worker.request(key),node=root(record,body.id),kind=type(node.had_activity_type);
    worker.controller.signal.throwIfAborted();store.assertWriter();
    if(body.role==='debate'&&(kind!=='PLENARY_DEBATE'||!Array.isArray(node.consists_of)||node.consists_of.length>10000))throw sourceRuleError('Declared debate has invalid child metadata.');
    if(body.role==='child'&&!sameParent(node,body.parent))throw sourceRuleError('Declared event detail conflicts with its parent.');
    if(body.role==='child'&&declaredSpeechType(kind)&&!currentTermSpeech(node,body.id,worker.clock()))throw sourceRuleError('Declared speech lacks its own current-term identity or date.');
    saved={id:body.id,kind,date:validDate(node.activity_date)?node.activity_date:null,classificationVersion:1,source:{url:record.url,fetchedAt:record.fetchedAt},...(body.role==='debate'?{children:[...new Set(node.consists_of.map(eventId).filter(id=>childId.test(id)))]}:{declaredBy:body.parent})};
    store.putSource(generation,key,body.role==='debate'?'debate':'event',saved,record.fetchedAt,[],{sourceUrl:record.url,acquisition:'recovery'});
  }
  if(body.role==='debate')for(const id of saved.children.slice(body.childOffset||0,(body.childOffset||0)+batch))await observeRuleGap(worker,generation,'/events/'+id);
  store.transaction(()=>{
    store.assertWriter();
    if(body.role==='debate') {
      // The numeric offset belongs to this exact observation. A refresh can
      // commit before a cursor checkpoint; the persisted hash catches that
      // interrupted handoff as well as reordered or newly inserted children.
      const childObservation=createHash('sha256').update(JSON.stringify([saved.source,saved.children])).digest('hex');
      const offset=body.childObservation===childObservation?body.childOffset||0:0;
      if(!Number.isSafeInteger(offset)||offset<0||offset>saved.children.length)throw new Error('Invalid declared child cursor.');
      for(const id of saved.children.slice(offset,offset+batch))enqueueEvent(worker,generation,id,'child',body.id);
      if(offset+batch<saved.children.length){store.taskProgress(task,{...body,childOffset:offset+batch,childObservation});return;}
    } else if(declaredSpeechType(saved.kind)&&!speechOwned(store,generation,body.id)) {
      store.enqueue(generation,'recovery:/speeches/'+body.id,'speeches',{recoveryId:body.id,declaredParent:body.parent,detectedAt:saved.source.fetchedAt,params:{'sitting-date':saved.date,'sitting-date-end':saved.date},offset:0},103);
    }
    store.finishTask(task);
  });
}
