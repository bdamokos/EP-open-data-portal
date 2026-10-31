import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const directory=process.argv[2];
if(!directory)throw Error('Usage: node scripts/error-summary.mjs ERROR_LOG_DIRECTORY');
const groups=new Map();
for(const name of (await readdir(directory)).filter(name=>/^errors\.jsonl(?:\.[1-3])?$/.test(name))) {
  for(const line of (await readFile(path.join(directory,name),'utf8')).split('\n')) {
    if(!line.trim())continue;
    let event;try{event=JSON.parse(line);}catch{continue;} // A concurrently written final line may be incomplete.
    const key=JSON.stringify([event.source,event.kind,event.request?.split('?')[0],event.status,event.code,event.name,event.frames]);
    const group=groups.get(key)||{source:event.source,kind:event.kind,request:event.request?.split('?')[0],status:event.status,code:event.code,name:event.name,frames:event.frames,count:0,first:event.time,last:event.time};
    group.count++;if(event.time<group.first)group.first=event.time;if(event.time>group.last)group.last=event.time;groups.set(key,group);
  }
}
console.log(JSON.stringify([...groups.values()].sort((a,b)=>b.count-a.count),null,2));
