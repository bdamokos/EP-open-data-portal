import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {readMemberVotesJourney} from './memberVotesJourney.mjs';

const sitting='MTG-PL-2026-10-08',decision=sitting+'-DEC-198251';
function response({member='197494',id=decision,method='VOTE_ELECTRONIC_ROLLCALL',position={status:'recorded',position:'for'},outcome='ADOPTED',ballotStatus='conducted'}={}) {
  const vote={id,sittingId:sitting,date:'2026-10-08',title:'Exact decision',titleLanguage:'en',titles:{en:'Exact decision'},referenceTexts:{en:'Motion for a resolution'},
    method,outcome,ballotStatus,scope:{kind:'whole-text'},actualPosition:position,intention:{status:'reported',positions:['against']},
    totals:{for:445,against:37,abstaining:97},alignment:'with',subjectId:null,context:{documentIds:['RC-10-2026-0443'],amendmentIds:[],componentIds:[],partialReferenceIds:[]},
    parts:[],rollCallRequesters:[],resultRelationship:{binding:'consistent'}};
  return {version:10,member:{id:member},period:{kind:'sitting',week:null,sittingId:sitting,from:'2026-10-08',to:'2026-10-08'},snapshotId:'a'.repeat(64),positions:'all',alignment:'all',alignmentCounts:{with:1,against:0,abstained:0,unclassified:0},items:[],subjects:[],
    pagination:{offset:0,limit:50,returned:0,observedTotal:1,recordedTotal:1,filteredTotal:1,nextOffset:0},selected:{status:'found',item:vote},coverage:{status:'partial',termWide:false}};
}
function exactResponse(patch) {
  const value=response(patch);value.items=[value.selected.item];value.pagination={offset:0,limit:50,returned:1,observedTotal:1,recordedTotal:1,filteredTotal:1,nextOffset:null};return value;
}
async function mount(t,handler) {
  const window=new Window({url:'http://localhost/?member=197494&module=activities&activity=motions%3AB-10-2026-0448&ma-amendment=RC-10-2026-0443-AM-31&mv-offset=50&mv-snapshot='+('b'.repeat(64))});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(String(url));return handler(url,options);});
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ActivityVote}=await load('/src/ActivityVote.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const render=patch=>act(async()=>root.render(createElement(ActivityVote,{memberId:197494,memberName:'Selected member',language:'en',decisionId:decision,...patch},createElement('p',null,'Indexed result · Adopted · Show of hands'))));
  return {window,container,calls,render,load,root};
}
test('activity reuses exact vote data and links without carrying filters, snapshots or context',async t=>{
  const h=await mount(t,async()=>Response.json(exactResponse()));await h.render();
  assert.match(h.container.textContent,/Selected member\s+For/);assert.match(h.container.textContent,/Declared intention: Against/);assert.match(h.container.textContent,/445/);assert.doesNotMatch(h.container.textContent,/Indexed result/);
  const request=new URL(h.calls[0],'http://localhost');assert.equal(request.searchParams.get('sitting'),sitting);assert.equal(request.searchParams.get('decision'),decision);assert.equal(request.searchParams.get('positions'),'all');
  const link=new URL(h.container.querySelector('a').href),journey=readMemberVotesJourney(link.searchParams,197494);
  assert.equal(journey.invalid,false);assert.equal(journey.state.decisionId,decision);assert.equal(journey.state.sittingId,sitting);assert.equal(journey.state.positions,'all');assert.equal(journey.state.snapshotId,null);assert.equal(journey.state.offset,0);assert.equal(journey.state.context,null);assert.equal(link.searchParams.get('activity'),'motions:B-10-2026-0448');
});
test('show of hands preserves the known result and explains why individual positions are not recorded',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({method:'VOTE_HAND',position:{status:'not-individually-recorded',position:null}});value.selected.item.totals={for:null,against:null,abstaining:null};return Response.json(value);});await h.render();
  assert.match(h.container.textContent,/Show of hands/);assert.match(h.container.textContent,/Adopted/);assert.match(h.container.textContent,/Not individually recorded/);assert.doesNotMatch(h.container.textContent,/Position unavailable|Tallies unavailable|details.*unavailable/);
});
test('wrong identities and failed reads retain indexed facts, expose retry and never invent a position',async t=>{
  let wrong=true;const h=await mount(t,async()=>Response.json(exactResponse({member:wrong?'99':'197494'})));await h.render();
  assert.match(h.container.textContent,/Indexed result · Adopted · Show of hands/);assert.doesNotMatch(h.container.textContent,/Selected member\s+For/);
  wrong=false;await act(async()=>h.container.querySelector('button').click());assert.match(h.container.textContent,/Selected member\s+For/);
  await h.render({memberId:99});assert.doesNotMatch(h.container.textContent,/Selected member\s+For/);
});
test('invalid decision identities perform no source read and preserve known activity facts',async t=>{
  const h=await mount(t,async()=>{throw Error('must not fetch');});await h.render({decisionId:'MTG-PL-2026-02-30-DEC-1'});assert.equal(h.calls.length,0);assert.match(h.container.textContent,/Indexed result/);
});

test('a transport failure keeps the indexed outcome and voting method readable',async t=>{
  const h=await mount(t,async()=>new Response(JSON.stringify({message:'Source temporarily unavailable'}),{status:503,headers:{'content-type':'application/json'}}));await h.render();
  assert.match(h.container.textContent,/Indexed result · Adopted · Show of hands/);assert.match(h.container.textContent,/Additional vote details could not be loaded/);assert.doesNotMatch(h.container.textContent,/Position unavailable|Selected memberFor/);assert(h.container.querySelector('a'));
});

test('partial tallies preserve known counts and keep unknown values separate from zero',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse();value.selected.item.totals={for:445,against:0,abstaining:null};return Response.json(value);});await h.render();
  assert.match(h.container.textContent,/For 445Against 0Abstaining —/);assert.doesNotMatch(h.container.textContent,/Tallies unavailable/);
});

test('an exact but incomplete response retains a known outcome, method and counts',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({outcome:null,method:null,ballotStatus:'unknown',position:{status:'unavailable',position:null}});value.selected.item.totals={for:null,against:null,abstaining:null};return Response.json(value);});
  await h.render({indexed:{outcome:'ADOPTED',method:'VOTE_HAND',totals:{for:445,against:0,abstaining:null}}});
  assert.match(h.container.textContent,/Adopted/);assert.match(h.container.textContent,/Show of hands/);assert.match(h.container.textContent,/For 445Against 0Abstaining —/);assert.doesNotMatch(h.container.textContent,/Outcome unavailable/);
});
test('unavailable observation never claims that a completed search found no records',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse();value.coverage.status='unavailable';value.alignmentCounts=null;value.items=[];value.pagination={offset:0,limit:50,returned:0,observedTotal:0,recordedTotal:null,filteredTotal:0,nextOffset:null};value.selected={status:'unavailable',item:null};return Response.json(value);});await h.render();
  assert.match(h.container.textContent,/Indexed result/);assert.match(h.container.textContent,/Additional vote details could not be loaded/);assert.doesNotMatch(h.container.textContent,/No additional details were found/);
});
test('disagreeing result snapshots remain explicitly labelled instead of silently combined',async t=>{
  const h=await mount(t,async()=>Response.json(exactResponse({outcome:'REJECTED'})));await h.render({indexed:{outcome:'ADOPTED',method:'VOTE_HAND'}});
  assert.match(h.container.textContent,/voting record has changed since this activity was saved/);assert.match(h.container.querySelector('[aria-label="Saved activity result"]').textContent,/Adopted · Show of hands/);assert.match(h.container.querySelector('.member-votes-result').textContent,/Rejected/);
});
test('explicit source conflict never revives a saved result as a current confirmed outcome',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({outcome:null,method:null,ballotStatus:'unknown',position:{status:'conflicting',position:null}});value.selected.item.sourceConflicts={fields:['decision_outcome']};value.selected.item.totals={for:null,against:null,abstaining:null};return Response.json(value);});await h.render({indexed:{outcome:'ADOPTED',method:'VOTE_HAND'}});
  assert.match(h.container.textContent,/Vote sources disagree/);assert.match(h.container.querySelector('[aria-label="Saved activity result"]').textContent,/Adopted/);assert.match(h.container.querySelector('.member-votes-result').textContent,/Outcome unavailable/);assert.doesNotMatch(h.container.textContent,/retained from the saved/);
});

test('a conducted named ballot cannot inherit a saved lapsed outcome',async t=>{
  const h=await mount(t,async()=>Response.json(exactResponse({outcome:null,ballotStatus:'conducted'})));await h.render({indexed:{outcome:'LAPSED',method:'VOTE_ELECTRONIC_ROLLCALL'}});
  assert.match(h.container.textContent,/voting record has changed/);assert.doesNotMatch(h.container.querySelector('.member-votes-result').textContent,/Lapsed/);
});
test('known show-of-hands method cannot override an unavailable position when ballot type is unknown',async t=>{
  const h=await mount(t,async()=>Response.json(exactResponse({method:'VOTE_HAND',outcome:'ADOPTED',ballotStatus:'unknown',position:{status:'unavailable',position:null}})));await h.render({indexed:{outcome:'ADOPTED',method:'VOTE_HAND'}});
  assert.match(h.container.textContent,/Adopted/);assert.match(h.container.textContent,/Show of hands/);assert.match(h.container.textContent,/Position unavailable/);assert.doesNotMatch(h.container.textContent,/Not individually recorded/);
});

test('published counts remain visible when named-ballot collection is unknown',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({ballotStatus:'unknown',position:{status:'unavailable',position:null}});value.selected.item.totals={for:445,against:0,abstaining:null};return Response.json(value);});await h.render({indexed:{outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:445,against:0,abstaining:null}}});
  assert.match(h.container.textContent,/For 445Against 0Abstaining —/);assert.doesNotMatch(h.container.textContent,/Tallies unavailable/);assert.equal(h.container.querySelector('.member-votes-bar'),null);
});
test('retained lapsed outcomes retain their not-conducted semantics',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({outcome:null,method:null,ballotStatus:'unknown',position:{status:'unavailable',position:null}});value.selected.item.totals={for:null,against:null,abstaining:null};return Response.json(value);});await h.render({indexed:{outcome:'LAPSED',method:'VOTE_HAND'}});
  assert.match(h.container.textContent,/Lapsed/);assert.match(h.container.textContent,/Not put to a vote/);assert.doesNotMatch(h.container.textContent,/Position unavailable|Tallies unavailable|Individual positions are not recorded/);
});

test('a saved lapsed-motion explanation stays within its labelled saved result after a current adoption',async t=>{
  const h=await mount(t,async()=>Response.json(exactResponse()));const {MotionOutcome}=await h.load('/src/MotionOutcome.tsx');
  await act(async()=>h.root.render(createElement(MotionOutcome,{memberId:197494,memberName:'Selected member',language:'en',sourceId:'B-10-2026-0448',reference:'B10-0448/2026',outcome:{status:'lapsed',method:'VOTE_ELECTRONIC_ROLLCALL',decisionId:decision}})));
  const saved=h.container.querySelector('[aria-label="Saved activity result"]');assert.match(saved.textContent,/This text lapsed and was not adopted/);assert.match(h.container.querySelector('.member-votes-result').textContent,/Adopted/);
  assert.equal([...h.container.querySelectorAll('.explorer-motion-explanation')].filter(node=>!saved.contains(node)).length,0);
});

for(const method of ['VOTE_HAND','VOTE_ELECTRONIC','VOTE_SECRET','VOTE_SECRET_BALLOT'])test('activity uses authoritative position certainty for '+method,async t=>{
  let status='not-individually-recorded',ballotStatus='conducted',outcome='ADOPTED';
  const h=await mount(t,async url=>Response.json(exactResponse({id:new URL(url,'http://localhost').searchParams.get('decision'),method,position:{status,position:null},ballotStatus,outcome})));await h.render();
  assert.match(h.container.querySelector('.member-votes-position').textContent,/Not individually recorded/);
  status='unavailable';ballotStatus='unknown';await h.render({decisionId:sitting+'-DEC-198252'});
  assert.match(h.container.querySelector('.member-votes-position').textContent,/Position unavailable/);assert.doesNotMatch(h.container.textContent,/Not individually recorded/);
  status='not-conducted';ballotStatus='not-conducted';outcome='LAPSED';await h.render({decisionId:sitting+'-DEC-198253'});
  assert.match(h.container.querySelector('.member-votes-position').textContent,/Not put to a vote/);assert.doesNotMatch(h.container.textContent,/Not individually recorded/);
});

for(const outcome of ['LAPSED','WITHDRAWN'])test('activity labels an unheld '+outcome+' ballot without its retained roll-call method',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse({outcome,method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'not-conducted',position:{status:'not-conducted',position:null}});value.selected.item.totals={for:null,against:null,abstaining:null};return Response.json(value);});
  await h.render();
  assert.match(h.container.querySelector('.activity-vote__meta').textContent,/Not put to a vote/);
  assert.doesNotMatch(h.container.textContent,/Roll-call vote/);
});

test('verified chairing removes the complete activity vote block, including indexed results and position fallback text',async t=>{
  const h=await mount(t,async()=>{const value=exactResponse();value.selected={status:'chairing',item:null};return Response.json(value);});
  for(const context of [false,true]){await h.render({context});assert.equal(h.container.textContent,'');assert.equal(h.container.querySelector('.activity-vote'),null);}
});
