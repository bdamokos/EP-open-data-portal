// node:sqlite keeps the values of every JS SQL function call alive until the
// statement finishes. Fast-read triggers parse each copied body in JS, so one
// INSERT ... SELECT over a whole generation holds every parsed body at once and
// can exhaust the worker heap. Copy such tables in key ranges instead; callers
// stay inside their transaction, so the copy remains atomic.
export const GENERATION_COPY_BATCH=500;

export function copyGenerationRows(db,{table,key,select},generation,source,batch=GENERATION_COPY_BATCH) {
  const boundary=db.prepare(`SELECT ${key} AS value FROM ${table} WHERE generation=? AND ${key}>? ORDER BY ${key} LIMIT ${batch}`);
  const first=db.prepare(`SELECT ${key} AS value FROM ${table} WHERE generation=? ORDER BY ${key} LIMIT ${batch}`);
  const range=db.prepare(`${select} WHERE generation=? AND ${key}>? AND ${key}<=?`);
  const head=db.prepare(`${select} WHERE generation=? AND ${key}<=?`);
  const rest=db.prepare(`${select} WHERE generation=? AND ${key}>?`);
  let after=first.all(source).at(-1)?.value;
  if(after===undefined){db.prepare(`${select} WHERE generation=?`).run(generation,source);return;}
  head.run(generation,source,after);
  for(let next=boundary.all(source,after).at(-1)?.value;next!==undefined;next=boundary.all(source,after).at(-1)?.value){range.run(generation,source,after,next);after=next;}
  rest.run(generation,source,after);
}

// Read only keys into JS. Finish the boundary SELECT before running a statement
// that invokes JS functions; never retain a body-bearing iterator across writes.
export function updateGenerationRows(db,{table,key,where='1',indexedBy='',set},generation,batch=GENERATION_COPY_BATCH) {
  const from=`${table}${indexedBy?' INDEXED BY '+indexedBy:''}`;
  const head=db.prepare(`SELECT ${key} value FROM ${from} WHERE generation=? AND ${where} ORDER BY ${key} LIMIT ?`);
  const next=db.prepare(`SELECT ${key} value FROM ${from} WHERE generation=? AND ${where} AND ${key}>? ORDER BY ${key} LIMIT ?`);
  const update=db.prepare(`UPDATE ${from} SET ${set} WHERE generation=? AND ${where} AND ${key}>=? AND ${key}<=?`);
  let keys=head.all(generation,batch),changes=0,lastInsertRowid=0;
  while(keys.length) {
    const end=keys.at(-1).value,result=update.run(generation,keys[0].value,end);
    changes+=Number(result.changes);lastInsertRowid=result.lastInsertRowid;
    keys=next.all(generation,end,batch);
  }
  return {changes,lastInsertRowid};
}

const projections={
  sources:['sources',['source_reads','question_reads','question_frontiers','procedure_event_reads']],
  outside_contributions:['outside',['outside_directory_reads']],
  amendment_targets:['targets',['amendment_target_reads']],
};
export function copyProjectedGenerationRows(db,spec,generation,source) {
  const [projection,tables]=projections[spec.table];
  // Existing destination rows (extension replay) and incomplete backfills must
  // retain ordinary trigger semantics. The caller owns the single transaction.
  if(!db.isTransaction)throw new Error('Generation copy requires a transaction.');
  if(!db.prepare('SELECT ready FROM fast_read_progress WHERE projection=? AND generation=?').get(projection,source)?.ready ||
      db.prepare(`SELECT 1 FROM ${spec.table} WHERE generation=? LIMIT 1`).get(generation)) {
    return copyGenerationRows(db,spec,generation,source);
  }
  db.prepare("INSERT INTO meta(key,value) VALUES ('fastReadCopyGeneration',?)").run(String(generation));
  try {
    db.prepare(`${spec.select} WHERE generation=?`).run(generation,source);
    for(const table of tables) {
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name).filter(name=>name!=='generation');
      db.prepare(`INSERT INTO ${table}(generation,${columns.join(',')}) SELECT ?,${columns.join(',')} FROM ${table} WHERE generation=?`).run(generation,source);
    }
    db.prepare('INSERT OR REPLACE INTO fast_read_progress(projection,generation,cursor,ready) SELECT projection,?,cursor,ready FROM fast_read_progress WHERE projection=? AND generation=?').run(generation,projection,source);
  } finally {
    db.prepare("DELETE FROM meta WHERE key='fastReadCopyGeneration'").run();
  }
}
