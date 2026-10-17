import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {SpeechInterventions} from '../server/speech-intervention-service.mjs';

async function statistics(t,fetch) {
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',fetch);
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {InterventionStatistics}=await vite.ssrLoadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {
    container,
    render:props=>act(async()=>root.render(createElement(InterventionStatistics,props))),
    unmount:()=>act(async()=>root.unmount()),
    stat:label=>[...container.querySelectorAll('.intervention-stats-grid>div')].find(card=>card.querySelector('span').textContent===label)?.querySelector('strong').textContent,
  };
}
const result=(available,nextPage=null,overrides={})=>({
  memberId:'257070',items:[],counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},
  groups:[{id:'the-left',label:'The Left',count:0}],
  coverage:{complete:nextPage===null,available,total:69,headers:available,unclassified:0,issues:[]},
  nextPage,sources:[{url:'https://example.org/source',fetchedAt:'2026-10-15T22:00:00Z',stale:false}],...overrides,
});

test('automatically counts every page including written and unreadable contributions, with a spinner until finished',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/speech-interventions-live-20261015.json',import.meta.url)));
  const ordinary=fixture.activities.find(a=>a.recorded_in_a_realization_of?.[0]?.numbering===172);
  const rows=Array.from({length:69},(_,i)=>{
    const row=structuredClone(ordinary);
    row.activity_id='MTG-PL-2026-10-06-OTH-'+(100000+i);row.id='eli/dl/event/'+row.activity_id;
    if(i===0)delete row.recorded_in_a_realization_of[0]['api:xmlFragment'];
    if(i===1)row.had_activity_type='http://data.europarl.europa.eu/def/ep-activities/PLENARY_DEBATE_WRITTEN_STATEMENT';
    return row;
  });
  const service=new SpeechInterventions({request:async(endpoint,params)=>{
    assert.equal(endpoint,'/speeches');
    const data=rows.slice(params.offset,params.offset+params.limit);
    return {url:'https://data.europarl.europa.eu/api/v2/speeches?'+new URLSearchParams(params),fetchedAt:Date.parse('2026-10-15T22:00:00Z'),payload:{data,meta:{total:rows.length},searchResults:{hits:data.map(row=>({id:row.id}))}}};
  }});
  const pages=[],enriched=[];let finish;
  const ui=await statistics(t,async input=>{
    const url=new URL(input,'http://localhost');
    assert.equal(url.pathname,'/api/poc/speech-statistics/257070');
    const page=Number(url.searchParams.get('page'));pages.push(page);
    if(page===1)await new Promise(resolve=>finish=resolve);
    return Response.json(await service.member('257070',page));
  });
  await ui.render({member:257070,onItems:items=>enriched.push(items.length)});
  assert.deepEqual(pages,[0,1],'next page starts without a click or a redundant page-zero request');
  assert.equal(ui.stat('Total contributions'),'50');
  assert.equal(ui.stat('On behalf of a group'),'0');
  assert.equal(ui.stat('Blue cards raised'),'—');
  assert.match(ui.container.querySelector('[role="status"]').textContent,/Counting contributions/);
  assert.equal(ui.container.querySelector('.intervention-stats-grid').getAttribute('aria-busy'),'true');
  assert(!ui.container.textContent.includes('Partial coverage'),'ongoing pagination uses the spinner');
  assert.equal(ui.container.querySelector('button,details,.intervention-group-counts'),null);
  await act(async()=>finish());
  assert.equal(ui.stat('Total contributions'),'69');
  assert.equal(ui.stat('On behalf of a group'),'0');
  assert.equal(ui.stat('Blue cards raised'),'—');
  assert.match(ui.container.textContent,/Partial coverage/,'unreadable headers remain incomplete after the final page');
  assert.equal(ui.container.querySelector('[role="status"]'),null);
  assert.equal(ui.container.querySelector('.intervention-stats-grid').getAttribute('aria-busy'),'false');
  assert(!ui.container.textContent.includes('contributions counted'));
  assert(!ui.container.textContent.includes('About these counts'));
  assert.deepEqual(enriched,[50,69],'speech enrichment receives each cumulative result');
});

test('complete empty coverage displays known zeroes without a duplicate footer or spinner',async t=>{
  const data=result(0,null);data.coverage.total=0;
  const ui=await statistics(t,async()=>Response.json(data));
  await ui.render({member:257070});
  for(const label of ['Total contributions','On behalf of a group','Blue cards raised','Blue cards answered','Blue-card reactions'])assert.equal(ui.stat(label),'0');
  assert.equal(ui.container.querySelector('[role="status"],.intervention-caption,details'),null);
  assert(!ui.container.textContent.includes('The Left'),'redundant group counts are omitted');
});

test('a failed later page retains partial counts and retry automatically finishes the remaining walk',async t=>{
  const pages=[];let fail=true,finish;
  const ui=await statistics(t,async input=>{
    const page=Number(new URL(input,'http://localhost').searchParams.get('page'));pages.push(page);
    if(page===0)return Response.json(result(50,1));
    if(fail)return Response.json({error:{message:'More contributions are temporarily unavailable.'}},{status:503});
    return new Promise(resolve=>finish=()=>resolve(Response.json(result(69))));
  });
  await ui.render({member:257070});
  assert.equal(ui.stat('Total contributions'),'50');
  assert.match(ui.container.textContent,/Partial coverage/);
  assert.equal(ui.container.querySelector('[role="status"]'),null);
  assert.match(ui.container.querySelector('[role="alert"]').textContent,/temporarily unavailable/);
  fail=false;
  await act(async()=>ui.container.querySelector('button').click());
  assert.equal(ui.stat('Total contributions'),'50');
  assert(ui.container.querySelector('[role="status"]'));
  assert.equal(ui.container.querySelector('[role="alert"]'),null);
  await act(async()=>finish());
  assert.deepEqual(pages,[0,1,0,1]);
  assert.equal(ui.stat('Total contributions'),'69');
  assert.equal(ui.container.querySelector('[role="alert"],[role="status"],.intervention-caption'),null);
});

test('a first-page failure offers retry without presenting missing data as zero',async t=>{
  let fail=true;
  const ui=await statistics(t,async()=>fail?Response.json({error:{message:'Counts unavailable.'}},{status:503}):Response.json(result(69)));
  await ui.render({member:257070});
  assert.equal(ui.stat('Total contributions'),undefined);
  assert.equal(ui.container.querySelector('[role="status"]'),null);
  assert.match(ui.container.querySelector('[role="alert"]').textContent,/Counts unavailable/);
  fail=false;
  await act(async()=>ui.container.querySelector('button').click());
  assert.equal(ui.stat('Total contributions'),'69');
  assert.equal(ui.container.querySelector('[role="alert"]'),null);
});

test('switching member and unmounting abort outstanding pages and ignore their late results',async t=>{
  const pending=[],enriched=[],calls=[];
  const onItems=items=>enriched.push(items[0]?.id);
  const ui=await statistics(t,(input,{signal})=>{
    const url=new URL(input,'http://localhost');calls.push(url.pathname+url.search);
    if(url.pathname.endsWith('/2'))return Promise.resolve(Response.json(result(3,null,{items:[{id:'member-two'}]})));
    if(url.searchParams.get('page')==='0'&&url.pathname.endsWith('/1'))return Promise.resolve(Response.json(result(50,1,{items:[{id:'member-one'}]})));
    // Ignore abort in this mock to also verify protection against late responses.
    return new Promise(resolve=>pending.push({signal,finish:()=>resolve(Response.json(result(99,2,{items:[{id:'stale'}]})))}));
  });
  await ui.render({member:1,onItems});
  assert.equal(ui.stat('Total contributions'),'50');
  await ui.render({member:2,onItems});
  assert.equal(pending[0].signal.aborted,true);
  assert.equal(ui.stat('Total contributions'),'3');
  await act(async()=>pending[0].finish());
  assert.equal(ui.stat('Total contributions'),'3');
  assert.deepEqual(enriched,['member-one','member-two']);
  assert.equal(calls.length,3,'no further stale-member pages start');
  await ui.render({member:3,onItems});
  assert.equal(ui.stat('Total contributions'),undefined,'prior member counts are cleared');
  assert(ui.container.querySelector('[role="status"]'));
  await ui.unmount();
  assert.equal(pending[1].signal.aborted,true);
  await act(async()=>pending[1].finish());
  assert.equal(calls.length,4,'unmount prevents continuation');
  assert.deepEqual(enriched,['member-one','member-two']);
});

test('repeated server cache restarts stop at the existing bound and allow an explicit retry',async t=>{
  let calls=0,restart=true;
  const ui=await statistics(t,async()=>{
    calls++;
    return Response.json(result(50,restart?1:null,{restarted:restart&&calls>1}));
  });
  await ui.render({member:257070});
  assert.equal(calls,4,'the third restart stops the automatic walk');
  assert.match(ui.container.querySelector('[role="alert"]').textContent,/Counting was interrupted/);
  assert.equal(ui.container.querySelector('[role="status"]'),null);
  restart=false;
  await act(async()=>ui.container.querySelector('button').click());
  assert.equal(calls,5);
  assert.equal(ui.container.querySelector('[role="alert"],[role="status"]'),null);
});
