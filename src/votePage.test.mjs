import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {voteFixture,decisionId,amendmentId} from '../server/test-support/decision-votes.mjs';

async function mount(t,handler,{id=decisionId,url,members=[],country=null,onCountry=()=>{},member=null,historyState=null,language='en'}={}) {
 const window=new Window({url:url||'http://localhost/?view=legislation&pl-mode=vote&pl-vote='+id+'&lang=en'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map();
 for(const [key,value] of Object.entries(globals)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 if(historyState)window.history.replaceState(historyState,'',window.location.href);
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const target=new URL(input,window.location.href);calls.push(target.pathname);return handler(target);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {VotePage}=await load('/src/VotePage.tsx'),{PersonNamesProvider}=await load('/src/PersonName.tsx'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx'),{createRoot}=await import('react-dom/client');
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),catalogues=language==='en'?null:{[language]:(await import('./ui-locales/'+language+'.json',{with:{type:'json'}})).default};
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 const page=createElement(PersonNamesProvider,{members},createElement(VotePage,{decisionId:id,language,country,onCountry,member}));
 await act(async()=>root.render(language==='en'?page:createElement(UiI18nProvider,{i18n:createAppUiI18n(catalogues),language},page)));
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
test('French group labels keep the interface language while literal group codes stay neutral',async t=>{
 const data=await voteFixture().read(),h=await mount(t,serve(data),{language:'fr'});
 const rows=[...h.container.querySelectorAll('.ledger tbody th[scope=row] .t')];
 assert.deepEqual(rows.map(node=>[node.textContent,node.lang]),[['PPE','fr'],['S&D',''],['Renew',''],['Non-inscrits','fr']]);
});
const partData=async ({outcome='ADOPTED',wording='full',extra={}}={})=>{
 const f=voteFixture();f.raw.referenceText={en:'Amendment 114/2'};
 const data=await f.read();
 const request='MTG-PL-2026-10-07-VOT-ITM-1-SPLIT-1',uri='eli/dl/event/'+request;
 const component=(number,text)=>({componentId:request+'-'+number,number:String(number),requestUri:uri,contentByLanguage:{en:{sourceLiteral:text,text}}});
 const one=component(1,'Text as a whole without the words: ‘bracketed words’'),two=component(2,'those words');
 const {decision}=data,base={scope:decision.scope,referenceTexts:{en:'Article 1'},context:{amendmentIds:[amendmentId]},namedVotersAvailable:false};
 const label=number=>({number:String(number),requestUri:uri,requestId:request,requestScopeByLanguage:{en:'Amendment 114'}});
 const main={...base,context:{amendmentIds:[]},id:'MTG-PL-2026-10-07-DEC-9',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'conducted',totals:{for:500,against:50,abstaining:5},parts:[],referenceTexts:{en:'Motion for a resolution'}};
 const other={...base,id:'MTG-PL-2026-10-07-DEC-8',outcome,method:'VOTE_HAND',ballotStatus:'conducted',totals:{for:null,against:null,abstaining:null},parts:[label(1)]};
 const self={...base,id:decisionId,outcome:decision.outcome,method:decision.method,ballotStatus:decision.ballotStatus,totals:decision.totals,parts:[label(2)]};
 data.decision={...decision,context:{...decision.context,amendmentIds:[amendmentId]},referenceTexts:{en:'Article 1'},parts:[{...two,...label(2),contextComponents:[one,two]}]};
 data.siblings=[main,other,self];data.mainVoteId=main.id;data.subject={...(data.subject||{}),id:'item',title:'An item',titleLanguage:'en',titles:{en:'An item'},agendaItemIds:[],documentIds:['B-10-2026-0424'],procedureIds:['2025-0222'],procedures:[{id:'2025-0222',reference:'2025/0222(COD)'}],debates:[]};
 data.procedureReferral=true;
 const variant={wordingStatus:'available',language:'en',listId:'B-10-2026-0424-AM-001-200',proposedText:'(3)\tThe words before bracketed words and after.',originalText:'(3)\tThe old text.',targetLabel:'Recital 3',targetLabelLanguage:'en'};
 const passage={before:{label:{kind:'recital',value:'2',prefix:'(2)'},text:'The recital before.'},original:{label:{kind:'recital',value:'3',prefix:'(3)'},text:'The old text.'},after:{label:{kind:'point',value:'a',prefix:'(a)'},text:'The point after.'}};
 return {data,handler:async target=>{
  const body=target.searchParams.get('body');
  if(target.pathname.includes('document-context'))return body==='passage'?Response.json({version:112,documentId:'B-10-2026-0424',requestedLanguage:'en',baseline:{kind:'commission-proposal',language:'en'},placement:{operation:'replace',status:'placed',...extra.placement},passage:extra.passage===undefined?passage:extra.passage}):Response.json({version:112,documentId:'B-10-2026-0424',requestedLanguage:'en',amendment:{id:amendmentId,variants:wording==='full'?[variant]:wording==='blank'?[{...variant,proposedText:''}]:[]},placement:null});
  return serve(data)(target);
 }};
};
const text=node=>node?.textContent.replace(/\s+/g,' ').trim();
test('a part page marks its words, keys both parts, shows the amendment in its place and hides the final vote',async t=>{
 const {handler}=await partData();
 const h=await mount(t,handler);
 assert.match(text(h.container.querySelector('h1')),/Parliament adopted part 2 of amendment 114/);
 const clause=h.container.querySelector('.clause');
 assert.equal(text(clause.querySelector('h3')),'Amendment 114, recital 3');
 assert.equal(text(clause.querySelector('.run-on')),'[bracketed words]Part 2','only the part\'s own words are bold');
 assert.equal(clause.querySelector('.clause-text').getAttribute('lang'),'en');
 const key=[...clause.querySelectorAll('.clause-part')].map(text);
 assert.equal(key[0],'Part 1: Text as a whole without the words in part 2. Adopted by show of hands.');
 assert.equal(key[1],'Part 2: those words. Adopted by 2 to 1, with 1 abstaining. This vote.');
 assert.match(clause.querySelector('.clause-part a').getAttribute('href'),/pl-vote=MTG-PL-2026-10-07-DEC-8/,'the other part links to its vote');
 assert.equal(text(h.container.querySelector('h2.section')),'In its place: recital 3');
 assert.equal(text(h.container.querySelector('.place-op')),'Amendment 114: new wording for the text shown.');
 assert.equal(h.container.querySelector('.verse ins'),null,'a rewrite shows both texts whole, unmarked');
 const rows=[...h.container.querySelectorAll('.verse')].map(row=>[text(row.querySelector('.gut')),text(row.querySelector('p'))]);
 assert.deepEqual(rows,[['Recital 2','The recital before.'],['Recital 3, Commission','The old text.'],['Recital 3, amendment 114','The words before bracketed words and after.'],['(a)','The point after.']]);
 assert(h.container.querySelector('.verse.old del'),'struck: the part was adopted');
 assert.match(h.container.querySelector('.place-more a').getAttribute('href'),/pl-mode=read.*read-amendment=B-10-2026-0424-AM-114/);
 const folds=[...h.container.querySelectorAll('.frow .t')].map(node=>node.textContent);
 assert(folds.includes('Dossier'));assert(!folds.includes('The file'));assert(!folds.includes('Documents'));
 assert.doesNotMatch(h.container.textContent,/500|Source:/);
 assert.equal(h.container.querySelector('.strip a[href*="DEC-9"]'),null,'the stepper skips the final vote');
 const near=h.container.querySelector('.near-text');assert.equal(near.getAttribute('aria-expanded'),'false');
 await act(async()=>near.click());
 assert.equal(h.container.querySelector('.near-text').getAttribute('aria-expanded'),'true');
 const votes=[...h.container.querySelectorAll('details')].find(details=>/Votes on this item/.test(details.querySelector('summary').textContent));
 votes.open=true;await act(async()=>{votes.dispatchEvent(new globalThis.window.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,10));});
 const final=[...votes.querySelectorAll('.row')].find(row=>/Final vote/.test(row.textContent));
 assert.equal(text(final),'Final vote','by label only');assert.equal(final.querySelector('a'),null);
});
test('the wrong language or shape falls back to the full text and published descriptions',async t=>{
 const {handler,data}=await partData();
 data.decision.parts[0].contextComponents[0].contentByLanguage={en:{sourceLiteral:'x',text:'Text as a whole without the words: ‘not in this text’'}};
 const h=await mount(t,handler);
 const clause=h.container.querySelector('.clause');
 assert(clause.querySelector('.clause-text.plain'));
 assert.equal(clause.querySelector('.run-on'),null);
 assert.equal(text(clause.querySelector('.clause-text')),'The words before bracketed words and after.');
 assert.match(text(clause.querySelector('.clause-part')),/Part 1: Text as a whole without the words: ‘not in this text’\. Adopted by show of hands\./);
});
test('In its place follows the operation, and a failed placement is silent',async t=>{
 const insert=await partData({extra:{placement:{operation:'insert'},passage:{before:null,original:null,after:{label:null,text:'After.'}}}});
 let h=await mount(t,insert.handler);
 assert.equal(text(h.container.querySelector('.place-op')),'Amendment 114: a new provision.');
 assert.deepEqual([...h.container.querySelectorAll('.verse .gut')].map(text),['New in amendment 114','']);
});
test('a deletion says the provision is removed and marks it so, whatever the outcome',async t=>{
 const removal=await partData({extra:{placement:{operation:'delete'}}});
 removal.data.decision.outcome='REJECTED';removal.data.siblings.forEach(row=>{row.outcome='REJECTED';});
 const h=await mount(t,removal.handler);
 assert.equal(text(h.container.querySelector('.place-op')),'Amendment 114: deletion of the text shown.');
 assert.deepEqual([...h.container.querySelectorAll('.verse .gut')].map(text),['Recital 2','Recital 3, removed in amendment 114','(a)']);
 assert.match(text(h.container.querySelector('.verse.gone del')),/The old text\./,'struck with the reader\'s mark, named for screen readers');
 assert.equal(h.container.querySelector('.verse.old'),null);
});
for(const outcome of ['REJECTED','ADOPTED'])test('a replacement that keeps most words marks what it removes and adds: '+outcome,async t=>{
 {
  const close=await partData({extra:{passage:{before:null,original:{label:null,text:'The words before old words and after.'},after:null}}});
  close.data.decision.outcome=outcome;close.data.siblings.forEach(row=>{row.outcome=outcome;});
  const h=await mount(t,close.handler);
  const [original,amendment]=h.container.querySelectorAll('.verse');
  assert.match(text(original.querySelector('del')),/old/,outcome);
  assert.equal(original.querySelector('ins'),null);
  assert.match(text(amendment.querySelector('ins')),/bracketed/,outcome);
  assert.equal(amendment.querySelector('del'),null);
  assert.equal(Boolean(original.querySelector('del.struck')),outcome==='ADOPTED','an adopted replacement also strikes the original row, announced as deleted');
  assert.equal(text(amendment.querySelector('.gut')),'Recital 3, amendment 114');
 }
});
test('a deletion with no wording of its own still shows the original in its place',async t=>{
 const removal=await partData({wording:'blank',extra:{placement:{operation:'delete'}}});
 const h=await mount(t,removal.handler);
 assert.equal(text(h.container.querySelector('h2.section')),'In its place: recital 3');
 assert.deepEqual([...h.container.querySelectorAll('.verse .gut')].map(text),['Recital 2','Recital 3, removed in amendment 114','(a)']);
 assert(h.container.querySelector('.verse.gone del'));
});
test('no placement or no rows: no section and no note',async t=>{
 const unplaced=await partData({extra:{placement:{status:'unresolved'}}});
 const h=await mount(t,unplaced.handler);
 assert.equal(h.container.querySelector('h2.section'),null);
 assert.equal(h.container.querySelector('.verses'),null);
 assert.equal(h.container.querySelector('.place-op'),null);
 assert.match(text(h.container.querySelector('.clause-part')),/Part 1:/,'the key still shows');
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

const openCountries=async(t,{country=null,onCountry=()=>{},countries=['FR'],outcome=null}={})=>{
 if(!globalThis.requestAnimationFrame){globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);t.after(()=>{delete globalThis.requestAnimationFrame;});}
 const f=voteFixture(),data=await f.read();
 if(outcome)data.decision.outcome=outcome;
 data.voters.forEach((voter,index)=>{data.people[voter.personId]={...data.people[voter.personId],name:'Member '+voter.personId,country:countries[index%countries.length]};});
 const h=await mount(t,serve(data),{country,onCountry});
 const fold=[...h.container.querySelectorAll('details')].find(node=>/Countries/.test(node.querySelector('summary').textContent));
 fold.open=true;await act(async()=>{fold.dispatchEvent(new globalThis.window.Event('toggle'));});
 for(let i=0;i<100&&!fold.querySelector('.crow button');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
 return {h,fold,france:()=>[...fold.querySelectorAll('.crow button')].find(button=>button.textContent==='France')};
};
test('a country row filters Members and pressing it again clears the filter',async t=>{
 const {h,fold,france}=await openCountries(t);
 assert.equal(fold.querySelectorAll('.crow').length,1,'one row per country with a ballot');
 assert.equal(fold.querySelector('.crow .sbar').getAttribute('aria-hidden'),'true','the numbers, not the bar, carry the values');
 const shown=['for','against','abstaining'].filter(position=>fold.querySelector('.crow .n.'+{for:'f',against:'a',abstaining:'x'}[position]).textContent!=='0');
 assert.deepEqual([...fold.querySelectorAll('.crow .sbar i')].map(node=>node.className),shown.map(position=>'b-'+position),'segments follow the columns and skip zeros');
 assert.equal(fold.querySelector('.countries').getAttribute('role'),'table');
 assert.deepEqual([...fold.querySelectorAll('.crow [role]')].map(node=>node.getAttribute('role')),['rowheader','cell','cell','cell','cell'],'each number is a cell under its own head');
 assert.equal(france().getAttribute('aria-pressed'),'false');
 await act(async()=>{france().click();});
 assert.equal(france().getAttribute('aria-pressed'),'true');
 assert.match(h.container.querySelector('#members .chip').textContent,/France/);
 await act(async()=>{france().click();});
 assert.equal(france().getAttribute('aria-pressed'),'false');
 assert.equal(h.container.querySelector('#members .chip'),null);
});
test('pressing the country that came from the address clears it',async t=>{
 const cleared=[],{france}=await openCountries(t,{country:'FR',onCountry:value=>cleared.push(value)});
 assert.equal(france().getAttribute('aria-pressed'),'true','the address country reads as chosen');
 await act(async()=>{france().click();});
 assert.deepEqual(cleared,[null]);
});

const named=[{id:197481,firstName:'Ann',lastName:'Against',countryCode:'FR'},{id:197591,firstName:'Sam',lastName:'Socialist',countryCode:'FR'},{id:124846,firstName:'Rae',lastName:'Renew',countryCode:'FR'},{id:256852,firstName:'Nia',lastName:'Attached',countryCode:'DE'},{id:999,firstName:'Una',lastName:'Elsewhere',countryCode:'IE'}];
test('a vote page with a member says how they voted and leads back to them',async t=>{
 const data=await voteFixture().read();
 data.mainVoteId=null;
 const h=await mount(t,serve(data),{members:named,member:'197481'});
 const line=h.container.querySelector('.member-line');
 assert.equal(line.textContent,'Ann Against voted against, unlike the outcome.');
 assert(line.querySelector('svg.mk'),'next to its mark');
 const back=h.container.querySelector('.strip a');
 assert.match(back.textContent,/Ann Against/);
 assert.match(back.getAttribute('href'),/^\?member=197481&module=votes/);
 const sentence=h.container.querySelector('h1');
 assert.equal(sentence.nextElementSibling,line,'directly under the sentence');
 assert(!/agenda-period/.test(back.getAttribute('href')));
});
test('without a member, and for a member not on the vote, the page stays the plain vote page',async t=>{
 const data=await voteFixture().read();
 for(const [label,options] of [['no member',{}],['unknown id',{member:'424242'}]]) await t.test(label,async sub=>{
  const h=await mount(sub,serve(data),{members:named,...options});
  assert.equal(h.container.querySelector('.member-line'),null);
  assert.match(h.container.querySelector('.strip a').getAttribute('href'),/agenda-period=sitting/,'the day link stays');
 });
 await t.test('a known member who was not on this vote keeps the way back and has no line',async sub=>{
  const h=await mount(sub,serve(data),{members:named,member:'999'});
  assert.equal(h.container.querySelector('.member-line'),null);
  assert.match(h.container.querySelector('.strip a').textContent,/Una Elsewhere/);
 });
});
test('no recorded vote is stated, never counted',async t=>{
 const data=await voteFixture().read();
 data.noRecord={ids:['999'],groups:['PPE']};
 const h=await mount(t,serve(data),{members:named,member:'999'});
 assert.equal(h.container.querySelector('.member-line').textContent,'Una Elsewhere: no vote recorded');
});
test('stepping keeps the member, and their dot carries the chart focus',async t=>{
 const {data}=await partData();
 const h=await mount(t,serve(data),{members:named,member:'197481'});
 const steps=[...h.container.querySelectorAll('.step a')].map(link=>link.getAttribute('href')).filter(href=>href.startsWith('?'));
 assert(steps.length>0);
 for(const href of steps)assert.match(href,/vote-member=197481/);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
 const marked=h.container.querySelectorAll('svg .d.sel');
 assert.equal(marked.length,1);
 assert.match(marked[0].getAttribute('aria-label'),/^Ann Against/);
 assert.doesNotMatch(h.container.querySelector('.hollow').textContent,/Ann Against/,'the centre keeps the outcome');
});
test('an exact roll-call request shows as one quiet line, and nothing shows without one',async t=>{
 const data=await voteFixture().read();
 await t.test('none',async sub=>{
  const h=await mount(sub,serve(data));
  assert.doesNotMatch(h.container.textContent,/Roll call requested/);
 });
 await t.test('exact',async sub=>{
  const requested={...data,decision:{...data.decision,rollCallRequesters:[{id:'a',binding:'exact-decision-was_motivated_by',organizationLabels:{en:'S&D'}},{id:'b',binding:'other',organizationLabels:{en:'Not bound'}}]}};
  const h=await mount(sub,serve(requested));
  assert.equal([...h.container.querySelectorAll('.note')].find(node=>/Roll call/.test(node.textContent)).textContent,'Roll call requested by S&D.');
 });
});
test('after a reload the back link still goes to the exact place in the record',async t=>{
 const data=await voteFixture().read(),record='http://localhost/?member=197481&module=votes&mv-record-offset=20&lang=en';
 const h=await mount(t,serve(data),{members:named,member:'197481',historyState:{dossierOrigin:record}});
 assert.equal(h.container.querySelector('.strip a').getAttribute('href'),record);
});

// A vote on § 10, part 2 of a report: no amendment, so its wording comes from the report by number.
const paragraphVote=async ()=>{
 const f=voteFixture();
 const data=await f.read(),{decision}=data,request='MTG-PL-2026-03-11-VOT-ITM-986171-SPLIT-1',uri='eli/dl/event/'+request;
 const component=(number,text)=>({componentId:request+'-'+number,number:String(number),requestUri:uri,contentByLanguage:{en:{sourceLiteral:text,text}}});
 const one=component(1,'Text as a whole without the words: ‘including access to free, safe and legal abortion’'),two=component(2,'those words');
 const label=number=>({number:String(number),requestUri:uri,requestId:request,requestScopeByLanguage:{en:'§ 10'}});
 const base={scope:{kind:'split-part',basis:'exact-component-reference'},referenceTexts:{en:'§ 10'},context:{amendmentIds:[]},namedVotersAvailable:true};
 const main={...base,scope:{kind:'whole-text',basis:'english-reference-label'},referenceTexts:{en:'Motion for a resolution (as a whole)'},id:'MTG-PL-2026-10-07-DEC-9',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'conducted',totals:{for:500,against:50,abstaining:5},parts:[]};
 const other={...base,id:'MTG-PL-2026-10-07-DEC-8',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'conducted',totals:{for:449,against:139,abstaining:39},parts:[label(1)]};
 const self={...base,id:decisionId,outcome:decision.outcome,method:decision.method,ballotStatus:decision.ballotStatus,totals:decision.totals,parts:[label(2)]};
 data.decision={...decision,scope:base.scope,title:'A10-0021/2026 – § 10/2',referenceTexts:{en:'§ 10'},context:{documentIds:['A-10-2026-0021','PV-10-2026-03-11'],amendmentIds:[]},amendmentIds:[],parts:[{...two,...label(2),contextComponents:[one,two]}]};
 data.siblings=[main,other,self];data.mainVoteId=main.id;data.subject={...(data.subject||{}),id:'item',title:'Gender pay gap',titleLanguage:'en',titles:{en:'Gender pay gap'},agendaItemIds:[],documentIds:['A-10-2026-0021'],procedureIds:[],procedures:[],debates:[]};
 return data;
};
const provisionReply=text=>({version:113,documentId:'A-10-2026-0021',requestedLanguage:'en',provision:'paragraph:10',text,language:text?'en':null});
const withProvision=(data,text,seen=[])=>async target=>{if(target.pathname.includes('document-context')){seen.push(target.search);return Response.json(provisionReply(text));}return serve(data)(target);};
const paragraph='Calls on the EU to provide healthcare, including access to free, safe and legal abortion;';
test('a part of a report paragraph shows the wording with its words bracketed, and no box',async t=>{
 const data=await paragraphVote(),seen=[];
 const h=await mount(t,withProvision(data,paragraph,seen));
 assert.equal(seen.length,1);
 assert.match(seen[0],/^\?provision=paragraph%3A10&lang=en/);
 assert.equal(text(h.container.querySelector('.say')),'Parliament adopted § 10, part 2 by 2 to 1, with 1 abstaining.');
 const clause=h.container.querySelector('.clause');
 assert.equal(clause.querySelector('h3').textContent,'§ 10');
 assert.equal(text(clause.querySelector('.clause-text.marked')),'Calls on the EU to provide healthcare, [including access to free, safe and legal abortion]Part 2;');
 assert.equal(clause.querySelector('.run-on').textContent.replace('Part 2',''),'[including access to free, safe and legal abortion]');
 const key=[...clause.querySelectorAll('.clause-part')];
 assert.match(text(key[0]),/^Part 1: Text as a whole without the words in part 2\. Adopted by 449 to 139, with 39 abstaining\.$/);
 assert.match(text(key[1]),/^Part 2: those words\..*This vote\.$/);
 assert(key[1].classList.contains('this'));
 assert.equal(h.container.querySelector('.member-votes-part'),null,'the boxed block is gone');
 assert(!/Split vote/.test(h.container.textContent));
});
test('a vote with no document of its own asks for no wording, whatever its item holds',async t=>{
 const data=await paragraphVote(),seen=[];
 const unlinked={...data,decision:{...data.decision,title:'§ 10',context:{...data.decision.context,documentIds:[]}}};
 const h=await mount(t,withProvision(unlinked,paragraph,seen));
 assert.deepEqual(seen,[]);
 assert.equal(h.container.querySelector('.clause-text'),null);
 assert.match(text(h.container.querySelector('.clause-part.this')),/^Part 2: those words\..*This vote\.$/);
});
test('without wording the key alone says which part this vote is, with no note',async t=>{
 const data=await paragraphVote();
 const h=await mount(t,withProvision(data,null));
 const clause=h.container.querySelector('.clause');
 assert.equal(clause.querySelector('.clause-text'),null);
 assert.match(text(clause.querySelector('.clause-part.this')),/^Part 2: those words\..*This vote\.$/);
 assert(/‘including access to free, safe and legal abortion’/.test(clause.textContent),'the other part keeps its quote when nothing shortens it');
 assert.equal(h.container.querySelector('.member-votes-part'),null);
});
test('coming from a member, the text comes before the way line; otherwise the approved order stays',async t=>{
 const data=await paragraphVote();
 const order=container=>[...container.querySelector('[data-vote-page]').children].map(node=>node.classList.contains('say')?'say':node.classList.contains('member-line')?'member':node.classList.contains('clause')?'text':node.classList.contains('way')?'way':node.classList.contains('split')?'chart':null).filter(Boolean);
 await t.test('with a member',async sub=>{
  const h=await mount(sub,withProvision(data,paragraph),{members:named,member:'197481'});
  assert.deepEqual(order(h.container),['say','member','text','way','chart']);
 });
 await t.test('without one',async sub=>{
  const h=await mount(sub,withProvision(data,paragraph));
  assert.deepEqual(order(h.container),['say','way','text','chart']);
 });
});
test('a final vote asks for no provision and shows no text block',async t=>{
 const data=await paragraphVote(),seen=[];
 const final={...data,mainVoteId:decisionId,decision:{...data.decision,scope:{kind:'whole-text',basis:'english-reference-label'},referenceTexts:{en:'Motion for a resolution (as a whole)'},parts:[]},siblings:data.siblings.map(row=>row.id===decisionId?{...row,parts:[]}:row)};
 const h=await mount(t,withProvision(final,paragraph,seen));
 assert.deepEqual(seen,[]);
 assert.equal(h.container.querySelector('.clause'),null);
});
test('a paragraph voted in two split requests keeps both keys under its wording',async t=>{
 const data=await paragraphVote(),other='MTG-PL-2026-03-11-VOT-ITM-986171-SPLIT-2',uri='eli/dl/event/'+other,text2='Second request words';
 const part=data.decision.parts[0],second={...part,componentId:other+'-1',number:'1',requestUri:uri,requestId:other,contentByLanguage:{en:{sourceLiteral:text2,text:text2}},contextComponents:[]};
 data.decision={...data.decision,parts:[part,second]};
 const h=await mount(t,withProvision(data,paragraph));
 const clause=h.container.querySelector('.clause');
 assert.equal(text(clause.querySelector('.clause-text.plain')),paragraph,'no one request can mark it');
 assert.equal(clause.querySelectorAll('.clause-key').length,2);
 assert.match(clause.textContent,/Second request words/);
});
test('a delegation that broke with its group reads as one plain sentence after the member line',async t=>{
 const data=await voteFixture().read();
 // Two French EPP voters against, the EPP's majority for: two Dutch EPP voters for are added to make it.
 data.voters=[...data.voters,{personId:'500',position:'against',status:'recorded',group:{code:'PPE',orgId:'org/7018',groupId:'org/PPE'},groupStatus:'verified',groupSource:null},...['501','502','503'].map(personId=>({personId,position:'for',status:'recorded',group:{code:'PPE',orgId:'org/7018',groupId:'org/PPE'},groupStatus:'verified',groupSource:null}))];
 data.decision={...data.decision,totals:{for:5,against:2,abstaining:1},namedVoters:{...data.decision.namedVoters,counts:{for:5,against:2,abstaining:1}}};
 const members=[...named,{id:500,firstName:'Bea',lastName:'Second',countryCode:'FR'},...[501,502,503].map(id=>({id,firstName:'Dutch',lastName:String(id),countryCode:'NL'}))];
 const h=await mount(t,serve(data),{members,member:'197481'});
 assert.equal(h.container.querySelector('.member-line').textContent,'Ann Against voted against, unlike their group (EPP) and the outcome. France: both EPP MEPs voted against, unlike their group.');
});
test('a country voting together across groups reads as one plain sentence',async t=>{
 const data=await voteFixture().read(),voter=(personId,position,code,groupId)=>({personId,position,status:'recorded',group:{code,orgId:'org/'+groupId,groupId:'org/'+code},groupStatus:'verified',groupSource:null});
 // France votes against, all 4: its two S&D voters cross the S&D majority for, its EPP voter stays with the EPP.
 data.voters=[voter('197481','against','PPE','7018'),voter('197591','against','S&D','7038'),voter('124846','against','Renew','7035'),voter('256852','abstaining','NI','6561'),voter('600','against','S&D','7038'),...['601','602','603'].map(id=>voter(id,'for','S&D','7038')),...['604','605'].map(id=>voter(id,'against','PPE','7018')),voter('606','against','Renew','7035'),voter('607','for','Renew','7035'),voter('608','for','Renew','7035')];
 const counts={for:5,against:7,abstaining:1};
 data.decision={...data.decision,outcome:'REJECTED',totals:counts,namedVoters:{...data.decision.namedVoters,counts}};
 const members=[...named,{id:600,firstName:'Cy',lastName:'Crossed',countryCode:'FR'},...[601,602,603,604,605,606,607,608].map(id=>({id,firstName:'Other',lastName:String(id),countryCode:'DE'}))];
 await t.test('a member whose own delegation stayed with its group',async sub=>{
  const h=await mount(sub,serve(data),{members,member:'197481'});
  assert.equal(h.container.querySelector('.member-line').textContent,'Ann Against voted against, with their group (EPP) and the outcome. France: all 4 MEPs voted against, whatever their group.');
 });
 await t.test('a member whose delegation broke with its group hears that first',async sub=>{
  const h=await mount(sub,serve(data),{members,member:'197591'});
  assert.equal(h.container.querySelector('.member-line').textContent,'Sam Socialist voted against, unlike their group (S&D) but with the outcome. France: both S&D MEPs voted against, unlike their group.');
 });
});
test('every head sorts the countries and keeps the order in the address',async t=>{
 const {h,fold}=await openCountries(t,{countries:['FR','DE','IE','AT']});
 const heads=()=>Object.fromEntries([...fold.querySelectorAll('[role=columnheader]')].map(node=>[node.querySelector('button').textContent.replace(/[↑↓]/g,'').trim(),node.getAttribute('aria-sort')]));
 const names=()=>[...fold.querySelectorAll('.crow button')].map(button=>button.textContent);
 const press=async label=>{const head=[...fold.querySelectorAll('[role=columnheader] button')].find(button=>button.textContent.replace(/[↑↓]/g,'').trim()===label);await act(async()=>{head.click();});await act(async()=>{});};
 assert.equal(heads().Share,'descending','the winning side leads by default');
 assert.equal(globalThis.location.search.includes('vote-country-order'),false,'the default leaves the address clean');
 await press('Country');
 assert.equal(heads().Country,'ascending');assert.equal(heads().Share,'none');
 assert.deepEqual(names(),['Austria','France','Germany','Ireland']);
 assert.match(globalThis.location.search,/vote-country-order=name(&|$)/);
 await press('Country');
 assert.equal(heads().Country,'descending');
 assert.deepEqual(names(),['Ireland','Germany','France','Austria']);
 assert.match(globalThis.location.search,/vote-country-order=name-rev/);
 await press('For');
 assert.equal(heads().For,'descending','counts start largest first');
 const counts=[...fold.querySelectorAll('.crow .n.f')].map(node=>Number(node.textContent));
 assert.deepEqual(counts,[...counts].sort((a,b)=>b-a));
 assert.equal(fold.querySelectorAll('.crow.turn').length,0,'the rule belongs to the share order only');
 void h;
});
const sideOrder=async(t,outcome)=>{
 const {fold}=await openCountries(t,{countries:['FR','DE','IE','AT','EL','MT'],outcome});
 const rows=[...fold.querySelectorAll('.crow')].map(row=>({f:Number(row.querySelector('.n.f').textContent),a:Number(row.querySelector('.n.a').textContent),turn:row.classList.contains('turn')}));
 return rows;
};
for(const [outcome,win] of [['ADOPTED',row=>row.f>row.a],['REJECTED',row=>row.a>row.f]])test('in the default order the side that won leads and the rule follows its last country: '+outcome,async t=>{
 const rows=await sideOrder(t,outcome),lead=rows.filter(win).length;
 assert.ok(rows.slice(0,lead).every(win),'every country with a majority for the winning side comes first');
 assert.deepEqual(rows.map((row,index)=>row.turn?index:-1).filter(index=>index>=0),lead&&lead<rows.length?[lead-1]:[],'one rule, after the last of them, only when both kinds are present');
});
