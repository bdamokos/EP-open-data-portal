import {exhaustAutomaticRetries,installRetryClock} from './test-support/automaticRecovery.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const MEMBER=197591,A='MTG-PL-2026-09-16',B='MTG-PL-2026-10-07';
const counts=(withGroup,against,abstained=0,notComparable=0)=>({with:withGroup,against,abstained,notComparable});
const departures=Array.from({length:6},(_,index)=>({
  decisionId:B+'-DEC-'+(10+index),sittingId:B,date:'2026-10-07',scope:index===0?'final':'all',wholeText:index===0,
  position:'against',line:'for',text:'Departure '+(index+1),language:'en',
}));
function response(patch={}) {
  return {
    version:1,
    member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER},
    period:{from:'2024-07-16',to:'2026-10-07'},
    coverage:{sittings:2,included:2,missing:0,status:'complete'},
    group:{code:'S&D',status:'attached'},
    alignment:{all:counts(3,1,1,0),wholeText:counts(2,0,0,0)},
    ballots:{recorded:5,named:4,chaired:0},
    bySitting:[
      {sittingId:B,date:'2026-10-07',withGroup:2,comparable:2},
      {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2},
    ],
    departures:{scope:'all',offset:0,limit:5,total:6,items:departures.slice(0,5),nextOffset:5},
    comparison:{group:{median:0.625,members:2},parliament:{median:0.5,members:3}},
    attribution:'European Parliament Open Data API v2, CC BY 4.0',
    ...patch,
  };
}

async function mount(t,{data=response(),status=200,memberId=MEMBER,scope='all',offset=0}={}) {
  const window=new Window({url:'http://localhost/?member='+MEMBER+'&module=votes'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;const calls=[],offsets=[],scopes=[],opened=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(String(url));
    if(status!==200)return new Response('',{status});
    const url_=new URL(String(url),'http://localhost');
    return Response.json(typeof data==='function'?data(url_):data);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberVoteRecord,MemberVoteRecordSummary}=await load('/src/MemberVoteRecord.tsx');
  const {createRoot}=await import('react-dom/client');const container=window.document.createElement('div');window.document.body.append(container);installRetryClock(t);root=createRoot(container);
  const props={memberId,language:'en',scope,offset,onScopeChange:value=>scopes.push(value),onOffset:value=>offsets.push(value),onOpenDecision:value=>opened.push(value)};
  await act(async()=>root.render(createElement(MemberVoteRecord,props)));
  return {container,calls,offsets,scopes,opened,MemberVoteRecordSummary,window,
    async renderSummary(summaryProps={}){await act(async()=>root.render(createElement(MemberVoteRecordSummary,{memberId,language:'en',onOpen:()=>scopes.push('open'),...summaryProps})));},
    async render(next){await act(async()=>root.render(createElement(MemberVoteRecord,{...props,...next})));}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
const links=container=>[...container.querySelectorAll('.member-vote-record-departures a')];

test('an active member record shows labelled figures, an accessible trend and linked departures',async t=>{
  const view=await mount(t);
  assert.match(view.container.textContent,/Voting record/);
  assert.match(view.container.textContent,/Current term · 16 Jul 2024 – 7 Oct 2026/);
  assert.match(view.container.textContent,/Sittings covered: 2/);
  assert.match(view.container.textContent,/With group75%3 of 4/);
  assert.match(view.container.textContent,/Against group25%1 of 4/);
  assert.match(view.container.textContent,/Abstained1of 5 recorded votes/);
  assert.match(view.container.textContent,/Not comparable0No group line/);
  assert.match(view.container.textContent,/Group median 62.5% \(2 members\) · Parliament median 50% \(3 members\)/);
  assert.equal(view.container.querySelectorAll('svg circle').length,2);
  assert.equal(view.container.querySelectorAll('svg path.member-vote-record-line').length,1);
  assert.match(view.container.querySelectorAll('.visually-hidden')[1].textContent,/7 Oct 2026: 100% with group \(2 of 2\)/);
  assert.equal(links(view.container).length,5,'the first page keeps five departures');
  assert.match(links(view.container)[0].getAttribute('href'),/mv-decision=MTG-PL-2026-10-07-DEC-10/);
  assert.equal(new URL(links(view.container)[0].href).searchParams.get('module'),'votes');
  await act(async()=>links(view.container)[0].click());
  assert.equal(view.opened.length,1);
  assert.equal(view.opened[0].decisionId,B+'-DEC-10');
  assert.equal(view.window.location.href.includes('mv-decision'),false,'the click keeps in-page navigation');
});

test('scope and departure page actions report their own values',async t=>{
  const view=await mount(t);
  await act(async()=>button(view.container,'Final votes').click());
  assert.deepEqual(view.scopes,['final']);
  await act(async()=>button(view.container,'Show more').click());
  assert.deepEqual(view.offsets,[5]);
  await act(async()=>view.render({scope:'final',offset:5}));
  assert.equal(view.calls.at(-1).includes('scope=final'),true);
  assert.equal(view.calls.at(-1).includes('offset=5'),true);
});

test('final votes use whole-text counts and label their departures separately',async t=>{
  const view=await mount(t,{scope:'final',data:response({departures:{...response().departures,scope:'final',items:departures.slice(0,1),total:1,nextOffset:null}})});
  assert.match(view.container.textContent,/With group100%2 of 2/);
  assert.match(view.container.textContent,/Final votes against group/);
  assert.equal(view.container.querySelectorAll('.member-vote-record-departures a').length,1);
  assert.equal(button(view.container,'Show more'),undefined);
});

test('a non-attached member sees recorded ballots and one short label, never group figures',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Recorded votes5/);
  assert.match(view.container.textContent,/Named votes held4/);
  assert.match(view.container.textContent,/Non-attached · no group figures/);
  assert.equal(view.container.textContent.includes('With group'),false);
  assert.equal(view.container.querySelector('svg'),null);
});

test('a chairing member gets a separate chaired count',async t=>{
  const view=await mount(t,{data:response({ballots:{recorded:5,named:4,chaired:2}})});
  assert.match(view.container.textContent,/Votes chaired2/);
});

test('a failed record read shows a few words and leaves the rest of the page to the Votes tab',async t=>{
  const view=await mount(t,{status:503});
  await exhaustAutomaticRetries(t);
  assert.equal(view.container.textContent.trim(),'Voting record unavailable.');
  assert.equal(view.container.querySelector('svg'),null);
});

test('a partial record states the missing sittings instead of zeroes',async t=>{
  const view=await mount(t,{data:response({coverage:{sittings:3,included:2,missing:1,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · 2 of 3 covered/);
});

test('the profile strip summarizes the record and opens the Votes tab',async t=>{
  const view=await mount(t);
  await view.renderSummary();
  assert.equal(view.calls.at(-1).includes('limit=0'),true);
  assert.match(view.container.textContent,/Voting record: 75% with group · 5 recorded votes/);
  await act(async()=>view.container.querySelector('.member-vote-record-summary button').click());
  assert.deepEqual(view.scopes,['open']);
});

test('the profile strip keeps non-attached and chaired counts to one line',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,ballots:{recorded:5,named:4,chaired:1}})});
  await view.renderSummary();
  assert.match(view.container.textContent,/Voting record: 5 recorded votes · 1 chaired/);
});
