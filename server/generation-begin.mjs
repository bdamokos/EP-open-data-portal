import {performance} from 'node:perf_hooks';
import {copyFastReadProgress,projectionTables} from './generation-copy.mjs';
import {amendmentSnapshotSource} from './amendments-store.mjs';
import {groupVoiceSource} from './group-voices-store.mjs';
import {questionFileBackfillDue} from './activity-read-projections.mjs';

// One transaction over a whole rotation spills its page cache again and again,
// rewrites the WAL at COMMIT, and loses everything when the process stops. Readers
// only follow `active`, so the new generation can be built in small commits: rows
// stay invisible until the final commit sets `working`. Only the source writer
// writes here and it resumes first, so the active rows cannot change underneath.
const MARKER='generationBegin';
// Row size varies by three orders of magnitude and the disk may be busy, so batches
// follow commit time and bytes. That also bounds how long shutdown waits on a
// synchronous commit, and the temporary copy SQLite holds of a batch.
const BATCH={initial:50,min:10,max:2000,targetMs:1000,bytes:16*1024*1024};
const PRUNED=['sources','items','amendments'].map(table=>({step:'prune',table,prune:true}));
// Tables without a primary key name their range key here.
const RANGE_KEYS={procedure_event_reads:'source_key'};
const STEPS=[
  ...[['sources',{seen:'0'}],...projectionTables('sources').map(table=>[table])].map(([table,literal])=>({step:'sources',table,literal})),
  {step:'items',table:'items'},
  {step:'questionFiles',table:'question_file_sources'},{step:'questionFiles',table:'question_files'},
  ...['outside_contributions',...projectionTables('outside')].map(table=>({step:'outside',table})),
  {step:'groupVoices',table:'group_voice_observations',voices:true},{step:'groupVoices',table:'group_voice_designations',voices:true},
  ...['amendments',...projectionTables('amendments')].map(table=>({step:'amendments',table})),
];

function batchedBeginEligible(store,active) {
  if(!active||!['sources','outside','amendments'].every(projection=>store.fastReadsReady(active,projection)))return false;
  // These are the only writes a released image makes to active rows before it
  // advances documentBodyTurn. Finished, a rollback cannot change rows unseen.
  if(questionFileBackfillDue(store,active))return false;
  // Older images can leave extension tables behind the core generation. Their
  // adoption replays through triggers, so it keeps the single-transaction path.
  const voices=groupVoiceSource(store.db,active);
  return amendmentSnapshotSource(store.db,active)===active&&(voices===null||voices===active);
}
function columns(db,table,literal={}) {
  const info=db.prepare(`PRAGMA table_info(${table})`).all();
  const names=info.map(row=>row.name).filter(name=>name!=='generation');
  // The range key is the primary-key column after generation, when there is one.
  const key=RANGE_KEYS[table]??info.filter(row=>row.pk>0).sort((a,b)=>a.pk-b.pk).map(row=>row.name)[1];
  if(!key)throw new Error(`Generation copy of ${table} has no range key.`);
  return {names,values:names.map(name=>literal[name]??name),key,sized:names.includes('body')};
}
// Ranges never split one key, so a commit can slightly exceed its bounds.
function copyBatch(db,{table,literal},generation,active,cursor,rows,bytes) {
  const {names,values,key,sized}=columns(db,table,literal);
  const insert=where=>`INSERT INTO ${table}(generation,${names.join(',')}) SELECT ?,${values.join(',')} FROM ${table} WHERE generation=? ${where}`;
  db.prepare("INSERT INTO meta(key,value) VALUES ('fastReadCopyGeneration',?)").run(String(generation));
  let changes=0,next;
  try {
    // NULL sorts first and fails every range comparison, so copy it up front.
    if(cursor===undefined)changes+=Number(db.prepare(insert(`AND ${key} IS NULL`)).run(generation,active).changes);
    const after=cursor===undefined?`${key} IS NOT NULL`:`${key}>?`,args=cursor===undefined?[]:[cursor];
    let total=0;
    // octet_length reads only the record header, on pages this batch is about to copy.
    for(const row of db.prepare(`SELECT ${key} value,${sized?'octet_length(body)':'0'} size FROM ${table} WHERE generation=? AND ${after} ORDER BY ${key} LIMIT ?`).iterate(active,...args,rows)) {
      next=row.value;total+=row.size||0;
      if(total>=bytes)break;
    }
    if(next!==undefined)changes+=Number(db.prepare(insert(`AND ${after} AND ${key}<=?`)).run(generation,active,...args,next).changes);
    if(table==='amendments'&&changes)db.prepare("INSERT INTO meta(key,value) VALUES ('amendmentMutationRevision',?) ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+CAST(excluded.value AS INTEGER) AS TEXT)").run(String(changes));
  } finally {db.prepare("DELETE FROM meta WHERE key='fastReadCopyGeneration'").run();}
  return next;
}
function pruneBatch(db,table,active,generation,batch) {
  let changes=0;
  for(const [where,args] of [['generation<?',[active]],['generation>? AND generation<?',[active,generation]],['generation>?',[generation]]]) {
    changes+=Number(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ?)`).run(...args,batch-changes).changes);
    if(changes>=batch)return false;
  }
  return true;
}
const allTables=[...new Set(STEPS.map(stage=>stage.table))].reverse(),GENERATION_DISCARD_BATCH=200;
// The marker keeps these rows out of amendment adoption and reads, so it goes only
// in the commit that removes the last of them. Interrupted, this simply runs again.
function discardPartialGeneration(store,{generation},pause) {
  const {db}=store,active=store.get('active')||0;
  if(generation!==active&&generation!==store.get('working')?.generation)for(const table of allTables) {
    for(let changes=GENERATION_DISCARD_BATCH;changes>=GENERATION_DISCARD_BATCH;) {
      const started=performance.now();
      // Tables without a rowid hold only small projections; remove them in one step.
      const whole=db.prepare("SELECT wr FROM pragma_table_list WHERE schema='main' AND name=?").get(table).wr;
      changes=store.generationTransaction(()=>Number((whole?db.prepare(`DELETE FROM ${table} WHERE generation=?`).run(generation):db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE generation=? LIMIT ?)`).run(generation,GENERATION_DISCARD_BATCH)).changes));
      if(whole)break;
      pause?.(performance.now()-started);
    }
  }
  store.generationTransaction(()=>store.set(MARKER,null));
}

// Returns the new cycle, or null when the caller must use the atomic path.
export function beginGenerationInBatches(store,{pause,batch,batchBytes=BATCH.bytes,memoryTemp=false,log=console.log,finish}) {
  const db=store.db,saved=store.get(MARKER);
  if(store.get('working')){if(saved)discardPartialGeneration(store,saved,pause);return null;}
  const sequence=store.get('sequence')||0,active=store.get('active')||0;
  const voices=groupVoiceSource(db,active)!==null,stages=[...PRUNED,...STEPS.filter(stage=>!stage.voices||voices)];
  // A cursor is only meaningful to the plan that wrote it. Every iteration of any
  // image advances documentBodyTurn before it can write, and the writer resumes
  // before its own, so a changed turn means active rows may have changed since.
  const plan=stages.map(stage=>stage.table).join(),turn=store.get('documentBodyTurn')??0;
  const resuming=saved&&!saved.discard&&saved.generation===sequence&&saved.active===active&&saved.plan===plan&&saved.turn===turn;
  if(saved&&!resuming)discardPartialGeneration(store,saved,pause);
  if(!resuming&&!batchedBeginEligible(store,active))return null;
  let state=resuming?{...saved,resumes:(saved.resumes||0)+1}:{generation:sequence+1,active,plan,turn,startedAt:new Date(store.clock()).toISOString(),stage:0,steps:{},batches:0,resumes:0};
  const {generation}=state;
  // Each batch's INSERT ... SELECT reads its own table, so SQLite buffers the rows
  // in a temporary table. They are small now; keep them off the disk. Not for the
  // atomic path, whose buffer is the whole table.
  if(memoryTemp)db.exec('PRAGMA temp_store=MEMORY');
  let size=batch??BATCH.initial;
  const commit=work=>{
    const started=performance.now(),result=store.generationTransaction(()=>{
      const value=work();
      store.set(MARKER,state);
      return value;
    }),elapsed=performance.now()-started;
    if(batch===undefined)size=elapsed>2*BATCH.targetMs?Math.max(BATCH.min,size>>1):elapsed<BATCH.targetMs?Math.min(BATCH.max,size*2):size;
    pause?.(elapsed);
    return result;
  };
  if(!resuming)commit(()=>{
    // Dropping the rollback generation first frees pages the copy reuses, and it
    // must commit before those rows start to go.
    store.set('sequence',generation);store.set('previous',null);
    for(const table of ['tasks','follow_summary','dossier_events','follow_generations','follow_touched','membership_snapshots','group_history_snapshots'])store.pruneGenerationTable(table,active);
    db.prepare('DELETE FROM outside_contributions WHERE generation<>?').run(active);
  });
  const matchesSource=table=>{
    const count=g=>db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE generation=?`).get(g).n;
    if(count(generation)!==count(active))throw Object.assign(new Error(`Generation copy of ${table} does not match its source.`),{restartBegin:true});
  };
  while(state.stage<stages.length) {
    const stage=stages[state.stage],started=performance.now();
    commit(()=>{
      const next={...state,batches:state.batches+1};
      const advance=()=>{next.stage++;delete next.cursor;if(batch===undefined)size=BATCH.initial;};
      if(stage.prune) {
        if(pruneBatch(db,stage.table,active,generation,size))advance();
      } else {
        const cursor=copyBatch(db,stage,generation,active,state.cursor,size,batchBytes);
        if(cursor===undefined)advance();
        else next.cursor=cursor;
      }
      next.steps={...state.steps,[stage.step]:(state.steps[stage.step]||0)+Math.round(performance.now()-started)};
      state=next;
    });
  }
  if(memoryTemp)db.exec('PRAGMA temp_store=FILE');
  return store.generationTransaction(()=>{
    const started=performance.now();
    // Row counts catch a source that changed unseen, across every copied table.
    for(const {table,prune} of stages)if(!prune)matchesSource(table);
    const cycle=finish(state,{log});
    copyFastReadProgress(db,'sources',generation,active);copyFastReadProgress(db,'outside',generation,active);copyFastReadProgress(db,'amendments',generation,active);
    state.steps.finish=Math.round(performance.now()-started);
    log('[generation-begin]',JSON.stringify({generation,active,steps:state.steps,batches:state.batches,resumes:state.resumes}));
    store.set(MARKER,null);
    return cycle;
  });
}
export const generationBeginPending=store=>Boolean(store.get(MARKER));
// Anything that may have rebuilt rows under a partial generation ends its resume.
export const discardGenerationBegin=store=>{const saved=store.get(MARKER);if(saved&&!saved.discard)store.set(MARKER,{...saved,discard:true});};
