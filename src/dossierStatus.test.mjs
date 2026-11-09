import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const {procedures}=JSON.parse(readFileSync(new URL('../server/fixtures/reader-first-helpers.json',import.meta.url)));
const [erasmus,fisheries]=procedures;
const tally={for:454,against:34,abstaining:93};
const coverage={limited:false,invalidRows:0,incompleteEvents:0},source={fetchedAt:'2026-11-06T10:00:00Z',stale:false,refreshInProgress:false,refreshError:null};
const progressFor=fixture=>({reference:fixture.reference,language:'en',state:'mapped',dossier:'d',events:fixture.cellarEvents.map(event=>({dates:[event.date],label:event.types[0].code,labelLanguage:'en',statuses:[],institutions:[],works:[],milestone:false,issues:[],...event,types:event.types.map(type=>({id:type.code,label:null,language:null,...type}))})),coverage,source});
const statusFor=(fixture,slots={},extra={})=>({version:1,reference:fixture.reference,family:'COD',steps:[],stage:'unknown',indexEvents:fixture.indexEvents,slots,...extra});
const contextFor=fixture=>({reference:fixture.reference,title:'A dossier',language:'en',summaries:fixture.summaries.map((row,index)=>({id:String(index),...row})),summary:{id:'0',stage:'proposal',date:'2025-07-16',blocks:[{kind:'p',text:'One'},{kind:'p',text:'Two'},{kind:'p',text:'Three'}],method:null,source:{url:'u'}},subjects:[],topics:[{id:'t',label:'A topic',language:'en'}],source:{url:'https://oeil.europarl.europa.eu/x'}});

async function mount(t,reference,handlers) {
  const window=new Window({url:'http://localhost/?view=legislation&pl-mode=dossier'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href),name=url.pathname.split('/').at(-1);calls.push(name);
    if(handlers[name])return handlers[name](url);
    return Response.json({error:{code:'absent',message:'Absent'}},{status:404});
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ProcedureContext}=await loadModule('/src/ProcedureContext.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(ProcedureContext,{reference,language:'en',showTitle:true},createElement('div',{id:'people'},'People'))));
  const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  await settle();
  return {container,calls,settle,steps:()=>[...container.querySelectorAll('.dossier-steps>li')].map(row=>[row.dataset.state,row.textContent.replace('✓','')])};
}
const before=(a,b)=>Boolean(a.compareDocumentPosition(b)&4);

test('the dossier answers first: status, strip, summary, closed timeline, people, then topics',async t=>{
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{committees:[{code:'CULT',name:'Committee on Culture and Education',language:'en'}],mainVote:{id:'d',date:'2026-10-22',outcome:'ADOPTED',method:'m',ballotStatus:'conducted',totals:tally}},{stage:'position-talks'})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  const {container,steps}=view;
  assert.equal(container.querySelector('.dossier-status-sentence').textContent,'Parliament set its position on Oct 22, 2026: 454 for, 34 against, 93 abstaining. The file went back to committee for talks with the Council.');
  assert.equal(container.querySelector('.dossier-status-next').textContent,'Next step: talks with the Council.');
  assert.deepEqual(steps().map(row=>row[0]),['done','done','done','done','current','open','open','open','open']);
  assert.equal(container.querySelector('.dossier-steps [aria-current="step"]').textContent,'Negotiations');
  assert.match(steps()[3][1],/May 11, 2026 · partial/);
  assert.match(steps()[0][1],/Jul 16, 2025/,'the OEIL proposal date, not the 17 July registration');
  const [status,summary,timeline,people,topics]=['.dossier-status','.insight-official-summary','.procedure-progress','#people','.insight-official-topics'].map(selector=>container.querySelector(selector));
  assert(before(status,summary));assert(before(summary,timeline));assert(before(timeline,people));assert(before(people,topics));
  assert(before(container.querySelector('.insight-dossier-title'),status));
  assert.equal(container.querySelectorAll('.insight-official-summary>p').length,2);
  const toggle=container.querySelector('.procedure-progress-toggle');
  assert.equal(toggle.textContent,'Full timeline (34 events)');assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(container.querySelector('.procedure-progress-timeline'),null);
  assert.equal(container.querySelector('.procedure-progress-latest'),null);
  await act(async()=>toggle.click());
  const rows=[...container.querySelectorAll('.procedure-progress-timeline>li')];
  assert.equal(rows.length,34,'the opened timeline holds every counted event');
  assert.equal(rows.find(row=>row.textContent.includes('ADP_PROPLEG_byCOM')).querySelector('time').textContent,'Jul 16, 2025');
  assert.equal(view.calls.filter(name=>name==='procedure-progress').length,1,'status and timeline share one read');
});
test('the strip renders at once, Cellar steps fill in, and nothing says Checking',async t=>{
  let answer;const deferred=new Promise(resolve=>{answer=resolve;});
  const view=await mount(t,fisheries.reference,{
    'dossier-status':()=>Response.json(statusFor(fisheries,{committees:[{code:'PECH',name:'Committee on Fisheries',language:'en'}]},{stage:'drafting'})),
    'procedure-progress':()=>deferred.then(()=>Response.json(progressFor(fisheries))),
    'procedure-context':()=>Response.json(contextFor(fisheries)),
  });
  const {container,steps,settle}=view;
  assert.equal(steps().length,9);assert.doesNotMatch(container.textContent,/Checking/);
  assert.equal(steps().find(row=>row[1].startsWith('Council'))[0],'open','nothing from Cellar yet');
  assert.equal(container.querySelector('.dossier-status-sentence').textContent,'With the Committee on Fisheries (PECH). Amendments tabled on Jun 10, 2026.');
  assert.equal(container.querySelector('.dossier-status-next').textContent,'Next step: committee vote.');
  await act(async()=>answer());await settle();
  const council=steps().find(row=>row[1].startsWith('Council'));
  assert.equal(council[0],'done');assert.match(council[1],/Sep 29, 2026 · partial/,'cancelled rows of 22 June and 28 September do not count');
  assert.equal(steps().find(row=>row[1].startsWith('Committee'))[0],'current');
  assert.equal(steps().find(row=>row[1]==='Negotiations')[0],'open');
});
test('a failed Cellar read leaves the index steps with no message',async t=>{
  const {container,steps}=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{},{stage:'position-talks'})),
    'procedure-progress':()=>Response.json({error:{code:'down',message:'Down'}},{status:500}),
    'procedure-context':()=>Response.json({...contextFor(erasmus),summaries:[]}),
  });
  assert.equal(steps().length,9);assert.equal(steps()[2][0],'done');
  assert.doesNotMatch(container.querySelector('.dossier-status').textContent,/unavailable|Down/i);
  assert.equal(container.querySelector('.procedure-progress'),null);
});
test('nothing known reads as unavailable with the procedure file in its place',async t=>{
  const {container}=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json({error:{code:'down',message:'Down'}},{status:404}),
    'procedure-progress':()=>Response.json({error:{code:'down',message:'Down'}},{status:404}),
    'procedure-context':()=>Response.json({...contextFor(erasmus),summaries:[]}),
  });
  const line=container.querySelector('.dossier-status-sentence');
  assert.match(line.textContent,/^Status unavailable\./);assert.match(line.querySelector('a').href,/oeil\.europarl\.europa\.eu\/oeil\/en\/procedure-file\?reference=2025%2F0222%28COD%29/);
});
test('without a Legislative Observatory file the gap line links nowhere',async t=>{
  const {container}=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json({error:{code:'down',message:'Down'}},{status:404}),
    'procedure-progress':()=>Response.json({error:{code:'down',message:'Down'}},{status:404}),
    'procedure-context':()=>Response.json({error:{code:'official_source_not_found',message:'Missing'}},{status:404}),
  });
  assert.equal(container.querySelector('.dossier-status-sentence').textContent,'Status unavailable.');
  assert.ok(!container.querySelector('a[href*="oeil.europarl"]'));
  assert.doesNotMatch(container.textContent,/Loading/,'nothing keeps loading');
  assert.equal(container.querySelector('#people').textContent,'People');
});
test('a reference no source holds gets one line and nothing that keeps loading',async t=>{
  const reference='2026/0030(COD)',view=await mount(t,reference,{
    'dossier-status':()=>Response.json({error:{code:'procedure_not_found',message:'Parliament has no record of this procedure.'}},{status:404}),
    'procedure-progress':()=>Response.json({reference,language:'en',state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json({error:{code:'official_source_not_found',message:'Missing'}},{status:404}),
  });
  const {container}=view;
  assert.equal(container.querySelector('.dossier-status').textContent,'No record of this procedure.');
  assert.ok(!container.querySelector('.dossier-steps'));
  assert.equal(container.querySelector('.dossier-identity-row').textContent,reference,'no follow control for a file that does not exist');
  assert.ok(!container.querySelector('#people'));
  assert.doesNotMatch(container.textContent,/Summary unavailable|Loading|Legislative Observatory|Amendments for this dossier/);
  assert.ok(!container.querySelector('a[href*="oeil.europarl"]'));
  assert.equal(view.calls.filter(name=>name==='dossier-status').length,1,'a missing record is not retried');
});
test('a procedure only the Legislative Observatory holds keeps its strip and people',async t=>{
  const {container,steps}=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json({error:{code:'procedure_not_found',message:'Parliament has no record of this procedure.'}},{status:404}),
    'procedure-progress':()=>Response.json({reference:erasmus.reference,language:'en',state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  assert.equal(container.querySelector('.insight-dossier-title h2').textContent,'A dossier');
  assert.equal(steps().length,9);assert.match(steps()[0][1],/Jul 16, 2025/);
  assert.doesNotMatch(container.textContent,/No record of this procedure/);
  assert.equal(container.querySelector('#people').textContent,'People');
});
test('other families get a sentence and no strip',async t=>{
  const reference='2026/2000(RSP)',fixture={reference,indexEvents:[],cellarEvents:[],summaries:[]};
  const adopted=await mount(t,reference,{
    'dossier-status':()=>Response.json(statusFor(fixture,{mainVote:{id:'d',date:'2026-10-22',outcome:'ADOPTED',method:'m',ballotStatus:'conducted',totals:tally}},{family:'RSP',stage:'resolution-adopted'})),
    'procedure-progress':()=>Response.json({reference,state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json(contextFor(fixture)),
  });
  assert.equal(adopted.container.querySelector('.dossier-steps'),null);
  assert.equal(adopted.container.querySelector('.dossier-status-sentence').textContent,'Parliament adopted this on Oct 22, 2026: 454 for, 34 against, 93 abstaining.');
  assert.equal(adopted.container.querySelector('.dossier-status-next'),null);
});

for(const [counts,expected] of [
  [{blockVotes:2,blockAmendments:318,individual:48,identical:2},'On the voting list: block votes on 318 committee amendments, then 48 individual amendments, 2 of them identical.'],
  [{blockVotes:1,blockAmendments:84,individual:5,identical:0},'On the voting list: a block vote on 84 committee amendments, then 5 individual amendments.'],
  [{blockVotes:0,blockAmendments:0,individual:20,identical:0},'On the voting list: 20 individual amendments.'],
  [{blockVotes:0,blockAmendments:0,individual:1,identical:0},'On the voting list: 1 individual amendment.'],
  [null,null],
])test(`a held voting list adds one plain line: ${expected}`,async t=>{
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{committees:[],mainVote:null,plenaryDate:null,votingList:counts})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  assert.equal(view.container.querySelector('.dossier-status-voting-list')?.textContent??null,expected);
});
