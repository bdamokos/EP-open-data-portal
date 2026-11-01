import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {voteFixture,contradictoryVoteFixture,splitBindingFixture,decisionId,amendmentId} from '../server/test-support/decision-votes.mjs';

const item={id:amendmentId,number:114,targetDocumentId:'B-10-2026-0424',outcome:'ADOPTED',authors:[{name:'Author One',personId:'197591'},{name:'Author Two',personId:'197481'},{name:'Unresolved Author',personId:null},{name:'Unlisted Author',personId:'999'}]};
const decision={id:decisionId,outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:2,against:1,abstaining:1}};
async function mount(t,handler,{integrated=false,indexedDecision=decision,members,language='en',i18n}={}) {
 const window=new Window({url:'http://localhost/?member=197591&module=amendments'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,window.location.href);calls.push(url);if(url.pathname.endsWith('/amendments'))return Response.json({items:[{...item,decisions:[indexedDecision]}],total:1,offset:0,limit:20,coverage:{complete:false,pending:false}});return handler(url);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {AmendmentNamedVotes}=await load('/src/AmendmentNamedVotes.tsx'),{Amendments}=await load('/src/Amendments.tsx'),{createRoot}=await import('react-dom/client');
 const {PersonNamesProvider}=await load('/src/PersonName.tsx'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx');
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const render=patch=>{const view=createElement(PersonNamesProvider,{members},createElement(integrated?Amendments:AmendmentNamedVotes,integrated?{member:197591,language}:{item,decision,language,...patch}));return act(async()=>root.render(i18n?createElement(UiI18nProvider,{i18n,language},view):view));};
 const open=async()=>{const details=container.querySelector('.amendment-named-votes__groups');await act(async()=>{if(details){details.open=true;details.dispatchEvent(new window.Event('toggle'));}});};
 return {window,container,calls,render,open};
}
test('member Amendments retains indexed result and shows author positions with readable group rows',async t=>{
 const data=await voteFixture().read(),h=await mount(t,async()=>Response.json(data),{integrated:true});await h.render();assert.equal(h.calls.length,2);assert.match(h.container.textContent,/Adopted/);assert.equal(h.container.querySelector('table'),null);
 await h.open();assert.equal(h.calls.length,2);const text=h.container.textContent;
 assert.match(text,/Author One(?: S&D)? voted for/);assert.match(text,/Author Two(?: EPP)? voted against/);assert.match(text,/Unresolved Author MEP unresolved/);assert.match(text,/Unlisted Author has no recorded vote/);assert.match(text,/How groups voted/);assert.equal(h.container.querySelectorAll('.amendment-named-votes__group').length,4);
 assert.equal(h.container.querySelector('.explorer-amendment-totals dd').textContent,'2');
 const group=[...h.container.querySelectorAll('.amendment-named-votes__group')].find(group=>group.querySelector('summary').textContent.startsWith('S&D'));assert(group);assert.match(group.querySelector('summary').textContent,/For: 1Against: 0Abstentions: 0/);await act(async()=>{group.open=true;});assert(group.querySelector('a[href*="member=197591"]'));
});
test('non-named, unheld and unverified components do not start reads',async t=>{
 const h=await mount(t,()=>{throw Error('Unexpected read');});
 for(const [patch,label] of [[{method:'VOTE_HAND'},'Not individually recorded'],[{method:'VOTE_ELECTRONIC'},'Not individually recorded'],[{method:'VOTE_SECRET'},'Not individually recorded'],[{method:'VOTE_SECRET_BALLOT'},'Not individually recorded'],[{method:'UNKNOWN'},'Named votes unavailable'],[{method:null},'Named votes unavailable'],[{outcome:'CANCELLED'},'Not put to a vote']]){await h.render({decision:{...decision,...patch}});assert.match(h.container.textContent,new RegExp(label));assert.equal(h.container.querySelector('details'),null);}
 for(const patch of [{outcome:'LAPSED'},{outcome:'WITHDRAWN'},{componentBinding:'unverified'},{componentBinding:'unresolved-collective'},{partNumber:2},{partId:'part',partNumber:2}]){await h.render({decision:{...decision,...patch}});assert.equal(h.container.querySelector('details'),null);}
 assert.equal(h.calls.length,0);
});
test('conflicting variants show the verified matrix without combined author attribution',async t=>{
 const h=await mount(t,async()=>Response.json(await voteFixture().read()));await h.render({item:{...item,conflicted:true}});await h.open();assert(h.container.querySelector('.amendment-named-votes__group'));assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);assert.match(h.container.textContent,/Author votes withheld: sources conflict/);
});
test('missing group history retains author positions without a group table',async t=>{
 const f=voteFixture();f.store.db.prepare=()=>({get:()=>undefined});const h=await mount(t,async()=>Response.json(await f.read()));await h.render();await h.open();assert.match(h.container.textContent,/Author One(?: S&D)? voted for/);assert.match(h.container.textContent,/Groups unavailable for this date/);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);
});
test('partial ballots withhold group totals and avoid claiming an unlisted author had no vote',async t=>{
 const f=voteFixture();f.raw.had_voter_favor.push('invalid-person');const h=await mount(t,async()=>Response.json(await f.read()));await h.render();await h.open();assert.match(h.container.textContent,/Named list incomplete/);assert.match(h.container.textContent,/Unlisted Author Unavailable/);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);
});
test('wrong decision responses and transport errors offer retry, then exact data recovers',async t=>{
 let mode='wrong';const h=await mount(t,async()=>{const data=await voteFixture().read();if(mode==='wrong')data.decisionId+='1';return mode==='error'?new Response('{}',{status:503}):Response.json(data);});await h.render();await h.open();assert.match(h.container.textContent,/Named votes unavailable/);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);
 mode='error';await act(async()=>h.container.querySelector('button').click());assert.match(h.container.textContent,/Named votes unavailable/);
 mode='good';await act(async()=>h.container.querySelector('button').click());assert(h.container.querySelector('.amendment-named-votes__group'));
});
test('mismatched exact components suppress every position',async t=>{
 const data=await voteFixture().read();data.decision.componentIds=['MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-2'];const h=await mount(t,async()=>Response.json(data));await h.render({decision:{...decision,partId:'eli/dl/doc/MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-1',partNumber:1,componentBinding:'single-amendment'}});await h.open();assert.match(h.container.textContent,/Vote record does not match this amendment/);assert.equal(h.container.querySelector('button'),null);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);
});
test('a late response for a previous decision cannot populate the next panel',async t=>{
 let resolveOld;const oldResponse=new Promise(resolve=>{resolveOld=resolve;}),nextId=decisionId.replace('197457','197458'),data=await voteFixture().read();
 const h=await mount(t,async url=>{if(url.pathname.endsWith(decisionId))return oldResponse;const next=structuredClone(data);next.decisionId=nextId;next.decision.id=nextId;return Response.json(next);});
 await h.render();await h.open();assert.match(h.container.textContent,/Loading named votes/);
 await h.render({decision:{...decision,id:nextId}});await h.open();assert.match(h.container.textContent,/Author One(?: S&D)? voted for/);
 const wrong=structuredClone(data);wrong.voters.find(v=>v.personId==='197591').position='against';await act(async()=>{resolveOld(Response.json(wrong));await new Promise(resolve=>setTimeout(resolve,10));});
 assert.match(h.container.textContent,/Author One(?: S&D)? voted for/);assert.doesNotMatch(h.container.textContent,/Author One voted against/);
});

for(const scenario of ['ambiguous-result-binding','conflicting-result-source','component-outside-result'])test(scenario+' preserves the indexed result and withholds named joins',async t=>{
 const f=contradictoryVoteFixture(scenario),data=await f.read();
 const h=await mount(t,async()=>Response.json(data),{integrated:true,indexedDecision:f.indexed});await h.render();await h.open();
 assert.match(h.container.querySelector('.amendment-named-votes').textContent,/Vote record does not match this amendment/);
 assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);
 assert.match(h.container.querySelector('.explorer-amendment-card').textContent,/Adopted/);
 assert.match(h.container.querySelector('.explorer-amendment-totals').textContent,/For2/);
});

for(const scenario of [
 {ownership:'shared',wording:'valid'},
 {ownership:'shared',wording:'missing'},
 {ownership:'shared',wording:'unreadable'},
 {definitions:'conflicting',context:'present'},
 {definitions:'conflicting',context:'missing'},
 {ownership:'outside',wording:'missing',context:'missing'},
])test('known component contradictions are withheld: '+JSON.stringify(scenario),async t=>{
 const f=splitBindingFixture(scenario),data=await f.read(),h=await mount(t,async()=>Response.json(data),{integrated:true,indexedDecision:f.indexed});await h.render();await h.open();
 assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);
 assert.match(h.container.querySelector('.amendment-named-votes').textContent,/Vote record does not match this amendment/);
 assert.match(h.container.querySelector('.explorer-amendment-card').textContent,/Adopted/);assert.match(h.container.querySelector('.explorer-amendment-totals').textContent,/For2/);
});
for(const scenario of [{wording:'missing'},{wording:'unreadable',context:'missing'},{ownership:'unknown',context:'missing'}])test('missing split context stays distinct from contradictions: '+JSON.stringify(scenario),async t=>{
 const f=splitBindingFixture(scenario),data=await f.read(),h=await mount(t,async()=>Response.json(data),{integrated:true,indexedDecision:f.indexed});await h.render();await h.open();
 assert(h.container.querySelector('.amendment-named-votes__group'));assert.match(h.container.querySelector('[aria-label="Authors’ votes"]').textContent,/Author One(?: S&D)? voted for/);
});

test('unestablished memberships stay separate from verified groups',async t=>{
 const data=await voteFixture().read();data.voters[0].group=null;data.voters[0].groupStatus='ambiguous';
 const h=await mount(t,async()=>Response.json(data));await h.render();await h.open();assert(h.container.querySelector('.amendment-named-votes__group'));assert.match(h.container.textContent,/Group unknown/);assert.match(h.container.textContent,/Non-attached/);
});
test('unknown methods from a named read stay unavailable',async t=>{
 const data=await voteFixture().read();data.decision.method=null;data.integrity='unavailable';
 const h=await mount(t,async()=>Response.json(data));await h.render();await h.open();assert.match(h.container.textContent,/Named votes unavailable/);assert.doesNotMatch(h.container.textContent,/Not individually recorded/);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);
});
test('group sources show the captured membership generation and retrieval date',async t=>{
 const data=await voteFixture().read();data.groupHistory.catalogue.retrievedAt='2026-10-23T12:00:00Z';
 const h=await mount(t,async()=>Response.json(data));await h.render();await h.open();assert.doesNotMatch(h.container.textContent,/membership snapshot|Vote sources/);
});

test('a missing tally does not hide a known mismatch or imply an unlisted author had no vote',async t=>{
 const f=voteFixture();f.raw.number_of_votes_favor=99;delete f.raw.number_of_votes_abstention;const data=await f.read();
 const h=await mount(t,async()=>Response.json(data),{integrated:true,indexedDecision:{...decision,totals:{for:99,against:1,abstaining:null}}});
 await h.render();await h.open();assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);assert.match(h.container.textContent,/Vote record does not match this amendment/);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);assert.match(h.container.querySelector('.explorer-amendment-totals').textContent,/For99/);
});

for(const [position,field] of [['for','number_of_votes_favor'],['against','number_of_votes_against'],['abstaining','number_of_votes_abstention']]){
 for(const matches of [true,false])test('missing fresh '+position+' tally with '+(matches?'matching':'contradictory')+' indexed count',async t=>{
  const f=voteFixture();delete f.raw[field];const data=await f.read();
  const h=await mount(t,async()=>Response.json(data),{integrated:true,indexedDecision:{...decision,totals:{...decision.totals,[position]:matches?decision.totals[position]:99}}});
  await h.render();await h.open();assert.match(h.container.querySelector('.explorer-amendment-card').textContent,/Adopted/);
  if(matches){assert(h.container.querySelector('.amendment-named-votes__group'));assert.match(h.container.textContent,/Unlisted Author has no recorded vote/);}
  else{assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);assert.equal(h.container.querySelector('[aria-label="Authors’ votes"]'),null);assert.match(h.container.textContent,/Vote record does not match this amendment/);assert.match(h.container.querySelector('.explorer-amendment-totals').textContent,/99/);}
 });
}

 test('named voters and author votes use dated exact-ID groups and roster country without current-group fallback',async t=>{
 const data=await voteFixture().read();
 const members=[{id:197591,firstName:'Author',lastName:'One',countryCode:'HU',groupCode:'PPE'},
 {id:197481,firstName:'Author',lastName:'Two',countryCode:'FR',groupCode:'Renew'},
 {id:999,firstName:'Unlisted',lastName:'Author',countryCode:'DE',groupCode:'PPE'},
 {id:888,firstName:'Unresolved',lastName:'Author',countryCode:'IT',groupCode:'PPE'}];
 const h=await mount(t,async()=>Response.json(data),{members});await h.render();await h.open();
 const rows=h.container.querySelectorAll('.amendment-named-votes__authors li');
 assert.match(rows[0].querySelector('.member-affiliation').textContent,/S&D · HUHungary/);
 assert.match(rows[1].querySelector('.member-affiliation').textContent,/EPP · FRFrance/);
 assert.equal(rows[2].querySelector('.member-affiliation'),null,'same name with no exact ID cannot join');
 assert.equal(rows[3].querySelector('.member-affiliation').textContent,'DEGermany','unlisted author gets no current group');
 const voter=h.container.querySelector('.amendment-named-votes__people a[href*="member=197591"]').parentElement;
 assert.match(voter.querySelector('.member-affiliation').textContent,/S&D · HUHungary/);
 const outside=h.container.querySelector('.amendment-named-votes__people a[href*="member=124846"]').parentElement;
 assert.equal(outside.querySelector('.member-affiliation').textContent,'Renew','outside roster keeps dated group only');
 assert.equal(h.calls.length,1,'affiliations start no reads');
 });
 test('missing dated membership omits the group even when the directory has one',async t=>{
 const data=await voteFixture().read();data.voters.find(v=>v.personId==='197591').group=null;
 const h=await mount(t,async()=>Response.json(data),{members:[{id:197591,countryCode:'HU',groupCode:'PPE'}]});await h.render();await h.open();
 const tag=h.container.querySelector('.amendment-named-votes__authors .member-affiliation');
 assert.equal(tag.textContent,'HUHungary');assert.equal(tag.querySelector('i'),null);
 });

test('amendment author metadata stays country-only independently of vote-date affiliation',async t=>{
 const h=await mount(t,async()=>Response.json(await voteFixture().read()),{integrated:true,members:[{id:197591,countryCode:'HU',groupCode:'PPE'}]});await h.render();
 const tag=h.container.querySelector('.explorer-amendment-authors .member-affiliation');
 assert.equal(tag.textContent,'HUHungary');assert.equal(tag.querySelector('i'),null);
});

test('named-vote group headings use the French UI language for unknown and translated groups',async t=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),{default:fr}=await import('./ui-locales/fr.json',{with:{type:'json'}});
 const i18n=createAppUiI18n({fr}),ui=i18n.forLocale('fr'),data=await voteFixture().read();
 data.voters[0].group=null;data.voters[0].groupStatus='ambiguous';
 const h=await mount(t,async()=>Response.json(data),{language:'fr',i18n});await h.render();await h.open();
 const headings=[...h.container.querySelectorAll('.amendment-named-votes__group summary>span:first-child')];assert(headings.length);
 const unknown=headings.find(node=>node.textContent===ui.t('amendmentnamedvotes.tsx.group.unknown'));assert(unknown);assert.equal(unknown.lang,'fr');
 const translated=headings.find(node=>node.textContent===ui.t('grouplabels.ts.epp'));assert(translated);assert.equal(translated.lang,'fr');
 const literal=headings.find(node=>node.textContent==='S&D');assert(literal);assert.equal(literal.lang,'');
});

test('a real snapshot conflict withholds old voters and offers a working retry',async t=>{
 let conflict=true;const h=await mount(t,async()=>conflict?Response.json({error:{code:'vote_snapshot_unavailable',message:'Snapshot changed'}},{status:409}):Response.json(await voteFixture().read()));
 await h.render();await h.open();assert.match(h.container.textContent,/Named votes unavailable/);assert.equal(h.container.querySelector('.amendment-named-votes__group'),null);
 conflict=false;await act(async()=>h.container.querySelector('button').click());assert(h.container.querySelector('.amendment-named-votes__group'));
});
