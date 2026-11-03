import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createElement,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';
let load;after(async()=>load?.close());
const sitting='MTG-PL-2026-09-15',id=sitting+'-OJ-ITM-V-29',documentId='A-10-2026-0201';
const row=(number,subject=['Recital 3'],extra={})=>({key:documentId+':am:'+number,documentId,revision:'rev',kind:'amendment',amendments:[{number,cp:null}],authors:['MEPs'],subject,amendmentRows:[],outcome:null,decisionId:null,...extra});
const ballot=(rows,extra={})=>({id,title:'Carbon border adjustment mechanism',titleLanguage:'en',sittingId:sitting,documentId,source:'voting-list',rows,added:[],procedureIds:[],...extra});
async function harness(t,respond=()=>({items:[]})){
 const w=new Window({url:'http://localhost/'}),old=new Map();
 for(const [k,v]of Object.entries({window:w,document:w.document,location:w.location,history:w.history,Event:w.Event,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 t.mock.method(globalThis,'fetch',async input=>{const value=respond(new URL(input,location.href));return value instanceof Response?value:Response.json(value);});
 if(!load)load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const mod=await load('/src/YourVotes.tsx'),{createRoot}=await import('react-dom/client');
 for(const c of mod.yourVotesStore.snapshot().choices)mod.yourVotesStore.choose({...c,choice:null});for(const s of mod.yourVotesStore.snapshot().stars)mod.yourVotesStore.toggleStar(s);
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 t.after(async()=>{await act(async()=>root.unmount());await w.happyDOM.close();for(const[k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 return {...mod,node,render:async(Component,props)=>act(async()=>{root.render(createElement(Component,props));}),flush:async()=>act(async()=>{await new Promise(r=>setImmediate(r));})};
}
test('ballot groups subjects, formats rows and reveals only the first 12 groups',async t=>{
 const h=await harness(t),rows=[row(131,['Recital 3'],{authors:['S&D']}),row(89,['Recital 3'],{amendments:[{number:89},{number:105},{number:108}],authors:['ECR','PfE','MEPs'],vote:{rollCall:true},partText:'Short wording [ROLL-CALL VOTE]'}),row(83,['§ 13'],{amendments:[{number:83,cp:1,deleting:true}],authors:['committee'],status:'withdrawn'}),...Array.from({length:12},(_,i)=>row(i+200,['Article '+i]))];
 await h.render(h.BallotCard,{ballot:ballot(rows),language:'en'});
 assert.equal([...h.node.querySelectorAll('.your-votes-group h4')].filter(n=>n.textContent==='Recital 3').length,1);
 assert(h.node.textContent.includes('AM 131 · S&D'));assert(h.node.textContent.includes('AM 89 = 105 = 108 · ECR, PfE, Members'));assert(h.node.textContent.includes('Part 1 of AM 83 · Committee'));assert(!h.node.textContent.includes('[ROLL-CALL VOTE]'));assert(h.node.textContent.includes('Roll call'));assert(h.node.textContent.includes('Deletes text'));
 assert.equal(h.node.querySelectorAll('.your-votes-group').length,12);assert(!h.node.textContent.includes('Show wording'));
 await act(async()=>[...h.node.querySelectorAll('button')].find(b=>b.textContent==='Show all 15 votes').click());assert.equal(h.node.querySelectorAll('.your-votes-group').length,14);
});
test('upcoming unpublished ballot shows the localized deadline and empty state',async t=>{
 const h=await harness(t);await h.render(h.BallotCard,{ballot:ballot([],{source:'tabled',sittingId:'MTG-PL-2099-11-12'}),language:'en',deadlines:[{id:'deadline',end:'2026-11-04T13:00:00+01:00',type:'TABLING_AMENDMENT',labels:{en:'Amendments'}}]});
 assert(h.node.textContent.includes('Voting list not published yet'));assert(h.node.textContent.includes('Amendments due 4 November, 13:00'));assert(h.node.textContent.includes('No amendments tabled yet.'));
});
test('Following summarizes choices and roll-call agreement with agenda links and no editing controls',async t=>{
 const rows=[row(7,['§ 13'],{outcome:'ADOPTED',decisionId:'decision1'}),row(8,['§ 14'],{outcome:'REJECTED',decisionId:'decision2'}),row(9,['§ 15'],{outcome:'ADOPTED',decisionId:'decision3'})],b=ballot(rows);const comparisonRequests=[];
 const h=await harness(t,u=>{if(u.pathname.endsWith('/ballot-comparisons')){comparisonRequests.push(u.href);return {items:rows.map(r=>({decisionId:r.decisionId,integrity:'complete',majorities:[{id:'EPP',position:'for'}],voters:[{personId:'1',position:'for',status:'recorded'}]}))};}return u.pathname.endsWith('/upcoming-votes')?{items:[b]}:u.pathname.endsWith('/vote-periods')?{weeks:[{week:'2026-09-14',sittings:[{date:'2026-09-14'},{date:'2026-09-17'}]}]}:{sittings:[],items:[]};});
 for(const r of rows.slice(0,2))h.yourVotesStore.choose({key:r.key,sittingId:sitting,agendaItemId:id,documentId,revision:'rev',choice:'for'});
 await h.render(h.YourVotes,{language:'en',members:[{id:1,firstName:'Picked',lastName:'Member'}]});await h.flush();await h.flush();
 const select=h.node.querySelector('select');await act(async()=>{select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
 assert(h.node.textContent.replace(/\u2009/g,'').includes('14–17 September 2026'));assert(h.node.textContent.includes('You voted on 2 of 3 votes'));assert(h.node.textContent.includes('Result: agreed 1 of 2'));assert(h.node.textContent.includes('EPP2 of 2'));assert(h.node.textContent.includes('Picked Member2 of 2'));
 assert.equal(comparisonRequests.length,1);assert.equal(new URL(comparisonRequests[0]).searchParams.get('sitting'),sitting);assert(!comparisonRequests[0].includes('decision'));
 await act(async()=>h.yourVotesStore.choose({...h.yourVotesStore.snapshot().choices[1],choice:null}));await h.flush();assert.equal(comparisonRequests.length,1,'editing a choice never changes the comparison request set');
 assert(!h.node.querySelector('.your-votes-choices'));assert(!h.node.querySelector('details'));assert(!h.node.querySelector('[data-withdrawn]'));
 const link=[...h.node.querySelectorAll('a')].find(a=>a.textContent==='Open voting list');assert.equal(new URL(link.href).searchParams.get('agenda-topic'),id);assert(!h.node.textContent.includes(sitting));
});

test('past agenda without a list or retained bindings adds no ballot UI',async t=>{
 const b=ballot([],{source:'tabled',added:[{decisionId:'past',label:'Resolution',outcome:'ADOPTED'}]}),h=await harness(t,()=>({items:[b]}));
 await h.render(h.AgendaBallot,{sitting,agendaItemId:id,language:'en'});await h.flush();assert.equal(h.node.textContent,'');
 await h.render(h.BallotCard,{ballot:b,language:'en'});assert.equal(h.node.textContent,'');
});
test('unavailable historical agenda reads leave the existing results section alone',async t=>{
 const h=await harness(t,()=>Response.json({error:{code:'invalid_sitting'}},{status:400}));await h.render(h.AgendaBallot,{sitting:'MTG-PL-2023-09-15',agendaItemId:'past',language:'en'});await h.flush();assert.equal(h.node.textContent,'');
});
test('an unbound past list row has a neutral result label even without a local choice',async t=>{
 const h=await harness(t);await h.render(h.BallotCard,{ballot:ballot([row(17)]),language:'en'});assert(h.node.textContent.includes('Result not matched'));assert(!h.node.textContent.includes('Added in plenary'));
});
