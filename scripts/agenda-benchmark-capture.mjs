import {writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {API,SCHEMA,hash,sourceUrl,snapshotId,allowedSource,monday} from './agenda-benchmark-model.mjs';
import {userAgent} from '../server/user-agent.mjs';

export async function captureIndexStatus(filename,apiBase,{fetcher=fetch}={}) {
  const base=new URL(apiBase);
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Provide an anonymous HTTPS app origin.');
  const url=new URL('/api/activity-index/status',base).href;
  const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':userAgent('agenda benchmark readiness observation')},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(25_000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('json'))throw Error('Anonymous app readiness unavailable: HTTP '+response.status);
  let bytes=0;const parts=[];
  for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>1024*1024)throw Error('App readiness response exceeds 1 MiB.');parts.push(chunk);}
  const body=Buffer.concat(parts).toString('utf8'),payload=JSON.parse(body);
  if(!payload.currentMeps||!payload.servingGeneration)throw Error('Observed app index is not ready.');
  const record={url,retrievedAt:new Date().toISOString(),sha256:hash(body),body};
  await writeFile(filename,JSON.stringify(record,null,2)+'\n');return record;
}

// Acquisition has a fixed source plan, independent of the measured checkout.
// Only public catalogue pages and the selected week's raw agenda pages are read.
export async function capture(directory,{week='latest',sitting=null,language='en',cap=80,delay=750,fetcher=fetch,wait=sleep,now=()=>Date.now()}={}) {
  if((await readdir(directory)).length)throw Error('Acquisition requires a new, empty snapshot directory.');
  const asOf=new Date(now()).toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date(asOf));
  const sources=[],nodes=[];let last=0,totalBytes=0;
  async function read(endpoint,params) {
    const url=sourceUrl(endpoint,params);
    if(!allowedSource(url)||sources.length>=cap)throw Error('Unsupported source or request cap exhausted.');
    await wait(Math.max(0,last+delay-now()));last=now();
    const started=performance.now(),response=await fetcher(url,{headers:{Accept:'application/ld+json','User-Agent':userAgent('agenda benchmark')},redirect:'error',signal:AbortSignal.timeout(25_000)}),headersMs=performance.now()-started;
    // Never retry before a source's pause, and never persist transient errors.
    if(![200,204,404].includes(response.status)){await response.body?.cancel();throw Error('Acquisition stopped at HTTP '+response.status+'; Retry-After: '+(response.headers.get('retry-after')||'unspecified')+'. Start a new snapshot after the source recovers.');}
    const parts=[];let bytes=0;const bodyStart=performance.now();
    for await(const chunk of response.body||[]){bytes+=chunk.byteLength;totalBytes+=chunk.byteLength;if(bytes>12*1024*1024||totalBytes>64*1024*1024)throw Error('Public input byte budget exceeded.');parts.push(chunk);}
    const body=Buffer.concat(parts),bodyMs=performance.now()-bodyStart;
    const payload=response.status===200?JSON.parse(body):null;
    if(response.status===200&&(!response.headers.get('content-type')?.includes('json')||!Array.isArray(payload?.data)))throw Error('Unreadable public JSON-LD input.');
    const record={url,status:response.status,contentType:response.headers.get('content-type')||'',retrievedAt:new Date(now()).toISOString(),bytes,sha256:hash(body),headersMs,bodyMs};
    sources.push(record);await writeFile(path.join(directory,hash(url)+'.body'),body);
    process.stderr.write(`Captured ${sources.length}/${cap}: ${url.slice(API.length)} (${Math.round(headersMs+bodyMs)} ms)\n`);
    return {record,payload};
  }
  for(let year=2024;year<=Number(day.slice(0,4));year++) {
    let complete=false;
    for(let page=0;page<10;page++) {
      const {record,payload}=await read('/meetings',{year,limit:50,offset:page*50});
      if(record.status===204&&page>0){complete=true;break;}
      if(record.status!==200)throw Error('Catalogue acquisition incomplete.');
      const data=payload.data;
      if(data.some(node=>typeof node?.id!=='string'))throw Error('Malformed catalogue identity.');
      nodes.push(...data);
      if(data.length<50){complete=true;break;}
    }
    if(!complete)throw Error('Catalogue page budget exhausted; no sealed snapshot.');
  }
  const plenary=nodes.filter(node=>String(node.had_activity_type).split('/').at(-1)==='PLENARY_SITTING'&&node.activity_date>='2024-07-16');
  if(plenary.some(node=>node.id?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')!=='eli/dl/event/'+node.activity_id||node.activity_date!==node.activity_id?.slice(7)))throw Error('Conflicting plenary identity in catalogue.');
  const unique=new Map();
  for(const node of plenary){if(unique.has(node.activity_id)&&JSON.stringify(unique.get(node.activity_id))!==JSON.stringify(node))throw Error('Changing catalogue rows.');unique.set(node.activity_id,node);}
  const all=[...unique.values()],latest=all.filter(node=>node.activity_date<=day).sort((a,b)=>b.activity_date.localeCompare(a.activity_date))[0]||all.sort((a,b)=>a.activity_date.localeCompare(b.activity_date))[0];
  const resolvedWeek=week==='latest'&&latest?monday(latest.activity_date):week;
  const selected=all.filter(node=>sitting?node.activity_id===sitting:monday(node.activity_date)===resolvedWeek).sort((a,b)=>a.activity_date.localeCompare(b.activity_date));
  if(!selected.length||selected.length>5)throw Error('Choose a listed sitting or week with one to five sitting days.');
  for(const node of selected)for(let page=0;page<2;page++) {
    const {record,payload}=await read('/meetings/'+node.activity_id+'/foreseen-activities',{limit:50,offset:page*50});
    if(record.status!==200||payload.data.length<50)break;
  }
  const query={lang:language,...(sitting?{sitting}:{week})};
  const snapshot={schemaVersion:SCHEMA,sample:{asOf,query,resolvedWeek:sitting?null:resolvedWeek,sittings:selected.map(node=>node.activity_id)},sources};
  snapshot.snapshotId=snapshotId(snapshot);
  await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');
  return snapshot;
}
