import test from 'node:test';
import assert from 'node:assert/strict';
import {topicAmendments,TOPIC_AMENDMENT_LIMITS} from './topic-involvement.mjs';
const store={get:()=>null,db:{prepare:()=>({get:()=>({generation:1})})}};
const target='A-10-2026-0001',people=[{id:'1'},{id:'2'},{id:'3'}];
const row=(id,extra={})=>({id,targetDocumentId:target,documentDate:'2026-10-07',authors:[{personId:'1',status:'resolved'}],...extra});

test('topic amendments use checked exact attribution, deduplicate observations and retain coverage',()=>{
  const coverage={complete:false,lastUpdated:'2026-10-07T12:00:00Z',gaps:['Partial']},calls=[];
  const result=topicAmendments(store,[target,target,'TA-10-2026-0001'],people,{readPage:(_store,query)=>{
    calls.push(query);return {total:1000,coverage,items:[row('a'),row('a'),row('b',{conflicted:true,variants:[row('b',{authors:[{personId:'2',status:'resolved'}]})]}),row('c',{documentDate:null}),row('d',{authors:[{personId:'3',status:'ambiguous'}]}),row('e',{targetDocumentId:'B-10-2026-0002'})]};
  }});
  assert.deepEqual(result.counts,{'1':1,'2':1,'3':null});
  assert.deepEqual(calls,[{document:target,limit:500,offset:0}]);
  assert.deepEqual(result.documents,[{id:target,total:1000,checked:6,coverage,sources:[]}]);
  assert.equal(result.truncated,false);assert.equal(result.generation,0);
});

test('topic amendment reads are bounded and initialization stays unavailable',()=>{
  let calls=0;
  const ids=Array.from({length:8},(_,i)=>'B-10-2026-'+String(i).padStart(4,'0'));
  const result=topicAmendments(store,ids,people,{readPage:()=>{calls++;throw new Error('Unavailable index row');}});
  assert.equal(calls,TOPIC_AMENDMENT_LIMITS.documents);assert.equal(result.truncated,true);
  assert.deepEqual(result.counts,{'1':null,'2':null,'3':null});assert(result.documents.every(row=>row.coverage===null));
  assert.equal(topicAmendments(store,[],people,{readPage:()=>assert.fail('No targets must not query amendments')}).documents.length,0);
});

test('an unavailable target preserves other exact observations and their attribution sources',()=>{
  const source={url:'https://data.europarl.europa.eu/api/v2/plenary-documents/A-10-2026-0001-AM-001-010',fetchedAt:'2026-10-07T12:00:00Z',language:'en'};
  const result=topicAmendments(store,['B-10-2026-0002',target],people,{readPage:(_store,{document})=>{
    if(document!==target)throw new Error('Unreadable saved target');
    return {total:1,coverage:{complete:false},items:[row('exact-amendment',{proposerSource:source,sources:[source]})]};
  }});
  assert.deepEqual(result.counts,{'1':1,'2':null,'3':null});
  assert.equal(result.documents.length,2);assert.equal(result.documents[0].coverage,null);
  assert.deepEqual(result.documents[1].sources,[source]);
});

test('failed topic counts bypass memory, disk and HTTP caches and recover in the same generation',async t=>{
  const {InsightViewCache}=await import('./insights-view-cache.mjs');
  const {topicAmendmentsCacheable}=await import('./topic-involvement.mjs');
  const {apiCachePolicy}=await import('./response-cache.mjs');
  const {mkdtemp,rm,readdir,readFile}=await import('node:fs/promises');
  const directory=await mkdtemp('/tmp/topic-count-cache-');t.after(()=>rm(directory,{recursive:true,force:true}));
  const cache=new InsightViewCache({directory,cacheable:topicAmendmentsCacheable});
  let failed=true,reads=0;
  const load=()=>{reads++;return {view:'legislation',detail:{amendments:topicAmendments(store,[target],people,{readPage:()=>{
    if(failed)throw new Error('Temporary unavailable target');
    return {items:[row('a')],total:1,coverage:{complete:false}};
  }})}};};
  const key=['legislation','same-generation',target],first=await cache.get(key,load);
  assert.equal(first.detail.amendments.documents[0].status,'unavailable');
  const policy=apiCachePolicy({method:'GET'},new URL('https://example.test/api/insights/legislation'),first);
  assert.equal(policy.cacheControl,'no-store');assert.equal(policy.cdnCacheControl,'no-store');
  assert.equal(cache.cache.size,0);assert.deepEqual(await readdir(directory),[]);
  failed=false;
  const recovered=await cache.get(key,load);
  assert.equal(recovered.detail.amendments.generation,first.detail.amendments.generation);
  assert.equal(recovered.detail.amendments.counts['1'],1);assert.equal(reads,2);
  const persisted=JSON.parse(await readFile(directory+'/'+cache.key(key)+'.json','utf8'));
  assert.equal(persisted.value.detail.amendments.counts['1'],1);
  await cache.get(key,()=>assert.fail('Available counts retain normal memory caching'));
  const restarted=new InsightViewCache({directory,cacheable:topicAmendmentsCacheable});
  await restarted.get(key,()=>assert.fail('Available counts retain normal disk caching'));
});

for(const layer of ['memory','disk'])test('previous unavailable topic counts in '+layer+' do not mask a recovered read',async t=>{
  const {InsightViewCache}=await import('./insights-view-cache.mjs');
  const {topicAmendmentsCacheable}=await import('./topic-involvement.mjs');
  const {mkdtemp,rm,writeFile}=await import('node:fs/promises');
  const directory=await mkdtemp('/tmp/topic-count-retained-');t.after(()=>rm(directory,{recursive:true,force:true}));
  const cache=new InsightViewCache({directory,cacheable:topicAmendmentsCacheable}),key=['legislation',target],hash=cache.key(key);
  // A retained pre-fix response has no explicit unavailable status.
  const legacy={view:'legislation',detail:{amendments:{counts:{'1':null},generation:0,documents:[{id:target,coverage:null}]}}};
  const record={key:hash,at:Date.now(),value:legacy};
  if(layer==='memory')cache.remember(hash,record);
  else await writeFile(directory+'/'+hash+'.json',JSON.stringify(record));
  let reads=0;const recovered={view:'legislation',detail:{amendments:{counts:{'1':1},generation:0,documents:[{id:target,coverage:{complete:false}}]}}};
  const result=await cache.get(key,()=>{reads++;return recovered;});
  assert.equal(reads,1);assert.equal(result.detail.amendments.counts['1'],1);
});
