// A finite startup repair for profiles whose saved projection omitted every
// political-group period. Published generations remain immutable.
const repairVersion=1;

export function groupHistoryRepairDue(store) {
  return store.get('groupHistoryRepairVersion')!==repairVersion;
}

export function scheduleGroupHistoryRepair(store,generation) {
  if(!groupHistoryRepairDue(store))return;
  store.transaction(()=>{
    store.assertWriter();
    if(store.get('working')?.generation!==generation)throw Error('Group history repair requires a working generation.');
    const rows=store.db.prepare("SELECT key FROM sources WHERE generation=? AND kind='group-history' AND json_extract(body,'$.coverage')='partial' AND json_array_length(body,'$.mandates')>0 AND json_array_length(body,'$.groups')=0 ORDER BY key").all(generation);
    for(const {key} of rows) {
      const id=key.slice('group-history:'.length);
      if(!/^[1-9]\d{0,8}$/.test(id))continue;
      store.enqueue(generation,'group-history-repair:'+repairVersion+':'+id,'group-history-repair',{id},106.5);
    }
    // This records admission, not successful acquisition. The durable tasks
    // survive restart and prevent publication until completed or gap-recorded.
    store.set('groupHistoryRepairVersion',repairVersion);
  });
}
