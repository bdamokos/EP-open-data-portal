import {isMainThread} from 'node:worker_threads';
import {createHash} from 'node:crypto';

// Bound SQLite's own memory independently of the size of the retained corpus.
// Negative cache_size is KiB, per connection; attached databases have their own.
export function observeSqlite(db,store,{threshold=250,log=console.warn,now=()=>performance.now(),enabled=isMainThread}={}) {
  db.exec('PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;');
  if(!enabled)return db;
  const timed=(label,fn,rows)=>{
    const start=now();let value;
    try {value=fn();return value;}
    finally {const duration=now()-start;if(duration>=threshold)log('[sqlite-slow]',JSON.stringify({store,statement:label,durationMs:Math.round(duration),...(rows&&value!==undefined?{rows:rows(value)}:{})}));}
  };
  const prepare=db.prepare.bind(db),exec=db.exec.bind(db);
  db.prepare=sql=>{
    const label=sql.trim().replace(/\s+/g,' ').slice(0,100)+' #'+createHash('sha256').update(sql).digest('hex').slice(0,10);
    const statement=timed('prepare '+label,()=>prepare(sql));
    for(const method of ['get','all','run']) {
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>timed(label,()=>execute(...args),method==='all'?r=>r.length:method==='get'?()=>1:r=>Number(r.changes));
    }
    const iterate=statement.iterate.bind(statement);
    statement.iterate=function*(...args){
      const iterator=iterate(...args);let duration=0,rows=0;
      try {for(;;){const start=now();let next;try{next=iterator.next();}finally{duration+=now()-start;}if(next.done)break;rows++;yield next.value;}}
      finally {iterator.return?.();if(duration>=threshold)log('[sqlite-slow]',JSON.stringify({store,statement:label,durationMs:Math.round(duration),rows}));}
    };
    return statement;
  };
  db.exec=sql=>timed(sql.trim().replace(/\s+/g,' ').slice(0,100)+' #'+createHash('sha256').update(sql).digest('hex').slice(0,10),()=>exec(sql));
  return db;
}

export function loopTimer(loop,{threshold=250,now=()=>performance.now(),log=console.warn}={}) {
  const start=now();
  return details=>{const duration=now()-start;if(duration>=threshold)log('[background-slow]',JSON.stringify({loop,durationMs:Math.round(duration),...details}));};
}
