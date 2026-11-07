import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {AMENDMENT_LINKS_VERSION} from './activity-index-model.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENT_DISTRIBUTION_PROOF_VERSION} from './amendments.mjs';
import {saveAmendmentRows} from './amendments-store.mjs';
import {amendmentNeighbours,amendmentNeighboursQuery,amendmentSplitFields} from './amendment-neighbours.mjs';

const target='A-10-2026-0257',date='2026-10-14',at='2026-10-18T12:00:00.000Z',first=target+'-AM-001-003',second=target+'-AM-004-005';
const source={url:'https://data.europarl.europa.eu/distribution/example/list_en.docx',fetchedAt:at,language:'en'};
const amendment=(number,listId,extra={})=>({id:target+'-AM-'+number,targetDocumentId:target,number,date,documentDate:date,proposerDate:date,proposerDateBasis:'individual-amendment-document',...(listId?{listId}:{}),language:'en',originalText:'Original.',proposedText:'Proposed.',textIntegrity:'complete',textParserVersion:AMENDMENT_EXTRACTION_VERSION,sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'fresh',distributionState:'available'},wordingSource:source,metadataSource:source,proposerSource:source,authors:[],decisions:[],splitParts:[],sources:[source],gaps:[],...extra});
function setup(t,rows) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-neighbours-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  saveAmendmentRows(store,generation,{id:target,date,listProjectionVersion:AMENDMENT_LINKS_VERSION},rows,{complete:true,gaps:[],lastUpdated:at});
  return {store,generation};
}
const read=(store,value)=>amendmentNeighbours(store,amendmentNeighboursQuery(new URLSearchParams(value)));
const neighbours=result=>[result.previous?.id??null,result.next?.id??null];

test('neighbours stay inside the exact list, in number order',t=>{
  const {store}=setup(t,[amendment(3,first),amendment(1,first),amendment(2,first),amendment(4,second),amendment(5,second)]);
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-2')),[target+'-AM-1',target+'-AM-3']);
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-1')),[null,target+'-AM-2'],'the first has no previous');
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-3')),[target+'-AM-2',null],'the list ends at its own last number');
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-4')),[null,target+'-AM-5'],'the next list starts afresh');
  assert.equal(read(store,'amendment='+target+'-AM-2').listId,first);
});

test('a number in range that names no list is passed over',t=>{
  const {store}=setup(t,[amendment(1,first),amendment(2,null,{originalText:null,proposedText:null,textIntegrity:'unavailable'}),amendment(3,first)]);
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-1')),[null,target+'-AM-3']);
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-3')),[target+'-AM-1',null]);
  assert.deepEqual(neighbours(read(store,'amendment='+target+'-AM-2')),[null,null],'an amendment without a list has no neighbours');
});

test('a list the amendment does not belong to has no neighbours, and the row still answers',t=>{
  const {store}=setup(t,[amendment(1,first),amendment(2,first)]);
  const result=read(store,'amendment='+target+'-AM-1&list='+second);
  assert.deepEqual(neighbours(result),[null,null]);assert.equal(result.listId,second);
});

test('the line reads who tabled it and a known outcome, and nothing of a list',t=>{
  const {store}=setup(t,[amendment(1,first,{authors:[{name:'A proposer',personId:'101',status:'resolved',method:'exact_full_name_active_mandate'}],onBehalfOf:'Group',outcome:'ADOPTED'}),amendment(2,first,{committeeProposer:'Committee on Culture and Education'})]);
  const one=read(store,'amendment='+target+'-AM-1');
  assert.equal(one.authors[0].name,'A proposer');assert.equal(one.onBehalfOf,'Group');
  assert.equal(read(store,'amendment='+target+'-AM-2').committeeProposer,'Committee on Culture and Education');
  assert.equal(read(store,'amendment='+target+'-AM-2').outcome,null,'unknown stays unknown');
  for(const key of ['originalText','proposedText','items','total'])assert.equal(Object.hasOwn(one,key),false,key);
});

test('a split amendment reads its parts and each part\'s decision, by part number or exact part ID',()=>{
  const reply=amendmentSplitFields({splitParts:[{id:'p/1',number:1,description:'Text as a whole without the words: ‘x’',language:'en'},{id:'p/2',number:2,sourceDescriptions:{en:'<partValue>those words</partValue>',fr:'<partValue>ces termes</partValue>'},description:'those words',language:'en'},{id:'p/3',number:3,description:null}],decisions:[
    {id:'DEC-1',partId:'p/1',outcome:'ADOPTED',method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null},date,source},
    {id:'DEC-2',partNumber:2,outcome:'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:1,against:2,abstaining:3}},
  ]});
  assert.deepEqual(reply.splitParts,[{number:1,descriptions:{en:'Text as a whole without the words: ‘x’'}},{number:2,descriptions:{en:'those words',fr:'ces termes'}},{number:3,descriptions:{}}]);
  assert.deepEqual(reply.decisions,[
    {id:'DEC-1',partNumber:1,outcome:'ADOPTED',method:'VOTE_HAND',ballotStatus:null,totals:{for:null,against:null,abstaining:null}},
    {id:'DEC-2',partNumber:2,outcome:'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:null,totals:{for:1,against:2,abstaining:3}},
  ]);
  assert.deepEqual(amendmentSplitFields({}),{splitParts:[],decisions:[]});
  const xml=amendmentSplitFields({splitParts:[{id:'p/1',number:1,sourceDescriptions:{fr:'<partValue>Texte &#171;politique&#187;</partValue>',de:'<partValue><broken>',el:' '}}]});
  assert.deepEqual(xml.splitParts,[{number:1,descriptions:{fr:'Texte «politique»'}}],'source XML is decoded; unreadable values are left out');
});
test('every reply carries the version and split fields, empty when not voted in parts',t=>{
  const {store}=setup(t,[amendment(1,first)]);
  const reply=read(store,'amendment='+target+'-AM-1');
  assert.equal(reply.version,2);assert.deepEqual(reply.splitParts,[]);assert.deepEqual(reply.decisions,[]);
});
test('a missing amendment is a 404 and malformed input a 400',t=>{
  const {store}=setup(t,[amendment(1,first)]);
  assert.throws(()=>read(store,'amendment='+target+'-AM-9'),error=>error.status===404);
  for(const value of ['','amendment=nonsense','amendment='+target+'-AM-1&list=A-10-2026-0001-AM-001-003','amendment='+target+'-AM-1&list=x','amendment=committee:CULT-AM-789899:1&list=CULT-AM-1234','amendment='+target+'-AM-1&other=1'])assert.throws(()=>amendmentNeighboursQuery(new URLSearchParams(value)),error=>error.status===400,value);
});
