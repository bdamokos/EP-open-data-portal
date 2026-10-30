const marker='declaredSpeechDiscovery';
const state=(store,generation)=>{
  const saved=store.get(marker);return saved?.generation===generation&&typeof saved.afterKey==='string'&&saved.afterKey.length<=180&&typeof saved.complete==='boolean'&&(!saved.complete||Number.isFinite(saved.completedAt)&&store.clock()-saved.completedAt<6*3600_000)?saved:{generation,afterKey:'',complete:false};
};
export function declaredSpeechDiscoveryDue(store,generation) {return generation!==null&&!state(store,generation).complete;}
// Read only the published index. Never copy its data into another index or
// write through the attachment; normal corpus jobs own all transcript work.
export async function discoverDeclaredSpeeches(worker,generation) {
  const {store}=worker,saved=state(store,generation);if(saved.complete)return;
  const rows=store.db.prepare(`SELECT source.key,json_extract(source.body,'$.id') id,json_extract(source.body,'$.kind') kind,json_extract(source.body,'$.declaredParent') parent
    FROM idx.sources source WHERE source.generation=? AND source.kind='speech' AND source.key>? ORDER BY source.key LIMIT 100`).all(generation,saved.afterKey);
  store.transaction(()=>{
    store.assertWriter();
    for(const row of rows) {
      if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(row.id)||row.key!=='/speeches/'+row.id||!['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].includes(row.kind))continue;
      if(store.db.prepare("SELECT 1 FROM documents WHERE source_id=? AND kind='speech'").get(row.id))continue;
      // INSERT OR IGNORE preserves every pending task's body, attempts and
      // future deadline. Only an already-completed empty job may be reopened.
      const key='speech:'+row.id,body={id:row.id,declaredIndex:true,...(row.parent!=null?{declaredParent:row.parent}:{})};
      const prior=store.task(key),inserted=store.enqueue(key,'speech',body,61);
      if(!inserted)store.reopen(key,body,61);
      const metadata=store.task('speech-metadata-detail:'+row.id);
      if(metadata&&!metadata.done&&metadata.retry_at>worker.clock()&&(inserted||prior?.done===1))
        store.db.prepare('UPDATE tasks SET retry_at=MAX(retry_at,?) WHERE key=?').run(metadata.retry_at,key);
    }
    store.set(marker,{generation,afterKey:rows.at(-1)?.key||saved.afterKey,complete:rows.length<100,completedAt:rows.length<100?worker.clock():null});
  });
  if(rows.length)await worker.checkpoint();
}
