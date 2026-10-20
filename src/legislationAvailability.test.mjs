import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('agenda availability distinguishes scheduled items, waits, gaps, source errors and filters',async t=>{
  t.mock.method(Date,'now',()=>Date.parse('2026-10-20T00:30:00Z'));
  const window=new Window({url:'http://localhost/?view=legislation'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,requestAnimationFrame:callback=>{callback();return 0;},innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  let recover=false;
  const dates={future:'2026-10-21',today:'2026-10-20',recent:'2026-10-19',old:'2026-10-07',error:'2026-10-20',filter:'2026-10-20'};
  const topics=Object.entries(dates).flatMap(([state,date])=>['debate','vote'].map(kind=>({id:state+'-'+kind,title:state+' '+kind,date,kind:kind==='vote'?'PLENARY_VOTE':'PLENARY_DEBATE',documentIds:[],procedureIds:[]})));
  function response(params) {
    const item=topics.find(item=>item.id===params.get('topic'));
    const empty={uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,denominator:0,referenceDate:item?.date,dimensions:{country:[],group:[],gender:[],age:[]}};
    const failure=item?.id.startsWith('error')&&!recover;
    const person={id:'1',name:'Speaker',country:'BE',currentMep:false};
    return {sitting:{id:'MTG-PL-2026-10-20',phase:'past',date:'2026-10-20'},sittings:[{id:'MTG-PL-2026-10-20',phase:'past',date:'2026-10-20'}],topics,coverage:{agendaError:null},detail:item?{...item,phase:'past',procedures:[],committeeWork:[],roles:[],people:[],stats:empty,speeches:item.id==='filter-debate'?[{sourceId:'test-speech',date:item.date,kind:'PLENARY_DEBATE_SPEECH',start:null,people:[person]}]:[],votes:[],selectedVote:null,voteCoverage:{error:failure?'timeout':null,truncated:false},coverage:{roleRowsTruncated:false,gaps:failure?[{source:'actual debate event',message:'timeout'}]:[],speechAssociations:{sources:[],truncated:false}}}:null};
  }
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    assert(url.pathname.endsWith('/insights/legislation'),'Unexpected request: '+url);
    return Response.json(response(url.searchParams));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null,ws:false},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Legislation}=await vite.ssrLoadModule('/src/Legislation.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);
  async function show(id,extra='') {
    if(root)await act(async()=>root.unmount());
    window.history.replaceState({},'',`/?view=legislation&pl-sitting=MTG-PL-2026-10-20&agenda-topic=${id}${extra}`);
    root=createRoot(container);
    await act(async()=>root.render(createElement(Legislation,{language:'en',onBack(){}})));
    assert(container.querySelector('.insight-topic-detail h2')?.textContent.includes(id.replace('-',' ')));
    return container.querySelector('.insight-topic-detail').textContent;
  }
  for(const kind of ['debate','vote']) {
    assert.match(await show('future-'+kind),/is in the future/);
    assert.equal(container.querySelector('[role="alert"]'),null);
    assert.match(await show('today-'+kind),/scheduled today/);
    assert.equal(container.querySelector('[role="alert"]'),null);
    assert.match(await show('recent-'+kind),/not available here yet/);
    assert.match(await show('old-'+kind),/coverage or .* links may be incomplete/i);
    assert.match(await show('error-'+kind),/could not be loaded/);
    assert(container.querySelector('[role="alert"]'));
  }
  recover=true;
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Try again').click());
  assert.equal(container.querySelector('[role="alert"]'),null);
  assert.match(container.querySelector('.insight-topic-detail').textContent,/scheduled today/);
  assert.match(await show('filter-debate','&agenda-country=HU'),/No listed speeches match this country filter/);
  assert(!container.querySelector('.insight-topic-detail').textContent.includes('Allow a few days'));
  const before=calls.length;
  await show('future-vote','&agenda-vote=stale-vote');
  assert(calls.slice(before).every(url=>!url.searchParams.has('vote')),'Do not request an unheld named vote');
});
