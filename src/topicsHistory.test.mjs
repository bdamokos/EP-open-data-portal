import {automaticRecovery,installRetryClock} from './test-support/automaticRecovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createElement,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';

test('Back restores the quarter, page offset and every previously loaded group',async t=>{
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A1.10&t-q=2026-Q1'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/topics/story-facts')return Response.json({ready:false});assert.equal(u.pathname,'/api/topics/detail');calls.push(u);const offset=Number(u.searchParams.get('offset')||0),q2=u.searchParams.get('from')==='2026-04-01',groups=Array.from({length:20},(_,i)=>({key:`MTG-PL-2026-01-01-PVCRE-ITM-${q2?101+i:offset+i+1}`,kind:'debate',title:`${q2?'Second quarter':'First quarter'} group ${offset+i+1}`,date:'2026-01-01',items:[],speechCount:0,speakers:[]}));return Response.json({ready:true,concept:{key:'oeil:1.10',label:'Trade',role:'topic'},periods:['2026-Q1','2026-Q2'],partial:{first:null,last:null},series:[{period:'2026-Q1',groups:40,speech:0,question:0,document:0},{period:'2026-Q2',groups:20,speech:0,question:0,document:0}],groupsTotal:q2?20:40,total:q2?20:40,facets:{keywords:[],places:[],topics:[]},groups,nextOffset:!q2&&offset===0?20:null});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelectorAll('.topic-record-group').length===20);await act(async()=>[...node.querySelectorAll('#topic-records button')].find(b=>b.textContent==='More').click());await wait(()=>node.querySelectorAll('.topic-record-group').length===40);const paged=location.href;assert.equal(new URL(paged).searchParams.get('t-offset'),'20');
 await act(async()=>node.querySelector('.topic-bars button[aria-label^="2026 Q2"]').click());await wait(()=>node.textContent.includes('Second quarter group 1'));assert.equal(new URL(location.href).searchParams.get('t-offset'),null);
 await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});await wait(()=>node.querySelectorAll('.topic-record-group').length===40);assert.equal(location.href,paged);assert(node.textContent.includes('First quarter group 1'));assert(node.textContent.includes('First quarter group 40'));assert.equal(new URL(location.href).searchParams.get('t-q'),'2026-Q1');assert(calls.some(u=>u.searchParams.get('offset')==='20'));
});

test('invalid quarter falls back, tied peaks stay visible and keyword chips retain ten choices',async t=>{
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A1.10&t-q=bad'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});

 const detail={ready:true,concept:{key:'oeil:1.10',label:'Trade',role:'topic'},periods:['2026-Q1','2026-Q2'],partial:{first:null,last:null},series:['2026-Q1','2026-Q2'].map(period=>({period,groups:1,speech:0,question:0,document:0,top:{key:'MTG-PL-'+period,title:'1. Trade (debate)'}})),groupsTotal:2,total:2,facets:{keywords:[{key:'oeil:1.10',label:'Trade',n:2},...Array.from({length:11},(_,i)=>({key:'eurovoc:'+i,label:'Keyword '+i,n:1}))],places:[],topics:[]},groups:[],nextOffset:null};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);return Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:detail);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelectorAll('.topic-peak').length===2);await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q2');assert(!node.textContent.includes('Unavailable'));assert.equal(node.querySelectorAll('.topic-facets a').length,10);assert(!node.querySelector('.topic-peak').textContent.includes('(debate)'));assert(node.querySelector('.topic-bars button').getAttribute('aria-label').includes('1 debate or dossier'));assert(!node.querySelector('.topic-bars button').getAttribute('aria-label').includes('1 debates'));
 const chip=node.querySelector('.topic-facets a');assert.equal(chip.getAttribute('aria-pressed'),'false');await act(async()=>chip.click());await wait(()=>node.querySelector('.topic-facets a').getAttribute('aria-pressed')==='true');assert.equal(new URL(location.href).searchParams.get('t-kw'),'eurovoc:0');
});

test('Places shows months in the title, steps with the stepper and slider, and has no Play control',async t=>{
 const window=new Window({url:'http://localhost/?view=geopolitics&t-q=2025-Q2'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const timers=[],originalTimeout=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{if(ms>=7000&&ms<=16000)timers.push(ms);return originalTimeout(fn,ms,...args);});
 const data={ready:true,periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{first:null,last:'2025-08-01'},items:[{key:'place:IRN',id:'IRN',iso3:'IRN',label:'Iran',series:[{period:'2025-Q2',question:10},{period:'2025-Q3',question:12}]}]};t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);return Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:data);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>originalTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelector('.places-map'));
 const title=()=>node.querySelector('.places-quarter').textContent;
 assert.match(title(),/^April\s*[–-]\s*June 2025$/,'the title names the months');assert.equal(node.querySelector('.places-scrubber input').getAttribute('aria-valuetext'),title());
 assert.equal(node.querySelector('.places-play'),null,'no Play control');assert(![...node.querySelectorAll('button')].some(b=>/Play|Pause/.test(b.textContent)));
 assert.deepEqual([...node.querySelectorAll('.places-ends span')].map(s=>s.textContent),['2025 Q1','2025 Q3 so far'],'compact labels at the slider ends');
 await act(async()=>node.querySelector('.places-scrubber button:last-of-type').click());await wait(()=>/July/.test(title()));
 assert.match(title(),/^July\s*[–-]\s*September 2025 so far$/,'a partial quarter reads "so far"');assert.equal(new URL(location.href).searchParams.get('t-q'),'2025-Q3','URLs keep the quarter');
 assert(!(await import('node:fs/promises').then(fs=>fs.readFile(new URL('./Topics.tsx',import.meta.url),'utf8'))).includes('dwell'),'no dwell timer');
});

test('place uses one detail response, not-home records and all metric peak ties',async t=>{
 const window=new Window({url:'http://localhost/?view=geopolitics&place=GRC&t-own=1&t-kind=question'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});

 const calls=[],series=[{period:'2026-Q1',question:3,questionHome:2,questionElsewhere:0,questionUnknown:1,document:2,groups:3,speech:0}],peaks={document:[{period:'2026-Q1',n:2,groups:['First','Second'].map((title,i)=>({key:'2026-000'+i,kind:'procedure',title:'REPORT on '+title,language:'en',date:'2026-01-01',n:1}))}]};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/topics/story-facts')return Response.json({ready:false});if(u.pathname==='/api/insights/record-topics')return Response.json({ready:true,records:[]});assert.equal(u.pathname,'/api/topics/detail');calls.push(u);assert.equal(u.searchParams.get('askers'),'not-home');return Response.json({ready:true,concept:{key:'place:GRC',label:'Greece',iso3:'GRC'},periods:['2026-Q1'],partial:{first:null,last:null},series:[{...series[0],question:1}],chart:{periods:['2026-Q1'],series,peaks,total:5,groupsTotal:3},groupsTotal:1,total:1,groups:[{key:'unknown-question',title:'Unknown origin question',date:'2026-01-01',kind:'record',items:[],speechCount:0}],facets:{keywords:[],places:[],topics:[]},nextOffset:null});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelectorAll('.topic-peak').length===2);assert.equal(calls.length,1);assert(node.textContent.includes('Unknown origin question'));assert(!node.textContent.includes('Unavailable'));assert.deepEqual([...node.querySelectorAll('.topic-peak i')].map(i=>i.textContent),['First','Second']);
 // Not-home is elsewhere plus unknown even though the series carries only the parts.
 assert.match(node.querySelector('.topic-chart .topic-bars button').getAttribute('aria-label'),/\b1 question\b/);
});

test('coverage counts read plus unavailable and clears when collected',async t=>{
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=topics'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});

 let read=4;t.mock.method(globalThis,'fetch',async()=>Response.json({ready:true,items:[],periods:[],partial:{},coverage:{read,unavailable:1,referenced:9}}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.textContent.includes('Policy areas collected for 5 of 9 dossiers'));read=8;await act(async()=>root.render(createElement(Topics,{language:'fr'})));await wait(()=>node.querySelector('.topic-heat')&&!node.textContent.includes('Policy areas collected'));
});

test('filter changes keep the page and chart on screen while records load',async t=>{
 const window=new Window({url:'http://localhost/?view=geopolitics&place=GRC&t-own=1'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load,release;t.after(async()=>{release?.();if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const series=[{period:'2026-Q1',question:3,questionHome:1,questionElsewhere:1,questionUnknown:1,document:2,groups:3,speech:0}],gate=new Promise(r=>{release=r;});
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname!=='/api/topics/detail')return Response.json({ready:false});if(u.searchParams.get('kind')==='document')await gate;return Response.json({ready:true,concept:{key:'place:GRC',label:'Greece',iso3:'GRC'},periods:['2026-Q1'],partial:{first:null,last:null},series,chart:{periods:['2026-Q1'],series,peaks:{},total:5,groupsTotal:3},groupsTotal:1,total:1,groups:[{key:'g-'+(u.searchParams.get('kind')||'all'),title:'Group '+(u.searchParams.get('kind')||'all'),date:'2026-01-01',kind:'record',items:[],speechCount:0}],facets:{keywords:[],places:[],topics:[]},nextOffset:null});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.textContent.includes('Group all'));
 const heading=node.querySelector('h1');heading.blur();const select=node.querySelector('.topic-kind select');select.focus();
 await act(async()=>{select.value='document';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await act(async()=>new Promise(r=>setTimeout(r,60)));
 assert.equal(node.querySelector('h1')?.textContent,'Greece');assert(node.querySelector('.topic-chart'));assert.notEqual(document.activeElement,node.querySelector('h1'));
 release();await wait(()=>node.textContent.includes('Group document'));assert.notEqual(document.activeElement,node.querySelector('h1'));
});

test('heat strip sorts by the term, the last full quarter or the current quarter so far, with full row labels',async t=>{
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=topics'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const long='Relations with/in the context of international organisations: UN, OSCE, OECD, Council of Europe, EBRD',row=(key,label,q3,q4,total)=>({key,label,groupsTotal:total,series:[{period:'2026-Q3',groups:q3},{period:'2026-Q4',groups:q4}]});
 t.mock.method(globalThis,'fetch',async input=>Response.json({ready:true,periods:['2026-Q3','2026-Q4'],partial:new URL(String(input),location.href).searchParams.get('lang')==='fr'?{first:null,last:null}:{first:null,last:'2026-10-29'},items:[row('oeil:a','Term leader',1,0,30),row('oeil:b','Full quarter leader',9,1,10),row('oeil:c',long,2,5,7)]}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 const labels=()=>[...node.querySelectorAll('.topic-heat tbody th a')].map(a=>a.textContent),options=()=>[...node.querySelectorAll('.topic-sort button')].map(b=>b.textContent),press=async text=>act(async()=>[...node.querySelectorAll('.topic-sort button')].find(b=>b.textContent===text).click());
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelector('.topic-heat'));
 assert.equal(node.querySelector('.topic-sort [role=group]').getAttribute('aria-labelledby'),node.querySelector('.topic-sort > span').id);
 assert.deepEqual(options(),['This term','2026 Q3','2026 Q4 so far']);assert.deepEqual(labels(),['Term leader','Full quarter leader',long]);assert.equal(node.querySelector('.topic-heat th[aria-sort]'),null);
 const link=node.querySelector('.topic-heat tbody tr:last-child th a');assert.equal(link.getAttribute('title'),null);assert.equal(link.textContent,long);
 await press('2026 Q4 so far');await wait(()=>labels()[0]===long);assert.equal(new URL(location.href).searchParams.get('t-sort'),'current');assert.match(node.querySelector('.topic-heat th[aria-sort=descending]').textContent,/2026 Q4/);
 await press('2026 Q3');await wait(()=>labels()[0]==='Full quarter leader');assert.equal(new URL(location.href).searchParams.get('t-sort'),'last');assert.match(node.querySelector('.topic-heat th[aria-sort=descending]').textContent,/2026 Q3/);
 // Once the latest quarter is complete it is the last full quarter, and a saved current-quarter sort follows it.
 await press('2026 Q4 so far');await act(async()=>root.render(createElement(Topics,{language:'fr'})));await wait(()=>options().length===2);assert.equal(new URL(location.href).searchParams.get('t-sort'),'current');assert.deepEqual(options(),['This term','2026 Q4']);assert.equal(node.querySelector('.topic-sort button[aria-pressed=true]').textContent,'2026 Q4');assert.equal(labels()[0],long);
});

test('places put the time control, map and story first and the ranked list and finder after',async t=>{
 const window=new Window({url:'http://localhost/?view=geopolitics'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const data={ready:true,periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{first:null,last:'2025-07-01'},items:[{key:'place:IRN',id:'IRN',iso3:'IRN',label:'Iran',series:[{period:'2025-Q2',question:10},{period:'2025-Q3',question:12}]}]};t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);return u.pathname==='/api/topics/story-facts'?Response.json({ready:false}):Response.json(data);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelector('.places-map'));
 const order=[...node.querySelectorAll('.topic-time,.places-map,.places-caption,.places-ranking,.topic-finder')].map(e=>e.className.split(' ')[0]);
 assert.deepEqual(order,['topic-time','places-map','places-caption','places-ranking','topic-finder']);
 assert(node.querySelector('.places-stage .topic-time + .places-map'),'the map follows its time control directly');
 assert.equal(node.querySelectorAll('.topic-finder').length,1);assert(node.querySelector('.places-side .topic-finder'));
 assert.match(node.querySelector('.places-quarter').textContent,/^April\s*[–-]\s*June 2025$/);assert.equal(node.querySelector('.places-quarter').getAttribute('aria-live'),'polite');
 const slider=node.querySelector('.places-scrubber input[type=range]');assert.equal(slider.getAttribute('aria-label'),'Quarter');assert.equal(slider.getAttribute('aria-valuetext'),node.querySelector('.places-quarter').textContent);
 assert.deepEqual([...node.querySelectorAll('.places-ends span')].map(s=>s.textContent),['2025 Q1','2025 Q3 so far']);
 await act(async()=>node.querySelector('.places-scrubber button[aria-label="Next quarter"]').click());await wait(()=>/^July\s*[–-]\s*September 2025 so far$/.test(node.querySelector('.places-quarter').textContent));assert.equal(new URL(location.href).searchParams.get('t-q'),'2025-Q3');
});

test('voting-time groups without exact targets stay unlinked and never captioned as debates',async t=>{
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A1.10&t-q=2026-Q1'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const vote='MTG-PL-2026-01-20-PVCRE-ITM-7-2',debate='MTG-PL-2026-01-21-PVCRE-ITM-9';
 const detail={ready:true,concept:{key:'oeil:1.10',label:'Trade',role:'topic'},periods:['2026-Q1','2026-Q2'],partial:{first:null,last:null},series:[{period:'2026-Q1',groups:2,speech:8,question:0,document:0,debate:1,top:{key:vote,title:'Support for Ukraine (vote)',kind:'record'}},{period:'2026-Q2',groups:0,speech:0,question:0,document:0,debate:0}],
  peaks:{groups:[{period:'2026-Q1',n:2,groups:[{key:'MTG-PL-2026-01-22-PVCRE-ITM-3',kind:'debate',title:null,language:null,date:'2026-01-22',n:5},{key:vote,kind:'record',title:'Support for Ukraine (vote)',language:'en',date:'2026-01-20',n:5},{key:debate,kind:'debate',title:'Support for Ukraine (debate)',language:'en',date:'2026-01-21',n:5}]}]},
  groupsTotal:2,total:2,facets:{keywords:[],places:[],topics:[]},groups:[{key:'MTG-PL-2026-01-22-PVCRE-ITM-3',kind:'debate',agendaId:'MTG-PL-2026-01-22-PVCRE-ITM-3',title:null,titleLanguage:null,date:'2026-01-22',items:[],speechCount:2,speakers:[]},{key:vote,kind:'record',title:'Support for Ukraine (vote)',date:'2026-01-20',items:[],speechCount:5,speakers:[]},{key:debate,kind:'debate',agendaId:debate,title:'Support for Ukraine (debate)',date:'2026-01-21',items:[],speechCount:3,speakers:[]}],nextOffset:null};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);return Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:detail);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 await act(async()=>root.render(createElement(Topics,{language:'en'})));await wait(()=>node.querySelectorAll('.topic-record-group').length===3);
 assert.match(node.querySelector('#topic-records h2').textContent,/January\s*[–-]\s*March 2026/,'the records meta line names months');
 const untitled=[...node.querySelectorAll('.topic-record-group')].find(g=>g.textContent.includes('Untitled item'));assert(untitled,'a group without a held title reads "Untitled item"');assert(!node.textContent.includes('MTG-PL-2026-01-22-PVCRE-ITM-3'),'the raw ID is never shown as a title');assert(untitled.querySelector('a').getAttribute('href').includes('MTG-PL-2026-01-22-PVCRE-ITM-3'),'the ID stays in the link');
 const links=[...node.querySelectorAll('.topic-record-group a')].map(a=>a.getAttribute('href'));
 const voteLink=links.find(h=>h&&h.includes(encodeURIComponent(vote))||h&&h.includes(vote));assert(!voteLink,'an unresolved voting-time parent must not have an agenda link');assert(!links.includes('#topic-records'));
 const captions=[...node.querySelectorAll('.topic-peak')].map(b=>b.textContent);
 assert(captions.some(c=>c.includes('Support for Ukraine')),'the real debate keeps its peak caption'); assert(!captions.some(c=>/Untitled|MTG-PL-2026-01-22/.test(c)),'an untitled peak group gets no caption');assert(!captions.some(c=>c.includes('(vote)')),'no caption names the voting-time item: '+captions.join(' | '));assert.equal(captions.length,1);
});

async function placesHarness(t,url,respond,{language='en',setup}={}){
 const window=new Window({url}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 setup?.(window);
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async input=>respond(new URL(String(input),location.href)));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<80&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 let view=createElement(Topics,{language});
 if(language!=='en'){const {UiI18nProvider}=await load('/src/UiI18nReact.tsx'),{createAppUiI18n}=await import('./uiCatalogues.mjs'),locale=(await import('./ui-locales/'+language+'.json',{with:{type:'json'}})).default;view=createElement(UiI18nProvider,{i18n:createAppUiI18n({[language]:locale}),language},view);}
 await act(async()=>root.render(view));return {node,wait};
}
const placesData=(sittingQ4,label='Iran')=>({ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{first:null,last:'2026-11-02'},sittingDays:{'2026-Q2':12,'2026-Q3':8,'2026-Q4':sittingQ4},items:[{key:'place:IRN',id:'IRN',iso3:'IRN',label,series:[{period:'2026-Q2',question:5},{period:'2026-Q3',question:6},{period:'2026-Q4',question:2}]}]});
test('Geopolitics opens on the map',async t=>{
 const overview=[];const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics',u=>{if(u.pathname==='/api/topics/overview')overview.push(u.searchParams.get('role'));return Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:placesData(3));});
 await wait(()=>node.querySelector('.places-map'));assert.equal(overview[0],'place');assert.equal(node.querySelector('.parliament-header [aria-current=page]').textContent,'Geopolitics');assert.equal(node.querySelector('.topic-tabs'),null);
});
test('Plenary Topics mode opens the heat strip',async t=>{
 const {node,wait}=await placesHarness(t,'http://localhost/?view=legislation&pl-mode=topics',u=>Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:{...placesData(3),items:[]}));
 await wait(()=>node.querySelector('.topic-heat'));assert.equal(node.querySelector('.parliament-header [aria-current=page]').textContent,'Plenary agenda');assert.equal(node.querySelector('h1').textContent,'Topics');assert.equal(node.querySelector('.places-map'),null);
});
for(const [name,sittings,url,expected] of [['the current quarter once its first plenary has happened',3,'',/^October\s*[–-]\s*December 2026 so far$/],['the last quarter with plenary data before the current quarter\'s first sitting',0,'',/^July\s*[–-]\s*September 2026$/],['an explicit t-q',3,'&t-q=2026-Q2',/^April\s*[–-]\s*June 2026$/]])test('the map defaults to '+name,async t=>{
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics'+url,u=>Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:placesData(sittings)));
 await wait(()=>node.querySelector('.places-quarter'));assert.match(node.querySelector('.places-quarter').textContent,expected);
});
test('leaving out own-country questions refreshes inline: content stays, no loading state, focus stays',async t=>{
 let release;const pending=new Promise(r=>release=r);
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics',async u=>{if(u.pathname==='/api/topics/story-facts')return Response.json({ready:false});if(u.searchParams.get('askers')==='all'){await pending;const data=placesData(3);data.items[0].series.at(-1).question=9;return Response.json(data);}return Response.json(placesData(3));});
 await wait(()=>node.querySelector('.places-ranking')?.textContent.includes('Iran'));
 const box=node.querySelector('.topic-controls input[type=checkbox]');box.focus();await act(async()=>box.click());
 await act(async()=>new Promise(r=>setTimeout(r,60)));
 assert(node.querySelector('.places-map'),'the map stays');assert(node.querySelector('.places-ranking').textContent.includes('Iran'),'the list stays');assert(node.querySelector('.places-quarter'),'the time control stays');
 assert(!/Loading/.test(node.textContent),'no loading state');assert.equal(node.querySelector('.topics-content').getAttribute('data-topics-pending'),null);
 assert.equal(document.activeElement,node.querySelector('.topic-controls input[type=checkbox]'),'focus stays on the checkbox');
 release();await wait(()=>node.querySelector('.places-ranking strong')?.textContent==='9');
});
test('map, list, story and story links swap together once the requested story facts arrive',async t=>{
 let release;const pending=new Promise(r=>release=r);const period='2026-Q3';
 const overview={ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{first:null,last:'2026-11-02'},sittingDays:{'2026-Q2':12,'2026-Q3':8,'2026-Q4':3},items:[{key:'place:TUR',id:'TUR',iso3:'TUR',label:'Türkiye',series:[{period,question:13,document:1}]},{key:'place:IRN',id:'IRN',iso3:'IRN',label:'Iran',series:[{period,question:4,document:9}]}]};
 const facts=(mode)=>({ready:true,periods:overview.periods,partial:{},counts:{},periodCounts:[{period,placesWithAdoptedTexts:2}],winners:{},sets:{},questions:[],debates:[],docs:[],series:{},periodWinners:{[period]:mode==='d'?{topAdoptedPlaces:[{id:'IRN',count:9},{id:'TUR',count:1}]}:{mostQuestionedPlaces:[{id:'TUR',count:13}]}}});
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&t-q='+period,async u=>{if(u.pathname==='/api/topics/story-facts'){if(u.searchParams.get('mode')==='d'){await pending;return Response.json(facts('d'));}return Response.json(facts('q'));}return Response.json(overview);});
 const story=()=>node.querySelector('.places-caption').textContent,first=()=>node.querySelector('.places-ranking li').textContent;
 await wait(()=>/drew the most questions/.test(story()));const link=()=>[...node.querySelectorAll('.places-caption a')].find(a=>/^13$/.test(a.textContent));assert.equal(new URL(link().getAttribute('href'),location.href).searchParams.get('t-mode'),'q');
 const texts=[...node.querySelectorAll('.insight-chart-switch button')].find(b=>/Texts on/.test(b.textContent));await act(async()=>texts.click());
 await act(async()=>new Promise(r=>setTimeout(r,60)));
 assert.equal(texts.getAttribute('aria-pressed'),'true','the control shows the requested choice');
 assert.match(first(),/Türkiye\s*13/,'the list keeps the displayed questions');assert.match(story(),/Türkiye drew the most questions/,'the story keeps the displayed questions');
 assert.equal(new URL(link().getAttribute('href'),location.href).searchParams.get('t-mode'),'q','retained story links keep the displayed selection');
 release();await wait(()=>/adopted texts naming/.test(story()));
 assert.match(first(),/Iran\s*9/,'the list switches with the story');assert(!/drew the most questions/.test(story()));
});
test('a standalone story keeps its links on the displayed selection while new facts load',async t=>{
 const window=new Window({url:'http://localhost/?view=geopolitics&place=TUR&t-q=2026-Q3'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 let release;const pending=new Promise(r=>release=r),period='2026-Q3';
 const facts={ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{},counts:{},periodCounts:[{period}],winners:{},sets:{},questions:[],debates:[],docs:[],series:{},periodWinners:{[period]:{mostQuestionedPlaces:[{id:'TUR',count:13}]}}};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.searchParams.get('askers')==='all'){await pending;}return Response.json(facts);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});const {TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async predicate=>{for(let i=0;i<80&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 const selection=excludeOwn=>({periods:facts.periods,partial:[],period,zoom:'world',mode:'q',excludeOwn,labels:{TUR:'Türkiye'}});
 await act(async()=>root.render(createElement(TopicStories,{selection:selection(true)})));
 const own=()=>new URL([...node.querySelectorAll('a')].find(a=>/^13$/.test(a.textContent)).getAttribute('href'),location.href).searchParams.get('t-own');
 await wait(()=>/drew the most questions \(13\)/.test(node.textContent));assert.equal(own(),'1');
 await act(async()=>root.render(createElement(TopicStories,{selection:selection(false)})));await act(async()=>new Promise(r=>setTimeout(r,60)));
 assert.equal(own(),'1','links keep the displayed selection until the new facts arrive');
 release();await wait(()=>own()==='0');
});

const swapData=period=>({overview:{ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{first:null,last:'2026-11-02'},sittingDays:{'2026-Q2':12,'2026-Q3':8,'2026-Q4':3},items:[{key:'place:TUR',id:'TUR',iso3:'TUR',label:'Türkiye',series:[{period,question:13,document:1}]},{key:'place:FRA',id:'FRA',iso3:'FRA',label:'France',series:[{period,question:4,document:9}]}]},
 facts:mode=>({ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{},counts:{},periodCounts:[{period,placesWithAdoptedTexts:2}],winners:{},sets:{},questions:[],debates:[],docs:[],series:{},periodWinners:{[period]:mode==='d'?{topAdoptedPlaces:[{id:'FRA',count:9},{id:'TUR',count:1}]}:{mostQuestionedPlaces:[{id:'TUR',count:13}]}}})});
test('in French the swap and the story share one story-facts request',async t=>{
 const period='2026-Q3',{overview,facts}=swapData(period),seen=[];
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&t-q='+period,async u=>{if(u.pathname==='/api/topics/story-facts'){seen.push(u.searchParams.get('mode')+':'+u.searchParams.get('lang'));return Response.json(facts(u.searchParams.get('mode')));}return Response.json(overview);},{language:'fr'});
 await wait(()=>node.querySelector('.places-ranking'));
 const texts=node.querySelectorAll('.insight-chart-switch button')[1];await act(async()=>texts.click());await wait(()=>/France\s*9/.test(node.querySelector('.places-ranking li').textContent));
 assert(seen.length&&seen.every(k=>k.endsWith(':fr')),'every story-facts request uses the interface language: '+seen.join(' '));assert.equal(seen.filter(k=>k.startsWith('d:')).length,1,'one request for the new selection');
});
test('a failed story-facts request keeps the displayed view and offers Retry',async t=>{
 const period='2026-Q3',{overview,facts}=swapData(period);let fail=true;
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&t-q='+period,async u=>{if(u.pathname==='/api/topics/story-facts'){if(u.searchParams.get('mode')==='d'&&fail)return Response.json({error:{message:'Story facts unavailable'}},{status:500});return Response.json(facts(u.searchParams.get('mode')));}return Response.json(overview);});
 await wait(()=>/drew the most questions/.test(node.querySelector('.places-caption').textContent));
 const texts=[...node.querySelectorAll('.insight-chart-switch button')].find(b=>/Texts on/.test(b.textContent));await act(async()=>texts.click());
 await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));assert.equal([...node.querySelectorAll('button')].some(b=>/Reload|Retry|Try again/i.test(b.textContent)),false);
 assert.match(node.querySelector('.places-ranking li').textContent,/Türkiye\s*13/,'the map and list are not switched on failure');assert.match(node.querySelector('.places-caption').textContent,/drew the most questions/);
 fail=false;await automaticRecovery(t);
 await wait(()=>/France\s*9/.test(node.querySelector('.places-ranking li').textContent));assert(/adopted texts naming/.test(node.querySelector('.places-caption').textContent));
});
// Russia 50, Ukraine 20: the Europe list follows the projection the story was built from.
const europeSwitch=(published)=>{const period='2026-Q3',overview={ready:true,periods:['2026-Q2','2026-Q3','2026-Q4'],partial:{first:null,last:'2026-11-02'},sittingDays:{'2026-Q2':12,'2026-Q3':8,'2026-Q4':3},items:[{key:'place:RUS',id:'RUS',iso3:'RUS',label:'Russia',series:[{period,question:50}]},{key:'place:UKR',id:'UKR',iso3:'UKR',label:'Ukraine',series:[{period,question:20}]}]};
 return {period,overview,facts:{ready:true,europe:published,periods:overview.periods,partial:{},counts:{},periodCounts:[{period}],winners:{},sets:{},questions:[],debates:[],docs:[],series:{},periodWinners:{[period]:{mostQuestionedPlaces:published.includes('RUS')?[{id:'RUS',count:50}]:[{id:'UKR',count:20}]}}}};};
for(const [name,version] of [['before',13],['after',14]])test(`Europe list and story agree ${name} the version 14 projection publishes`,async t=>{
 const {europeBeforeV14}=await import('../server/story-europe.mjs'),{default:europe}=await import('../server/story-europe-countries.json',{with:{type:'json'}});
 const {period,overview,facts}=europeSwitch(version===13?[...europeBeforeV14]:europe.ids);
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&t-zoom=eu&t-q='+period,async u=>Response.json(u.pathname==='/api/topics/story-facts'?facts:overview));
 const story=()=>node.querySelector('.places-caption').textContent,list=()=>[...node.querySelectorAll('.places-ranking li')].map(li=>li.textContent.replace(/\s+/g,' ').trim());
 await wait(()=>/In Europe and its neighbours/.test(story()));
 if(version===13){assert.match(story(),/Ukraine drew the most questions \(20\)/);assert.match(list()[0],/^Ukraine\s*20/);assert(!list().some(row=>/Russia/.test(row)),'the list leaves Russia out with the story');}
 else{assert.match(story(),/Russia drew the most questions \(50\)/);assert.match(list()[0],/^Russia\s*50/);}
});

for(const iso of ['UKR','GRC'])for(const input of ['pointer click','click with detail 0'])test(input+' activation on '+iso+' shares quarter selection across charts, URL and announcements without moving focus',async t=>{
 const periods=['2026-Q1','2026-Q2'],detail={ready:true,concept:{key:'place:'+iso,label:iso,iso3:iso},periods,partial:{first:null,last:null},series:periods.map(period=>({period,question:4,questionHome:1,questionElsewhere:3,document:2,groups:6,speech:0})),groupsTotal:6,total:6,groups:[],facets:{keywords:[],places:[],topics:[]},nextOffset:null};
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&place='+iso,u=>Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:detail));
 await wait(()=>node.querySelector('.topic-bars button'));
 const charts=()=>[...node.querySelectorAll('.topic-bars')],selected=()=>charts().map(c=>[...c.querySelectorAll('[aria-pressed=true]')].map(b=>b.getAttribute('aria-label').slice(0,7)));
 // Native buttons deliver click for both pointer and keyboard activation (detail 0).
 const activate=button=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:input==='pointer click'?1:0}));
 assert.equal(node.querySelector('[aria-live=polite]').textContent,'');
 const first=charts()[0].querySelector('button');first.focus();await act(async()=>activate(first));
 await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q1');assert.deepEqual(selected(),charts().map(()=>['2026 Q1']));assert.equal(document.activeElement,first);assert.match(node.querySelector('[aria-live=polite]').textContent,/January/);
 const other=charts().at(-1).querySelector('button');other.focus();await act(async()=>activate(other));
 assert.equal(new URL(location.href).searchParams.get('t-q'),'2026-Q1');assert.equal(new URL(location.href).searchParams.get('t-kind'),'document');assert.deepEqual(selected(),charts().map(()=>['2026 Q1']));assert.equal(document.activeElement,other);
 const second=charts().at(-1).querySelectorAll('button')[1];second.focus();await act(async()=>activate(second));
 await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q2');assert.deepEqual(selected(),charts().map(()=>['2026 Q2']));assert.equal(document.activeElement,second);
 await act(async()=>activate(second));await wait(()=>!new URL(location.href).searchParams.has('t-q'));assert.deepEqual(selected(),charts().map(()=>[]));assert.equal(document.activeElement,second);assert.equal(node.querySelector('[aria-live=polite]').textContent,'This term');
 await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q2');assert.deepEqual(selected(),charts().map(()=>['2026 Q2']));assert.match(node.querySelector('[aria-live=polite]').textContent,/April/);
});


const selectionDetail=()=>({ready:true,concept:{key:'place:UKR',label:'Ukraine',iso3:'UKR'},periods:['2026-Q1','2026-Q2'],partial:{first:null,last:null},series:['2026-Q1','2026-Q2'].map(period=>({period,question:4,document:2,groups:6,speech:0})),peaks:{document:[{period:'2026-Q2',n:2,groups:[{key:'2026-0001',kind:'procedure',title:'Support for Ukraine',n:2}]}]},groupsTotal:6,total:6,groups:[],facets:{keywords:[],places:[],topics:[]},nextOffset:null});
const selectionFacts=()=>({ready:true,periods:['2026-Q1','2026-Q2'],counts:{questions:8,debates:0,adoptedTexts:0,groups:12},periodCounts:['2026-Q1','2026-Q2'].map(period=>({period,questions:4})),periodWinners:{},winners:{},sets:{},questions:[],debates:[],docs:[]});
const popBack=()=>act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});

test('a place URL with a quarter selects every chart silently; a no-op peak then Back never reveals the story',async t=>{
 const scrolled=[],{node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&place=UKR&t-q=2026-Q1&t-kind=document',u=>Response.json(u.pathname==='/api/topics/story-facts'?selectionFacts():selectionDetail()),{setup:window=>{
  window.HTMLElement.prototype.scrollIntoView=function(options){scrolled.push({element:this,options});};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {top:-100};};
 }});
 await wait(()=>node.querySelector('.topic-story'));assert.equal(node.querySelectorAll('.topic-bars [aria-pressed=true]').length,2);assert.equal(node.querySelector('[aria-live=polite]').textContent,'');assert.deepEqual(scrolled,[]);
 const q2=node.querySelectorAll('.topic-bars')[1].querySelectorAll('button')[1];q2.focus();await act(async()=>q2.click());
 await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q2');assert.equal(scrolled.length,1);assert.equal(scrolled[0].element,node.querySelector('.topic-story'));assert.equal(document.activeElement,q2);
 scrolled.length=0;const peak=node.querySelector('.topic-peak');peak.focus();await act(async()=>peak.click());assert.equal(new URL(location.href).searchParams.get('t-q'),'2026-Q2');assert.deepEqual(scrolled,[]);
 await popBack();await wait(()=>new URL(location.href).searchParams.get('t-q')==='2026-Q1');assert.deepEqual(scrolled,[]);assert.match(node.querySelector('[aria-live=polite]').textContent,/January/);
});

test('showRecords uses the focused records heading without announcing the period a second time',async t=>{
 const scrolled=[],{node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&place=UKR',u=>Response.json(u.pathname==='/api/topics/story-facts'?selectionFacts():selectionDetail()),{setup:window=>{
  window.HTMLElement.prototype.scrollIntoView=function(){scrolled.push(this);};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {top:-100};};
 }});
 await wait(()=>node.querySelector('.topic-story'));const bar=node.querySelector('.topic-bars button');bar.focus();await act(async()=>bar.click());await wait(()=>/January/.test(node.querySelector('[aria-live=polite]').textContent));
 const previous=node.querySelector('[aria-live=polite]').textContent;scrolled.length=0;
 const recordsLink=node.querySelector('.topic-detail-header p a');recordsLink.focus();await act(async()=>recordsLink.click());
 await wait(()=>document.activeElement===node.querySelector('#topic-records h2'));assert.equal(new URL(location.href).searchParams.get('t-q'),null);assert.equal(node.querySelector('[aria-live=polite]').textContent,previous);assert.deepEqual(scrolled,[node.querySelector('#topic-records h2')]);
});

test('map tooltips keep the UI language while ranking labels retain their source language',async t=>{
 // This browser has no CLDR locale: the server's English fallback must remain English.
 t.mock.method(Intl.DisplayNames,'supportedLocalesOf',()=>[]);
 const data=placesData(3,'Morocco');data.items[0]={...data.items[0],key:'place:MAR',id:'MAR',iso3:'MAR',labelLanguage:'en'};
 const {node,wait}=await placesHarness(t,'http://localhost/?view=geopolitics&lang=fr',u=>Response.json(u.pathname==='/api/topics/story-facts'?{ready:false}:data),{language:'fr'});
 await wait(()=>node.querySelector('.places-map title'));
 assert.equal(node.querySelector('.places-map title').getAttribute('lang'),'fr');
 assert.equal(node.querySelector('.places-ranking a > span').getAttribute('lang'),'en');
 assert.equal(node.querySelector('.places-ranking a > span').textContent,'Morocco');
});
