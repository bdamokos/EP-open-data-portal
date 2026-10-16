import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {recordingDetail} from './mmc.mjs';
import {playerContent} from './player-content.mjs';
import {documentText} from './document-text.mjs';
import {runWithRequestSignal,cancelledRequest} from './request-budget.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const realRead=fs.readFile;

for(const [index,kind] of ['recording','player','document'].entries())test(`${kind} disk lookup cancellation cannot enter the source failure cache`,async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'media-disk-reader-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+180_000*(index+1)});
  let finish,upstream=0,blocked=false;
  const mock=t.mock.method(fs,'readFile',(file,...args)=>{
    if(String(file).startsWith(directory)){
      const absent=()=>Object.assign(new Error('cache absent'),{code:'ENOENT'});
      if(!blocked){blocked=true;return new Promise((resolve,reject)=>finish=()=>reject(absent()));}
      return Promise.reject(absent());
    }
    return realRead(file,...args);
  });syncBuiltinESMExports();
  t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const id=`2026100${index+1}-DISK-READ`;
  const map=[{lang:'EN',sort:1}];
  const work={identifier:'B-10-2026-9999',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/disk-reader-test.docx'}]}]};
  t.mock.method(globalThis,'fetch',async()=>{
    upstream++;return Response.json({resultJSON:{content:{mediaBusinessId:id,meetingStartDate:'2026-10-01T07:00:00Z',meetingEndDate:'2026-10-01T08:00:00Z',mediaAssets:[{url:'https://webstreaming.europarl.europa.eu/ep/embed/embed.html?event='+id}]}}});
  });
  const read=()=>kind==='recording'?recordingDetail(id,directory):kind==='player'?playerContent(id,directory,{fetchContent:async()=>{upstream++;return {commonId:id,visibility:'PUBLISHED',startDate:'2026-10-01T07:00:00Z',endDate:'2026-10-01T08:00:00Z',languageMapping:map};}}):documentText(work,'en',{directory,download:async()=>{upstream++;return {paragraphs:['Recovered text']};}});
  const a=new AbortController(),reason=cancelledRequest();
  const first=runWithRequestSignal(a.signal,()=>assert.rejects(read(),e=>e===reason));
  await turn();assert(finish);a.abort(reason);finish();await first;assert.equal(upstream,0);
  const result=await read();
  assert.equal(upstream,1,'reader B must reach the source rather than a cached cancellation');
  assert(kind==='document'?result.status==='available':Boolean(result.payload));
  assert.equal(upstream,1);
});
