import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {voteFixture,decisionId,amendmentId} from '../server/test-support/decision-votes.mjs';

const item={id:amendmentId,number:114,targetDocumentId:'B-10-2026-0424',outcome:'ADOPTED',authors:[{name:'Author One',personId:'197591'},{name:'Author Two',personId:'197481'},{name:'Unresolved Author',personId:null},{name:'Unlisted Author',personId:'999'}]};
const decision={id:decisionId,outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:2,against:1,abstaining:1}};
async function mount(t,handler,{integrated=false}={}) {
 const window=new Window({url:'http://localhost/?member=197591&module=amendments'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,window.location.href);calls.push(url);if(url.pathname.endsWith('/amendments'))return Response.json({items:[{...item,decisions:[decision]}],total:1,offset:0,limit:20,coverage:{complete:false,pending:false}});return handler(url);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {AmendmentNamedVotes}=await load('/src/AmendmentNamedVotes.tsx'),{Amendments}=await load('/src/Amendments.tsx'),{createRoot}=await import('react-dom/client');
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const render=patch=>act(async()=>root.render(createElement(integrated?Amendments:AmendmentNamedVotes,integrated?{member:197591,showFailures:false,language:'en'}:{item,decision,language:'en',...patch})));
 const open=async()=>{const details=container.querySelector('.amendment-named-votes');assert(details);await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});};
 return {window,container,calls,render,open};
}
test('member Amendments retains result and lazily shows author positions and group counts',async t=>{
 const data=await voteFixture().read(),h=await mount(t,async()=>Response.json(data),{integrated:true});await h.render();assert.equal(h.calls.length,1);assert.match(h.container.textContent,/Adopted/);assert.equal(h.container.querySelector('table'),null);
 await h.open();assert.equal(h.calls.length,2);const text=h.container.textContent;
 assert.match(text,/Author One · S&DFor/);assert.match(text,/Author Two · EPPAgainst/);assert.match(text,/Unresolved AuthorMEP unresolved/);assert.match(text,/Unlisted AuthorNo recorded vote/);assert.match(text,/Groups on/);assert.equal(h.container.querySelectorAll('tbody tr').length,4);
 assert.equal(h.container.querySelector('.explorer-amendment-totals dd').textContent,'2');
 const button=h.container.querySelector('button[aria-label="S&D: For · 1"]');assert(button);await act(async()=>button.click());assert(h.container.querySelector('section[aria-label="Named voters"] a[href*="member=197591"]'));
});
test('non-named, unheld and unverified components do not start reads',async t=>{
 const h=await mount(t,()=>{throw Error('Unexpected read');});
 for(const [patch,label] of [[{method:'VOTE_HAND'},'Not individually recorded'],[{method:'VOTE_ELECTRONIC'},'Not individually recorded'],[{outcome:'LAPSED'},'Not put to a vote'],[{outcome:'WITHDRAWN'},'Not put to a vote']]){await h.render({decision:{...decision,...patch}});assert.match(h.container.textContent,new RegExp(label));assert.equal(h.container.querySelector('details'),null);}
 for(const patch of [{componentBinding:'unverified'},{componentBinding:'unresolved-collective'},{partNumber:2},{partId:'part',partNumber:2}]){await h.render({decision:{...decision,...patch}});assert.equal(h.container.querySelector('details'),null);}
 assert.equal(h.calls.length,0);
});
test('conflicting variants show the verified matrix without combined author attribution',async t=>{
 const h=await mount(t,async()=>Response.json(await voteFixture().read()));await h.render({item:{...item,conflicted:true}});await h.open();assert(h.container.querySelector('table'));assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);
});
test('missing group history retains positions in a separate unavailable group',async t=>{
 const f=voteFixture();f.store.db.prepare=()=>({get:()=>undefined});const h=await mount(t,async()=>Response.json(await f.read()));await h.render();await h.open();assert.match(h.container.textContent,/Author OneFor/);assert.match(h.container.textContent,/Group unavailable/);assert.equal(h.container.querySelectorAll('tbody tr').length,1);
});
test('partial ballots withhold group totals and avoid claiming an unlisted author had no vote',async t=>{
 const f=voteFixture();f.raw.had_voter_favor.push('invalid-person');const h=await mount(t,async()=>Response.json(await f.read()));await h.render();await h.open();assert.match(h.container.textContent,/Named list incomplete/);assert.match(h.container.textContent,/Unlisted AuthorUnavailable/);assert.equal(h.container.querySelector('table'),null);
});
test('wrong decision responses and transport errors offer retry, then exact data recovers',async t=>{
 let mode='wrong';const h=await mount(t,async()=>{const data=await voteFixture().read();if(mode==='wrong')data.decisionId+='1';return mode==='error'?new Response('{}',{status:503}):Response.json(data);});await h.render();await h.open();assert.match(h.container.textContent,/Named votes unavailable/);assert.equal(h.container.querySelector('table'),null);
 mode='error';await act(async()=>h.container.querySelector('button').click());assert.match(h.container.textContent,/Named votes unavailable/);
 mode='good';await act(async()=>h.container.querySelector('button').click());assert(h.container.querySelector('table'));
});
test('mismatched exact components suppress every position',async t=>{
 const data=await voteFixture().read();data.decision.componentIds=['MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-2'];const h=await mount(t,async()=>Response.json(data));await h.render({decision:{...decision,partId:'eli/dl/doc/MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-1',partNumber:1,componentBinding:'single-amendment'}});await h.open();assert.match(h.container.textContent,/Vote records differ/);assert.equal(h.container.querySelector('table'),null);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);
});
test('a late response for a previous decision cannot populate the next panel',async t=>{
 let resolveOld;const oldResponse=new Promise(resolve=>{resolveOld=resolve;}),nextId=decisionId.replace('197457','197458'),data=await voteFixture().read();
 const h=await mount(t,async url=>{if(url.pathname.endsWith(decisionId))return oldResponse;const next=structuredClone(data);next.decisionId=nextId;next.decision.id=nextId;return Response.json(next);});
 await h.render();await h.open();assert.match(h.container.textContent,/Loading named votes/);
 await h.render({decision:{...decision,id:nextId}});await h.open();assert.match(h.container.textContent,/Author One · S&DFor/);
 const wrong=structuredClone(data);wrong.voters.find(v=>v.personId==='197591').position='against';await act(async()=>{resolveOld(Response.json(wrong));await new Promise(resolve=>setTimeout(resolve,10));});
 assert.match(h.container.textContent,/Author One · S&DFor/);assert.doesNotMatch(h.container.textContent,/Author One · S&DAgainst/);
});
