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
      {sittingId:B,date:'2026-10-07',withGroup:2,comparable:2,finalWithGroup:2,finalComparable:2},
      {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,finalWithGroup:null,finalComparable:null},
    ],
    departures:{scope:'all',offset:0,limit:5,total:6,items:departures.slice(0,5),nextOffset:5},
    comparison:{all:{group:{median:0.625,members:2},parliament:{median:0.5,members:3}},final:{group:{median:1,members:2},parliament:{median:0.75,members:3}}},
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
  const text=view.container.textContent;
  assert.match(text,/Voting record/);
  assert.match(text,/Current term · 16 Jul 2024 – 7 Oct 2026/);
  assert.match(text,/With their group75%3 of 4 votesGroup median 62.5% · Parliament median 50%/);
  assert.match(text,/Against their group11 of 4 votes/);
  assert.match(text,/Recorded votes5 of 4named votes held/);
  assert.equal(text.includes('Partial'),false);
  assert.equal(view.container.querySelectorAll('svg circle').length,2);
  assert.equal(view.container.querySelectorAll('svg path.member-vote-record-line').length,1);
  assert.match(view.container.querySelector('.member-vote-record-trend ul').textContent,/7 Oct 2026: 100% with their group \(2 of 2\)/);
  assert.equal(links(view.container).length,5,'the first page keeps five departures');
  assert.match(links(view.container)[0].getAttribute('href'),/mv-decision=MTG-PL-2026-10-07-DEC-10/);
  assert.equal(links(view.container)[0].hasAttribute('lang'),false,'text in the interface language needs no language mark');
  assert.match(view.container.querySelector('.member-vote-record-departures small').textContent,/7 Oct 2026 · Against · group For/);
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
  assert.match(view.container.textContent,/With their group100%2 of 2 votesGroup median 100% · Parliament median 75%/);
  assert.equal(view.container.querySelectorAll('svg circle').length,1,'final votes plot only sittings with a final comparable vote');
  assert.equal(view.container.querySelectorAll('.member-vote-record-departures a').length,1);
  assert.equal(button(view.container,'Show more'),undefined);
});

test('a non-attached member sees recorded ballots and one short label, never group figures',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,departures:{...response().departures,total:0,items:[],nextOffset:null}})});
  assert.match(view.container.textContent,/Recorded votes5 of 4named votes heldNon-attached/);
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.textContent.includes('Against'),false);
  assert.equal(view.container.querySelector('svg'),null);
});

test('a chairing member gets a separate chaired count',async t=>{
  const view=await mount(t,{data:response({ballots:{recorded:5,named:4,chaired:2}})});
  assert.match(view.container.textContent,/Chaired: 2/);
});

test('unknown named votes leave only the recorded count, and a null sitting breaks the trend line',async t=>{
  const data=response({ballots:{recorded:5,named:null,chaired:0},bySitting:[
    {sittingId:B,date:'2026-10-07',withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null},
    {sittingId:A,date:'2026-09-16',withGroup:1,comparable:2,finalWithGroup:null,finalComparable:null},
  ]});
  const view=await mount(t,{data});
  assert.match(view.container.textContent,/Recorded votes5(?!.*named votes held)/);
  assert.equal(view.container.querySelectorAll('svg circle').length,1);
  assert.equal(view.container.querySelectorAll('svg path.member-vote-record-line').length,0);
  assert.match(view.container.querySelector('.member-vote-record-trend ul').textContent,/7 Oct 2026: no comparable votes/);
});

test('a failed record read shows a few words and leaves the rest of the page to the Votes tab',async t=>{
  const view=await mount(t,{status:503});
  await exhaustAutomaticRetries(t);
  assert.equal(view.container.textContent.trim(),'Voting record unavailable.');
  assert.equal(view.container.querySelector('svg'),null);
});

test('a partial record states the missing sittings instead of zeroes',async t=>{
  const view=await mount(t,{data:response({coverage:{sittings:3,included:2,missing:1,status:'partial'}})});
  assert.match(view.container.textContent,/Partial · missing sittings: 1/);
});

test('the profile strip summarizes the record and opens the Votes tab',async t=>{
  const view=await mount(t);
  await view.renderSummary();
  assert.equal(view.calls.at(-1).includes('limit=0'),true);
  assert.match(view.container.textContent,/Voting record: 75% with their group · 5 recorded votes/);
  await act(async()=>view.container.querySelector('.member-vote-record-summary a').click());
  assert.deepEqual(view.scopes,['open']);
});

test('the profile strip keeps non-attached and chaired counts to one line',async t=>{
  const view=await mount(t,{data:response({group:{code:'NI',status:'non-attached'},alignment:null,comparison:null,ballots:{recorded:5,named:4,chaired:1}})});
  await view.renderSummary();
  assert.match(view.container.textContent,/Voting record: 5 recorded votes · chaired 1/);
});

test('a chairing member with no comparable vote shows recorded and chaired counts only',async t=>{
  const view=await mount(t,{data:response({alignment:{all:counts(0,0,0,0),wholeText:counts(0,0,0,0)},comparison:null,ballots:{recorded:14,named:612,chaired:598}})});
  assert.match(view.container.textContent,/Recorded votes14 of 612named votes heldChaired: 598/);
  assert.equal(view.container.textContent.includes('With their group'),false);
  assert.equal(view.container.textContent.includes('Group unavailable'),false);
  assert.equal(view.container.querySelector('.member-vote-record-departures'),null);
});

test('departure wording in another language is marked, and language-neutral wording is not',async t=>{
  const items=[{...departures[1],text:'Après le considérant 27',language:'fr'},{...departures[2],text:'RC-B10-0371/2025 - § 2 - Am 3',language:'mul'}];
  const view=await mount(t,{data:response({departures:{scope:'all',offset:0,limit:5,total:2,items,nextOffset:null}})});
  assert.equal(links(view.container)[0].getAttribute('lang'),'fr');
  assert.equal(links(view.container)[1].hasAttribute('lang'),false);
});
