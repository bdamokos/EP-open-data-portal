import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retryable,retryDelay,retryableGap,gapRetryAt} from './automaticRetry.mjs';
import {createElement as h,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('retry policy admits transient statuses, network failures and timeouts only',()=>{
 for(const status of [408,425,429,500,502,503,504])assert(retryable({status}));
 for(const status of [400,401,403,404,409,410,422])assert(!retryable({status}));
 assert(retryable(new TypeError('network')));assert(retryable(new DOMException('timeout','TimeoutError')));
 assert(!retryable(new DOMException('cancel','AbortError')));assert(!retryable(new Error('invalid payload')));
 assert(!retryableGap({coverage:{status:'partial',retryable:false}}));
 assert(!retryableGap({document:{selectedText:{refreshError:'download'}}}));
 assert(retryableGap({refreshInProgress:true}));
});
test('backoff has small jitter, caps its schedule and honours server deadlines',()=>{
 for(const [i,delay]of [5000,15000,45000,120000,300000,300000].entries())assert.equal(retryDelay(i,0,0,0.5),delay);
 assert.equal(retryDelay(20,0,0,0.5),300000);assert.equal(retryDelay(0,40000,10000,0.5),30000);
 assert.equal(retryDelay(0,0,0,0),4750);
});
test('automatic episodes pause hidden timers, resume online, cap attempts, retain data and clean up',async t=>{
 const win=new Window({url:'http://localhost/'}),originals=new Map();
 for(const[key,value]of Object.entries({window:win,document:win.document,HTMLElement:win.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 let root,loader,state,calls=0,fail=false;
 t.after(async()=>{if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loader)await loader.close();await win.happyDOM.close();for(const[k,d]of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return fail?Response.json({error:{message:'Busy'}},{status:503}):Response.json({value:'kept'});});
 loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
 const {useData}=await loader('/src/data.ts');const {createRoot}=await import('react-dom/client');
 function Reader(){state=useData('automatic-test');return h('output',null,state.data?.value);}
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(h(Reader)));assert.equal(state.data.value,'kept');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.mock.method(Math,'random',()=>0.5);
 fail=true;await act(async()=>state.retry());assert.equal(state.data.value,'kept');assert.equal(state.error,null);
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(async()=>document.dispatchEvent(new win.Event('visibilitychange')));
 await act(async()=>t.mock.timers.tick(10000));assert.equal(calls,2);
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});await act(async()=>document.dispatchEvent(new win.Event('visibilitychange')));assert.equal(calls,3);
 for(const delay of [15000,45000,120000,300000,300000])await act(async()=>t.mock.timers.tick(delay));
 assert.equal(calls,8);assert.equal(state.retrying,false);assert.equal(state.error,'Busy');assert.equal(state.data.value,'kept');
 await act(async()=>t.mock.timers.tick(900000));assert.equal(calls,8);
 fail=false;await act(async()=>window.dispatchEvent(new win.Event('online')));assert.equal(calls,9);assert.equal(state.error,null);
 fail=true;await act(async()=>state.retry());const before=calls;
 await act(async()=>root.unmount());root=null;await act(async()=>t.mock.timers.tick(900000));window.dispatchEvent(new win.Event('online'));assert.equal(calls,before);
});

test('joined readers batch jittered retries into six shared requests and settle together',async t=>{
 const win=new Window({url:'http://localhost/'}),originals=new Map();
 for(const[key,value]of Object.entries({window:win,document:win.document,HTMLElement:win.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 let root,loader,calls=0,random=0;const states=[];
 t.after(async()=>{if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loader)await loader.close();await win.happyDOM.close();for(const[k,d]of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'Busy'}},{status:503});});
 loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
 const {useData}=await loader('/src/data.ts'),{createRoot}=await import('react-dom/client');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.mock.method(Math,'random',()=>++random%2?0.1:0.9);
 function Reader({id}){states[id]=useData('joined-retries');return h('output',null,states[id].error);}
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(h('section',null,h(Reader,{id:0}),h(Reader,{id:1}))));assert.equal(calls,1);
 for(const delay of [5300,16000,48000,127000,300000,300000])await act(async()=>t.mock.timers.tick(delay));
 assert.equal(calls,7,'one initial read plus six automatic requests for the shared route');
 assert(states.every(state=>state.error==='Busy'&&!state.retrying));
 await act(async()=>t.mock.timers.tick(900000));assert.equal(calls,7);
});

// The retained-index representation is a complete public observation, not a
// client retry request. These match the none-listed/available follow-up shapes.
const retainedFollowup=(available=false)=>({
 version:3,documentId:available?'TA-10-2025-0247':'TA-10-2026-0367',requestedLanguage:'en',status:available?'available':'none-listed',
 relationshipObservation:'observed',declaredCount:available?1:0,checkedCount:available?1:0,truncated:false,
 items:available?[{id:'SP-10-2025-000001',documentDate:'2025-10-01',files:[{expressionId:'reply-en',manifestationId:'reply-pdf',language:'en',languageUri:'http://publications.europa.eu/resource/authority/language/ENG',format:'PDF',url:'https://www.europarl.europa.eu/doceo/document/TA-10-2025-0247_EN.html',issued:null,byteSize:null}]}]:[],gaps:[],
 sources:[{url:'https://data.europarl.europa.eu/api/v2/adopted-texts/'+(available?'TA-10-2025-0247':'TA-10-2026-0367')+'?format=application%2Fld%2Bjson',fetchedAt:'2026-11-03T08:00:00Z',stale:true,refreshInProgress:false,refreshError:null,contentHash:'synthetic',representation:'retained-index-projection',generation:1,epoch:'fixture'}],
});

test('only explicit progress or deadlines make a generic response retryable',()=>{
 for(const data of [retainedFollowup(),retainedFollowup(true),{stale:true},{refreshError:'Server is retrying'},{sources:[{refreshInProgress:true,retryAt:999999}]},{status:'unavailable'},{retryable:true},{sourceError:true},{error:'Unavailable',complete:false}])assert.equal(retryableGap(data),false,JSON.stringify(data));
 for(const data of [{refreshInProgress:true},{pending:true},{pending:2},{cache:{complete:false}},{status:'unavailable',retryAt:999999},{retryAt:999999},{nextRetryAt:'2026-11-03T12:00:00Z'}])assert.equal(retryableGap(data),true);
 for(const data of [{retryable:false,pending:true},{coverage:{retryable:false},refreshInProgress:true}])assert.equal(retryableGap(data),false);
 assert.equal(gapRetryAt({sources:[{retryAt:999999}]}),0);
 assert.equal(gapRetryAt({retryAt:1000,nextRetryAt:'1970-01-01T00:00:02Z'}),2000);
 assert.equal(retryableGap({selectedText:{refreshInProgress:true}}),false);
 assert.equal(retryableGap({selectedText:{refreshInProgress:true}},data=>retryableGap(data.selectedText)),true);
 assert.equal(retryableGap({retryable:false,selectedText:{refreshInProgress:true}},data=>retryableGap(data.selectedText)),false);
});

async function gapReader(t,{payload,insight=false,component=false}={}) {
 const win=new Window({url:'http://localhost/'}),originals=new Map();
 for(const[key,value]of Object.entries({window:win,document:win.document,HTMLElement:win.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 let root,loader,state,calls=0;
 t.after(async()=>{if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loader)await loader.close();await win.happyDOM.close();for(const[key,value]of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(payload);});
 loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {useData}=await loader('/src/data.ts'),{useInsightData}=await loader('/src/InsightData.ts'),{CommissionFollowups}=await loader('/src/CommissionFollowups.tsx'),{createRoot}=await import('react-dom/client');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.mock.method(Math,'random',()=>0.5);
 function Reader(){state=insight?useInsightData('gap-fixture'):useData('gap-fixture');return h('output',null,JSON.stringify(state.data));}
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(component?h(CommissionFollowups,{id:payload.documentId,language:'en',interfaceLanguage:'en'}):h(Reader)));
 const tick=ms=>act(async()=>t.mock.timers.tick(ms));
 const foreground=async()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(async()=>document.dispatchEvent(new win.Event('visibilitychange')));Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});await act(async()=>{document.dispatchEvent(new win.Event('visibilitychange'));window.dispatchEvent(new win.Event('online'));});};
 return {container,win,tick,foreground,state:()=>state,calls:()=>calls,payload:value=>payload=value};
}
for(const [name,payload]of [['none-listed',retainedFollowup()],['available',retainedFollowup(true)],['refreshError',{value:'Kept',refreshError:'Last server update failed'}]])for(const insight of [false,true])test('complete '+name+' stays idle on timers and foreground events: '+(insight?'insight':'data'),async t=>{
 const reader=await gapReader(t,{payload,insight});assert.equal(reader.calls(),1);assert.equal(reader.state().retrying,false);assert.deepEqual(reader.state().data,payload);
 await reader.tick(2_000_000);await reader.foreground();await reader.tick(2_000_000);await reader.foreground();assert.equal(reader.calls(),1);assert.deepEqual(reader.state().data,payload);
});
for(const available of [false,true])test('CommissionFollowups retained '+(available?'available':'none-listed')+' makes one read',async t=>{
 const reader=await gapReader(t,{payload:retainedFollowup(available),component:true});assert.equal(reader.calls(),1);assert.equal(reader.container.querySelectorAll('.commission-followup').length,available?1:0);
 await reader.tick(2_000_000);await reader.foreground();await reader.tick(2_000_000);await reader.foreground();assert.equal(reader.calls(),1);assert.equal(reader.container.querySelectorAll('.commission-followup').length,available?1:0);
});
for(const [name,payload]of [['refreshInProgress',{refreshInProgress:true}],['pending boolean',{pending:true}],['pending count',{pending:1}],['cache filling',{cache:{complete:false}}],['retryAt',{retryAt:120000}],['nextRetryAt',{nextRetryAt:'1970-01-01T00:02:00Z'}]])test(name+' retries on backoff, caps and never revives an exhausted gap',async t=>{
 const reader=await gapReader(t,{payload:{value:'Kept',...payload}});assert.equal(reader.calls(),1);assert.equal(reader.state().retrying,true);
 const first=name.includes('RetryAt')||name==='retryAt'?20000:5000;
 await reader.tick(first-1);assert.equal(reader.calls(),1);await reader.tick(1);assert.equal(reader.calls(),2);assert.equal(reader.state().data.value,'Kept');
 for(const delay of [15000,45000,120000,300000,300000])await reader.tick(delay);
 assert.equal(reader.calls(),7);assert.equal(reader.state().retrying,false);assert.equal(reader.state().data.value,'Kept');
 await reader.tick(2_000_000);for(let i=0;i<3;i++){await reader.foreground();await reader.tick(2_000_000);}assert.equal(reader.calls(),7,'visibility/online cannot restart a successful gap episode');
});
