import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('dossier press releases keep exact links and English titles without a coverage disclaimer',async t=>{
  const window=new Window({url:'http://localhost/?view=legislation'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const reference='2026/0211(COD)',empty='2025/0407(COD)',failing='2024/0001(COD)';
  const coverage={complete:false,followingSince:'2026-10-20T22:30:00.000Z',feeds:[],procedureLinks:{status:'unavailable',source:null},pendingReleases:0,unreadableReleases:0,unlistedReleases:1};
  const item=(id,title,publishedAt)=>({id,url:`https://www.europarl.europa.eu/news/en/press-room/${id}/`,title,titleLanguage:'en',publishedAt,committees:[],links:[{kind:'procedure',value:reference,label:'Procedure file'}],fetchedAt:'2026-10-20T12:00:00.000Z'});
  const items=[
    item('20261016IPR48237','ETS: MEPs want extra free allowances','2026-10-19T17:08:00.000Z'),
    item('20261015IPR48200','Second release','2026-10-15T13:18:00.000Z'),
    item('20261012IPR48100','Third release','2026-10-12T08:00:00.000Z'),
    item('20261011IPR48090','Fourth release','2026-10-11T08:00:00.000Z'),
  ];
  const requested=[];let answerSummary,failures=0;
  const pendingSummary=new Promise(resolve=>{answerSummary=resolve;});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href),ref=url.searchParams.get('reference');
    if(url.pathname.endsWith('/insights/procedure-progress'))return Response.json({reference:ref,state:'unmapped',events:[],coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{fetchedAt:'2026-10-20T10:00:00Z',stale:false,refreshInProgress:false,refreshError:null}});
    const summary=()=>Response.json({reference:ref,title:'Free allocation',language:'en',summaries:[],summary:null,subjects:[],topics:[],source:{url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference='+ref}});
    if(url.pathname.endsWith('/insights/procedure-context'))return ref===reference&&!requested.includes('summary-answered')?pendingSummary.then(summary):summary();
    if(url.pathname.endsWith('/insights/press-releases')){requested.push(ref);if(ref===failing&&!failures++)return Response.json({error:{message:'Press releases unavailable.'}},{status:500});return Response.json({view:'press-releases',reference:ref,items:ref===reference?items:[],total:ref===reference?6:0,coverage});}
    throw new Error('Unexpected request '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ProcedureContext}=await vite.ssrLoadModule('/src/ProcedureContext.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(ProcedureContext,{reference,language:'fr'})));
  assert.match(container.textContent,/Loading summary/);
  const section=container.querySelector('.press-mentions');
  assert(section,'press releases load independently of the summary');
  await act(async()=>{requested.push('summary-answered');answerSummary();});
  assert.doesNotMatch(container.textContent,/Loading summary/);
  assert.equal(container.querySelector('.press-mentions'),section,'the list stays mounted when the summary arrives');
  assert.equal(section.getAttribute('lang'),'en');
  assert.equal(section.querySelector('h4').textContent,'Parliament press releases · latest 3 of 6');
  const links=[...section.querySelectorAll('li a')];
  assert.deepEqual(links.map(link=>link.getAttribute('href')),items.slice(0,3).map(entry=>entry.url),'agenda items show at most three');
  assert(links.every(link=>link.target==='_blank'&&link.rel==='noreferrer'));
  assert.equal(links[0].querySelector('span').getAttribute('lang'),'en','titles stay English inside any interface language');
  const details=[...section.querySelectorAll('li small')];
  assert.deepEqual(details.map(detail=>detail.textContent),['19 oct. 2026','15 oct. 2026','12 oct. 2026']);
  assert.equal(details[0].querySelector('time').getAttribute('lang'),'fr');
  assert.equal(section.querySelector('.press-mentions-scope'),null);
  await act(async()=>root.render(createElement(ProcedureContext,{reference,language:'fr',showTitle:true})));
  assert.equal(container.querySelectorAll('.press-mentions li').length,4,'the dossier view shows up to five');
  await act(async()=>root.render(createElement(ProcedureContext,{reference:empty,language:'fr'})));
  assert.deepEqual(requested.at(-1),empty);
  assert.equal(container.querySelector('.press-mentions'),null,'no found items render nothing, not a zero');
  assert.doesNotMatch(container.textContent,/temporarily unavailable/);
  await act(async()=>root.render(createElement(ProcedureContext,{reference:failing,language:'fr'})));
  assert.match(container.textContent,/Parliament press releases are temporarily unavailable\. Try again/,'a failed read is not shown as an empty result');
  const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='Try again');
  await act(async()=>retry.click());
  assert.doesNotMatch(container.textContent,/temporarily unavailable/);
  assert.equal(requested.filter(ref=>ref===failing).length,2);
});
