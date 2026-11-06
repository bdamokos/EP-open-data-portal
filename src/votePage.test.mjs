import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {voteFixture,decisionId} from '../server/test-support/decision-votes.mjs';

async function mount(t,handler,{id=decisionId,url,members=[]}={}) {
 const window=new Window({url:url||'http://localhost/?view=legislation&pl-mode=vote&pl-vote='+id+'&lang=en'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map();
 for(const [key,value] of Object.entries(globals)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const target=new URL(input,window.location.href);calls.push(target.pathname);return handler(target);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {VotePage}=await load('/src/VotePage.tsx'),{PersonNamesProvider}=await load('/src/PersonName.tsx'),{createRoot}=await import('react-dom/client');
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 await act(async()=>root.render(createElement(PersonNamesProvider,{members},createElement(VotePage,{decisionId:id,language:'en',country:null,onCountry:()=>{}}))));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 return {container,calls};
}
test('a roll-call vote page shows the sentence, totals and groups without a member read',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};
 const data=await f.read(),h=await mount(t,async()=>Response.json(data));
 assert.match(h.container.querySelector('h1').textContent,/Amendment 114 was adopted: 2 for, 1 against, 1 abstaining\./);
 assert(h.container.querySelector('.member-votes-result'));
 assert(h.container.querySelector('.insight-vote-matrix'));
 assert.match(h.container.textContent,/With majority: share of the group voting with the group's own majority\./);
 assert.match(h.container.textContent,/Browse voters/);assert.equal(h.container.querySelector('.insight-voter-list'),null,'closed by default');
 assert.equal(h.calls.length,1);assert.match(h.calls[0],/decision-votes\//);assert(!h.calls.some(path=>path.includes('member-votes')));
 assert.equal(h.container.querySelector('.member-votes-position'),null,'no member frame');
 assert.equal(h.container.querySelector('details.vote-page-text').open,false);
});
test('vote corrections name a current member from the directory',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};const data=await f.read();
 const h=await mount(t,async()=>Response.json(data),{members:[{id:197591,firstName:'Known',lastName:'Member',countryCode:'FR'}]});
 const corrections=[...h.container.querySelectorAll('details')].find(details=>/Vote corrections/.test(details.querySelector('summary').textContent));
 assert.match(corrections.textContent,/Known Member/);assert(!/: MEP\b/.test(corrections.textContent));
});
test('the plenary view renders the vote page on its route, without the agenda read',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};const data=await f.read();
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=vote&pl-vote='+decisionId+'&lang=en'}),old=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const target=new URL(input,window.location.href);calls.push(target.pathname);return target.pathname.includes('decision-votes')?Response.json(data):Response.json({});});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {Legislation}=await load('/src/Legislation.tsx'),{createRoot}=await import('react-dom/client');
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 await act(async()=>root.render(createElement(Legislation,{language:'en',onBack:()=>{},onNavigate:()=>{},onMember:()=>{},onSaved:()=>{}})));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 assert.equal(container.querySelector('[data-vote-page]').dataset.votePage,decisionId);
 assert.match(container.querySelector('[data-vote-page] h1').textContent,/Amendment 114 was adopted/);
 assert.equal(container.querySelector('.insight-mode-nav'),null);
 assert(!calls.some(path=>path.includes('insights/legislation')));
});
test('a show of hands has no group table or voter list and says so in the sentence',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};f.raw.decision_method='def/ep-entities/VOTE_HAND';for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention','number_of_votes_favor','number_of_votes_against','number_of_votes_abstention'])delete f.raw[key];
 const data=await f.read(),h=await mount(t,async()=>Response.json(data));
 assert.match(h.container.querySelector('h1').textContent,/Amendment 114 was adopted by show of hands\. No names on record\./);
 assert.equal(h.container.querySelector('.insight-vote-matrix'),null);assert.equal(h.container.querySelector('.member-votes-result'),null,'no tally, no totals bar');
 assert(!/Individual votes unavailable/.test(h.container.textContent));
});
test('conflicting records show totals and no voters',async t=>{
 const f=voteFixture();f.raw._conflictingSourceObservations={fields:['decision_method']};const data=await f.read();
 const h=await mount(t,async()=>Response.json(data));
 assert.equal(h.container.querySelector('.insight-vote-matrix'),null);assert.match(h.container.textContent,/Individual votes unavailable\./);
});
test('partial records keep the published-totals line',async t=>{
 const f=voteFixture();f.raw.number_of_votes_favor=9;const data=await f.read();assert.equal(data.integrity,'partial');
 const h=await mount(t,async()=>Response.json(data));
 assert(h.container.querySelector('.insight-vote-matrix'));assert.match(h.container.textContent,/The named-voter list differs from Parliament’s published totals\./);
});
test('a decision absent from complete data reads not found',async t=>{
 const f=voteFixture();f.day.decisions=[];const data=await f.read();
 const h=await mount(t,async()=>Response.json(data));assert.equal(h.container.querySelector('h1').textContent,'Vote not found.');
});
test('a decision absent from partial data reads unavailable',async t=>{
 const f=voteFixture();f.day.decisions=[];const data=await f.read();
 const h=await mount(t,async()=>Response.json({...data,coverage:'partial'}));assert.equal(h.container.querySelector('h1').textContent,'Vote unavailable.');
});
test('an invalid identifier reads not found without a request',async t=>{
 const h=await mount(t,()=>{throw Error('Unexpected read');},{id:'not-a-decision'});assert.equal(h.container.querySelector('h1').textContent,'Vote not found.');assert.equal(h.calls.length,0);
});
test('Back returns to the origin, and a dossier reopened from a vote keeps its own origin',async t=>{
 const member='http://localhost/?member=1&module=votes',dossier='http://localhost/?view=legislation&pl-mode=dossier&dossier-ref=2025%2F0222%28COD%29&lang=en',vote='http://localhost/?view=legislation&pl-mode=vote&pl-vote=MTG-PL-2026-10-22-DEC-1&lang=en',other=vote.replace('DEC-1','DEC-2');
 const window=new Window({url:member}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement},old=new Map();
 for(const [key,value] of Object.entries(globals)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 t.after(async()=>{await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const {navigateDossier,dossierBackHref}=await load('/src/dossierJourney.ts');
 navigateDossier(dossier);assert.equal(dossierBackHref(),member);
 navigateDossier(vote);assert.equal(dossierBackHref(),dossier);
 navigateDossier(other);assert.equal(dossierBackHref(),dossier,'moving between votes keeps the origin');
 navigateDossier(dossier);assert.equal(dossierBackHref(),member,'the dossier gets its own origin back');
});
