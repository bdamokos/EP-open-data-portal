import {installRetryClock} from './test-support/automaticRecovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const days=['2026-10-06','2026-10-07','2026-09-17'].map(date=>({id:'MTG-PL-'+date,date,phase:'past',title:'Plenary'}));
const topics=days.slice(0,2).flatMap((day,index)=>[0,1].map(n=>({id:day.id+'-ITM-'+n,sittingId:day.id,date:day.date,title:'Agenda '+index+' '+n,titleLanguage:'en',kind:'PLENARY_DEBATE',documentIds:[],procedureIds:[]})));
const stats={denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}};
function response(params) {
  const selected=topics.find(topic=>topic.id===params.get('topic'));
  return {view:'legislation',week:'2026-10-05',sitting:days[1],sittings:days,agendaSittings:days.slice(0,2),topics,coverage:{agendaComplete:false,agendaError:null},detail:selected?{
    ...selected,phase:'past',procedures:[],committeeWork:[],roles:[],speeches:[],people:[],stats,coverage:{roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}
  }:null};
}
let calendarResponse=null;
async function harness(t,width=1440,query='') {
  const window=new Window({url:'http://localhost/?view=legislation'+query}),originals=new Map(),requests=[],agendaRequests=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:width,requestAnimationFrame:callback=>{callback();return 0;},IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  let root,loadModule;
  t.mock.method(globalThis,'fetch',(input,options)=>{
    const url=new URL(input,location.href);
    // The default agenda week waits for the sitting calendar; no calendar keeps the latest week.
    if(url.pathname.endsWith('/vote-periods'))return Promise.resolve(calendarResponse?calendarResponse():Response.json({version:3,weeks:[],coverage:{status:'unavailable',years:[]}}));
    if(url.pathname.endsWith('/insights/week-results'))return Promise.resolve(Response.json({version:1,week:url.searchParams.get('week'),location:null,days:[],items:[]}));
    assert(url.pathname.endsWith('/insights/legislation'),'Unexpected request '+url);
    if(!url.searchParams.has('topic')){agendaRequests.push(url);return Promise.resolve(Response.json(response(url.searchParams)));}
    return new Promise(resolve=>requests.push({url,...options,resolve,settled:false}));
  });
  t.after(async()=>{
    if(root)await act(async()=>{root.unmount();for(const request of requests.filter(r=>!r.settled))request.resolve(Response.json(response(request.url.searchParams)));});
    t.mock.timers.reset();if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const loaderOptions={configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}};
  loadModule=await freshLoader(loaderOptions);
  const {Legislation}=await loadModule('/src/Legislation.tsx'),{createRoot}=await import('react-dom/client');
  // Module loading uses real timers; only mounted application deadlines are advanced.
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(window,'setTimeout',(callback,ms,...args)=>setTimeout(callback,ms,...args));
  t.mock.method(window,'clearTimeout',timer=>clearTimeout(timer));
  const tick=async(ms=350)=>{await act(async()=>{});await act(async()=>{t.mock.timers.tick(ms);});};
  const container=document.createElement('div');document.body.append(container);installRetryClock(t);root=createRoot(container);
  const render=language=>act(async()=>root.render(createElement(Legislation,{language,onBack(){}})));
  await render('en');
  return {agendaRequests};
}

const coverage={status:'complete',years:[]};
for(const [name,calendar,expected] of [
  ['opens on the next sitting week when none is current',()=>Response.json({version:4,weeks:[{week:'2026-10-05',sittings:[{sittingId:'MTG-PL-2026-10-07',date:'2026-10-07'}]}],upcoming:[{week:'2099-01-05',sittings:[{sittingId:'MTG-PL-2099-01-07',date:'2099-01-07'}]}],coverage}),'2099-01-05'],
  ['keeps the latest week when the calendar fails',()=>Response.json({error:{message:'down'}},{status:503}),'latest'],
  ['keeps the latest week when the calendar is malformed',()=>Response.json({version:4,weeks:[{week:'bad',sittings:[]}],upcoming:[],coverage}),'latest'],
])test('the default agenda week '+name,async t=>{
  calendarResponse=calendar;t.after(()=>{calendarResponse=null;});
  const h=await harness(t,1440,'');
  assert.deepEqual(h.agendaRequests.map(url=>url.searchParams.get('week')),[expected]);
});

