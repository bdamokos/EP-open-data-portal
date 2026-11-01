// Readers already key caches from committed SQLite revisions. Forward small
// revision notices too, so serving-side hooks never depend on shared JS state.
export function observePublications(store,source,send) {
  const keys=['active','availabilityRevision','availabilityCoverageRevision','demographicRevision','marksEpoch','markBaseline','lastSuccess','amendmentMutationRevision','amendmentReadVersion','speechReadRevision','backfilledAt'];
  let previous,scheduled=false,closed=false;
  const publish=()=>{
    scheduled=false;if(closed)return;
    const rows=store.db.prepare('SELECT key,value FROM meta WHERE key IN ('+keys.map(()=>'?').join(',')+')').all(...keys);
    const revision=Object.fromEntries(rows.map(row=>[row.key,JSON.parse(row.value)]));
    const serialized=JSON.stringify(revision);if(serialized===previous)return;
    previous=serialized;send({type:'publication',source,revision});
  };
  const notify=()=>{if(!scheduled&&!closed){scheduled=true;setImmediate(publish);}};
  store.onCommit=notify;notify();
  return ()=>{closed=true;store.onCommit=undefined;};
}
