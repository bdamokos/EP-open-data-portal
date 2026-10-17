import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusSearchResponse} from './corpus-search-response.mjs';

const bytes=value=>Buffer.byteLength(JSON.stringify(value))+1;
const result=(count,offset=0,total=count)=>({total,limit:50,offset,nextOffset:null,truncated:false,
  coverage:{complete:false,note:'Retained texts only.'},results:Array.from({length:count},(_,n)=>({sourceId:'Q-'+(offset+n),
    hits:[{sourceId:'Q-'+(offset+n),sourceKey:'en',language:'en',snippet:'Ocean '+('漢😀"\\'.repeat(1000)),people:[{id:43,name:'Saved author'}]}]}))});

test('response budget keeps complete groups and continues without losing variants or legacy hits',()=>{
  const input=result(5),first=corpusSearchResponse(input,64*1024);
  assert(bytes(first)<=64*1024);assert(first.results.length>0&&first.results.length<5);
  assert.equal(first.responseLimited,true);assert.equal(first.nextOffset,first.results.length);
  assert.equal(first.total,5);assert.equal(first.limit,50);assert.equal(first.coverage,input.coverage);
  assert.deepEqual(first.hits,first.results.flatMap(group=>group.hits));
  const seen=[...first.results];let offset=first.nextOffset,last;
  while(offset!==null){last=corpusSearchResponse({...input,offset,results:input.results.slice(offset)},64*1024);seen.push(...last.results);offset=last.nextOffset;}
  assert.deepEqual(seen,input.results);assert.equal(last.responseLimited,false);
});

test('byte boundary includes escaped UTF-8 JSON and newline; an indivisible oversized group is explicit',()=>{
  const input=result(1),full=corpusSearchResponse(input,Infinity),size=bytes(full);
  assert.equal(bytes(corpusSearchResponse(input,size)),size);
  assert.throws(()=>corpusSearchResponse(input,size-1),error=>error.status===413&&error.code==='corpus_search_result_too_large');
});

test('byte-limited continuation retains the existing maximum offset and coverage truncation',()=>{
  const input=result(5,999,1010),page=corpusSearchResponse(input,64*1024);
  assert.equal(page.nextOffset,null);assert.equal(page.truncated,true);
  assert.equal(page.responseLimited,true);assert.equal(page.coverage.complete,false);
});
