// node:sqlite keeps the values of every JS SQL function call alive until the
// statement finishes. Fast-read triggers parse each copied body in JS, so one
// INSERT ... SELECT over a whole generation holds every parsed body at once and
// can exhaust the worker heap. Copy such tables in key ranges instead; callers
// stay inside their transaction, so the copy remains atomic.
export const GENERATION_COPY_BATCH=500;

export function copyGenerationRows(db,{table,key,select},generation,source,batch=GENERATION_COPY_BATCH) {
  const boundary=db.prepare(`SELECT ${key} AS value FROM ${table} WHERE generation=? AND ${key}>? ORDER BY ${key} LIMIT 1 OFFSET ${batch-1}`);
  const first=db.prepare(`SELECT ${key} AS value FROM ${table} WHERE generation=? ORDER BY ${key} LIMIT 1 OFFSET ${batch-1}`);
  const range=db.prepare(`${select} WHERE generation=? AND ${key}>? AND ${key}<=?`);
  const head=db.prepare(`${select} WHERE generation=? AND ${key}<=?`);
  const rest=db.prepare(`${select} WHERE generation=? AND ${key}>?`);
  let after=first.get(source)?.value;
  if(after===undefined){db.prepare(`${select} WHERE generation=?`).run(generation,source);return;}
  head.run(generation,source,after);
  for(let next=boundary.get(source,after)?.value;next!==undefined;next=boundary.get(source,after)?.value){range.run(generation,source,after,next);after=next;}
  rest.run(generation,source,after);
}
