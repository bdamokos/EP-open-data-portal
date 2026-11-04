import {performance} from 'node:perf_hooks';
import {copyFastReadProgress,projectionTables} from './generation-copy.mjs';
import {amendmentSnapshotSource} from './amendments-store.mjs';
import {groupVoiceSource} from './group-voices-store.mjs';

// One transaction over a whole rotation spills its page cache again and again,
// rewrites the WAL at COMMIT, and loses everything when the process stops. Readers
// only follow `active`, so the new generation can be built in small commits: rows
// stay invisible until the final commit sets `working`. Only the source writer
// writes here and it resumes first, so the active rows cannot change underneath.
const MARKER='generationBegin';
// Row size varies by three orders of magnitude and the disk may be busy, so batches
// follow commit time. It also bounds how long shutdown waits on a synchronous commit.
const BATCH={initial:50,min:10,max:2000,targetMs:1000};
const PRUNED=[['sources','prune'],['items','prune'],['amendments','prune']];
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
  // Older images can leave extension tables behind the core generation. Their
  // adoption replays through triggers, so it keeps the single-transaction path.
  const voices=groupVoiceSource(store.db,active);
  return amendmentSnapshotSource(store.db,active)===active&&(voices===null||voices===active);
}
function columns(db,table,literal={}) {
  const info=db.prepare(`PRAGMA table_info(${table})`).all();
  const names=info.map(row=>row.name).filter(name=>name!=='generation');
  // The range key is the primary-key column after generation, when there is one.
  const key=info.filter(row=>row.pk>0).sort((a,b)=>a.pk-b.pk).map(row=>row.name)[1];
  return {names,values:names.map(name=>literal[name]??name),key};
}
// Ranges never split one key, so a commit may slightly exceed the batch size.
function copyBatch(db,{table,literal},generation,active,cursor,batch) {
  const {names,values,key}=columns(db,table,literal);
  const insert=where=>`INSERT INTO ${table}(generation,${names.join(',')}) SELECT ?,${values.join(',')} FROM ${table} WHERE generation=? ${where}`;
  db.prepare("INSERT INTO meta(key,value) VALUES ('fastReadCopyGeneration',?)").run(String(generation));
  let changes=0,next;
  try {
    if(!key)changes=Number(db.prepare(insert('')).run(generation,active).changes);
    else {
      // NULL sorts first and fails every range comparison, so copy it up front.
      if(cursor===undefined)changes+=Number(db.prepare(insert(`AND ${key} IS NULL`)).run(generation,active).changes);
      const after=cursor===undefined?`${key} IS NOT NULL`:`${key}>?`,args=cursor===undefined?[]:[cursor];
      next=db.prepare(`SELECT ${key} value FROM ${table} WHERE generation=? AND ${after} ORDER BY ${key} LIMIT ?`).all(active,...args,batch).at(-1)?.value;
      if(next!==undefined)changes+=Number(db.prepare(insert(`AND ${after} AND ${key}<=?`)).run(generation,active,...args,next).changes);
    }
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

// Returns the new cycle, or null when the caller must use the atomic path.
export function beginGenerationInBatches(store,{pause,batch,memoryTemp=false,log=console.log,finish}) {
  const db=store.db,saved=store.get(MARKER),sequence=store.get('sequence')||0,active=store.get('active')||0;
  if(store.get('working')){if(saved)store.generationTransaction(()=>store.set(MARKER,null));return null;}
  const voices=groupVoiceSource(db,active)!==null,stages=[...PRUNED.map(([table,step])=>({step,table,prune:true})),...STEPS.filter(stage=>!stage.voices||voices)];
  // A cursor is only meaningful to the plan that wrote it. An image with a
  // different plan starts a new generation and prunes the partial one.
  const plan=stages.map(stage=>stage.table).join();
  const resuming=saved?.generation===sequence&&saved.active===active&&saved.plan===plan;
  if(!resuming&&!batchedBeginEligible(store,active)){if(saved)store.generationTransaction(()=>store.set(MARKER,null));return null;}
  let state=resuming?{...saved,resumes:(saved.resumes||0)+1}:{generation:sequence+1,active,plan,startedAt:new Date(store.clock()).toISOString(),stage:0,steps:{},batches:0,resumes:0};
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
  while(state.stage<stages.length) {
    const stage=stages[state.stage],started=performance.now();
    commit(()=>{
      const next={...state,batches:state.batches+1};
      if(stage.prune) {
        if(pruneBatch(db,stage.table,active,generation,size)){next.stage++;delete next.cursor;}
      } else {
        const cursor=copyBatch(db,stage,generation,active,state.cursor,size);
        if(cursor===undefined){
          // Row counts catch a source that changed across a resume, such as an
          // older image writing during a rollback. Restart rather than publish it.
          const count=g=>db.prepare(`SELECT COUNT(*) n FROM ${stage.table} WHERE generation=?`).get(g).n;
          if(count(generation)!==count(active))throw Object.assign(new Error(`Generation copy of ${stage.table} does not match its source.`),{restartBegin:true});
          next.stage++;delete next.cursor;
        } else next.cursor=cursor;
      }
      next.steps={...state.steps,[stage.step]:(state.steps[stage.step]||0)+Math.round(performance.now()-started)};
      state=next;
    });
  }
  return store.generationTransaction(()=>{
    const started=performance.now(),cycle=finish(state,{log});
    copyFastReadProgress(db,'sources',generation,active);copyFastReadProgress(db,'outside',generation,active);copyFastReadProgress(db,'amendments',generation,active);
    state.steps.finish=Math.round(performance.now()-started);
    log('[generation-begin]',JSON.stringify({generation,active,steps:state.steps,batches:state.batches,resumes:state.resumes}));
    store.set(MARKER,null);
    return cycle;
  });
}
export const generationBeginPending=store=>Boolean(store.get(MARKER));
export const abandonGenerationBegin=store=>store.generationTransaction(()=>store.set(MARKER,null));
