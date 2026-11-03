import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptedPlacementText} from './amendment-placement-check.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
const documentId='RC-10-2026-0346',identifier='TA-10-2026-0200';
const work={id:'eli/dl/doc/'+identifier,identifier,work_type:'def/ep-document-types/TEXT_ADOPTED',document_date:'2026-06-10',adopts:['eli/dl/doc/'+documentId]};
const options={documentId,dates:['2026-06-10'],language:'en'};
test('adopted text binding requires exact relationship, identity, date and uniqueness',()=>{
 assert.match(adoptedPlacementText([work],options),/TA-10-2026-0200_EN.html$/u);
 for(const changed of [{adopts:[]},{document_date:'2026-06-11'},{identifier:'TA-10-2026-0201'},{work_type:'def/ep-document-types/REPORT_PLENARY'}])assert.equal(adoptedPlacementText([{...work,...changed}],options),null);
 assert.equal(adoptedPlacementText([work,work],options),null);
 assert.equal(adoptedPlacementText([work],{...options,dates:[]}),null);
 assert.equal(adoptedPlacementText([work],{...options,dates:['2026-06-10','2026-06-11']}),null);
});
const paragraphs=['The European Parliament,','A. First recital;','B. Second recital;','1. First paragraph;','2. Second paragraph;'];
const text={status:'available',textLanguage:'en',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({path:'p'+i,ordinal:i,container:'body',containerPath:'body',segment:0,complete:true}))};
const chosen={language:'en',targetLabelLanguage:'en',baseline:'motion-resolution',targetLabel:'Recital A a (new)',originalText:'',proposedText:'New recital;'};
test('a vote list cannot relocate the published label, even when its unit is absent',()=>{
 for(const reference of ['After recital B','After recital D']) {
  const placed=documentContextPlacement({chosen,text,referenceTexts:[reference],resolutionDocument:true});
  assert.equal(placed.status,'placed');assert.equal(placed.insertAfter,1);assert.deepEqual(placed.finalPlacementCheck,{adoptedTextUrl:null});
 }
 assert.equal(documentContextPlacement({chosen,text,referenceTexts:['After recital A'],resolutionDocument:true}).finalPlacementCheck,undefined);
 assert.equal(documentContextPlacement({chosen:{...chosen,targetLabel:'Recital A',originalText:'B. Second recital;'},text,referenceTexts:['Recital B'],resolutionDocument:true}).status,'unresolved');
});

test('the production throttle contract pauses yearly reads for three minutes',async t=>{
 const {placementAdoptedListing}=await import('./amendment-placement-check.mjs?throttle-test');
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1_000_000});
 let calls=0;
 const request=async(_endpoint,_params,options)=>{
  assert.equal(options.staleWhileRevalidate,false,'stale refresh throttles must be observed');
  if(++calls===1)throw Object.assign(new Error('rate limited'),{status:503,code:'odp_rate_limited',retryAfter:0});
  return {payload:{data:[]}};
 };
 await assert.rejects(placementAdoptedListing(request,2026),{code:'odp_rate_limited'});
 t.mock.timers.tick(2100);
 assert.equal(await placementAdoptedListing(request,2027),null);assert.equal(calls,1);
 t.mock.timers.tick(177899);
 assert.equal(await placementAdoptedListing(request,2027),null);assert.equal(calls,1);
 t.mock.timers.tick(1);
 assert.deepEqual(await placementAdoptedListing(request,2027),{payload:{data:[]}});assert.equal(calls,2);
});
