import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderRecordKeywords} from './topic-keyword-order.mjs';
const key=id=>'eurovoc:'+id;
const kw=(id,label)=>({key:key(id),label,language:'en'});
test('official whole phrases lead, followed by shared-record count and exact concept ID',()=>{
 const keywords=[kw('400','market'),kw('200','law'),kw('300','trade'),kw('100','Café policy')];
 const concepts=new Map(keywords.map(k=>[k.key,{uri:'http://eurovoc.europa.eu/'+k.key.slice(8),labels:{en:k.label},alternatives:k.key===key('300')?{en:['trade rules']}:{en:[]},microthesauri:[k.key===key('200')?'m2':'m1']}]));
 const result=orderRecordKeywords(keywords,{title:'CAFE POLICY and trade rules for marketplaces',concepts,counts:new Map([[key('100'),9],[key('300'),4],[key('200'),99],[key('400'),99]])});
 assert.deepEqual(result.map(k=>k.key),[key('100'),key('300'),key('200'),key('400')]);assert.deepEqual(result.map(k=>k.featured),[true,true,true,false]);assert.deepEqual(new Set(result.map(k=>k.key)),new Set(keywords.map(k=>k.key)));
});
test('unknown or overlapping microthesauri feature only two and short lists never pad',()=>{
 const keywords=[kw('100','a'),kw('200','b'),kw('300','c')];assert.deepEqual(orderRecordKeywords(keywords,{concepts:new Map(keywords.map(k=>[k.key,{microthesauri:[],alternatives:{en:[]}}]))}).map(k=>k.featured),[true,true,false]);assert.equal(orderRecordKeywords(keywords.slice(0,1)).length,1);assert.deepEqual(orderRecordKeywords([]),[]);
 const concepts=new Map(keywords.map(k=>[k.key,{alternatives:{en:[]},microthesauri:['same']}]));assert.deepEqual(orderRecordKeywords(keywords,{concepts}).map(k=>k.featured),[true,true,false]);
});
