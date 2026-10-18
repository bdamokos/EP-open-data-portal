import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const MEMBER=197673,WEEK='2026-03-23',SITTING='MTG-PL-2026-03-25',SNAPSHOT='a'.repeat(64);
const SUBJECT='MTG-PL-2026-03-25-VOT-ITM-8',DOCUMENT='A-10-2026-0001',AMENDMENT=DOCUMENT+'-AM-7';
const decision=number=>SITTING+'-DEC-'+number;
const emptyPage={state:'complete',pages:1,rows:0,stopReason:'end',error:null,sources:[]};

function vote(number,patch={}) {
  return {
    id:decision(number),uri:'https://data.europarl.europa.eu/eli/dl/event/'+decision(number),sittingId:SITTING,date:'2026-03-25',
    titles:{en:'Synthetic decision '+number},referenceTexts:{en:'Decision '+number},title:'Synthetic decision '+number,titleLanguage:'en',
    method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',ballotStatus:'conducted',scope:{kind:'amendment',basis:'exact-component-reference'},
    actualPosition:{status:'recorded',position:'for'},intention:{status:'not-reported',positions:[]},sourceConflicts:null,
    totals:{for:400,against:200,abstaining:0},namedVoters:{available:true,counts:{for:400,against:200,abstaining:0},totalsMatch:true,conflictingPersonIds:[],malformedReferences:0},
    subjectId:SUBJECT,resultRelationship:{inverseResultIds:[SUBJECT],forwardResultIds:[SUBJECT],binding:'consistent'},parts:[],rollCallRequesters:[],
    evidenceGaps:[],evidencePaths:[],historicalGroup:null,
    context:{resultIds:[SUBJECT],agendaItemIds:[],documentIds:[],procedureIds:[],amendmentIds:[],componentIds:[],missingResultIds:[],missingAgendaItemIds:[],relationships:[]},
    sources:{decisions:[],results:[],agenda:[]},...patch,
  };
}
function subject(items,patch={}) {
  return {
    id:SUBJECT,uri:'https://data.europarl.europa.eu/eli/dl/event/'+SUBJECT,titles:{en:'Synthetic subject ***II'},title:'Synthetic subject ***II',titleLanguage:'en',
    documentIds:[],agendaItemIds:[],declaredDecisionIds:items.map(item=>item.id),observedDecisionIds:items.map(item=>item.id),
    counts:{observed:items.length,filtered:items.length,page:items.length},wholeTextDecisions:[],gaps:[],evidencePaths:[],sources:{results:[],decisions:[]},...patch,
  };
}
function part(number,patch={}) {
  return {componentId:DOCUMENT+'-SPLIT-'+number,uri:'https://example.test/part/'+number,requestUri:'https://example.test/request/1',number,
    contentByLanguage:{en:{sourceLiteral:'Published description of part '+number,text:'Published description of part '+number}},gaps:[],evidencePaths:[],
    requestId:'exact-request-1',resultId:SUBJECT,requestScopeByLanguage:{en:'Paragraph 4'},contextComponents:[],...patch};
}
function stateFrom(url) {
  const params=new URL(String(url),'http://localhost').searchParams;
  return {week:params.get('week')||WEEK,sittingId:params.get('sitting'),positions:params.get('positions')||'recorded',offset:Number(params.get('offset')||0),
    decisionId:params.get('decision'),snapshotId:params.get('snapshot')};
}
function responseFor(url,{items=[vote(1)],subjects,selected,snapshotId=SNAPSHOT,pagination={},coverage={},...patch}={}) {
  const state=stateFrom(url),week=state.week==='latest'?WEEK:state.week;
  return {version:2,member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER,mandateStatus:'not-assessed',historicalGroupStatus:'not-collected'},
    period:state.sittingId?{kind:'sitting',week:null,sittingId:state.sittingId,from:state.sittingId.slice(7),to:state.sittingId.slice(7)}:{kind:'week',week,sittingId:null,from:week,to:new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)},
    snapshotId,positions:state.positions,subjects:subjects??[subject(items)],
    pagination:{offset:state.offset,limit:50,returned:items.length,observedTotal:state.offset+items.length,filteredTotal:state.offset+items.length,nextOffset:null,...pagination},items,
    selected:selected??(state.decisionId?{status:'found',item:items.find(item=>item.id===state.decisionId)||null}:{status:'not-requested',item:null}),
    coverage:{status:'complete',collectionComplete:true,termWide:false,expectedSittingIds:[SITTING],scannedSittingIds:[SITTING],failedSittingIds:[],incompleteSittingIds:[],catalogue:emptyPage,sittings:[],basis:'Synthetic exact API fixture',...coverage},
    attribution:'European Parliament public data',...patch};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
const visiblePane=container=>[...container.querySelectorAll('.member-votes-pane')].find(item=>!item.hidden);

async function mount(t,{state={},handler=url=>Response.json(responseFor(url)),statusCompatibility=false,renderContext}={}) {
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,current,props,renderKey=0;
  const calls=[],changes=[],contexts=[];
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(String(url));return handler(url,options,calls.length);});
  // The parent owns the hook's optional HTTP status field. Exercise that integration in memory
  // until it lands here; all other cases use the worktree's unmodified shared hook.
  const plugins=statusCompatibility?[{name:'member-votes-shared-status-contract',enforce:'pre',transform(source,id){
    if(!id.split('?')[0].endsWith('/src/data.ts')||/\bstatus\??\s*:\s*number\b/.test(source))return null;
    const needle='error: e.message, retryAt: e.retryAt, loading: false';
    assert(source.includes(needle),'shared hook changed; remove or update the temporary status compatibility transform');
    return source.replace(needle,'error: e.message, retryAt: e.retryAt, status: e.status, loading: false');
  }}]:[];
  vite=await createServer({configFile:false,plugins,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await vite.ssrLoadModule('/src/MemberVotes.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  current={...structuredClone(module.defaultMemberVotesState),...state};
  const draw=()=>root.render(createElement(module.MemberVotes,{...props,state:current,key:renderKey}));
  props={memberId:MEMBER,memberName:'Test member',language:'en',onStateChange:(next,options)=>{current=next;changes.push({state:structuredClone(next),options});draw();},
    renderContext:request=>{contexts.push(request);return renderContext?renderContext(request):createElement('div',{'data-testid':'context'},request.documentId,createElement('button',{onClick:request.onBack},'Back from context'));}};
  await act(async()=>draw());
  return {container,calls,changes,contexts,module,get state(){return current;},async update(patch){await act(async()=>{current={...current,...patch};draw();});},
    async remount(){await act(async()=>{renderKey++;draw();});},
    async click(text){const target=button(container,text);assert(target,'Missing button: '+text);await act(async()=>target.click());},
    async select(selector,value){const target=container.querySelector(selector);assert(target,'Missing control: '+selector);await act(async()=>{target.value=value;target.dispatchEvent(new window.Event('change',{bubbles:true}));});}};
}

function wordingVariant(patch={}) {
  return {listId:'exact-published-list',wordingStatus:'available',language:'fr',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',
    originalText:'Texte original exact',proposedText:'Texte proposé exact',authors:[],...patch};
}
async function mountWording(t,{variants,amendmentStatus='available',state={}}) {
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  return mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id,...state},handler:url=>String(url).includes('document-context/')?
    Response.json({documentId:DOCUMENT,requestedLanguage:'en',document:null,amendment:{id:AMENDMENT,status:amendmentStatus,variants}}):Response.json(responseFor(url,{items:[item]}))});
}

test('default request explicitly filters recorded positions and canonical period/snapshot replace navigation',async t=>{
  const h=await mount(t);
  assert.deepEqual(h.module.defaultMemberVotesState,{week:'latest',sittingId:null,positions:'recorded',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null});
  const initial=new URL(h.calls[0],'http://localhost');
  assert.equal(initial.pathname,'/api/member-votes/'+MEMBER);
  assert.equal(initial.searchParams.get('week'),'latest');assert.equal(initial.searchParams.get('positions'),'recorded');
  assert.equal(initial.searchParams.get('limit'),'50');assert.equal(initial.searchParams.get('lang'),'en');
  assert.equal(h.state.week,WEEK);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert(h.changes.every(change=>change.options?.replace===true));
  assert.equal(button(h.container,'Recorded positions').getAttribute('aria-pressed'),'true');
  await h.click('All decisions');
  assert.equal(h.state.positions,'all');assert.equal(h.state.offset,0);assert.equal(h.changes.at(-1).options.replace,false);
  assert.equal(new URL(h.calls.at(-1),'http://localhost').searchParams.get('positions'),'all');
});

test('API responses for the wrong member, period, filter, page or pinned snapshot never render their rows',async t=>{
  for(const [label,mutate] of [
    ['member',data=>({...data,member:{...data.member,id:'999999'}})],
    ['period',data=>({...data,period:{kind:'week',week:'2026-03-30',sittingId:null,from:'2026-03-30',to:'2026-04-05'}})],
    ['filter',data=>({...data,positions:'all'})],
    ['page',data=>({...data,pagination:{...data.pagination,offset:50}})],
    ['snapshot',data=>({...data,snapshotId:'b'.repeat(64)})],
    ['requester binding',data=>({...data,items:[{...data.items[0],rollCallRequesters:[{id:'unbound',organizationLabels:{en:'Unbound requester'},binding:'different-decision'}]}]})],
  ])await t.test(label,async child=>{
    const h=await mount(child,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(mutate(responseFor(url)))});
    assert.match(h.container.textContent,/The requested voting records are unavailable here/);
    assert.equal(h.container.querySelector('.member-votes-row'),null);
    assert.equal(h.changes.length,0,'an invalid response cannot rewrite the requested URL state');
  });
});

test('a selected off-page decision uses its pinned projection without selecting the first page row',async t=>{
  const page=vote(1,{referenceTexts:{en:'On-page decision'}}),selected=vote(99,{referenceTexts:{en:'Exact off-page decision'},actualPosition:{status:'no-record',position:null},method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}});
  const h=await mount(t,{state:{week:WEEK,decisionId:selected.id,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items:[page],selected:{status:'found',item:selected}}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('h2').textContent,'Exact off-page decision');
  assert.match(detail.textContent,/No recorded position for this vote\./);assert.match(detail.textContent,/Show of hands/);
  assert(!detail.textContent.includes('On-page decision'));
  assert.equal(h.state.decisionId,selected.id);assert.equal(h.state.positions,'recorded');
});

test('unknown or mismatched decision deep links never fall back to another page decision',async t=>{
  for(const status of ['not-found-in-scanned-data','unavailable','mismatched'])await t.test(status,async child=>{
    const h=await mount(child,{state:{week:WEEK,decisionId:decision(999),snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{selected:status==='mismatched'?{status:'found',item:vote(1)}:{status,item:null}}))});
    assert.match(h.container.textContent,status==='mismatched'?/The requested voting records are unavailable here/:/The requested decision is unavailable in this period/);
    assert.equal(h.container.querySelector('.member-votes-detail'),null);
    assert.equal(h.state.decisionId,decision(999));
  });
});

test('exact subject grouping keeps split parts separate, preserves title language and shows independent whole-text outcomes',async t=>{
  const parts=[vote(1,{outcome:'REJECTED',parts:[part(1)]}),vote(2,{parts:[part(2)]})];
  const whole=vote(3,{scope:{kind:'whole-text',basis:'exact-component-reference'},outcome:'ADOPTED',method:'VOTE_HAND',actualPosition:{status:'no-record',position:null}});
  const sameTitleDifferentIdentity={...subject([vote(4)]),id:'distinct-result',titles:{fr:'Objet de test ***III'},title:'Objet de test ***III',titleLanguage:'fr'};
  const items=[...parts,vote(4,{subjectId:'distinct-result'})];
  const subjects=[subject(parts,{titles:{fr:'Objet de test ***III'},title:'Objet de test ***III',titleLanguage:'fr',wholeTextDecisions:[whole]}),sameTitleDifferentIdentity];
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT,'distinct-result']},handler:url=>Response.json(responseFor(url,{items,subjects}))});
  assert.equal(h.container.querySelectorAll('.member-votes-subject').length,2,'matching source titles do not join distinct exact subjects');
  const groups=[...h.container.querySelectorAll('.member-votes-subject')];
  assert.equal(groups[0].querySelectorAll('.member-votes-row').length,2);
  const heading=groups[0].querySelector('span[title]');assert.equal(heading.textContent,'Objet de test');assert.equal(heading.title,'Objet de test ***III');assert.equal(heading.lang,'fr');
  assert.match(groups[0].querySelector('.member-votes-whole').textContent,/Whole text: Adopted · No recorded MEP position/);
  assert.match(groups[0].querySelectorAll('.member-votes-row')[0].textContent,/Part 1.*Rejected/);
  assert.match(groups[0].querySelectorAll('.member-votes-row')[1].textContent,/Part 2.*Adopted/);
  await act(async()=>groups[0].querySelector('h3 button').click());
  assert.equal(h.state.expandedSubjectIds.includes(SUBJECT),false);assert.equal(h.changes.at(-1).options.replace,true);
  assert.equal(h.container.querySelector('.member-votes-subject h3 button').getAttribute('aria-expanded'),'false');
});

test('a subject without agenda/document context remains visible with only its exact source title',async t=>{
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:decision(1)},handler:url=>Response.json(responseFor(url,{subjects:[subject([vote(1)],{titles:{en:'Exact result subject'},title:'Exact result subject'})]}))});
  assert.match(visiblePane(h.container).textContent,/Exact result subject/);
  assert.equal(h.container.querySelector('.member-votes-documents'),null);
  const sources=h.container.querySelectorAll('.member-votes-source a');assert.equal(sources.length,1);
  assert.equal(sources[0].href,'https://www.europarl.europa.eu/doceo/document/PV-10-2026-03-25-VOT_EN.html');
  assert(!visiblePane(h.container).textContent.includes(decision(1)));assert(!visiblePane(h.container).textContent.includes(SNAPSHOT));
});

test('off-page whole-text outcomes do not add empty subjects or hide the recorded-position empty state',async t=>{
  const whole=vote(3,{scope:{kind:'whole-text',basis:'exact-component-reference'},actualPosition:{status:'no-record',position:null}});
  const absent=subject([],{id:'off-page-subject',counts:{observed:1,filtered:0,page:0},wholeTextDecisions:[whole]});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items:[],subjects:[absent],pagination:{observedTotal:1,filteredTotal:0}}))});
  assert.equal(h.container.querySelectorAll('.member-votes-subject').length,0);
  assert.match(visiblePane(h.container).textContent,/No recorded positions are available for this period/);
  assert(button(h.container,'All decisions'),'the other decisions remain one action away');
});

test('null totals, real zero totals and lapsed decisions remain distinct without invented member choices',async t=>{
  const items=[vote(1,{totals:{for:0,against:0,abstaining:0}}),vote(2,{totals:{for:400,against:null,abstaining:0}}),
    vote(3,{outcome:'LAPSED',ballotStatus:'not-conducted',method:null,actualPosition:{status:'not-conducted',position:null},totals:{for:null,against:null,abstaining:null}}),
    vote(4,{method:'VOTE_HAND',actualPosition:{status:'recorded',position:'for'},totals:{for:null,against:null,abstaining:null}})];
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,positions:'all',expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items}))});
  const rows=h.container.querySelectorAll('.member-votes-row');
  assert.equal(rows[0].querySelector('.member-votes-bar'),null);assert.deepEqual([...rows[0].querySelectorAll('.member-votes-counts b')].map(item=>item.textContent),['0','0','0']);
  assert.equal(rows[1].querySelector('.member-votes-bar,.member-votes-counts'),null);assert.match(rows[1].textContent,/Tallies unavailable/);
  assert.match(rows[2].textContent,/Not put to a vote.*Lapsed/);assert.equal(rows[2].querySelector('.member-votes-bar,.member-votes-counts'),null);
  assert.match(rows[3].textContent,/No recorded position for this vote\./);assert.equal(rows[3].querySelector('.member-votes-position-for'),null);
});

test('actual FOR, later intention to abstain and official raw counts are displayed independently',async t=>{
  const item=vote(1,{intention:{status:'reported',positions:['abstaining']},totals:{for:412,against:183,abstaining:0}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('.member-votes-position strong').textContent,'For');
  assert.match(detail.querySelector('.member-votes-intention').textContent,/Declared intention: Abstain.*official result and totals are unchanged/);
  assert.equal(detail.querySelector('.member-votes-bar').getAttribute('aria-label'),'For 412, Against 183, Abstaining 0');
  assert.deepEqual([...detail.querySelectorAll('.member-votes-counts b')].map(item=>item.textContent),['412','183','0']);
  assert(!/majority|attendance|success|\d%/.test(detail.textContent));
});

test('detail renders exact split wording, sibling context and only exact requesters',async t=>{
  const component=part(2,{contentByLanguage:{fr:{sourceLiteral:'Littéral exact de la deuxième partie',text:null}}});
  const first=vote(1,{parts:[part(1,{contentByLanguage:{fr:{sourceLiteral:'Littéral exact de la première partie',text:null}},contextComponents:[component]})],outcome:'REJECTED',rollCallRequesters:[
    {id:'requester-1',uri:'https://example.test/requester',type:'REQUEST_ROLLCALL',scopeByLanguage:{},organizationLabels:{fr:'Demandeur exact'},organizationReferences:[],organizationAliasReferences:[],binding:'exact-decision-was_motivated_by',evidencePaths:[]},
  ]});
  const sibling=vote(2,{parts:[part(2)],outcome:'ADOPTED'});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:first.id},handler:url=>Response.json(responseFor(url,{items:[first,sibling]}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('.member-votes-part p').textContent,'Littéral exact de la première partie');assert.equal(detail.querySelector('.member-votes-part p').lang,'fr');
  assert.match(detail.querySelector('.member-votes-related').textContent,/Littéral exact de la deuxième partie.*Each part has its own decision and outcome/);
  assert.match(detail.querySelector('.member-votes-siblings').textContent,/Part 2 · Adopted/);
  assert.match(detail.querySelector('.member-votes-requester').textContent,/Roll call requested by Demandeur exact/);assert(!detail.textContent.includes('Unbound requester'));
  await h.click('Part 2 · Adopted');assert.equal(h.state.decisionId,sibling.id);
});

test('amendment wording loads only after decision selection and requires an explicit exact published variant before context',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const variants=[{listId:'exact-published-list-fr',wordingStatus:'available',language:'fr',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',originalText:'Texte original exact',proposedText:'Texte proposé exact',authors:[{name:'Exact amendment proposer'}]},
    {listId:'exact-published-list-hu',wordingStatus:'available',language:'hu',targetLabel:'4. bekezdés',targetLabelLanguage:'hu',originalText:'Eredeti pontos szöveg',proposedText:'Javasolt pontos szöveg',authors:[{name:'Második pontos javaslattevő'}]}];
  const initial={week:WEEK,sittingId:null,positions:'recorded',offset:50,decisionId:item.id,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT,'another-exact-subject'],context:null};
  const h=await mount(t,{state:{...initial,decisionId:null},handler:url=>String(url).includes('document-context/')?Response.json({version:1,documentId:DOCUMENT,requestedLanguage:'en',document:null,related:{status:'not-requested',items:[],gaps:[]},amendment:{id:AMENDMENT,status:'available',basis:'published-list',variants,gaps:[]},target:{status:'not-requested',paragraphs:[],basis:null,relation:null,quoteMatches:null,reason:null},sources:[]}):Response.json(responseFor(url,{items:[vote(2)],selected:stateFrom(url).decisionId?{status:'found',item}:{status:'not-requested',item:null},subjects:[subject([item],{counts:{observed:51,filtered:51,page:1}})],pagination:{observedTotal:51,filteredTotal:51}}))});
  assert.equal(h.calls.filter(url=>url.includes('document-context/')).length,0);
  assert.equal(h.container.querySelector('.member-votes-wording'),null);
  await h.update({decisionId:item.id});
  const wordingCalls=h.calls.filter(url=>url.includes('document-context/'));assert.equal(wordingCalls.length,1);
  const query=new URL(wordingCalls[0],'http://localhost');assert.equal(query.pathname,'/api/document-context/'+DOCUMENT);assert.equal(query.searchParams.get('amendment'),AMENDMENT);assert.equal(query.searchParams.get('lang'),'en');
  assert.equal(query.searchParams.get('body'),'0');
  assert.equal(button(h.container,'Read in context'),undefined);assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(h.container.querySelector('select[aria-label="Amendment published version"]').value,'');
  await h.select('select[aria-label="Amendment published version"]',variants[1].listId);
  const comparison=h.container.querySelector('.member-votes-comparison');assert.equal(comparison.lang,'hu');
  assert.match(comparison.textContent,/Eredeti pontos szöveg.*Javasolt pontos szöveg/);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Text language: Hungarian · Proposed by Második pontos javaslattevő/);
  assert.equal(h.contexts.length,0,'reading wording must not open the full source context');
  await h.click('Read in context');
  assert.deepEqual(h.state,{...initial,context:{documentId:DOCUMENT,amendmentId:AMENDMENT,listId:variants[1].listId,wordingLanguage:'hu',view:'document'}});
  assert.equal(h.contexts.at(-1).documentId,DOCUMENT);assert.equal(h.contexts.at(-1).listId,variants[1].listId);
  await h.click('Back from context');assert.deepEqual(h.state,initial);
  assert.equal(h.container.querySelector('select[aria-label="Amendment published version"]').value,variants[1].listId);
  assert.equal(h.calls.filter(url=>url.includes('document-context/')).length,1);
  await h.click('← Back to votes');assert.deepEqual(h.state,{...initial,decisionId:null});
});

test('a single exact amendment version shows its wording on detail and opens full context only on request',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const variant={listId:'exact-published-list',wordingStatus:'available',language:'fr',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',originalText:'Texte original exact',proposedText:'Texte proposé exact',authors:[{name:'Exact amendment proposer'}]};
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>String(url).includes('document-context/')?Response.json({documentId:DOCUMENT,requestedLanguage:'en',document:null,amendment:{id:AMENDMENT,status:'available',variants:[variant]}}):Response.json(responseFor(url,{items:[item]}))});
  assert.equal(h.calls.filter(url=>url.includes('document-context/')).length,1);
  assert.equal(h.container.querySelector('select[aria-label="Amendment published version"]'),null);
  const comparison=h.container.querySelector('.member-votes-comparison');assert.equal(comparison.lang,'fr');
  assert.match(comparison.textContent,/Texte original exact.*Texte proposé exact/);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Text language: French · Proposed by Exact amendment proposer/);
  assert.equal(h.contexts.length,0);
  await h.click('Read in context');
  assert.equal(h.contexts.at(-1).documentId,DOCUMENT);assert.equal(h.contexts.at(-1).amendmentId,AMENDMENT);assert.equal(h.contexts.at(-1).listId,variant.listId);assert.equal(h.contexts.at(-1).view,'document');
  await h.click('Back from context');assert.equal(h.state.context,null);assert.equal(h.state.decisionId,item.id);
  assert.equal(h.calls.filter(url=>url.includes('document-context/')).length,1);
});

test('an adopted text lookup keeps the exact report and does not inherit its selected amendment',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>String(url).includes('document-context/')?Response.json({documentId:DOCUMENT,requestedLanguage:'en',amendment:{id:AMENDMENT,status:'unavailable',variants:[]}}):Response.json(responseFor(url,{items:[item]}))});
  await h.click('Find adopted text');
  assert.deepEqual(h.state.context,{documentId:DOCUMENT,view:'adopted'});
  assert.equal(h.contexts.at(-1).amendmentId,undefined);assert.equal(h.contexts.at(-1).listId,undefined);
  await h.click('Back from context');assert.equal(h.state.decisionId,item.id);assert.equal(h.state.context,null);
});

test('known unavailable wording remains a competing published version and opens only its exact selected list',async t=>{
  const variants=[wordingVariant({listId:'readable-published-list'}),wordingVariant({listId:'known-unavailable-list',wordingStatus:'unavailable',language:null,
    targetLabel:null,targetLabelLanguage:null,originalText:null,proposedText:null})];
  const initial={week:WEEK,sittingId:SITTING,positions:'all',offset:50,decisionId:decision(1),snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT],context:null};
  const h=await mountWording(t,{variants,amendmentStatus:'unavailable',state:initial});
  const selector='select[aria-label="Amendment published version"]';
  assert.deepEqual([...h.container.querySelector(selector).options].map(option=>option.value),['',...variants.map(variant=>variant.listId)]);
  assert.equal(h.container.querySelector(selector).value,'');
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);
  await h.select(selector,variants[0].listId);
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Texte original exact.*Texte proposé exact/);
  await h.select(selector,variants[1].listId);
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Amendment wording unavailable here\./);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Text language unknown\./);
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes(variants[0].proposedText));
  await h.click('Read in context');
  assert.equal(h.contexts.at(-1).listId,variants[1].listId);
  assert.equal(h.contexts.at(-1).documentId,DOCUMENT);assert.equal(h.contexts.at(-1).amendmentId,AMENDMENT);
  assert.equal(h.contexts.at(-1).wordingLanguage,null,'unknown wording language is retained as an explicit source choice');
  await h.click('Back from context');
  assert.deepEqual(h.state,initial);
  assert.equal(h.container.querySelector(selector).value,variants[1].listId);
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
});

test('nullable wording language is explicit, null text stays unavailable and empty original text remains a readable insertion',async t=>{
  const variants=[wordingVariant({listId:'unknown-wording-language',language:null}),
    wordingVariant({listId:'missing-original-wording',originalText:null}),
    wordingVariant({listId:'missing-proposed-wording',proposedText:null}),
    wordingVariant({listId:'exact-insertion',originalText:'',proposedText:'Exact inserted wording'})];
  const h=await mountWording(t,{variants}),selector='select[aria-label="Amendment published version"]';
  await h.select(selector,variants[0].listId);
  const comparison=h.container.querySelector('.member-votes-comparison');
  assert.equal(comparison.getAttribute('lang'),'');
  assert.match(comparison.textContent,/Texte original exact.*Texte proposé exact/);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Text language unknown\./);
  for(const variant of variants.slice(1,3)) {
    await h.select(selector,variant.listId);
    assert.equal(h.container.querySelector('.member-votes-comparison'),null);
    assert.match(h.container.querySelector('.member-votes-wording').textContent,/Amendment wording unavailable here\./);
  }
  await h.select(selector,variants[3].listId);
  const insertion=h.container.querySelector('.member-votes-comparison');
  assert(insertion);assert.equal(insertion.querySelector('div:first-child p').textContent,'');
  assert.equal(insertion.querySelector('div:last-child p').textContent,variants[3].proposedText);
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('Amendment wording unavailable here.'));
  await h.click('Read in context');assert.equal(h.contexts.at(-1).listId,variants[3].listId);
});

test('target labels use their own source language independently of amendment wording and unknown labels inherit no English',async t=>{
  const variants=[wordingVariant({listId:'french-target-hungarian-wording',language:'hu',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',
    originalText:'Eredeti pontos szöveg',proposedText:'Javasolt pontos szöveg'}),
    wordingVariant({listId:'unknown-target-language',language:'hu',targetLabel:'Exact target with unknown language',targetLabelLanguage:null})];
  const h=await mountWording(t,{variants}),selector='select[aria-label="Amendment published version"]';
  await h.select(selector,variants[0].listId);
  const label=[...h.container.querySelectorAll('.member-votes-wording p')].find(paragraph=>paragraph.textContent===variants[0].targetLabel);
  assert.equal(label.getAttribute('lang'),'fr');assert.equal(h.container.querySelector('.member-votes-comparison').getAttribute('lang'),'hu');
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Text language: Hungarian/);
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('Target language unknown.'));
  await h.select(selector,variants[1].listId);
  const unknown=[...h.container.querySelectorAll('.member-votes-wording p')].find(paragraph=>paragraph.textContent===variants[1].targetLabel);
  assert.equal(unknown.getAttribute('lang'),'');assert.equal(h.container.querySelector('.member-votes-comparison').getAttribute('lang'),'hu');
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Target language unknown\./);
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('English'));
});

test('saved wording and proposer qualifications apply only to the explicitly selected version',async t=>{
  const variants=[wordingVariant({listId:'retained-version',wordingRetained:true,proposerRetained:true,recordRetained:true,authors:[{name:'Exact retained proposer'}]}),
    wordingVariant({listId:'current-version',wordingRetained:false,proposerRetained:false,recordRetained:false,authors:[{name:'Exact current proposer'}]})];
  const h=await mountWording(t,{variants}),selector='select[aria-label="Amendment published version"]';
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('Showing saved wording.'));
  await h.select(selector,variants[0].listId);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Showing saved wording\./);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Proposer details are from an earlier source version\./);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Version details are from an earlier source record\./);
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Exact retained proposer/);
  await h.select(selector,variants[1].listId);
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('Showing saved wording.'));
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('earlier source version'));
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('earlier source record'));
  assert(!h.container.querySelector('.member-votes-wording').textContent.includes('Exact retained proposer'));
  assert.match(h.container.querySelector('.member-votes-wording').textContent,/Exact current proposer/);
});

test('same-list language variants pass the exact source list and chosen language to context',async t=>{
  const variants=[wordingVariant({listId:'same-exact-list',language:'fr'}),wordingVariant({listId:'same-exact-list',language:'hu',
    originalText:'Eredeti pontos szöveg',proposedText:'Javasolt pontos szöveg'})];
  const h=await mountWording(t,{variants}),selector='select[aria-label="Amendment published version"]';
  const options=[...h.container.querySelector(selector).options].slice(1);
  assert.equal(options.length,2);assert.notEqual(options[0].value,options[1].value);
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  await h.select(selector,options[1].value);
  assert.equal(h.container.querySelector('.member-votes-comparison').getAttribute('lang'),'hu');
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Javasolt pontos szöveg/);
  await h.click('Read in context');assert.equal(h.contexts.at(-1).listId,'same-exact-list');
  assert.equal(h.contexts.at(-1).wordingLanguage,'hu');
  await h.click('Back from context');assert.equal(h.container.querySelector(selector).value,options[1].value);
});

test('a selected published version disappearing from refreshed data never silently selects a remaining version',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const variants=[wordingVariant({listId:'selected-original-list'}),wordingVariant({listId:'other-version',proposedText:'Different source version'})];
  const wordingData={documentId:DOCUMENT,requestedLanguage:'en',document:null,amendment:{id:AMENDMENT,status:'available',variants}};
  // Keep the hook's fixture object so a rerender can exercise a refreshed response
  // without adding a production refresh action solely for this regression.
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>{
    if(!String(url).includes('document-context/'))return Response.json(responseFor(url,{items:[item]}));
    const response=new Response();response.json=async()=>wordingData;return response;
  }}),selector='select[aria-label="Amendment published version"]';
  await h.select(selector,variants[0].listId);
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Texte proposé exact/);
  wordingData.amendment.variants=[variants[1]];
  await h.update({expandedSubjectIds:[SUBJECT]});
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);
  assert.equal(h.container.querySelector(selector)?.value,'');
  await h.select(selector,variants[1].listId);
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Different source version/);
  await h.click('Read in context');assert.equal(h.contexts.at(-1).listId,variants[1].listId);
});

test('an initially automatic single version remains pinned when another sole version replaces it',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const original=wordingVariant({listId:'initial-only-published-list'}),replacement=wordingVariant({listId:'replacement-only-published-list',proposedText:'Different replacement wording'});
  const wordingData={documentId:DOCUMENT,requestedLanguage:'en',document:null,amendment:{id:AMENDMENT,status:'available',variants:[original]}};
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>{
    if(!String(url).includes('document-context/'))return Response.json(responseFor(url,{items:[item]}));
    const response=new Response();response.json=async()=>wordingData;return response;
  }}),selector='select[aria-label="Amendment published version"]';
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Texte proposé exact/);
  assert(button(h.container,'Read in context'));assert.equal(h.container.querySelector(selector),null);
  wordingData.amendment.variants=[replacement];
  await h.update({expandedSubjectIds:[SUBJECT]});
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);assert.equal(h.container.querySelector(selector)?.value,'');
  await h.select(selector,replacement.listId);
  assert.match(h.container.querySelector('.member-votes-comparison').textContent,/Different replacement wording/);
  await h.click('Read in context');assert.equal(h.contexts.at(-1).listId,replacement.listId);
});

test('unavailable amendment wording uses plain missing copy and never opens the shared reader',async t=>{
  const item=vote(1,{context:{...vote(1).context,amendmentIds:[AMENDMENT]}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>String(url).includes('document-context/')?Response.json({documentId:DOCUMENT,requestedLanguage:'en',amendment:{id:AMENDMENT,status:'unavailable',variants:[]}}):Response.json(responseFor(url,{items:[item]}))});
  assert.match(h.container.textContent,/Amendment wording unavailable here\./);
  assert.equal(h.calls.filter(url=>url.includes('document-context/')).length,1);
  assert.equal(button(h.container,'Read in context'),undefined);assert.equal(h.contexts.length,0);
});

test('document actions use only exact top-level A/B/RC contexts and cannot open an unrelated requested document',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT,DOCUMENT+'-AM-7','B-10-2026-0002','RC-10-2026-0003','TA-10-2026-0001','https://example.test/arbitrary']}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id,context:{documentId:'A-10-2026-9999',view:'document'}},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  assert.match(h.container.textContent,/The requested document is unavailable for this vote/);assert.equal(h.contexts.length,0);
  await h.update({context:{documentId:DOCUMENT,amendmentId:DOCUMENT+'-AM-999',view:'document'}});
  assert.match(h.container.textContent,/The requested document is unavailable for this vote/);assert.equal(h.contexts.length,0,'an exact top-level document must not authorize an unrelated amendment');
  await h.click('← Back to vote');
  const actions=[...h.container.querySelectorAll('.member-votes-documents button')].map(item=>item.textContent);
  assert.deepEqual(actions,['Read report · '+DOCUMENT,'Find adopted text','Read motion · B-10-2026-0002','Find adopted text','Read joint motion · RC-10-2026-0003','Find adopted text']);
  await h.click('Read report · '+DOCUMENT);assert.equal(h.contexts.at(-1).documentId,DOCUMENT);assert.equal(h.contexts.at(-1).view,'document');
  assert.equal(h.calls.filter(url=>url.includes('motion-')).length,0);
});

test('snapshot expiry requires explicit refresh and preserves the requested period, decision, filter, page and context',async t=>{
  const item=vote(99,{context:{...vote(99).context,documentIds:[DOCUMENT]}}),nextSnapshot='b'.repeat(64);
  const initial={week:WEEK,sittingId:SITTING,positions:'all',offset:50,decisionId:item.id,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT],context:{documentId:DOCUMENT,view:'document'}};
  const h=await mount(t,{state:initial,statusCompatibility:true,handler:url=>stateFrom(url).snapshotId===SNAPSHOT?Response.json({error:{code:'snapshot_expired',message:'Snapshot expired'}},{status:409}):Response.json(responseFor(url,{items:[vote(1)],selected:{status:'found',item},subjects:[subject([item],{counts:{observed:51,filtered:51,page:1}})],snapshotId:nextSnapshot,pagination:{observedTotal:51,filteredTotal:51}}))});
  assert.match(h.container.textContent,/This saved view of the period has expired/);assert.equal(h.calls.length,1);assert.equal(h.changes.length,0);assert.equal(h.contexts.length,0);
  await h.click('Refresh votes');
  assert.deepEqual(h.changes[0].state,{...initial,snapshotId:null});assert.equal(h.changes[0].options.replace,false);
  assert.deepEqual(h.state,{...initial,snapshotId:nextSnapshot});
  assert(!h.container.textContent.includes('has expired'));assert.equal(h.contexts.at(-1).documentId,DOCUMENT);
  assert(h.calls.every(url=>{const query=new URL(url,'http://localhost').searchParams;return query.get('sitting')===SITTING&&query.get('positions')==='all'&&query.get('offset')==='50'&&query.get('decision')===item.id;}));
  assert.equal(h.changes.at(-1).options.replace,true);
});

test('explicit snapshot refresh bypasses a cached unpinned response instead of repinning the expired snapshot',async t=>{
  const item=vote(99),nextSnapshot='b'.repeat(64);
  const initial={week:WEEK,sittingId:null,positions:'all',offset:50,decisionId:item.id,snapshotId:null,expandedSubjectIds:[SUBJECT],context:null};
  let unpinnedReads=0;
  const h=await mount(t,{state:initial,statusCompatibility:true,handler:url=>{
    const snapshot=stateFrom(url).snapshotId;
    if(snapshot===SNAPSHOT)return Response.json({error:{code:'snapshot_expired',message:'Snapshot expired'}},{status:409});
    const snapshotId=snapshot||(++unpinnedReads===1?SNAPSHOT:nextSnapshot);
    return Response.json(responseFor(url,{items:[vote(1)],selected:{status:'found',item},subjects:[subject([item],{counts:{observed:51,filtered:51,page:1}})],snapshotId,pagination:{observedTotal:51,filteredTotal:51}}));
  }});
  assert.equal(unpinnedReads,1);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert.match(h.container.textContent,/This saved view of the period has expired/);
  const beforeRefresh=h.changes.length;
  await h.click('Refresh votes');
  assert.equal(unpinnedReads,2,'explicit refresh must make a fresh network request despite the cached unpinned response');
  assert.deepEqual(h.changes.slice(beforeRefresh).map(change=>change.state.snapshotId),[null,nextSnapshot],'refresh must not repin the expired snapshot');
  assert.deepEqual(h.state,{...initial,snapshotId:nextSnapshot});
  assert.equal(h.calls.filter(url=>stateFrom(url).snapshotId===SNAPSHOT).length,1,'the expired snapshot must not be requested again');
  assert.equal(h.calls.filter(url=>stateFrom(url).snapshotId===nextSnapshot).length,1);
  assert(h.calls.every(url=>{const state=stateFrom(url);return state.week===WEEK&&state.positions==='all'&&state.offset===50&&state.decisionId===item.id;}));
  assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert.equal(visiblePane(h.container).querySelector('h2').textContent,'Decision 99');
});

test('a temporary 503 keeps the retry path usable while the backend load continues',async t=>{
  let attempts=0,finish;
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>++attempts===1?Response.json({error:{message:'Loading the period; retry shortly.'}},{status:503}):new Promise(resolve=>{finish=()=>resolve(Response.json(responseFor(url)));})});
  assert.match(h.container.textContent,/Voting records could not be loaded/);assert.equal(button(h.container,'Retry votes').disabled,false);
  await h.click('Retry votes');assert.equal(attempts,2);assert.equal(button(h.container,'Retry votes'),undefined);assert.match(h.container.textContent,/Loading voting records/);
  await act(async()=>finish());assert.equal(h.container.querySelector('[role="alert"]'),null);assert(h.container.querySelector('.member-votes-subject'));
});

test('partial period coverage is disclosed once alongside observed, filtered and page counts',async t=>{
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{coverage:{status:'partial',collectionComplete:false},pagination:{observedTotal:70,filteredTotal:1},subjects:[subject([vote(1)],{counts:{observed:70,filtered:1,page:1}})]}))});
  const notice='Some voting records for this period are unavailable. More decisions or recorded positions may exist.';
  assert.equal(h.container.textContent.split(notice).length-1,1);
  assert.match(h.container.querySelector('.member-votes-tools').textContent,/1–1 of 1 recorded position · 70 decisions available in this period/);
  assert.match(h.container.querySelector('.member-votes-subject-count').textContent,/1 recorded position in this subject · 1 on this page/);
  assert(!/all.term|attendance|denominator/i.test(h.container.textContent));
});

test('page navigation replaces page rows and retains the pinned snapshot and expanded subjects',async t=>{
  const all=Array.from({length:51},(_,index)=>vote(index+1));
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>{
    const {offset}=stateFrom(url),items=all.slice(offset,offset+50);
    return Response.json(responseFor(url,{items,pagination:{observedTotal:51,filteredTotal:51,nextOffset:offset===0?50:null},subjects:[subject(all,{counts:{observed:51,filtered:51,page:items.length}})]}));
  }});
  assert.equal(h.container.querySelectorAll('.member-votes-row').length,50);
  await h.click('Next page');assert.equal(h.state.offset,50);assert.equal(h.state.snapshotId,SNAPSHOT);assert.deepEqual(h.state.expandedSubjectIds,[SUBJECT]);
  assert.equal(h.container.querySelectorAll('.member-votes-row').length,1);assert.match(h.container.querySelector('.member-votes-row').textContent,/Decision 51/);
  assert.match(h.container.querySelector('.member-votes-tools').textContent,/51–51 of 51/);assert.equal(h.changes.at(-1).options.replace,false);
  await h.click('Previous page');assert.equal(h.state.offset,0);assert.equal(h.container.querySelectorAll('.member-votes-row').length,50);
});

test('returning from context preserves detail scroll, then returning to votes restores the list scroll',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT]}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  const list=visiblePane(h.container);
  await act(async()=>{list.scrollTop=240;list.dispatchEvent(new window.Event('scroll'));list.querySelector('.member-votes-row').click();});
  const selectedState=structuredClone(h.state),detail=visiblePane(h.container);
  await act(async()=>{detail.scrollTop=460;detail.dispatchEvent(new window.Event('scroll'));});
  await h.click('Read report · '+DOCUMENT);
  detail.scrollTop=0;
  await h.click('Back from context');
  assert.deepEqual(h.state,selectedState);assert.equal(visiblePane(h.container).scrollTop,460);
  list.scrollTop=0;
  await h.click('← Back to votes');
  assert.deepEqual(h.state,{...selectedState,decisionId:null});assert.equal(visiblePane(h.container).scrollTop,240);
  assert.deepEqual(h.state.expandedSubjectIds,[SUBJECT]);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert.equal(document.activeElement===visiblePane(h.container).querySelector('.member-votes-row'),true,'Back returns focus to the current exact row');
});

test('revalidating a cached list preserves the parent-restored scroll on its existing pane',async t=>{
  let finish,reads=0;
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>{
    if(++reads===1)return Response.json(responseFor(url));
    return new Promise(resolve=>{finish=()=>resolve(Response.json(responseFor(url,{subjects:[subject([vote(1)],{title:'Revalidated subject',titles:{en:'Revalidated subject'}})]})));});
  }});
  const now=Date.now();t.mock.method(Date,'now',()=>now+31_000);
  await h.remount();
  assert.equal(reads,2,'returning to an expired cached view revalidates its response');
  const list=visiblePane(h.container);
  assert.equal(Boolean(list),true,'the cached list remains visible while its response revalidates');
  // The owning page restores this position before the new response arrives.
  // A programmatic restoration need not emit a scroll event.
  list.scrollTop=237;
  await act(async()=>finish());
  assert.equal(h.container.querySelector('[data-vote-group]').textContent.includes('Revalidated subject'),true);
  assert.equal(visiblePane(h.container)===list,true,'a new response keeps the same visible list pane');
  assert.equal(list.scrollTop,237);
});

test('history return restores the exact row focus without changing the saved scroll',async t=>{
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]}});
  const list=visiblePane(h.container),row=list.querySelector('.member-votes-row');
  await act(async()=>{list.scrollTop=180;list.dispatchEvent(new window.Event('scroll'));row.focus();row.click();});
  assert.equal(document.activeElement===visiblePane(h.container).querySelector('h2'),true,'detail receives focus');
  await h.update({decisionId:null});
  assert.equal(document.activeElement===visiblePane(h.container).querySelector('.member-votes-row'),true,'history returns focus to the current row');assert.equal(visiblePane(h.container).scrollTop,180);
});

test('return focus falls back to a collapsed subject, an off-page subject, or the list heading',async t=>{
  for(const mode of ['collapsed','off-page','unlinked'])await t.test(mode,async child=>{
    const selected=vote(mode==='collapsed'?1:99,mode==='unlinked'?{subjectId:null,resultRelationship:{inverseResultIds:[],forwardResultIds:[],binding:'unlinked'}}:{});
    const h=await mount(child,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:selected.id,expandedSubjectIds:mode==='collapsed'?[]:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[vote(1)],selected:stateFrom(url).decisionId?{status:'found',item:selected}:{status:'not-requested',item:null}}))});
    await h.click('← Back to votes');
    assert.equal(document.activeElement===(mode==='unlinked'?h.container.querySelector('.member-votes-period h2'):h.container.querySelector('[data-vote-group]')),true,mode+' has a visible focus destination');
    assert.equal(visiblePane(h.container).scrollTop,0);
  });
});
