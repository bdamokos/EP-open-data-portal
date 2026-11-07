import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {voteFixture,decisionId} from '../server/test-support/decision-votes.mjs';

async function mount(t,handler,{id=decisionId,url,members=[],country=null,onCountry=()=>{}}={}) {
 const window=new Window({url:url||'http://localhost/?view=legislation&pl-mode=vote&pl-vote='+id+'&lang=en'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map();
 for(const [key,value] of Object.entries(globals)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const target=new URL(input,window.location.href);calls.push(target.pathname);return handler(target);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {VotePage}=await load('/src/VotePage.tsx'),{PersonNamesProvider}=await load('/src/PersonName.tsx'),{createRoot}=await import('react-dom/client');
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 await act(async()=>root.render(createElement(PersonNamesProvider,{members},createElement(VotePage,{decisionId:id,language:'en',country,onCountry}))));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 return {container,calls};
}
const plan={chamber:'str',seats:[{seat:1,x:0,y:100,r:5,member:197481,group:'PPE'},{seat:2,x:10,y:100,r:5,member:197591,group:'S&D'},{seat:6,x:12,y:100,r:5,member:2,group:'S&D'},{seat:3,x:20,y:100,r:5,member:124846,group:'Renew'},{seat:4,x:30,y:100,r:5,member:256852,group:'NI'},{seat:5,x:31,y:100,r:5,member:1,group:'PPE'}]};
const serve=(data,extra={})=>async target=>target.pathname.includes('decision-votes')?Response.json(data):target.pathname.includes('hemicycle')?(extra.plan===null?new Response('{}',{status:404}):Response.json(extra.plan||plan)):new Response('{}',{status:404});
test('a roll-call vote page shows the sentence, table and way line with real table semantics',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};
 const data=await f.read(),h=await mount(t,serve(data));
 assert.match(h.container.querySelector('h1').textContent,/Parliament adopted amendment 114 by 2 to 1, with 1 abstaining\./);
 const table=h.container.querySelector('.ledger table');
 assert.equal(table.querySelectorAll('thead th[scope=col]').length,4);
 assert.deepEqual([...table.querySelectorAll('tbody th[scope=row]')].map(th=>th.textContent),['EPP','S&D','Renew','Non-attached'],'plan order, non-attached last');
 assert.match(table.querySelector('thead').textContent,/4 votes cast/);
 assert.match(h.container.querySelector('.way').textContent,/For: S&D, Renew/);
 assert(!/Non-attached/.test(h.container.querySelector('.way').textContent));
 assert.equal(h.container.querySelector('.fopen .people'),null,'a fold mounts its content on first open');
 assert(!h.calls.some(path=>path.includes('member-votes')));
 assert.equal(h.container.querySelector('.member-votes-position'),null,'no member frame');
 assert.deepEqual([...h.container.querySelectorAll('.frow .t')].map(node=>node.textContent),['Members','Countries','Corrections','Documents'],'folds in order, each only with content');
});
test('corrections name a current member from the directory',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};const data=await f.read();
 const h=await mount(t,serve(data),{members:[{id:197591,firstName:'Known',lastName:'Member',countryCode:'FR'}]});
 const corrections=[...h.container.querySelectorAll('details')].find(details=>/Corrections/.test(details.querySelector('summary').textContent));
 corrections.open=true;await act(async()=>{corrections.dispatchEvent(new globalThis.window.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,10));});
 assert.match(corrections.textContent,/Known Member/);
});
test('a failed plan drops the chart and orders the table by this vote, non-attached last',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};const data=await f.read();
 const h=await mount(t,serve(data,{plan:null}));
 assert.match(h.container.textContent,/Seat chart unavailable/);
 assert.equal(h.container.querySelector('.stage svg'),null);
 assert.equal([...h.container.querySelectorAll('.ledger tbody th')].at(-1).textContent,'Non-attached');
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
 assert.match(container.querySelector('[data-vote-page] h1').textContent,/Parliament adopted amendment 114/);
 assert.equal(container.querySelector('.insight-mode-nav'),null);
 assert(!calls.some(path=>path.includes('insights/legislation')));
});
test('a show of hands has no chart, figures or person folds and opens the item folds',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};f.raw.decision_method='def/ep-entities/VOTE_HAND';for(const key of ['had_voter_favor','had_voter_against','had_voter_abstention','number_of_votes_favor','number_of_votes_against','number_of_votes_abstention','had_voter_intended_against'])delete f.raw[key];
 const data=await f.read(),h=await mount(t,serve(data));
 assert.match(h.container.querySelector('h1').textContent,/Parliament adopted amendment 114 by show of hands\./);
 assert.equal(h.container.querySelector('.ledger'),null);assert.equal(h.container.querySelector('.fig'),null);assert.equal(h.container.querySelector('.way'),null);
 assert(!/Members|Countries|Differs/.test(h.container.textContent));
 assert(!/Individual votes unavailable/.test(h.container.textContent));
});
test('conflicting records show the sentence and figures, and no voters',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};const data={...await f.read(),integrity:'conflicting',voters:[]};
 const h=await mount(t,serve(data));
 assert.equal(h.container.querySelector('.ledger'),null);assert.equal(h.container.querySelector('.stage'),null);
 assert.match(h.container.querySelector('h1').textContent,/Parliament adopted amendment 114/);
 assert.notEqual(h.container.querySelector('.fig'),null);assert.match(h.container.textContent,/Individual votes unavailable\./);
 assert(!/Members|Countries|Differs/.test(h.container.textContent));
});
test('partial records keep official figures and the published-totals line',async t=>{
 const f=voteFixture();f.raw.number_of_votes_favor=9;const data=await f.read();assert.equal(data.integrity,'partial');
 const h=await mount(t,serve(data));
 assert(h.container.querySelector('.ledger'));assert.match(h.container.querySelector('.ledger thead').textContent,/11 votes cast/);assert.match(h.container.textContent,/The named-voter list differs from Parliament’s published totals\./);
});
test('a missing official total keeps the column heads, with a dash for that total',async t=>{
 const f=voteFixture();f.raw.referenceText={en:'Article 1'};delete f.raw.number_of_votes_favor;const data=await f.read();
 const h=await mount(t,serve(data));
 const heads=[...h.container.querySelectorAll('.ledger thead th[scope=col]')];
 assert.equal(heads.length,4);
 assert.match(heads[1].textContent,/For–/);assert.match(heads[2].textContent,/Against1/);
 assert(!/votes cast/.test(heads[0].textContent),'no total without every position');
 assert.equal(h.container.querySelectorAll('.ledger tbody tr').length,4);
});
test('a decision absent from complete data reads not found',async t=>{
 const f=voteFixture();f.day.decisions=[];const data=await f.read();
 const h=await mount(t,serve(data));assert.equal(h.container.querySelector('h1').textContent,'Vote not found.');
});
test('a decision absent from partial data reads unavailable',async t=>{
 const f=voteFixture();f.day.decisions=[];const data=await f.read();
 const h=await mount(t,serve({...data,coverage:'partial'}));assert.equal(h.container.querySelector('h1').textContent,'Vote unavailable.');
});
test('an invalid identifier reads not found without a request',async t=>{
 const h=await mount(t,()=>{throw Error('Unexpected read');},{id:'not-a-decision'});assert.equal(h.container.querySelector('h1').textContent,'Vote not found.');assert(!h.calls.some(path=>path.includes('decision-votes')));
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
test('marks and head marks use the three shapes: against is a path of two bars, never a triangle',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 t.after(()=>load.close());
 const {VoteMark,againstPath}=await load('/src/VoteMark.tsx'),{renderToStaticMarkup}=await import('react-dom/server');
 const against=renderToStaticMarkup(createElement(VoteMark,{position:'against'}));
 assert.match(against,/<path /);assert(!/polygon|triangle/.test(against));
 assert.equal(againstPath(5,5,4).match(/M/g).length,2,'two bars');
 assert.match(renderToStaticMarkup(createElement(VoteMark,{position:'for'})),/<circle[^>]*fill="var\(--vote-for\)"/);
 assert.match(renderToStaticMarkup(createElement(VoteMark,{position:'abstaining'})),/fill="none"/);
});
test('the shared row shows a dash for unknown, a zero for zero and a bold rejected word',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 t.after(()=>load.close());
 const {VoteRow}=await load('/src/VoteRow.tsx'),{WordSwitch}=await load('/src/WordSwitch.tsx'),{renderToStaticMarkup}=await import('react-dom/server');
 const row=renderToStaticMarkup(createElement(VoteRow,{title:'A',word:'Rejected',rejected:true,totals:{for:0,against:null,abstaining:3}}));
 assert.match(row,/class="w no"/);assert.match(row,/class="n f zero">0</);assert.match(row,/class="n a unk">–</);assert.match(row,/class="n x">3</);
 const control=renderToStaticMarkup(createElement(WordSwitch,{label:'L',value:'a',onChange:()=>{},options:[{value:'a',label:'A'},{value:'b',label:'B'}]}));
 assert.match(control,/aria-pressed="true"[^>]*>A</);assert.match(control,/aria-pressed="false"[^>]*>B</);
});

test('choosing all countries clears a country that came from the address',async t=>{
 const f=voteFixture(),data=await f.read(),cleared=[];
 for(const voter of data.voters)data.people[voter.personId]={...data.people[voter.personId],name:'Member '+voter.personId,country:'FR'};
 const h=await mount(t,serve(data),{country:'FR',onCountry:value=>cleared.push(value)});
 const fold=[...h.container.querySelectorAll('details')].find(node=>/Countries/.test(node.querySelector('summary').textContent));
 fold.open=true;await act(async()=>{fold.dispatchEvent(new globalThis.window.Event('toggle'));});
 for(let i=0;i<100&&!fold.querySelector('button');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
 const all=[...fold.querySelectorAll('button')].find(button=>/All countries/.test(button.textContent));
 await act(async()=>{all.click();});
 assert.deepEqual(cleared,[null]);
});
