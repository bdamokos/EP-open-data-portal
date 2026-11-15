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

async function mount(t,reference,handlers,props={}) {
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
  const {DossierPage}=await loadModule('/src/DossierPage.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=extra=>act(async()=>root.render(createElement(DossierPage,{reference,language:'en',...props,...extra})));
  await render();
  const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  await settle();
  const rows=()=>[...container.querySelectorAll('.dossier-rows>.frow')].map(row=>[row.querySelector('.t').textContent,row.querySelector('.val')?.textContent??null]);
  const open=title=>act(async()=>{const row=[...container.querySelectorAll('.dossier-rows>details')].find(item=>item.querySelector('.t').textContent===title);row.open=true;row.dispatchEvent(new window.Event('toggle'));});
  return {container,calls,settle,render,rows,open,steps:()=>[...container.querySelectorAll('.dossier-steps>li')].map(row=>[row.dataset.state,row.textContent.replace('✓','')])};
}
const before=(a,b)=>Boolean(a.compareDocumentPosition(b)&4);

test('the dossier answers first: labelled lines, a step bar, then folded rows that read nothing until opened',async t=>{
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{committees:[{code:'CULT',name:'Committee on Culture and Education',language:'en'}],mainVote:{id:'d',date:'2026-10-22',outcome:'ADOPTED',method:'m',ballotStatus:'conducted',totals:tally}},{stage:'position-talks',title:'Erasmus+',titleLanguage:'en'})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json({...contextFor(erasmus),purpose:'To fund education and training.'}),
  });
  const {container,steps,rows,open}=view;
  assert.equal(container.querySelector('.insight-dossier-title h1').textContent,'Erasmus+');
  assert.equal(container.querySelector('.dossier-purpose').textContent,'To fund education and training.');
  assert.deepEqual([...container.querySelectorAll('.dossier-answer dt')].map(row=>row.textContent),['Now','Next']);
  assert.equal(container.querySelector('.dossier-status-sentence').textContent,'Parliament set its position on Oct 22, 2026: 454 for, 34 against, 93 abstaining. The file went back to committee for talks with the Council.');
  assert.equal(container.querySelector('.dossier-status-next').textContent,'Talks with the Council.');
  assert.deepEqual(steps().map(row=>row[0]),['done','done','done','done','current','open','open','open','open']);
  assert.equal(container.querySelector('.dossier-steps [aria-current="step"]').textContent,'Negotiations');
  // Council's partial mandate came before the committee vote, so its step comes first.
  assert.deepEqual(steps().slice(0,4).map(row=>row[1].replace(/[A-Z][a-z]{2} \d+, \d{4}.*$/,'')),['Commission proposes','Council sets position','Committee reports','Parliament sets position']);
  assert.match(steps()[1][1],/May 11, 2026 · partial/);
  assert.match(steps()[0][1],/Jul 16, 2025/,'the OEIL proposal date, not the 17 July registration');
  assert.equal(container.querySelector('.dossier-step-count p').textContent,'Step 5 of 9: NegotiationsAll steps');
  assert.deepEqual(rows().map(row=>row[0]),['Summary','People','Topics','Full timeline']);
  assert.deepEqual(rows().slice(2).map(row=>row[1]),['1','34 events']);
  const [title,status,folded]=['.insight-dossier-title','.dossier-status','.dossier-rows'].map(selector=>container.querySelector(selector));
  assert(before(title,status));assert(before(status,folded));
  assert.equal(container.querySelector('.insight-official-summary'),null,'a closed row mounts nothing');
  assert.deepEqual([...new Set(view.calls)].sort(),['dossier-status','procedure-context','procedure-progress'],'a first visit makes three reads');
  await open('Summary');
  assert.equal(container.querySelectorAll('.insight-official-summary>p').length,2);
  await open('Full timeline');
  assert.equal(container.querySelector('.procedure-progress-toggle'),null,'the row is the toggle');
  const events=[...container.querySelectorAll('.procedure-progress-timeline>li')];
  assert.equal(events.length,34,'the opened timeline holds every counted event');
  assert.equal(events.find(row=>row.textContent.includes('ADP_PROPLEG_byCOM')).querySelector('time').textContent,'Jul 16, 2025');
  assert.equal(view.calls.filter(name=>name==='procedure-progress').length,1,'status and timeline share one read');
  assert.equal(view.calls.filter(name=>name==='procedure-context').length,1);
});
test('a deal names its vote day, the voting list in plain words and the earlier tally',async t=>{
  const indexEvents=[{had_activity_type:'COMMITTEE_ADOPTING_REPORT',activity_date:'2026-04-15'},{had_activity_type:'PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS',activity_date:'2026-04-29'},{had_activity_type:'COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT',activity_date:'2026-09-10'}];
  const fixture={reference:'2025/0207(COD)',indexEvents,cellarEvents:[],summaries:[]};
  const view=await mount(t,fixture.reference,{
    'dossier-status':()=>Response.json(statusFor(fixture,{mainVote:{id:'v',date:'2026-04-29',outcome:'ADOPTED',method:'m',ballotStatus:'conducted',totals:{for:526,against:56,abstaining:69}},plenaryDate:'2099-11-12',votingList:{blockVotes:1,blockAmendments:1,individual:12,identical:3}},{stage:'deal',title:'Chemicals',titleLanguage:'en'})),
    'procedure-progress':()=>Response.json({reference:fixture.reference,language:'en',state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json(contextFor(fixture)),
  });
  const lines=Object.fromEntries([...view.container.querySelectorAll('.dossier-answer dt')].map(term=>[term.textContent,term.nextElementSibling.textContent]));
  assert.deepEqual(Object.keys(lines),['Now','Next','The vote','Earlier']);
  assert.equal(lines.Next,'Parliament votes on the deal on Thursday 12 November.');
  assert.equal(lines['The vote'],'one block vote on 1 committee amendment, then 12 amendments, 3 of them duplicates.');
  assert.equal(lines.Earlier,'Parliament set its position on Apr 29, 2026: 526 for, 56 against, 69 abstaining.');
  assert.equal(view.container.querySelector('.dossier-step-count p').textContent,'Step 7 of 9: Deal votedAll steps');
});
const dealFixture={reference:'2025/0207(COD)',indexEvents:[{had_activity_type:'COMMITTEE_ADOPTING_REPORT',activity_date:'2026-04-15'},{had_activity_type:'PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS',activity_date:'2026-04-29'},{had_activity_type:'COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT',activity_date:'2026-09-10'}],cellarEvents:[],summaries:[]};
const scrollInside=view=>act(async()=>{const inner=view.container.querySelector('.dossier-rows');inner.dispatchEvent(new window.Event('scroll',{bubbles:false}));await new Promise(resolve=>setTimeout(resolve,20));});
test('a scroll inside the page, whose scroll events do not bubble, loads the rows near it',async t=>{
  const view=await mount(t,dealFixture.reference,{
    'dossier-status':()=>Response.json(statusFor(dealFixture,{},{stage:'deal',title:'Chemicals',titleLanguage:'en'})),
    'procedure-progress':()=>Response.json({reference:dealFixture.reference,language:'en',state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json(contextFor(dealFixture)),
    'press-releases':()=>Response.json({reference:dealFixture.reference,total:1,items:[{id:'pr1',url:'https://www.europarl.europa.eu/news/en/press-room/x',title:'Deal on chemicals',titleLanguage:'en',publishedAt:'2026-09-10T10:00:00Z',links:[]}]}),
    'record-topics':()=>Response.json({ready:true,records:[]}),
  });
  assert(!view.calls.includes('press-releases'),'nothing before the reader scrolls');
  await scrollInside(view);await view.settle();
  assert(view.calls.includes('press-releases'));
  assert.deepEqual(view.rows().find(row=>row[0]==='Press releases'),['Press releases','1']);
});
test('a vote day the Publications Office gives after the status fills in the Next line',async t=>{
  let progress;const progressRead=new Promise(resolve=>{progress=resolve;});
  const fixture={...dealFixture,cellarEvents:[{id:'v',date:'2099-11-12',dates:['2099-11-12'],status:'projected',types:[{code:'VOTE_byEP'}]}]};
  const view=await mount(t,fixture.reference,{
    'dossier-status':()=>Response.json(statusFor(fixture,{plenaryDate:null},{stage:'deal',title:'Chemicals',titleLanguage:'en'})),
    'procedure-progress':()=>progressRead.then(()=>Response.json(progressFor(fixture))),
    'procedure-context':()=>Response.json(contextFor(fixture)),
  });
  const next=()=>view.container.querySelector('.dossier-status-next').textContent;
  assert.equal(next(),'Parliament votes on the deal.');
  const now=view.container.querySelector('.dossier-status-sentence').textContent;
  await act(async()=>progress());await view.settle();
  assert.equal(next(),'Parliament votes on the deal on Thursday 12 November.');
  assert.equal(view.container.querySelector('.dossier-status-sentence').textContent,now,'the Now line stays');
});
test('Parliament own topics keep the Topics row when the Observatory has none',async t=>{
  const view=await mount(t,dealFixture.reference,{
    'dossier-status':()=>Response.json(statusFor(dealFixture,{},{stage:'deal',title:'Chemicals',titleLanguage:'en'})),
    'procedure-progress':()=>Response.json({reference:dealFixture.reference,language:'en',state:'unmapped',dossier:null,events:[],coverage,source}),
    'procedure-context':()=>Response.json({error:{code:'official_source_not_found',message:'Missing'}},{status:404}),
    'record-topics':()=>Response.json({ready:true,records:[{id:'2025-0207',status:'ready',topics:[{key:'eurovoc:1',label:'chemical product',language:'en'}],places:[],keywords:[]}]}),
  });
  assert(!view.rows().some(row=>row[0]==='Topics'));
  await scrollInside(view);await view.settle();
  assert.deepEqual(view.rows().find(row=>row[0]==='Topics'),['Topics',null]);
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
  assert.equal(container.querySelector('.dossier-status-next').textContent,'The committee votes on its report.');
  await act(async()=>answer());await settle();
  const council=steps().find(row=>row[1].startsWith('Council'));
  assert.equal(council[0],'done');assert.match(council[1],/Sep 29, 2026 · partial/,'cancelled rows of 22 June and 28 September do not count');
  assert.equal(steps().find(row=>row[1].startsWith('Committee'))[0],'current');
  assert.equal(steps().find(row=>row[1]==='Negotiations')[0],'open');
});
for(const late of ['same stage','signature'])test(`the title comes with the status; late sources keep the title and rewrite the sentence only when the stage moves: ${late}`,async t=>{
  let progress,context;const progressRead=new Promise(resolve=>{progress=resolve;}),contextRead=new Promise(resolve=>{context=resolve;});
  // A signature only the Publications Office holds moves the file on to "signed".
  const body={...progressFor(erasmus)};if(late==='signature')body.events=[...body.events,{id:'sign',dates:['2026-11-01'],date:'2026-11-01',status:'recorded',types:[{id:'SIGN_byEP_CONSIL',code:'SIGN_byEP_CONSIL',label:null,language:null}],label:'Signature',labelLanguage:'en',statuses:[],institutions:[],works:[],milestone:false,issues:[]}];
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{},{stage:'position-talks',title:'Erasmus+ from the procedure record',titleLanguage:'en'})),
    'procedure-progress':()=>progressRead.then(()=>Response.json(body)),
    'procedure-context':()=>contextRead.then(()=>Response.json(contextFor(erasmus))),
  });
  const {container,steps,settle}=view;
  const heading=()=>container.querySelector('.insight-dossier-title h1')?.textContent;
  assert.equal(heading(),'Erasmus+ from the procedure record','no wait for the Legislative Observatory');
  const sentence=container.querySelector('.dossier-status-sentence').textContent;
  assert.match(sentence,/^Parliament set its position on Oct 22, 2026/);
  await act(async()=>{progress();context();});await settle();
  if(late==='signature'){
    assert.equal(steps().find(row=>row[1].startsWith('Signed'))?.[0],'done','the late signature fills its step');
    assert.equal(container.querySelector('.dossier-status-sentence').textContent,'Signed on Nov 1, 2026.','a later stage is never hidden behind the first sentence');
  }else assert.equal(container.querySelector('.dossier-status-sentence').textContent,sentence,'events of the same stage leave the sentence as shown');
  assert.equal(heading(),'Erasmus+ from the procedure record','the Observatory title does not replace it');
  assert.equal(view.calls.filter(name=>name==='dossier-status').length,1,'title and status share one read');
});
test('a language change takes the new language title',async t=>{
  const view=await mount(t,erasmus.reference,{
    'dossier-status':url=>Response.json(statusFor(erasmus,{},{stage:'position-talks',title:url.searchParams.get('lang')==='fr'?'Erasmus+ (fr)':'Erasmus+ (en)',titleLanguage:url.searchParams.get('lang')})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  const heading=()=>view.container.querySelector('.insight-dossier-title h1')?.textContent;
  assert.equal(heading(),'Erasmus+ (en)');
  await view.render({language:'fr'});await view.settle();
  assert.equal(heading(),'Erasmus+ (fr)');
});
test('a sentence from the Publications Office alone gives way when a retried status arrives',async t=>{
  let reads=0;
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>++reads===1?Response.json({error:{code:'unavailable',message:'Busy'}},{status:503}):Response.json(statusFor(erasmus,{committees:[],mainVote:{id:'d',date:'2026-10-22',outcome:'ADOPTED',method:'m',ballotStatus:'conducted',totals:tally}},{stage:'position-talks'})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  const sentence=()=>view.container.querySelector('.dossier-status-sentence')?.textContent||'';
  for(let waited=0;reads<2&&waited<20000;waited+=250)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250));});
  await view.settle();
  assert.equal(reads,2,'the client retried the status read');
  assert.match(sentence(),/454 for, 34 against, 93 abstaining/,'the held tally replaces the first sentence');
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
  assert.equal(container.querySelector('.insight-dossier-title h1').textContent,'A dossier');
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
  [{blockVotes:3,blockAmendments:312,individual:54,identical:2},'3 block votes on 312 committee amendments, then 54 amendments, 2 of them duplicates.'],
  [{blockVotes:1,blockAmendments:84,individual:5,identical:0},'one block vote on 84 committee amendments, then 5 amendments.'],
  [{blockVotes:1,blockAmendments:84,individual:0,identical:0},'one block vote on 84 committee amendments.'],
  [{blockVotes:0,blockAmendments:0,individual:20,identical:1},'20 amendments, each voted on its own, 1 of them a duplicate.'],
  [{blockVotes:0,blockAmendments:0,individual:1,identical:0},'1 amendment, each voted on its own.'],
  [null,null],
])test(`a held voting list adds The vote line: ${expected}`,async t=>{
  const view=await mount(t,erasmus.reference,{
    'dossier-status':()=>Response.json(statusFor(erasmus,{committees:[],mainVote:null,plenaryDate:null,votingList:counts})),
    'procedure-progress':()=>Response.json(progressFor(erasmus)),
    'procedure-context':()=>Response.json(contextFor(erasmus)),
  });
  assert.equal(view.container.querySelector('.dossier-status-voting-list')?.textContent??null,expected);
});
