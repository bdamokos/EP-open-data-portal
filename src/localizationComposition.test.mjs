import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';
import {Window} from 'happy-dom';
import {createUiI18n} from './uiI18n.mjs';
import {memberVotePositionState,memberVotePositionSummary} from './memberVotesPresentation.mjs';

const cases=[
 ['notConducted',{ballotStatus:'not-conducted',actualPosition:{status:'recorded',position:'for'}}],
 ['notConducted',{actualPosition:{status:'not-conducted'}}],
 ['conflicting',{actualPosition:{status:'conflicting'}}],['unavailable',{actualPosition:{status:'unavailable'}}],
 ['notIndividuallyRecorded',{actualPosition:{status:'not-individually-recorded'}}],
 ...['for','against','abstaining'].map(position=>[position,{actualPosition:{status:'recorded',position}}]),
 ['unavailable',{actualPosition:{status:'recorded',position:'UNRECOGNISED'}}],
 ['noRecordedPosition',{actualPosition:{status:'not-reported'}}],['noRecordedPosition',{}],
];
test('semantic position precedence preserves missing, unknown and source data independently of UI language',()=>{
 for(const [state,vote] of cases){const before=JSON.stringify(vote);assert.equal(memberVotePositionState(vote),state);assert.equal(JSON.stringify(vote),before);}
 const ui=createUiI18n({source:{'membervotespresentation.for':'Pour','membervotespresentation.count_position':'{count}: {position}','membervotespresentation.positions_positions':'Positions: {positions}'}}).forLocale('fr');
 assert.equal(memberVotePositionSummary([{actualPosition:{status:'recorded',position:'for'}}],ui),'Positions: 1: Pour');
});
test('approved locales render every full semantic state in both layouts and preserve raw names; other locales keep legacy contracts',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {Position}=await load('/src/MemberVoteSummary.tsx');const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
 const source=Object.fromEntries([...new Set(cases.map(([key])=>key))].map(key=>['membervotesummary.fullPosition.'+key,`{memberName} · ${key}`]));
 Object.assign(source,{'membervotesummary.membername_position':'{memberName} {position}','membervotesummary.membername_voted_position':'{memberName} voted {position}','membervotespresentation.for':'For'});
 const i18n=createUiI18n({source});
 for(const language of ['ro','lt'])for(const compact of [false,true])for(const [state,input] of cases){
 const vote={ballotStatus:'conducted',method:null,actualPosition:{status:'not-reported'},...input},before=JSON.stringify(vote);
 const markup=renderToStaticMarkup(h(UiI18nProvider,{i18n,language},h(Position,{vote,compact,memberName:'Žąsis <raw>'})));
 assert(markup.includes('Žąsis &lt;raw&gt;'));assert(markup.includes('· '+state));assert(markup.includes('lang=""'));assert.equal(JSON.stringify(vote),before);
 }
 const legacy=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'fr'},h(Position,{vote:cases[5][1],compact:true,memberName:'Raw'})));assert(legacy.includes('voted'));
});
test('recorded page summaries preserve filtered and unfiltered scopes, null and zero pages, and restrict new contracts to approved locales',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {votePageSummary}=await load('/src/MemberVotes.tsx');
 for(const language of ['ro','lt','fr'])for(const positions of ['recorded','all'])for(const mode of ['period','page'])for(const returned of [0,5])for(const recordedTotal of [null,0,71])for(const status of ['complete','partial']){
 const data={pagination:{mode,returned,recordedTotal,filteredTotal:17,offset:50},coverage:{status}},before=JSON.stringify(data);let call;
 votePageSummary(data,positions,{language,t:(id,values)=>{call={id,values};return id;}});
 const approved=language!=='fr'&&positions==='recorded'&&recordedTotal!==null;
 assert.equal(call.id.startsWith('membervotes.summary.recorded.'),approved);
 if(approved){assert.equal(call.id,`membervotes.summary.recorded.${mode==='period'?'period':returned?'page':'emptyPage'}`);assert.equal(call.values.recordedCount,recordedTotal);assert.equal(call.values.total,17);assert.equal(call.values.start,51);assert.equal(call.values.end,50+returned);}
 if(recordedTotal===null)assert(!call.id.includes('recordedcount'));
 assert.equal(JSON.stringify(data),before);
 }
});
test('controlled final-text outcomes translate known codes and retain unknown source values and unknown language',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {VoteOutcome}=await load('/src/FinalTextCheck.tsx');const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
 const codes=['ADOPTED','REJECTED','LAPSED','WITHDRAWN','CANCELLED'];
 const i18n=createUiI18n({source:Object.fromEntries(codes.map(code=>['membervotespresentation.'+code.toLowerCase(),'translated '+code]))});
 for(const outcome of [...codes,'SOURCE_New_VALUE']){const result=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'ro'},h(VoteOutcome,{outcome})));assert(result.includes(codes.includes(outcome)?'translated '+outcome:outcome));assert(result.includes(codes.includes(outcome)?'lang="ro"':'lang=""'));}
});
test('Romanian contextual stages leave standalone labels intact and non-approved locales never request contextual keys',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {contextNamesUi,namesUi,documentNamesUi}=await load('/src/MotionComparison.tsx');
 for(const language of ['ro','lt','en','fr']){
 const calls=[],ui={language,t:id=>{calls.push(id);return id;}};
 const standalone=namesUi(ui),documents=documentNamesUi(ui);calls.length=0;
 const context=contextNamesUi(ui);
 assert.deepEqual(Object.keys(context),['original','joint','adopted']);
 assert.equal(calls.some(id=>id.startsWith('MotionComparison.contextStage.')),language==='ro');
 assert.deepEqual(namesUi(ui),standalone);assert.deepEqual(documentNamesUi(ui),documents);
 }
});
test('independent demographic counts and Lithuanian whole containment message retain their numeric meanings',async t=>{
 const window=new Window({url:'http://localhost/'});const old=globalThis.window,oldDocument=globalThis.document;globalThis.window=window;globalThis.document=window.document;t.after(async()=>{globalThis.window=old;globalThis.document=oldDocument;await window.happyDOM.close();});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {InsightDemographics,genderName}=await load('/src/InsightShared.tsx');const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
 const id='insightshared.count_current_meps_outsidecount_outsiderosterlabel_each_person_counted_once.c653ed';
 const source={[id]:'Current: {count} · {outsideRosterLabel}: {outsideCount}','insightshared.genderFemale':'Women','insightshared.genderMale':'Men','insightshared.not_provided':'Not supplied'};
 const i18n=createUiI18n({source});const ui=i18n.forLocale('ro');
 assert.equal(genderName('Female',ui),'Women');assert.equal(genderName('Male',ui),'Men');assert.equal(genderName('Unknown',ui),'Not supplied');assert.equal(genderName('SOURCE_UNKNOWN',ui),'SOURCE_UNKNOWN');
 const stats={dimensions:{country:[],group:[],gender:[],age:[]},denominator:99,uniqueCurrentMeps:21,peopleOutsideCurrentRoster:2,referenceDate:'2026-10-01'};
 const before=JSON.stringify(stats);const result=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'ro'},h(InsightDemographics,{stats,outsideRosterLabel:'Raw caller label'})));
 assert(result.includes('Current: 21 · Raw caller label: 2'));assert.equal(JSON.stringify(stats),before);
 const {createAppUiI18n}=await load('/src/uiCatalogues.mjs');const {default:lt}=await load('/src/ui-locales/lt.json');
 const lithuanian=createAppUiI18n({lt}).forLocale('lt');
 for(const id of ['speechcloud.in_count_speech.b044c6','speechcloud.in_count_speeches.a25a1a'])for(const count of [0,1,2,9,10,11,19,20,21,22,100])assert.equal(lithuanian.t(id,{count}),`Kalbų, kuriose yra šis terminas, skaičius: ${count}`);
});

test('procedure stages, coverage dates and attendance use the active UI formatter',async t=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs');
 const {default:fr}=await import('./ui-locales/fr.json',{with:{type:'json'}});
 const ui=createAppUiI18n({fr}).forLocale('fr');
 const {summaryStage}=await import('./terms.mjs');
 for(const [stage,id] of [['parliament-decision','terms.parliamentDecision'],['final-act','terms.finalAct'],['proposal','batch6.references.commission.proposal.25'],['document','batch5.procedurecontext.tsx.33.71'],['unknown','batch5.procedurecontext.tsx.33.71']])assert.deepEqual(summaryStage(stage,'fr',ui),{text:ui.t(id),language:'fr'});
 const {memberVotesCoverageNotice}=await import('./memberVotesPresentation.mjs');
 const data={coverage:{status:'partial',failedSittingIds:['MTG-PL-2026-01-12'],catalogue:{state:'partial'}}};
 const date=new Intl.DateTimeFormat('fr',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date('2026-01-12T12:00:00Z'));
 assert.equal(memberVotesCoverageNotice(data,{},ui),ui.t('membervotespresentation.incomplete_voting_records')+' · '+date+' · '+ui.t('membervotespresentation.sitting_dates_incomplete'));
 assert.equal(data.coverage.failedSittingIds[0],'MTG-PL-2026-01-12');
 const {memberAttendanceLine}=await import('./memberAttendancePresentation.mjs');
 const attendance=memberAttendanceLine([{date:'2026-01-12',status:'observed',memberStatus:'listed-present'}],ui);
 assert(attendance.includes(new Intl.DateTimeFormat('fr',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date('2026-01-12T12:00:00Z'))));
});

test('translated chart and intervention labels keep their UI language and raw group identity',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {createAppUiI18n}=await load('/src/uiCatalogues.mjs'),{default:fr}=await load('/src/ui-locales/fr.json');
 const {UiI18nProvider}=await load('/src/UiI18nReact.tsx'),{GroupDonut}=await load('/src/InsightCharts.tsx');
 const i18n=createAppUiI18n({fr}),ui=i18n.forLocale('fr');
 const markup=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'fr'},h(GroupDonut,{rows:[{label:'NI',count:5},{label:'EPP',count:5}],contributions:{total:10,unavailable:0}})));
 assert(markup.includes(ui.t('batch4.insightcharts.tsx.contributions')));assert(!markup.includes('lang="en"'));
 assert(!markup.includes('of contributions'));
 const window=new Window();t.after(()=>window.happyDOM.close());
 window.document.body.innerHTML=markup;
 for(const node of window.document.querySelectorAll('circle[aria-label]'))assert.equal(node.closest('[lang]').getAttribute('lang'),'fr');
 const {QuestionTrend}=await load('/src/InsightCharts.tsx');
 const trend=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'fr'},h(QuestionTrend,{language:'fr',selected:true,scope:'Eau',scopeLanguage:'fr',comparison:true,onRange(){},data:{interval:'week',bins:[{start:'2026-01-12',end:'2026-01-18',count:3,total:8,share:37.5}]}})));
 window.document.body.innerHTML=trend;
 for(const selector of ['svg[role="group"]','svg g[role="button"]','option[value="2026-01-12"]'])assert.equal(window.document.querySelector(selector).closest('[lang]').getAttribute('lang'),'fr');
 assert.equal(window.document.querySelector('h2 span').getAttribute('lang'),'fr');

 const {InterventionBadges}=await load('/src/SpeechInterventions.tsx');
 const badge=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'fr'},h(InterventionBadges,{value:{type:'written',onBehalfOf:[]},language:'fr'})));
 assert(badge.includes('lang="fr"'));assert(!badge.includes('lang="en"'));assert(badge.includes(ui.t('insightshared.written_statement')));
});

test('PPE legend and hovered caption use UI language while raw group labels remain source values',async t=>{
 const window=new Window({url:'http://localhost/?lang=fr'});
 const globals={window,document:window.document,HTMLElement:window.HTMLElement,HTMLIFrameElement:window.HTMLIFrameElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 let load,root;
 const {act}=await import('react');
 t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {createAppUiI18n}=await load('/src/uiCatalogues.mjs'),{default:fr}=await load('/src/ui-locales/fr.json');
 const {UiI18nProvider}=await load('/src/UiI18nReact.tsx'),{GroupDonut}=await load('/src/InsightCharts.tsx'),{groupLabel,groupLabelLanguage}=await load('/src/groupLabels.ts');
 const i18n=createAppUiI18n({fr}),ui=i18n.forLocale('fr'),container=window.document.createElement('div');window.document.body.append(container);
 const {createRoot}=await import('react-dom/client');root=createRoot(container);
 await act(async()=>root.render(h(UiI18nProvider,{i18n,language:'fr'},h(GroupDonut,{rows:[{label:'PPE',count:5},{label:'SOURCE_GROUP',count:5}],contributions:{total:10,unavailable:0},onSelect(){}}))));
 const labels=[...container.querySelectorAll('li button span[lang]')];
 assert.equal(labels[0].textContent,groupLabel('PPE',ui));assert.equal(labels[0].lang,'fr');
 assert.equal(labels[1].textContent,'SOURCE_GROUP');assert.equal(labels[1].lang,'');
 await act(async()=>container.querySelector('circle[aria-label]').dispatchEvent(new window.FocusEvent('focusin',{bubbles:true})));
 const caption=container.querySelector('.insight-donut-caption');assert.equal(caption.textContent,groupLabel('PPE',ui));assert.equal(caption.getAttribute('lang'),'fr');
 assert.equal(groupLabel('constructor',ui),'constructor');assert.equal(groupLabelLanguage('constructor',ui),'');
});

test('Lithuanian followed report and opinion summaries use complete role constructions at every native count',async()=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs');
 const {default:lt}=await import('./ui-locales/lt.json',{with:{type:'json'}});
 const {summarizeByType,categoryLabelsUi}=await import('./followUpdates.mjs');
 const ui=createAppUiI18n({lt}).forLocale('lt');
 for(const category of ['reports-rapporteur','reports-shadow','opinions-rapporteur','opinions-shadow']) {
  assert(!categoryLabelsUi(ui)[category][0].includes('kaip'));
  for(const count of [1,2,10,11,21]) {
   const entries=Array.from({length:count},(_,i)=>({id:'exact-'+i,recordKind:'document',category,title:'Source title',titleLanguage:'fr'}));
   const before=JSON.stringify(entries),summary=summarizeByType(entries,0,ui);
   assert(!summary.includes('kaip pranešėjo'));assert(!summary.includes('kaip šešėlinio pranešėjo'));
   assert(summary.includes(String(count)));assert.equal(JSON.stringify(entries),before);
   if(count===1)assert.equal(summary.replace(/^1 /,''),categoryLabelsUi(ui)[category][0]);
  }
 }
});

test('proposal controls and missing amendment targets use UI language around French source text',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {createAppUiI18n}=await load('/src/uiCatalogues.mjs'),{default:hu}=await load('/src/ui-locales/hu.json'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx');
 const {ProposalContextText}=await load('/src/ProposalContextText.tsx');
 const source={url:'https://example.test/exact-original.docx',stale:false,refreshError:null};
 const proposal={paragraphs:[{index:0,text:'Texte français exact.',objects:[],formatting:[],complete:true,source:null,properties:null}],anchors:[],links:[],notes:[],units:[],gaps:[{code:'excerpted-source'}],contentComplete:false};
 const data={documentId:'A-10-2026-0042',baseline:{kind:'proposal',language:'fr',celex:null,items:[{source}],gaps:[],attribution:'Exact source attribution'},proposal:{items:[{kind:'act',index:1,proposal}]},placement:{status:'unresolved',reason:'target_not_found'}};
 const before=JSON.stringify(data),i18n=createAppUiI18n({hu}),window=new Window();t.after(()=>window.happyDOM.close());
 const html=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'hu'},h('div',{lang:'hu'},h(ProposalContextText,{data,wording:null,language:'hu'}))));window.document.body.innerHTML=html;
 for(const selector of ['.proposal-item-heading','.proposal-context-text .document-context-notice','.proposal-context-text .document-context-source'])assert.equal(window.document.querySelector(selector).closest('[lang]').getAttribute('lang'),'hu');
 const text=[...window.document.querySelectorAll('.proposal-context-text p')].find(node=>node.textContent==='Texte français exact.');assert(text);assert.equal(text.closest('[lang]').getAttribute('lang'),'fr');assert.equal(JSON.stringify(data),before);
 const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 t.after(()=>{for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 const {AmendmentCard}=await load('/src/Amendments.tsx');
 const item={id:'A-10-2026-0042-AM-1',targetDocumentId:'A-10-2026-0042',number:1,titles:{},language:'fr',targetLabel:null,originalText:'Texte initial.',proposedText:'Texte proposé.',authors:[],sources:[],decisions:[],splitParts:[],outcome:'unavailable'};
 const card=renderToStaticMarkup(h(UiI18nProvider,{i18n,language:'hu'},h(AmendmentCard,{item,language:'hu',reader:true,showOutcome:false})));
 window.document.body.innerHTML=card;
 const target=window.document.querySelector('.explorer-amendment-target');assert.equal(target.getAttribute('lang'),'hu');assert.equal(target.textContent,i18n.forLocale('hu').t('amendmentmodel.mjs.target.provision.unavailable'));
});
