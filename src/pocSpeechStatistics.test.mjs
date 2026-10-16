import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {SpeechInterventions} from '../server/speech-intervention-service.mjs';

test('the total includes ordinary and unreadable contributions and updates when all pages are counted',async t=>{
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
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);
    assert.equal(url.pathname,'/api/poc/speech-statistics/257070');
    return Response.json(await service.member('257070',Number(url.searchParams.get('page'))));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocInterventionStatistics}=await vite.ssrLoadModule('/src/PocSpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocInterventionStatistics,{member:257070})));
  const stat=label=>[...container.querySelectorAll('.intervention-stats-grid>div')].find(card=>card.querySelector('span').textContent===label)?.querySelector('strong').textContent;
  assert.equal(stat('Total contributions'),'50');
  assert.equal(stat('On behalf of a group'),'0');
  assert.equal(stat('Blue cards raised'),'—');
  assert.match(container.textContent,/50 of 69 contributions counted · Partial coverage/);
  assert.match(container.querySelector('.intervention-source').textContent,/without a group designation or readable speaker header/);
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Count all contributions').click());
  assert.equal(stat('Total contributions'),'69');
  assert.equal(stat('On behalf of a group'),'0');
  assert.equal(stat('Blue cards raised'),'—');
  assert.match(container.textContent,/69 contributions counted · Partial coverage/,'missing headers still keep classification coverage partial after every page is loaded');
  assert(![...container.querySelectorAll('button')].some(button=>button.textContent==='Count all contributions'));
});
