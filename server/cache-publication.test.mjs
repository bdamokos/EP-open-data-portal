import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeCacheFile} from './cache-publication.mjs';
import {documentText} from './document-text.mjs';
import {playerContent} from './player-content.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {upstreamStatus} from './odp.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const [index,kind] of ['document','player','view'].entries())for(const [stageIndex,stage] of ['mkdir','writeFile'].entries())test(`${kind} cannot publish expired data after a newer result during ${stage}`,async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cache-publication-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+5_000_000*(index*2+stageIndex+1)});
  const real=fs[stage],realUnlink=fs.unlink;let finish,reached,cleanedUp,blocked=false,resumed=false,calls=0;
  const started=new Promise(resolve=>reached=resolve),cleaned=new Promise(resolve=>cleanedUp=resolve);
  const mock=t.mock.method(fs,stage,(file,...args)=>{
    if(String(file).startsWith(directory)&&!blocked){blocked=true;return new Promise((resolve,reject)=>{finish=()=>real(file,...args).then(resolve,reject);reached();});}
    return real(file,...args);
  });
  const unlinkMock=t.mock.method(fs,'unlink',async file=>{try{return await realUnlink(file);}finally{if(resumed&&String(file).startsWith(directory)&&String(file).endsWith('.tmp'))cleanedUp();}});
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();unlinkMock.mock.restore();syncBuiltinESMExports();});
  const url=`https://data.europarl.europa.eu/distribution/persistence-${stage}.docx`,id='20261007-PERSISTENCE-'+stage.toUpperCase();
  const work={identifier:'B-10-2026-9999',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
  const view=new InsightViewCache({directory}),key=view.key(['publication',stage]);
  const read=()=>kind==='document'?documentText(work,'en',{directory,download:async()=>({paragraphs:[++calls===1?'expired old text':'replacement text']})}):kind==='player'?playerContent(id,directory,{fetchContent:async()=>({commonId:id,visibility:'PUBLISHED',startDate:'2026-10-07T07:00:00Z',endDate:'2026-10-07T08:00:00Z',languageMapping:[{lang:++calls===1?'EN':'FR',sort:1}]})}):view.refresh(key,async()=>({items:[++calls===1?'expired old view':'replacement view']}));
  const first=read().then(value=>({value}),error=>({error}));
  await started;t.mock.timers.tick(50_000);const expired=await first;
  assert(kind==='document'?expired.value.status==='error':expired.error.code==='request_timeout');
  await turn();assert.equal(upstreamStatus().active,0,'expired persistence must release its admitted source slot');
  t.mock.timers.tick(3_600_001);
  const replacement=await read();assert.equal(calls,2);
  resumed=true;finish();await cleaned;
  const file=kind==='document'?path.join(directory,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json'):kind==='player'?path.join(directory,'content',id+'.json'):path.join(directory,key+'.json');
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  if(kind==='document'){
    assert.deepEqual(replacement.paragraphs,['replacement text']);assert.deepEqual(saved.paragraphs,replacement.paragraphs);
    assert.deepEqual((await documentText(work,'en',{directory})).paragraphs,replacement.paragraphs);
  }else if(kind==='player'){
    assert.equal(replacement.payload.languageMapping[0].lang,'FR');assert.deepEqual(saved.payload,replacement.payload);
    assert.deepEqual((await playerContent(id,directory)).payload,replacement.payload);
  }else {
    assert.deepEqual(replacement.value.items,['replacement view']);assert.deepEqual(saved.value,replacement.value);
    assert.deepEqual((await new InsightViewCache({directory}).get(['publication',stage],()=>assert.fail('saved replacement'))).items,['replacement view']);
  }
  assert(!(await fs.readdir(path.dirname(file))).some(name=>name.endsWith('.tmp')));
});

test('an admitted slow rename cannot finish after and overwrite a newer publication',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cache-rename-order-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'record.json'),controller=new AbortController(),reason=new Error('owner expired');
  let finish,reachedRename,reachedPreparation,renames=0;
  const started=new Promise(resolve=>reachedRename=resolve),prepared=new Promise(resolve=>reachedPreparation=resolve);
  const realRename=fs.rename,realWrite=fs.writeFile;
  const renameMock=t.mock.method(fs,'rename',(from,to)=>{
    if(to===file&&++renames===1)return new Promise((resolve,reject)=>{finish=()=>realRename(from,to).then(resolve,reject);reachedRename();});
    return realRename(from,to);
  });
  const writeMock=t.mock.method(fs,'writeFile',async(...args)=>{await realWrite(...args);if(args[1]==='replacement')reachedPreparation();});
  syncBuiltinESMExports();t.after(()=>{renameMock.mock.restore();writeMock.mock.restore();syncBuiltinESMExports();});
  const first=assert.rejects(writeCacheFile(file,'expired',{signal:controller.signal}),error=>error===reason);
  await started;controller.abort(reason);
  const second=writeCacheFile(file,'replacement');await prepared;await turn();assert.equal(renames,1);
  finish();await first;await second;
  assert.equal(await fs.readFile(file,'utf8'),'replacement');assert.equal(renames,2);
  assert.deepEqual(await fs.readdir(directory),['record.json']);
});
