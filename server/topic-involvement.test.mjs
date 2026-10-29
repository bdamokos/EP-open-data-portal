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
