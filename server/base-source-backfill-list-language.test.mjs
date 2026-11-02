import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import {readFileSync} from 'node:fs';
import {distributionEvidenceFor} from './amendments.mjs';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {BaseSourceStore} from './base-source-store.mjs';
import {BaseSourceBackfill} from './base-source-backfill.mjs';
import {runBaseBackfill} from './base-source-backfill-context.mjs';
import {amendmentSourceStore} from './amendment-source-store.mjs';
import {word,p} from './test-support/nle-native-fixture.mjs';
const at='2026-10-30T12:00:00.000Z';
const cases=JSON.parse(readFileSync(new URL('./fixtures/base-source-language-gaps.json',import.meta.url),'utf8')).cases;
async function fixture(t,{target='B-10-2026-0999',listId=target+'-AM-001-001',baseLanguages=['fr'],wordingLanguages=['en'],listLanguages=['en','fr'],listUrl}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'list-language-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new ActivityStore(path.join(root,'index'));store.acquire();store.set('active',1);t.after(()=>store.close());
 const directory=path.join(root,'cache');await mkdir(directory);const retention=new BaseSourceStore(path.join(directory,'base-sources-v1'));
 const buffer=word(p('Amendment source fixture'));
 const declarations=(id,languages)=>languages.map(language=>({id:'eli/dl/doc/'+id+'/'+language,language,is_embodied_by:[{id:'eli/dl/doc/'+id+'/'+language+'/docx',format:'DOCX',is_exemplified_by:id===listId&&language===listLanguages.find(l=>baseLanguages.includes(l))&&listUrl?listUrl:'https://data.europarl.europa.eu/distribution/fixture/'+id+'_'+language+'.docx',byteSize:buffer.length,issued:at}]}));
 const list={id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:target,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+target],is_realized_by:declarations(listId,listLanguages),extraction:{language:wordingLanguages[0],amendments:wordingLanguages.map(language=>({language,number:1,originalText:'Original',proposedText:'Amendment'}))}};
 list.distributionEvidence=distributionEvidenceFor(list,{url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt:at,language:null});
 store.db.prepare("INSERT INTO sources(generation,key,kind,body) VALUES (1,?,'amendment-list',?)").run('amendment:list:'+listId,JSON.stringify(list));
 const base={id:'eli/dl/doc/'+target,is_realized_by:declarations(target,baseLanguages)};
 const downloads=[],metadata=[];
 const worker=new BaseSourceBackfill(store,{directory,retention,log:()=>{},read:async(endpoint,params,options)=>{metadata.push(endpoint);assert.equal(options.priority,'background');const data=endpoint==='/plenary-documents/'+target?base:endpoint==='/documents/'+listId?list:assert.fail('unexpected metadata');return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[data]}};},downloadNative:async(url,options)=>{downloads.push(url);assert.equal(options.priority,'background');assert.equal(options.expectedByteSize,buffer.length);return {buffer,fetchedAt:at,resolvedSourceUrl:url};}});
 worker.hits=0;const context={held:q=>worker.held(q),full:false};
 return {store,worker,retention,context,downloads,metadata,buffer,list,base,target,listId,job:{kind:'amendment-list',target,listId}};
}
test('general language rule selects exactly one shared declaration and preserves per-list wording scope',async t=>{
 for(const [options,expected] of [
  [{baseLanguages:['fr'],wordingLanguages:['en'],listLanguages:['en','fr']},'fr'],
  [{baseLanguages:['fr','de'],wordingLanguages:['en'],listLanguages:['en','de']},'de'],
  [{baseLanguages:['fr','de'],wordingLanguages:['en'],listLanguages:['fr','de']},'fr'],
  [{baseLanguages:['fr'],wordingLanguages:['fr'],listLanguages:['en','fr']},null],
  [{baseLanguages:['fr','en'],wordingLanguages:['en'],listLanguages:['en','fr']},null],
  [{baseLanguages:['fr'],wordingLanguages:['en'],listLanguages:['en']},'unresolved'],
 ])await t.test(JSON.stringify(options),async t=>{
  const f=await fixture(t,options),result=await runBaseBackfill(f.context,()=>f.worker.collect(f.job));
  if(expected==='unresolved'){assert.deepEqual(result.gaps,['shared-list-language-unavailable']);assert.equal(f.downloads.length,0);return;}
  assert.equal(result.status,'available');
  if(expected===null){assert.equal(f.downloads.length,0);return;}
  assert.equal(f.downloads.length,1);assert(f.downloads[0].endsWith('_'+expected+'.docx'));
  const row=f.store.db.prepare('SELECT * FROM amendment_sources').get();assert.equal(row.language,expected);assert.equal(row.list_id,f.listId);assert.equal(row.retrieved_at,at);assert.equal(amendmentSourceStore(f.store).referenced(row),true);
  assert.deepEqual((await amendmentSourceStore(f.store).read({url:row.url,language:expected,byteSize:f.buffer.length,issued:at})).buffer,f.buffer);
  f.worker.downloadNative=()=>assert.fail('held list fetched');
  await runBaseBackfill(f.context,()=>f.worker.collect(f.job));assert.equal(f.downloads.length,1);
 });
});
for(const entry of cases)test(`${entry.listId}: adopts the scoped ${entry.language} list URL through the amendment-source owner`,async t=>{
 assert.equal(entry.listObservation.state,'absent');assert.equal(entry.baseObservation.hashVerified,true);
 const f=await fixture(t,{...entry,baseLanguages:[entry.language],wordingLanguages:['en'],listLanguages:['en',entry.language],listUrl:entry.listObservation.url});
 // This is a supplied URL fixture and generated DOCX, never an upstream read.
 if(entry.target.startsWith('A-'))await f.retention.save({url:entry.listObservation.url,status:200,fetchedAt:at,request:{accept:'*/*',language:entry.language},descriptor:{url:entry.listObservation.url,language:entry.language,byteSize:f.buffer.length,issued:at,format:'DOCX'}},f.buffer);
 if(entry.target.startsWith('A-'))f.worker.downloadNative=()=>assert.fail('manifest-held concrete URL fetched');
 f.store.set('baseBackfillSeeded',true);f.store.set('baseBackfillNativeInputsVersion',1);
 assert.equal(f.worker.due(),true);assert.equal(await f.worker.step(),true);
 const row=f.store.db.prepare('SELECT * FROM amendment_sources').get();assert.equal(row.url,entry.listObservation.url);assert.equal(row.language,entry.language);assert.equal(row.list_id,entry.listId);assert.deepEqual(f.downloads,entry.target.startsWith('A-')?[]:[entry.listObservation.url]);
 assert.equal(f.worker.due(),false);assert.equal(f.worker.status().amendmentSources.files,1);assert.equal(f.worker.status().amendmentSources.bytes,f.buffer.length);
});
test('full amendment storage stops the backfill without completing the list job',async t=>{
 const f=await fixture(t);amendmentSourceStore(f.store).maxBytes=1;
 f.store.set('baseBackfillSeeded',true);f.store.set('baseBackfillNativeInputsVersion',1);
 assert.equal(await f.worker.step(),false);assert.equal(f.store.get('baseBackfillStop'),'storage-full');
 assert.equal(f.store.db.prepare('SELECT state FROM base_backfill_jobs').get().state,'pending');
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM amendment_sources').get().n,0);
});

test('only wording variants for the exact list suppress acquisition of its shared base language',async t=>{
 for(const own of [false,true])await t.test(String(own),async t=>{
  const f=await fixture(t);
  f.store.db.prepare('INSERT INTO amendments(generation,id,target,body) VALUES (1,?,?,?)').run(f.target+'-AM-1',f.target,JSON.stringify({number:1,listId:'another-list',language:'en',originalText:'Old',variants:[{listId:own?f.listId:'unrelated-list',language:'fr',originalText:'Texte'}]}));
  assert.equal((await runBaseBackfill(f.context,()=>f.worker.collect(f.job))).status,'available');
  assert.equal(f.downloads.length,own?0:1);
 });
});

test('empty extracted columns do not count as held wording in the base language',async t=>{
 const f=await fixture(t,{wordingLanguages:['fr']});
 f.list.extraction.amendments=[{language:'fr',number:1,originalText:'',proposedText:' '}];
 f.store.db.prepare('UPDATE sources SET body=? WHERE key=?').run(JSON.stringify(f.list),'amendment:list:'+f.listId);
 await runBaseBackfill(f.context,()=>f.worker.collect(f.job));assert.equal(f.downloads.length,1);
});
