import {proposalContextResponse} from './test-support/proposalContext.mjs';
import {contextOverlayResponse,assertContextOverlay} from './test-support/contextOverlay.mjs';
import {wordingText,wordingViewText} from './test-support/wordingText.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {projectMemberDecision} from '../server/member-votes-model.mjs';

const MEMBER=197673,WEEK='2026-03-23',SITTING='MTG-PL-2026-03-25',SNAPSHOT='a'.repeat(64);
const SUBJECT='MTG-PL-2026-03-25-VOT-ITM-8',DOCUMENT='A-10-2026-0001',AMENDMENT=DOCUMENT+'-AM-7';
const decision=number=>SITTING+'-DEC-'+number;
const emptyPage={state:'complete',pages:1,rows:0,stopReason:'end',error:null,sources:[]};

function vote(number,patch={}) {
  return {
    id:decision(number),uri:'https://data.europarl.europa.eu/eli/dl/event/'+decision(number),sittingId:SITTING,date:'2026-03-25',
    titles:{en:'Synthetic decision '+number},referenceTexts:{en:'Decision '+number},title:'Synthetic decision '+number,titleLanguage:'en',
    alignment:'with',method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',ballotStatus:'conducted',scope:{kind:'amendment',basis:'exact-component-reference'},
    actualPosition:{status:'recorded',position:'for'},intention:{status:'not-reported',positions:[]},sourceConflicts:null,
    totals:{for:400,against:200,abstaining:0},namedVoters:{available:true,counts:{for:400,against:200,abstaining:0},totalsMatch:true,conflictingPersonIds:[],malformedReferences:0},
    subjectId:SUBJECT,resultRelationship:{inverseResultIds:[SUBJECT],forwardResultIds:[SUBJECT],binding:'consistent'},parts:[],rollCallRequesters:[],
    evidenceGaps:[],evidencePaths:[],historicalGroup:null,
    context:{resultIds:[SUBJECT],agendaItemIds:[],documentIds:[],procedureIds:[],amendmentIds:[],componentIds:[],partialReferenceIds:[],missingResultIds:[],missingAgendaItemIds:[],relationships:[]},
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
  return {week:params.get('week')||WEEK,sittingId:params.get('sitting'),positions:params.get('positions')||'all',alignment:params.get('alignment')||'all',offset:Number(params.get('offset')||0),
    decisionId:params.get('decision'),snapshotId:params.get('snapshot')};
}
function responseFor(url,{items=[vote(1)],subjects,selected,snapshotId=SNAPSHOT,pagination={},coverage={},...patch}={}) {
  const state=stateFrom(url),week=state.week==='latest'?WEEK:state.week;
  return {version:10,member:{id:String(MEMBER),uri:'https://data.europarl.europa.eu/person/'+MEMBER,mandateStatus:'not-assessed',historicalGroupStatus:'not-collected'},
    period:state.sittingId?{kind:'sitting',week:null,sittingId:state.sittingId,from:state.sittingId.slice(7),to:state.sittingId.slice(7)}:{kind:'week',week,sittingId:null,from:week,to:new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)},
    snapshotId,positions:state.positions,alignment:state.alignment,alignmentCounts:coverage.status==='unavailable'?null:{with:items.filter(item=>item.alignment==='with').length,against:items.filter(item=>item.alignment==='against').length,abstained:items.filter(item=>item.alignment==='abstained').length,unclassified:(pagination.observedTotal??state.offset+items.length)-items.filter(item=>item.alignment!=='unclassified').length},subjects:subjects??[subject(items)],
    pagination:{offset:state.offset,limit:50,returned:items.length,observedTotal:state.offset+items.length,recordedTotal:coverage.status==='unavailable'?null:items.filter(item=>item.actualPosition.status==='recorded').length,filteredTotal:state.offset+items.length,nextOffset:null,...pagination},items,
    selected:selected??(state.decisionId?{status:'found',item:items.find(item=>item.id===state.decisionId)||null}:{status:'not-requested',item:null}),
    coverage:{status:'complete',collectionComplete:true,termWide:false,expectedSittingIds:[SITTING],scannedSittingIds:[SITTING],failedSittingIds:[],incompleteSittingIds:[],catalogue:emptyPage,sittings:[],basis:'Synthetic exact API fixture',...coverage},
    attribution:'European Parliament public data',...patch};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(item=>(item.getAttribute('aria-label')||item.textContent.trim())===text);
const visiblePane=container=>[...container.querySelectorAll('.member-votes-pane')].find(item=>!item.hidden);

async function mount(t,{state={},calendar={version:2,weeks:[{week:WEEK,sittings:[{sittingId:SITTING,date:SITTING.slice(7)}]}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}},handler=url=>Response.json(responseFor(url)),attendanceHandler=()=>Response.json({error:{code:'unavailable'}}),statusCompatibility=false,renderContext,members}={}) {
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
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).includes('/api/vote-periods'))return Response.json(calendar);
    // Attachment behavior has its own component tests. Keep these vote-reader
    // fixtures and request assertions scoped to the member-votes contract.
    if(String(url).includes('/api/member-vote-explanations/')){
      const params=new URL(String(url),'http://localhost').searchParams,decisionId=params.get('decision');
      return Response.json({version:3,memberId:String(MEMBER),decisionId,sittingId:decisionId.slice(0,17),snapshotId:params.get('snapshot'),subjectId:SUBJECT,matchScope:'subject',presentationAnchorDecisionId:null,items:[],written:{status:'unsupported',count:null},coverage:{status:'searched',searchComplete:true,gaps:[]}});
    }
    if(String(url).includes('/api/member-attendance/'))return attendanceHandler(url,options);
    calls.push(String(url));return handler(url,options,calls.length);
  });
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
  const DocumentContextReader=renderContext==='reader'?(await vite.ssrLoadModule('/src/DocumentContextReader.tsx')).DocumentContextReader:null;
  const {PersonNamesProvider}=await vite.ssrLoadModule('/src/PersonName.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  current={...structuredClone(module.defaultMemberVotesState),...state};
  const draw=()=>root.render(createElement(PersonNamesProvider,{members},createElement(module.MemberVotes,{...props,state:current,key:renderKey})));
  props={memberId:MEMBER,memberName:'Test member',language:'en',onStateChange:(next,options)=>{current=next;changes.push({state:structuredClone(next),options});draw();},
    renderContext:request=>{contexts.push(request);return DocumentContextReader?createElement(DocumentContextReader,{request,language:'en'}):renderContext?renderContext(request):createElement('div',{'data-testid':'context'},request.documentId,createElement('button',{onClick:request.onBack},'Back from context'));}};
  await act(async()=>draw());
  return {container,calls,changes,contexts,module,get state(){return current;},async update(patch){await act(async()=>{current={...current,...patch};draw();});},
    async updateProps(patch){await act(async()=>{props={...props,...patch};draw();});},
    async remount(){await act(async()=>{renderKey++;draw();});},
    async click(text){const target=button(container,text);assert(target,'Missing button: '+text);await act(async()=>target.click());},
    async select(selector,value){const target=container.querySelector(selector);assert(target,'Missing control: '+selector);await act(async()=>{if(target.tagName==='INPUT'){Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(target,value);target.dispatchEvent(new window.Event('input',{bubbles:true}));}else target.value=value;target.dispatchEvent(new window.Event('change',{bubbles:true}));});}};
}

function wordingVariant(patch={}) {
  return {listId:'exact-published-list',wordingStatus:'available',language:'fr',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',
    originalText:'Texte original exact',proposedText:'Texte proposé exact',authors:[],...patch};
}



async function mountWording(t,{variants,amendmentStatus='available',state={},members}) {
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  return mount(t,{members,state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id,...state},handler:url=>String(url).includes('document-context/')?
    Response.json({documentId:DOCUMENT,requestedLanguage:'en',document:null,amendment:{id:AMENDMENT,status:amendmentStatus,variants}}):Response.json(responseFor(url,{items:[item]}))});
}

test('vote justifications follow the chosen edition and render paragraphs as literal source text',async t=>{
  const text='Motif publié.\n<img src=x onerror=alert(1)> & seconde ligne.';
  const variants=[wordingVariant({listId:'published-fr',justification:text}),
    wordingVariant({listId:'published-hu',language:'hu',justification:'Magyar indokolás.'}),
    wordingVariant({listId:'no-justification',justification:' \n '})];
  const h=await mountWording(t,{variants});
  const selector='select[aria-label="Amendment published version"]';
  assert.equal(h.container.querySelector('.amendment-justification'),null);
  await h.select(selector,'published-fr');
  assert.equal(h.container.querySelector('.amendment-justification p').textContent,text);
  assert.equal(h.container.querySelector('.amendment-justification p').lang,'fr');
  assert.equal(h.container.querySelector('.amendment-justification img'),null);
  await h.select(selector,'published-hu');
  assert.equal(h.container.querySelector('.amendment-justification p').textContent,'Magyar indokolás.');
  assert.equal(h.container.querySelector('.amendment-justification p').lang,'hu');
  await h.select(selector,'no-justification');
  assert.equal(h.container.querySelector('.amendment-justification'),null);
});

test('decoded source reference text renders literally in vote cards and detail headings',async t=>{
  const source='S&amp;D: 10% &lt; 20% &amp; &lt;img src=x onerror=alert(1)&gt;',
    expected='S&D: 10% < 20% & <img src=x onerror=alert(1)>',
    projected=projectMemberDecision({id:'eli/dl/event/'+decision(1),referenceText:{en:source}},{sittingId:SITTING,date:'2026-03-25'},MEMBER),
    item=vote(1,{referenceTexts:projected.referenceTexts});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  assert.equal(h.container.querySelector('.member-votes-row-copy > span').textContent,expected);
  assert.equal(h.container.querySelector('img'),null,'decoded markup must remain text');
  await act(async()=>h.container.querySelector('.member-votes-row').click());
  assert.equal(visiblePane(h.container).querySelector('h2').textContent,expected);
  assert.equal(h.container.querySelector('img'),null);
});

test('default request includes all decisions and canonical period/snapshot replace navigation',async t=>{
  const h=await mount(t);
  assert.deepEqual(h.module.defaultMemberVotesState,{week:'latest',sittingId:null,positions:'all',alignment:'all',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null});
  const initial=new URL(h.calls[0],'http://localhost');
  assert.equal(initial.pathname,'/api/member-votes/'+MEMBER);
  assert.equal(initial.searchParams.get('week'),'latest');assert.equal(initial.searchParams.get('positions'),'all');
  assert.equal(initial.searchParams.get('limit'),'50');assert.equal(initial.searchParams.get('lang'),'en');
  assert.equal(h.state.week,WEEK);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert(h.changes.every(change=>change.options?.replace===true));
  assert.equal(button(h.container,'All decisions').getAttribute('aria-pressed'),'true');
  await h.click('Recorded positions');
  assert.equal(h.state.positions,'recorded');assert.equal(h.state.offset,0);assert.equal(h.changes.at(-1).options.replace,false);
  assert.equal(new URL(h.calls.at(-1),'http://localhost').searchParams.get('positions'),'recorded');
});

test('API responses for the wrong member, period, filter, page or pinned snapshot never render their rows',async t=>{
  for(const [label,mutate] of [
    ['member',data=>({...data,member:{...data.member,id:'999999'}})],
    ['period',data=>({...data,period:{kind:'week',week:'2026-03-30',sittingId:null,from:'2026-03-30',to:'2026-04-05'}})],
    ['filter',data=>({...data,positions:'recorded'})],
    ['page',data=>({...data,pagination:{...data.pagination,offset:50}})],
    ['snapshot',data=>({...data,snapshotId:'b'.repeat(64)})],
    ['requester binding',data=>({...data,items:[{...data.items[0],rollCallRequesters:[{id:'unbound',organizationLabels:{en:'Unbound requester'},binding:'different-decision'}]}]})],
  ])await t.test(label,async child=>{
    const h=await mount(child,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(mutate(responseFor(url)))});
    assert.match(h.container.textContent,/These voting records are unavailable/);
    assert.equal(h.container.querySelector('.member-votes-row'),null);
    assert.equal(h.changes.length,0,'an invalid response cannot rewrite the requested URL state');
  });
});

test('a selected off-page decision uses its pinned projection without selecting the first page row',async t=>{
  const page=vote(1,{referenceTexts:{en:'On-page decision'}}),selected=vote(99,{referenceTexts:{en:'Exact off-page decision'},actualPosition:{status:'no-record',position:null},method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}});
  const h=await mount(t,{state:{week:WEEK,decisionId:selected.id,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items:[page],selected:{status:'found',item:selected}}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('h2').textContent,'Exact off-page decision');
  assert.match(detail.textContent,/No recorded position/);assert.match(detail.textContent,/Show of hands/);
  assert(!detail.textContent.includes('On-page decision'));
  assert.equal(h.state.decisionId,selected.id);assert.equal(h.state.positions,'all');
});

test('unknown or mismatched decision deep links never fall back to another page decision',async t=>{
  for(const status of ['not-found-in-scanned-data','unavailable','mismatched'])await t.test(status,async child=>{
    const h=await mount(child,{state:{week:WEEK,decisionId:decision(999),snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{selected:status==='mismatched'?{status:'found',item:vote(1)}:{status,item:null}}))});
    assert.match(h.container.textContent,status==='mismatched'?/These voting records are unavailable/:/The requested decision is unavailable in this period/);
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
  assert.match(groups[0].querySelector('.member-votes-whole').textContent,/Final vote · Adopted · Test member No recorded position/);
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
  assert.equal(h.container.querySelectorAll('.member-votes-source a').length,0);
  assert.doesNotMatch(h.container.textContent,/Parliament’s voting record/);
  assert(!visiblePane(h.container).textContent.includes(decision(1)));assert(!visiblePane(h.container).textContent.includes(SNAPSHOT));
});

test('multilingual source subjects show one English title in list and detail while preserving the source literal',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/multilingual-vote-titles.json',import.meta.url)));
  const source=fixture.sources[0].payload.data.find(node=>node.activity_id.endsWith('000001'));
  const decisionSource=fixture.sources[1].payload.data.find(node=>node.activity_id.endsWith('198880'));
  const item=vote(1,{scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:decisionSource.referenceText,
    context:{...vote(1).context,amendmentIds:[]}});
  const sourceSubject=subject([item],{titles:source.activity_label,title:source.activity_label.mul,titleLanguage:'mul'});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[item],subjects:[sourceSubject]}))});
  const title=h.container.querySelector('.member-votes-subject h3 span[title]');
  assert.equal(title.textContent,'Monday’s Agenda - Request from the PfE Group - Riots');
  assert.equal(title.lang,'en');assert.equal(title.title,source.activity_label.mul);
  assert.match(h.container.querySelector('.member-votes-row').textContent,/Demande du groupe PfE - Émeutes/);
  await act(async()=>h.container.querySelector('.member-votes-row').click());
  const detail=h.container.querySelector('.member-votes-detail-subject');
  assert.equal(detail.textContent,title.textContent);assert.equal(detail.lang,'en');assert.equal(detail.title,source.activity_label.mul);
  assert.equal(h.container.querySelector('.member-votes-detail h2').textContent,decisionSource.referenceText.fr);
});

test('off-page whole-text outcomes do not add empty subjects or hide the recorded-position empty state',async t=>{
  const whole=vote(3,{scope:{kind:'whole-text',basis:'exact-component-reference'},actualPosition:{status:'no-record',position:null}});
  const absent=subject([],{id:'off-page-subject',counts:{observed:1,filtered:0,page:0},wholeTextDecisions:[whole]});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,positions:'recorded'},handler:url=>Response.json(responseFor(url,{items:[],subjects:[absent],pagination:{observedTotal:1,filteredTotal:0}}))});
  assert.equal(h.container.querySelectorAll('.member-votes-subject').length,0);
  assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.equal(button(h.container,'All decisions'),undefined,'Parliament outcomes are hidden for a period without member positions');
});

test('null totals, real zero totals and lapsed decisions remain distinct without invented member choices',async t=>{
  const items=[vote(1,{totals:{for:0,against:0,abstaining:0}}),vote(2,{totals:{for:400,against:null,abstaining:0}}),
    vote(3,{outcome:'LAPSED',ballotStatus:'not-conducted',method:'VOTE_ELECTRONIC_ROLLCALL',actualPosition:{status:'not-conducted',position:null},totals:{for:null,against:null,abstaining:null}}),
    vote(4,{method:'VOTE_HAND',alignment:'unclassified',actualPosition:{status:'not-individually-recorded',position:null},totals:{for:null,against:null,abstaining:null}})];
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,positions:'all',expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items}))});
  const rows=h.container.querySelectorAll('.member-votes-row');
  assert.equal(rows[0].querySelector('.member-votes-bar'),null);assert.deepEqual([...rows[0].querySelectorAll('.member-votes-counts b')].map(item=>item.textContent),['0','0','0']);
  assert.equal(rows[1].querySelector('.member-votes-bar,.member-votes-counts'),null);assert.match(rows[1].textContent,/Tallies unavailable/);assert.doesNotMatch(rows[1].textContent,/No tally published/);
  assert.match(rows[2].textContent,/Not put to a vote.*Lapsed/);assert.doesNotMatch(rows[2].textContent,/Roll-call vote/);assert.equal(rows[2].querySelector('.member-votes-row-copy .member-votes-muted'),null);assert.equal(rows[2].querySelector('.member-votes-bar,.member-votes-counts'),null);
  assert.match(rows[3].textContent,/Not individually recorded/);assert.equal(rows[3].querySelector('.member-votes-position-for'),null);
});

test('actual FOR, later intention to abstain and official raw counts are displayed independently',async t=>{
  const item=vote(1,{intention:{status:'reported',positions:['abstaining']},totals:{for:412,against:183,abstaining:0}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('.member-votes-position strong').textContent,'For');
  assert.match(detail.querySelector('.member-votes-intention').textContent,/Declared intention: Abstain.*result unchanged/);
  assert.equal(detail.querySelector('.member-votes-bar').getAttribute('aria-label'),'For 412, Against 183, Abstaining 0');
  assert.deepEqual([...detail.querySelectorAll('.member-votes-counts b')].map(item=>item.textContent),['412','183','0']);
  assert(!/success|\d%/.test(detail.textContent));
});

test('detail renders exact split wording, sibling context and only exact requesters',async t=>{
  const component=part(2,{contentByLanguage:{fr:{sourceLiteral:'Littéral exact de la deuxième partie',text:null}}});
  const first=vote(1,{parts:[part(1,{contentByLanguage:{fr:{sourceLiteral:'Littéral exact de la première partie',text:null}},contextComponents:[component]})],outcome:'REJECTED',rollCallRequesters:[
    {id:'requester-1',uri:'https://example.test/requester',type:'REQUEST_ROLLCALL',scopeByLanguage:{},organizationLabels:{fr:'Demandeur exact'},organizationReferences:[],organizationAliasReferences:[],binding:'exact-decision-was_motivated_by',evidencePaths:[]},
  ]});
  const sibling=vote(2,{parts:[part(2,{contextComponents:[part(1),part(2)]})],outcome:'ADOPTED'});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:first.id},handler:url=>Response.json(responseFor(url,{items:[first,sibling]}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('.member-votes-part p').textContent,'Littéral exact de la première partie');assert.equal(detail.querySelector('.member-votes-part p').lang,'fr');
  assert.match(detail.querySelector('.member-votes-related').textContent,/Littéral exact de la deuxième partie/);
  assert.match(detail.querySelector('.member-votes-siblings').textContent,/Part 2 · Adopted/);
  assert.match(detail.querySelector('.member-votes-requester').textContent,/Roll call requested by Demandeur exact/);assert(!detail.textContent.includes('Unbound requester'));
  assert.equal(detail.querySelector('.member-votes-related summary').textContent,'Split vote · Paragraph 4');
  assert.deepEqual([...detail.querySelectorAll('.member-votes-related h4')].map(node=>node.textContent),['Part 1','Part 2']);
  await h.click('Paragraph 4 · Part 2 · Adopted');assert.equal(h.state.decisionId,sibling.id);
  assert.deepEqual([...visiblePane(h.container).querySelectorAll('.member-votes-related h4')].map(node=>node.textContent),['Part 1','Part 2']);
});

test('amendment wording loads only after decision selection and requires an explicit exact published variant before context',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}});
  const variants=[{listId:'exact-published-list-fr',wordingStatus:'available',language:'fr',targetLabel:'Paragraphe 4',targetLabelLanguage:'fr',originalText:'Texte original exact',proposedText:'Texte proposé exact',authors:[{name:'Exact amendment proposer'}]},
    {listId:'exact-published-list-hu',wordingStatus:'available',language:'hu',targetLabel:'4. bekezdés',targetLabelLanguage:'hu',originalText:'Eredeti pontos szöveg',proposedText:'Javasolt pontos szöveg',authors:[{name:'Második pontos javaslattevő'}]}];
  const initial={week:WEEK,sittingId:null,positions:'recorded',alignment:'all',offset:50,decisionId:item.id,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT,'another-exact-subject'],context:null};
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
  assert.match(wordingViewText(comparison),/Eredeti pontos szöveg.*Javasolt pontos szöveg/);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Text language: Hungarian · Proposed by Második pontos javaslattevő/);
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
  assert(comparison.querySelector('ins'));assert(comparison.querySelector('del'));
  assert.equal(wordingText(comparison,'original'),variant.originalText);assert.equal(wordingText(comparison,'proposed'),variant.proposedText);
  await h.click('Side by side');assert.equal(comparison.querySelectorAll('.wording-diff__columns section').length,2);
  await h.click('Changes');assert.equal(button(comparison,'Changes').getAttribute('aria-pressed'),'true');
  assert.match(wordingViewText(comparison),/Texte original exact.*Texte proposé exact/);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Text language: French · Proposed by Exact amendment proposer/);
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
  const initial={week:WEEK,sittingId:SITTING,positions:'all',alignment:'all',offset:50,decisionId:decision(1),snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT],context:null};
  const h=await mountWording(t,{variants,amendmentStatus:'unavailable',state:initial});
  const selector='select[aria-label="Amendment published version"]';
  assert.deepEqual([...h.container.querySelector(selector).options].map(option=>option.value),['',...variants.map(variant=>variant.listId)]);
  assert.equal(h.container.querySelector(selector).value,'');
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);
  await h.select(selector,variants[0].listId);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Texte original exact.*Texte proposé exact/);
  await h.select(selector,variants[1].listId);
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Amendment wording unavailable here\./);
  assert.doesNotMatch(wordingViewText(h.container.querySelector('.member-votes-wording')),/Text language/);
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes(variants[0].proposedText));
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
  assert.match(wordingViewText(comparison),/Texte original exact.*Texte proposé exact/);
  assert.doesNotMatch(wordingViewText(h.container.querySelector('.member-votes-wording')),/language unknown/i);
  for(const variant of variants.slice(1,3)) {
    await h.select(selector,variant.listId);
    assert.equal(h.container.querySelector('.member-votes-comparison'),null);
    assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Amendment wording unavailable here\./);
  }
  await h.select(selector,variants[3].listId);
  const insertion=h.container.querySelector('.member-votes-comparison');
  assert(insertion);assert.equal(wordingText(insertion,'original'),'');
  assert.equal(wordingText(insertion,'proposed'),variants[3].proposedText);assert(insertion.querySelector('ins'));
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('Amendment wording unavailable here.'));
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
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Text language: Hungarian/);
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('Target language unknown.'));
  await h.select(selector,variants[1].listId);
  const unknown=[...h.container.querySelectorAll('.member-votes-wording p')].find(paragraph=>paragraph.textContent===variants[1].targetLabel);
  assert.equal(unknown.getAttribute('lang'),'');assert.equal(h.container.querySelector('.member-votes-comparison').getAttribute('lang'),'hu');
  assert.doesNotMatch(wordingViewText(h.container.querySelector('.member-votes-wording')),/language unknown/i);
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('English'));
});

test('saved wording and proposer qualifications apply only to the explicitly selected version',async t=>{
  const variants=[wordingVariant({listId:'retained-version',wordingRetained:true,proposerRetained:true,recordRetained:true,authors:[{name:'Exact retained proposer'}]}),
    wordingVariant({listId:'current-version',wordingRetained:false,proposerRetained:false,recordRetained:false,authors:[{name:'Exact current proposer'}]})];
  const h=await mountWording(t,{variants}),selector='select[aria-label="Amendment published version"]';
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('Showing saved wording.'));
  await h.select(selector,variants[0].listId);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Showing saved wording\./);
  assert.doesNotMatch(wordingViewText(h.container.querySelector('.member-votes-wording')),/earlier source version/);
  assert.doesNotMatch(wordingViewText(h.container.querySelector('.member-votes-wording')),/earlier source record/);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Exact retained proposer/);
  await h.select(selector,variants[1].listId);
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('Showing saved wording.'));
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('earlier source version'));
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('earlier source record'));
  assert(!wordingViewText(h.container.querySelector('.member-votes-wording')).includes('Exact retained proposer'));
  assert.match(wordingViewText(h.container.querySelector('.member-votes-wording')),/Exact current proposer/);
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
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Javasolt pontos szöveg/);
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
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Texte proposé exact/);
  wordingData.amendment.variants=[variants[1]];
  await h.update({expandedSubjectIds:[SUBJECT]});
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);
  assert.equal(h.container.querySelector(selector)?.value,'');
  await h.select(selector,variants[1].listId);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Different source version/);
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
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Texte proposé exact/);
  assert(button(h.container,'Read in context'));assert.equal(h.container.querySelector(selector),null);
  wordingData.amendment.variants=[replacement];
  await h.update({expandedSubjectIds:[SUBJECT]});
  assert.equal(h.container.querySelector('.member-votes-comparison'),null);
  assert.equal(button(h.container,'Read in context'),undefined);assert.equal(h.container.querySelector(selector)?.value,'');
  await h.select(selector,replacement.listId);
  assert.match(wordingViewText(h.container.querySelector('.member-votes-comparison')),/Different replacement wording/);
  await h.click('Read in context');assert.equal(h.contexts.at(-1).listId,replacement.listId);
});

test('unavailable amendment wording uses plain missing copy and never opens the shared reader',async t=>{
  const item=vote(1,{context:{...vote(1).context,amendmentIds:[AMENDMENT]}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},handler:url=>String(url).includes('document-context/')?Response.json({documentId:DOCUMENT,requestedLanguage:'en',amendment:{id:AMENDMENT,status:'unavailable',variants:[]}}):Response.json(responseFor(url,{items:[item]}))});
  assert.match(wordingViewText(h.container),/Amendment wording unavailable here\./);
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
  const initial={week:WEEK,sittingId:SITTING,positions:'all',alignment:'all',offset:50,decisionId:item.id,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT],context:{documentId:DOCUMENT,view:'document'}};
  const h=await mount(t,{state:initial,statusCompatibility:true,handler:url=>stateFrom(url).snapshotId===SNAPSHOT?Response.json({error:{code:'snapshot_expired',message:'Snapshot expired'}},{status:409}):Response.json(responseFor(url,{items:[vote(1)],selected:{status:'found',item},subjects:[subject([item],{counts:{observed:51,filtered:51,page:1}})],snapshotId:nextSnapshot,pagination:{observedTotal:51,filteredTotal:51}}))});
  assert.match(h.container.textContent,/This page is out of date/);assert.equal(h.calls.length,1);assert.equal(h.changes.length,0);assert.equal(h.contexts.length,0);
  await h.click('Refresh votes');
  assert.deepEqual(h.changes[0].state,{...initial,snapshotId:null});assert.equal(h.changes[0].options.replace,false);
  assert.deepEqual(h.state,{...initial,snapshotId:nextSnapshot});
  assert(!h.container.textContent.includes('has expired'));assert.equal(h.contexts.at(-1).documentId,DOCUMENT);
  assert(h.calls.every(url=>{const query=new URL(url,'http://localhost').searchParams;return query.get('sitting')===SITTING&&query.get('positions')==='all'&&query.get('offset')==='50'&&query.get('decision')===item.id;}));
  assert.equal(h.changes.at(-1).options.replace,true);
});

test('explicit snapshot refresh bypasses a cached unpinned response instead of repinning the expired snapshot',async t=>{
  const item=vote(99),nextSnapshot='b'.repeat(64);
  const initial={week:WEEK,sittingId:null,positions:'all',alignment:'all',offset:50,decisionId:item.id,snapshotId:null,expandedSubjectIds:[SUBJECT],context:null};
  let unpinnedReads=0;
  const h=await mount(t,{state:initial,statusCompatibility:true,handler:url=>{
    const snapshot=stateFrom(url).snapshotId;
    if(snapshot===SNAPSHOT)return Response.json({error:{code:'snapshot_expired',message:'Snapshot expired'}},{status:409});
    const snapshotId=snapshot||(++unpinnedReads===1?SNAPSHOT:nextSnapshot);
    return Response.json(responseFor(url,{items:[vote(1)],selected:{status:'found',item},subjects:[subject([item],{counts:{observed:51,filtered:51,page:1}})],snapshotId,pagination:{observedTotal:51,filteredTotal:51}}));
  }});
  assert.equal(unpinnedReads,1);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert.match(h.container.textContent,/This page is out of date/);
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
  const notice='Incomplete voting records';
  assert.equal(h.container.textContent.split(notice).length-1,1);
  assert.match(h.container.querySelector('.member-votes-tools').textContent,/1–1 of 1 decision · 1 with a recorded position/);
  assert.match(h.container.querySelector('.member-votes-subject-count').textContent,/1 decision/);
  assert(!/all.term|denominator/i.test(h.container.textContent));
});

test('coverage notice names incomplete sitting days and leaves unaffected detail and document panes clear',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT]}});
  const h=await mount(t,{state:{week:WEEK,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[item],coverage:{status:'partial',collectionComplete:false,incompleteSittingIds:[SITTING],sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:'partial',observedDecisionCount:1}]}}))});
  assert.equal(h.container.querySelector('.member-votes-notice').textContent,'Incomplete voting records · 25 Mar 2026');
  assert.doesNotMatch(h.container.querySelector('.member-votes-tools').textContent,/Partial coverage/);
  assert.doesNotMatch(h.container.querySelector('.member-votes-alignment').textContent,/Partial coverage/);
  await act(async()=>h.container.querySelector('[data-vote-id]').click());
  assert.equal(h.container.querySelector('.member-votes-notice'),null);
  await h.click('Read report · '+DOCUMENT);
  assert(h.container.querySelector('[data-testid="context"]'));
  assert.equal(h.container.querySelector('.member-votes-notice'),null);
});

test('a selected decision reports its own missing result, independently of period coverage',async t=>{
  const item=vote(1,{evidenceGaps:[{code:'missing-result',id:SUBJECT}]});
  const h=await mount(t,{state:{week:WEEK,decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item],coverage:{status:'partial',incompleteSittingIds:[SITTING]}}))});
  assert.equal(h.container.querySelector('.member-votes-notice').textContent,'Vote result incomplete');
  assert.doesNotMatch(h.container.querySelector('.member-votes-notice').textContent,/25 Mar|period/);
});

test('agenda context gaps alone do not label vote counts or the period incomplete',async t=>{
  const h=await mount(t,{state:{week:WEEK},handler:url=>Response.json(responseFor(url,{coverage:{sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:'complete',observedDecisionCount:1,agenda:{state:'unavailable'},completeness:{complete:false,votingRecordsComplete:true}}]}}))});
  assert.equal(h.container.querySelector('.member-votes-notice'),null);
  assert.doesNotMatch(h.container.querySelector('.member-votes-tools').textContent,/Partial coverage/);
  assert.doesNotMatch(h.container.querySelector('.member-votes-alignment').textContent,/Partial coverage/);
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

test('collapsed subjects expose final positions, page-scoped summaries and off-page final-vote navigation',async t=>{
  const items=[vote(1),vote(2,{actualPosition:{status:'recorded',position:'against'}}),vote(3,{actualPosition:{status:'recorded',position:'abstaining'}})];
  const whole=vote(99,{scope:{kind:'whole-text',basis:'exact-component-reference'}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items,subjects:[subject(items,{wholeTextDecisions:[whole]})],selected:stateFrom(url).decisionId?{status:'found',item:whole}:{status:'not-requested',item:null}}))});
  const group=h.container.querySelector('[data-vote-group]');assert.equal(group.getAttribute('aria-expanded'),'false');
  assert.match(group.textContent,/Positions: For: 1 · Against: 1 · Abstained: 1/);
  const final=h.container.querySelector('button.member-votes-whole');assert.match(final.textContent,/Final vote · Adopted · Test member voted For/);
  await act(async()=>final.click());assert.equal(h.state.decisionId,whole.id);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert.equal(visiblePane(h.container).querySelector('h2').textContent,'Final vote');
  await h.click('← Back to votes');assert.equal(document.activeElement===h.container.querySelector('[data-vote-group]'),true);assert.deepEqual(h.state.expandedSubjectIds,[]);
});

test('a filtered-out final vote opens its exact decision and keeps missing-position states distinct',async t=>{
  const item=vote(1),whole=vote(99,{scope:{kind:'whole-text',basis:'exact-component-reference'},actualPosition:{status:'conflicting',position:null}});
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items:[item],subjects:[subject([item],{wholeTextDecisions:[whole]})],selected:stateFrom(url).decisionId?{status:'found',item:whole}:{status:'not-requested',item:null}}))});
  const final=h.container.querySelector('button.member-votes-whole');assert.match(final.textContent,/Conflicting records/);
  await act(async()=>final.click());assert.match(visiblePane(h.container).textContent,/Conflicting records/);assert.equal(h.state.positions,'all');
  await h.click('← Back to votes');assert.equal(document.activeElement,h.container.querySelector('[data-vote-group]'));
});


test('period navigation steps through held weeks and week/day changes clear period-scoped selections',async t=>{
  const calendar={version:2,weeks:[{week:'2026-03-30',sittings:[{sittingId:'MTG-PL-2026-03-31',date:'2026-03-31'}]},{week:WEEK,sittings:[{sittingId:SITTING,date:'2026-03-25'}]}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}};
  const h=await mount(t,{calendar,state:{week:WEEK,snapshotId:SNAPSHOT,offset:50,decisionId:decision(1),expandedSubjectIds:[SUBJECT]},handler:url=>{const state=stateFrom(url);return Response.json(responseFor(url,{items:state.week===WEEK?[vote(1)]:[],subjects:state.week===WEEK?[subject([vote(1)])]:[]}));}});
  assert.equal(button(h.container,'Previous plenary week').disabled,true);assert.equal(button(h.container,'Next plenary week').disabled,false);
  const day=[...h.container.querySelectorAll('.member-votes-days button')].find(item=>item.textContent.includes('25'));assert(day);await act(async()=>day.click());
  const transition=h.changes.find(change=>change.state.sittingId===SITTING);
  assert(transition);for(const key of ['snapshotId','decisionId','context'])assert.equal(transition.state[key],null);assert.equal(transition.state.offset,0);assert.deepEqual(transition.state.expandedSubjectIds,[]);
  assert.equal(h.state.sittingId,SITTING);assert.equal(h.state.week,WEEK);
  await h.click('Whole week');assert.equal(h.state.week,WEEK);assert.equal(h.state.sittingId,null);
  await h.click('Next plenary week');assert.equal(h.state.week,'2026-03-30');assert.equal(button(h.container,'Next plenary week').disabled,true);
});

test('sitting-only links show their own week and Whole week never jumps to latest',async t=>{
  const h=await mount(t,{state:{week:'latest',sittingId:SITTING,snapshotId:SNAPSHOT}});
  assert.equal(h.container.querySelector('.member-votes-period-navigation select').value,WEEK);
  await h.click('Whole week');assert.equal(h.state.week,WEEK);assert.equal(h.state.sittingId,null);
});

test('partial calendars disclose gaps separately and retain missing selected week and sitting options',async t=>{
  const calendar={version:2,weeks:[],coverage:{status:'partial',years:[{year:2026,state:'partial',sources:[]}]}};
  const h=await mount(t,{calendar,state:{week:'latest',sittingId:SITTING,snapshotId:SNAPSHOT}});
  assert.match(h.container.textContent,/Some plenary dates could not be loaded\./);
  const select=h.container.querySelector('.member-votes-period-navigation select');assert.equal(select.value,WEEK);assert.match(select.textContent,/Week of/);
  const selectedDay=h.container.querySelector('.member-votes-days button[aria-pressed=true]');assert(selectedDay);assert.match(selectedDay.textContent,/25/);
  assert(!h.container.textContent.includes('Some voting records for this period are unavailable'));
  assert.equal(h.container.querySelector('.member-votes-period-navigation input'),null,'partial coverage retains the calendar without another date field');
});

test('unavailable calendars keep an any-date fallback that snaps to Monday',async t=>{
  const h=await mount(t,{calendar:{version:2,weeks:[],coverage:{status:'unavailable',years:[]}},state:{week:WEEK,snapshotId:SNAPSHOT}});
  assert.match(h.container.textContent,/The plenary calendar could not be loaded/);
  await h.select('.member-votes-period-navigation input','2026-03-26');assert.equal(h.state.week,WEEK);assert.equal(h.state.sittingId,null);assert(!h.container.textContent.includes('Choose a Monday'));
});


test('calendar jump controls keep the direct select, accessible icons and year groups at both boundaries',async t=>{
 const calendar={version:2,weeks:[{week:WEEK,sittings:[23,24,25,26].map(day=>({sittingId:'MTG-PL-2026-03-'+day,date:'2026-03-'+day}))},{week:'2025-12-15',sittings:[{sittingId:'MTG-PL-2025-12-16',date:'2025-12-16'}]}],coverage:{status:'complete',years:[{year:2025,state:'complete',sources:[]},{year:2026,state:'complete',sources:[]}]}};
 const h=await mount(t,{calendar,state:{week:WEEK,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items:[]}))});
 const row=h.container.querySelector('.member-votes-week-navigation');assert.deepEqual([...row.children].map(node=>node.tagName),['BUTTON','BUTTON','SELECT','BUTTON','BUTTON']);
 assert.deepEqual([...row.querySelectorAll('optgroup')].map(node=>node.label),['2026','2025']);
 assert.match(row.querySelector('option').textContent,/4 sitting days/);
 for(const name of ['First plenary week','Previous plenary week','Next plenary week','Latest plenary week']){
  const icon=button(h.container,name).querySelector('svg');assert(icon,'Missing navigation icon: '+name);
  assert.equal(icon.getAttribute('aria-hidden'),'true');assert.equal(icon.getAttribute('focusable'),'false');
 }
 assert.equal(button(h.container,'Latest plenary week').disabled,true);assert.equal(button(h.container,'First plenary week').disabled,false);
 await h.click('First plenary week');assert.equal(h.state.week,'2025-12-15');assert.equal(button(h.container,'First plenary week').disabled,true);assert.equal(button(h.container,'Previous plenary week').disabled,true);
 await h.click('Latest plenary week');assert.equal(h.state.week,WEEK);assert.equal(button(h.container,'Latest plenary week').disabled,true);
 assert.equal(h.container.querySelectorAll('.member-votes-days button').length,5);assert.equal(h.container.querySelector('input[type=date]'),null);
 assert.equal(button(h.container,'Latest'),undefined);assert.doesNotMatch(h.container.textContent,/Browse sitting weeks|choose a Monday/);
});

test('an observed empty calendar is distinct from unavailable and does not add a date input',async t=>{
 const h=await mount(t,{calendar:{version:2,weeks:[],coverage:{status:'complete',years:[]}}});
 assert.match(h.container.textContent,/No plenary weeks yet/);assert.equal(h.container.querySelector('input[type=date]'),null);assert.equal(button(h.container,'First plenary week').disabled,true);
});

test('only complete zero-decision days are muted as no-votes, remain clickable and open a sitting empty state',async t=>{
 const calendar={version:2,weeks:[{week:WEEK,sittings:[23,24,25,26].map(day=>({sittingId:'MTG-PL-2026-03-'+day,date:'2026-03-'+day}))}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}};
 const sittings=calendar.weeks[0].sittings.map((day,index)=>({...day,state:['complete','partial','unavailable','complete'][index],observedDecisionCount:index===3?1:0}));
 const h=await mount(t,{calendar,state:{week:WEEK},handler:url=>{
  const state=stateFrom(url),empty=Boolean(state.sittingId),items=empty?[]:[vote(1,{id:'MTG-PL-2026-03-26-DEC-1',sittingId:'MTG-PL-2026-03-26',date:'2026-03-26'})];
  return Response.json(responseFor(url,{items,coverage:{status:empty?'complete':'partial',sittings:empty?[sittings[0]]:sittings}}));
 }});
 const marked=h.container.querySelectorAll('.vote-period-no-votes');assert.equal(marked.length,1);assert.equal(marked[0].disabled,false);assert.match(marked[0].getAttribute('aria-label'),/^Monday.*2026, no votes recorded$/);
 assert.equal(h.container.querySelectorAll('.member-votes-days button').length,5);assert.match(h.container.querySelector('select').textContent,/4 sitting days/);
 await act(async()=>marked[0].click());assert.equal(h.state.sittingId,'MTG-PL-2026-03-23');assert.match(visiblePane(h.container).textContent,/No votes were recorded at this sitting\./);
});

for(const alignment of ['all','against'])test('a complete zero-decision week keeps no-votes copy with alignment '+alignment,async t=>{
 const h=await mount(t,{state:{week:WEEK,alignment},handler:url=>Response.json(responseFor(url,{items:[],coverage:{sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:'complete',observedDecisionCount:0}]}}))});
 assert.match(visiblePane(h.container).textContent,/No votes were recorded in this week\./);assert(h.container.querySelector('.vote-period-no-votes'));
});

for(const status of ['partial','unavailable'])test(status+' zero observations never claim no votes at a sitting',async t=>{
 const h=await mount(t,{state:{sittingId:SITTING,week:WEEK},handler:url=>Response.json(responseFor(url,{items:[],coverage:{status,sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:status,observedDecisionCount:0}]}}))});
 assert.equal(h.container.querySelector('.vote-period-no-votes'),null);assert.doesNotMatch(visiblePane(h.container).textContent,/No votes were recorded/);
});

test('a member without recorded positions is not labelled as a sitting with no votes',async t=>{
 const h=await mount(t,{state:{sittingId:SITTING,week:WEEK,positions:'recorded'},handler:url=>Response.json(responseFor(url,{items:[],pagination:{observedTotal:1,filteredTotal:0},coverage:{sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:'complete',observedDecisionCount:1}]}}))});
 assert.equal(h.container.querySelector('.vote-period-no-votes'),null);assert.match(visiblePane(h.container).textContent,/No recorded positions at this sitting/);assert.doesNotMatch(visiblePane(h.container).textContent,/No votes were recorded/);
});

test('outcome alignment retains the snapshot, resets pagination, marks rows and returns focus from detail',async t=>{
  const against=vote(2,{alignment:'against',actualPosition:{status:'recorded',position:'against'}});
  const counts={with:1,against:1,abstained:0,unclassified:0};
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,offset:50},handler:url=>{
    const state=stateFrom(url),filtered=[vote(1),against].filter(item=>state.alignment==='all'||item.alignment===state.alignment),items=state.offset?[]:filtered;
    return Response.json(responseFor(url,{items,alignmentCounts:counts,pagination:{offset:state.offset,observedTotal:2,recordedTotal:2,filteredTotal:filtered.length}}));
  }});
  // Start from a valid first page after proving the changed control resets a remembered offset.
  await h.update({offset:0});
  const control=button(h.container,'Against the outcome (1)');assert(control);control.focus();
  await act(async()=>control.click());
  assert.equal(h.state.alignment,'against');assert.equal(document.activeElement.dataset.voteAlignment,'against');assert.equal(h.state.offset,0);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert.equal(button(h.container,'Against the outcome (1)').getAttribute('aria-pressed'),'true');
  assert.match(h.container.querySelector('.member-votes-alignment').textContent,/Counts in this week$/);
  await act(async()=>h.container.querySelector('[data-vote-group]').click());
  const row=h.container.querySelector('[data-vote-id]');assert.match(row.textContent,/Against outcome/);
  await act(async()=>row.click());assert.equal(h.state.decisionId,against.id);
  await h.click('← Back to votes');assert.equal(h.state.alignment,'against');assert.equal(document.activeElement.dataset.voteId,against.id);
  assert(h.calls.some(url=>new URL(url,'http://localhost').searchParams.get('alignment')==='against'));
  await h.update({offset:50});await h.click('With the outcome (1)');assert.equal(h.state.offset,0);assert.equal(h.state.snapshotId,SNAPSHOT);
});

for(const coverage of ['complete','partial','unavailable'])test('alignment empty state preserves '+coverage+' coverage semantics',async t=>{
  const h=await mount(t,{state:{week:WEEK,alignment:'against'},handler:url=>Response.json(responseFor(url,{items:[],coverage:{status:coverage},alignmentCounts:coverage==='unavailable'?null:{with:0,against:0,abstained:0,unclassified:0}}))});
  const text=h.container.textContent;
  if(coverage==='complete')assert.match(text,/No recorded votes against Parliament’s outcome in this week/);
  if(coverage==='partial'){assert.match(text,/No matching recorded votes among the available records for this week/);assert.match(text,/Counts in this week/);}
  if(coverage==='unavailable'){
    assert.match(text,/Voting records unavailable/);assert.match(text,/Against the outcome \(Unavailable\)/);
    assert.equal(h.container.querySelector('.member-votes-empty'),null);assert.doesNotMatch(text,/0 decisions|No recorded votes|No matching recorded/);
  }
});

test('a complete empty sitting keeps the no-votes message under an outcome filter',async t=>{
 const h=await mount(t,{state:{week:WEEK,sittingId:SITTING,alignment:'against'},handler:url=>Response.json(responseFor(url,{items:[],coverage:{sittings:[{sittingId:SITTING,date:SITTING.slice(7),state:'complete',observedDecisionCount:0}]}}))});
 assert.match(visiblePane(h.container).textContent,/No votes were recorded at this sitting\./);
 assert.doesNotMatch(visiblePane(h.container).textContent,/No recorded votes against/);
});


test('vote Read in context reaches the same in-place amendment diff as motion reading',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}}),listId=DOCUMENT+'-AM-001-020';
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},renderContext:'reader',handler:url=>{
    if(String(url).includes('/api/references'))return Response.json({references:[]});
    return Response.json(String(url).includes('document-context/')?contextOverlayResponse(DOCUMENT,AMENDMENT,listId):responseFor(url,{items:[item]}));
  }});
  await h.click('Read in context');await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  assertContextOverlay(h.container);
  assert(h.calls.some(url=>url.includes('wording-lang=en')&&!url.includes('body=0')));
});


test('member-vote A-report Read in context reaches the Commission proposal',async t=>{
  const item=vote(1,{context:{...vote(1).context,documentIds:[DOCUMENT],amendmentIds:[AMENDMENT]}}),listId=DOCUMENT+'-AM-001-020';
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:item.id},renderContext:'reader',handler:url=>{
    if(String(url).includes('/api/references'))return Response.json({references:[]});
    return Response.json(String(url).includes('document-context/')?proposalContextResponse(DOCUMENT,AMENDMENT,listId,7):responseFor(url,{items:[item]}));
  }});
  await h.click('Read in context');await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  assert(h.container.textContent.includes('Commission proposal · COM(2025)0087'));
  assert.equal(h.container.querySelector('[data-amendment-block]').dataset.contextTarget,'true');
  const reader=h.container.querySelector('.document-context-reader'),summary=reader.querySelector('[aria-label="Vote on this text"]');
  assert(summary,'the reader keeps the vote in view');assert(summary.querySelector('.member-votes-position')&&summary.querySelector('.member-votes-result'));
  assert.equal(reader.querySelector('.document-context-back').textContent,'← Back to vote');
  assert(h.calls.some(url=>url.includes('wording-lang=en')&&!url.includes('body=0')));
});

test('amendment vote proposers use exact directory IDs and preserve unknown labels',async t=>{
  const h=await mountWording(t,{members:[{id:42,firstName:'Mika',lastName:'Aaltola'}],variants:[wordingVariant({authors:[{personId:'42',name:'Mika AALTOLA'},{personId:'99',name:'Guest McDONALD'}]})]});
  const wording=h.container.querySelector('.member-votes-wording');
  assert.match(wordingViewText(wording),/Proposed by Mika Aaltola, Guest McDONALD/);
  assert.equal(wording.querySelector('[title="Source label: Mika AALTOLA"]').textContent,'Mika Aaltola');
});

function attendanceResponse({status='observed',memberStatus='listed-present'}={}) {
  const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+SITTING,fetchedAt:'2026-03-26T12:00:00Z',contentHash:'c'.repeat(64),stale:false,refreshInProgress:false,refreshError:null};
  return {version:1,member:{id:String(MEMBER),mandateStatus:'not-assessed'},sittings:[{sittingId:SITTING,date:SITTING.slice(7),status,memberStatus:status==='observed'?memberStatus:null,excusedSupplied:true,counts:{present:600,excused:2,duplicatePresent:0,duplicateExcused:0,malformedReferences:status==='partial'?1:0},conflictingIds:memberStatus==='conflicting'?[String(MEMBER)]:[],source,
    register:{documentId:'PV-10-2026-03-25-ATT',pdf:{url:'https://data.europarl.europa.eu/distribution/doc/PV-10-2026-03-25-ATT_en.pdf',language:'en'},issued:'2026-03-26T10:00:00Z',status:'available',source}}]};
}

const olderWeek='2026-03-16',olderSitting='MTG-PL-2026-03-18';
const searchCalendar={version:2,weeks:[{week:WEEK,sittings:[{sittingId:SITTING,date:SITTING.slice(7)}]},{week:olderWeek,sittings:[{sittingId:olderSitting,date:olderSitting.slice(7)}]}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}};
function searchResponse(url,{olderRecorded=true,coverage={}}={}) {
  const older=stateFrom(url).week===olderWeek;
  const item=vote(1,older&&olderRecorded?{}:{actualPosition:{status:'no-record',position:null},alignment:'unclassified'});
  const value=responseFor(url,{items:[item],coverage});
  return older?JSON.parse(JSON.stringify(value).replaceAll(SITTING,olderSitting).replaceAll(SITTING.slice(7),olderSitting.slice(7))):value;
}

test('initial votes skips empty latest weeks, pins the latest recorded week and leaves manual navigation intact',async t=>{
  let attendanceCalls=0;
  const h=await mount(t,{calendar:searchCalendar,handler:url=>Response.json(searchResponse(url)),attendanceHandler:()=>{attendanceCalls++;return Response.json(JSON.parse(JSON.stringify(attendanceResponse()).replaceAll(SITTING,olderSitting).replaceAll(SITTING.slice(7),olderSitting.slice(7))));}});
  assert.equal(h.state.week,olderWeek);assert.equal(h.state.snapshotId,SNAPSHOT);
  assert(h.container.querySelector('.member-votes-subject'));
  assert(h.changes.every(change=>change.options.replace),'search changes replace history');
  assert.deepEqual([...new Set(h.calls.filter(url=>url.includes('member-votes/')).map(url=>stateFrom(url).week))],['latest',olderWeek]);
  assert.equal(attendanceCalls,1,'skipped weeks start no attendance read');
  await h.click('Next plenary week');
  assert.equal(h.state.week,WEEK);assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.equal(h.container.querySelector('.member-votes-subject'),null);
});

for(const state of [{week:WEEK},{week:'latest',decisionId:decision(1)}])test('explicit period stays on its requested empty week '+JSON.stringify(state),async t=>{
    const h=await mount(t,{calendar:searchCalendar,state,handler:url=>Response.json(searchResponse(url))});
    assert.equal(h.state.week,WEEK);assert.equal(h.calls.some(url=>url.includes('member-votes/')&&stateFrom(url).week===olderWeek),false);
});

test('manual period selection cancels a pending automatic search',async t=>{
  let releaseOlder;
  const gate=new Promise(resolve=>{releaseOlder=resolve;});
  const h=await mount(t,{calendar:searchCalendar,handler:async url=>{if(stateFrom(url).week===olderWeek)await gate;return Response.json(searchResponse(url));}});
  assert.match(h.container.textContent,/Finding latest recorded votes/);
  await h.update({week:WEEK});
  await act(async()=>releaseOlder());
  assert.equal(h.state.week,WEEK);assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.equal(h.container.querySelector('.member-votes-subject'),null);
});

test('an invalid calendar leaves the latest empty week usable instead of an endless search',async t=>{
  const h=await mount(t,{calendar:{version:109},handler:url=>Response.json(searchResponse(url))});
  assert.equal(h.state.week,WEEK);assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.doesNotMatch(h.container.textContent,/Finding latest recorded votes/);
});

test('a member with no positions in any available week returns to the latest plenary',async t=>{
  let latestReads=0;
  const refreshed='b'.repeat(64);
  const h=await mount(t,{calendar:searchCalendar,handler:url=>{
    const state=stateFrom(url),value=searchResponse(url,{olderRecorded:false});
    if(state.week==='latest')latestReads++;
    value.snapshotId=state.snapshotId??(latestReads>1?refreshed:SNAPSHOT);
    return Response.json(value);
  }});
  assert.equal(latestReads,2,'refresh the initial snapshot after scanning older weeks');
  assert.equal(h.state.week,WEEK);assert.equal(h.state.snapshotId,refreshed);assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert(h.calls.some(url=>url.includes('member-votes/')&&stateFrom(url).week===olderWeek));
  assert(h.calls.filter(url=>url.includes('member-votes/')).length<=4,'the search terminates after the available calendar');
});

test('an unavailable latest vote period stops the search without claiming no positions',async t=>{
  const h=await mount(t,{calendar:searchCalendar,handler:url=>Response.json(responseFor(url,{items:[],subjects:[],coverage:{status:'unavailable',collectionComplete:false}}))});
  assert.equal(h.state.week,WEEK);assert.match(h.container.textContent,/Voting records unavailable/);
  assert.equal(h.calls.some(url=>url.includes('member-votes/')&&stateFrom(url).week===olderWeek),false);
});

test('an unavailable earlier candidate returns to the latest week with a fresh snapshot',async t=>{
  let latestReads=0;
  const refreshed='b'.repeat(64);
  const h=await mount(t,{calendar:searchCalendar,handler:url=>{
    const state=stateFrom(url),older=state.week===olderWeek;
    if(state.week==='latest')latestReads++;
    const value=searchResponse(url,{olderRecorded:false,coverage:older?{status:'unavailable',collectionComplete:false}:{}});
    value.snapshotId=state.snapshotId??(latestReads>1?refreshed:SNAPSHOT);
    return Response.json(value);
  }});
  assert.equal(h.state.week,WEEK);assert.equal(h.state.snapshotId,refreshed);
  assert.equal(latestReads,2);
  assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.doesNotMatch(h.container.textContent,/Voting records unavailable|Finding latest recorded votes/);
  assert(h.changes.every(change=>change.state.week===WEEK),'never pin the unavailable earlier candidate');
});

for(const memberStatus of ['listed-excused','listed-present','not-listed'])test('a week without member positions hides results and keeps '+memberStatus+' attendance',async t=>{
  const unrecorded=vote(1,{actualPosition:{status:'no-record',position:null},alignment:'unclassified',scope:{kind:'whole-text',basis:'exact-component-reference'}});
  const calendar={version:2,weeks:[{week:WEEK,sittings:[{sittingId:SITTING,date:SITTING.slice(7)}]},{week:'2026-03-16',sittings:[{sittingId:'MTG-PL-2026-03-18',date:'2026-03-18'}]}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}};
  const h=await mount(t,{calendar,state:{week:WEEK,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[unrecorded],subjects:[subject([unrecorded],{wholeTextDecisions:[unrecorded]})],pagination:{observedTotal:100,filteredTotal:100,nextOffset:1}})),attendanceHandler:()=>Response.json(attendanceResponse({memberStatus}))});
  assert.equal(visiblePane(h.container).textContent,'No recorded positions this week.');
  assert.equal(h.container.querySelector('.member-votes-subject, .member-votes-tools, .member-votes-alignment, .member-votes-pages'),null);
  assert.match(h.container.querySelector('.member-votes-attendance-line').textContent,new RegExp({'listed-excused':'excused','listed-present':'listed present','not-listed':'not listed'}[memberStatus]));
  assert.doesNotMatch(h.container.textContent,/absent/i);
  await act(async()=>h.container.querySelectorAll('.member-votes-days button')[1].click());
  assert.equal(h.state.sittingId,SITTING);assert.match(visiblePane(h.container).textContent,/No recorded positions at this sitting/);
  await h.click('Previous plenary week');
  assert.equal(h.state.week,'2026-03-16');assert.equal(h.state.sittingId,null);
});

test('a zero-position partial week keeps its incomplete coverage notice without displaying outcomes',async t=>{
  const h=await mount(t,{handler:url=>Response.json(responseFor(url,{items:[vote(1,{actualPosition:{status:'no-record',position:null},alignment:'unclassified'})],coverage:{status:'partial',collectionComplete:false,incompleteSittingIds:[SITTING]}}))});
  assert.match(h.container.querySelector('.member-votes-notice').textContent,/Incomplete voting records/);
  assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
  assert.equal(h.container.querySelector('.member-votes-subject'),null);
});

test('an unknown recorded total stays unavailable rather than becoming a zero-position claim',async t=>{
  const h=await mount(t,{handler:url=>Response.json(responseFor(url,{items:[],subjects:[],coverage:{status:'unavailable',collectionComplete:false}}))});
  assert.match(h.container.textContent,/Voting records unavailable/);
  assert.doesNotMatch(h.container.textContent,/No recorded positions|absent/i);
});

test('a recorded vote remains visible alongside a contradictory excused register entry',async t=>{
  const h=await mount(t,{handler:url=>Response.json(responseFor(url)),attendanceHandler:()=>Response.json(attendanceResponse({memberStatus:'listed-excused'}))});
  assert(h.container.querySelector('.member-votes-subject'));assert.match(h.container.querySelector('.member-votes-attendance-line').textContent,/excused/);
});

test('all decisions shows non-named ballots, shared methods, counts and page summaries without changing outcomes',async t=>{
  const hand=vote(1,{method:'VOTE_HAND',actualPosition:{status:'not-individually-recorded',position:null},alignment:'unclassified',totals:{for:null,against:null,abstaining:null}});
  const electronic=vote(2,{method:'VOTE_ELECTRONIC',actualPosition:{status:'not-individually-recorded',position:null},alignment:'unclassified'});
  const h=await mount(t,{state:{week:WEEK,expandedSubjectIds:[SUBJECT]},handler:url=>Response.json(responseFor(url,{items:[hand,electronic,vote(3)]})),attendanceHandler:()=>Response.json(attendanceResponse())});
  assert.equal(h.state.positions,'all');assert.equal(h.container.querySelector('.member-votes-filter button').textContent,'All decisions');
  assert.match(h.container.querySelector('.member-votes-tools').textContent,/1–3 of 3 decisions · 1 with a recorded position/);
  assert.match(h.container.querySelector('.member-votes-subject-count:last-child').textContent,/2 not individually recorded/);
  const rows=h.container.querySelectorAll('.member-votes-row');
  assert.match(rows[0].textContent,/Show of hands.*Not individually recorded.*No tally published/);
  assert.match(rows[1].textContent,/Electronic vote \(names not recorded\).*Not individually recorded.*For 400/);
  assert.equal(h.container.querySelectorAll('.member-votes-row .member-votes-attendance').length,0);
  assert.match(h.container.querySelector('.member-votes-attendance-line').textContent,/listed present 25 Mar/);
});

for(const memberStatus of ['listed-present','not-listed','listed-excused'])test('attendance stays in list for '+memberStatus,async t=>{
 const h=await mount(t,{state:{week:WEEK,decisionId:decision(1)},attendanceHandler:()=>Response.json(attendanceResponse({memberStatus}))});
 assert.equal(visiblePane(h.container).querySelector('.member-votes-attendance'),null);
 await h.update({decisionId:null});assert(h.container.querySelector('.member-votes-attendance-line'));
});

test('attendance starts only after valid votes settle and failures leave votes and pagination usable',async t=>{
  let releaseVotes,releaseAttendance;
  const voteGate=new Promise(resolve=>{releaseVotes=resolve;}),attendanceGate=new Promise(resolve=>{releaseAttendance=resolve;});
  const attendanceCalls=[];
  const h=await mount(t,{handler:async url=>{await voteGate;return Response.json(responseFor(url,{pagination:{observedTotal:2,filteredTotal:2,nextOffset:stateFrom(url).offset?null:1}}));},attendanceHandler:async url=>{attendanceCalls.push(String(url));await attendanceGate;return new Response(JSON.stringify({error:{code:'attendance_unavailable',message:'unavailable'}}),{status:502,headers:{'content-type':'application/json'}});}});
  assert.equal(attendanceCalls.length,0);assert.equal(h.container.querySelector('.member-votes-attendance-line'),null);
  await act(async()=>releaseVotes());assert.equal(attendanceCalls.length,1);
  assert.equal(h.container.querySelector('.member-votes-attendance-line').textContent,'Loading attendance register…');
  const route=new URL(attendanceCalls[0],'http://localhost');assert.equal(route.searchParams.get('sittings'),SITTING);assert.equal(route.searchParams.has('snapshot'),false);
  assert.match(visiblePane(h.container).textContent,/Synthetic subject/);assert.equal(button(h.container,'Next page').disabled,false);
  await act(async()=>releaseAttendance());
  assert.match(h.container.querySelector('.member-votes-attendance-line').textContent,/Attendance couldn’t be loaded/);
  assert(button(h.container,'Retry attendance'));
  assert.equal(h.container.querySelector('[role="alert"]'),null);assert.equal(button(h.container,'Next page').disabled,false);
  await h.click('Next page');assert.equal(h.state.offset,1);assert.equal(h.state.snapshotId,SNAPSHOT);
});

test('invalid vote envelopes cannot start attendance reads',async t=>{
  let starts=0;
  const h=await mount(t,{handler:url=>Response.json({...responseFor(url),version:3}),attendanceHandler:()=>{starts++;return Response.json(attendanceResponse());}});
  assert.equal(starts,0);assert.match(h.container.textContent,/These voting records are unavailable/);
});


test('no scanned sittings leaves the unattempted attendance line hidden',async t=>{
  let reads=0;
  const h=await mount(t,{handler:url=>Response.json(responseFor(url,{items:[],subjects:[],coverage:{scannedSittingIds:[]}})),attendanceHandler:()=>{reads++;return Response.json(attendanceResponse());}});
  assert.equal(reads,0);assert.equal(h.container.querySelector('.member-votes-attendance-line'),null);
  assert.equal(h.container.querySelector('.member-votes-filter button').textContent,'All decisions');
});

for(const outcome of ['LAPSED','WITHDRAWN'])test('unheld '+outcome+' detail replaces its retained method label',async t=>{
  const item=vote(1,{outcome,ballotStatus:'not-conducted',method:'VOTE_ELECTRONIC_ROLLCALL',actualPosition:{status:'not-conducted',position:null},totals:{for:null,against:null,abstaining:null}});
  const h=await mount(t,{state:{week:WEEK,decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item]}))});
  const detail=visiblePane(h.container);
  assert.equal(detail.querySelector('.member-votes-detail > .member-votes-muted').textContent,'Not put to a vote');
  assert.doesNotMatch(detail.textContent,/Roll-call vote/);
});

test('partial totals keep base wording in detail while entirely null totals say unpublished',async t=>{
  const items=[vote(1,{totals:{for:400,against:null,abstaining:0}}),vote(2,{totals:{for:null,against:null,abstaining:null}})];
  const h=await mount(t,{state:{week:WEEK,decisionId:items[0].id},handler:url=>Response.json(responseFor(url,{items}))});
  assert.match(visiblePane(h.container).querySelector('.member-votes-result').textContent,/Tallies unavailable/);
  assert.doesNotMatch(visiblePane(h.container).textContent,/No tally published/);
  await h.update({decisionId:items[1].id});
  assert.match(visiblePane(h.container).querySelector('.member-votes-result').textContent,/No tally published/);
});

test('pending attendance survives filter, page and decision reloads for the same scope',async t=>{
  let releaseVotes,releaseAttendance,holdVotes=false;
  const attendanceGate=new Promise(resolve=>{releaseAttendance=resolve;}),reads=[];
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:async url=>{
    if(holdVotes)await new Promise(resolve=>{releaseVotes=resolve;});
    return Response.json(responseFor(url));
  },attendanceHandler:async(url,{signal})=>{reads.push({url:String(url),signal});await attendanceGate;return Response.json(attendanceResponse());}});
  assert.equal(reads.length,1);
  for(const patch of [{positions:'recorded'},{offset:50},{decisionId:decision(1)}]){
    holdVotes=true;await h.update(patch);
    assert.equal(reads.length,1);assert.equal(reads[0].signal.aborted,false);
    holdVotes=false;await act(async()=>releaseVotes());
    assert.equal(reads.length,1);assert.equal(reads[0].signal.aborted,false);
  }
  await act(async()=>releaseAttendance());
  assert.equal(visiblePane(h.container).querySelector('.member-votes-attendance'),null);
  await h.update({decisionId:null,offset:0});
  assert.match(h.container.querySelector('.member-votes-attendance-line').textContent,/listed present/);
  assert.equal(reads.length,1);
});

for(const change of ['member','language','period','resolved sittings','empty resolved sittings'])test('attendance route clears when '+change+' changes',async t=>{
  let holdVotes=false,releaseVotes,releaseAttendance;
  const gate=new Promise(resolve=>{releaseAttendance=resolve;}),reads=[];
  t.after(()=>releaseAttendance());
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:async url=>{
    if(holdVotes)await new Promise(resolve=>{releaseVotes=resolve;});
    return Response.json(responseFor(url,change.includes('resolved sittings')&&holdVotes?{coverage:{scannedSittingIds:change==='empty resolved sittings'?[]:['MTG-PL-2026-03-26']}}:{}));
  },attendanceHandler:async(url,{signal})=>{reads.push({url:String(url),signal});await gate;return Response.json(attendanceResponse());}});
  assert.equal(reads.length,1);holdVotes=true;
  if(change==='member')await h.updateProps({memberId:42});
  else if(change==='language')await h.updateProps({language:'fr'});
  else await h.update(change==='period'?{week:'2026-03-30',snapshotId:null}:{positions:'recorded'});
  if(change.includes('resolved sittings')){
    assert.equal(reads[0].signal.aborted,false);
    await act(async()=>releaseVotes());
    if(change==='empty resolved sittings'){assert.equal(reads.length,1);assert.equal(h.container.querySelector('.member-votes-attendance-line'),null);}
    else {assert.equal(reads.length,2);assert.match(reads[1].url,/MTG-PL-2026-03-26/);}
  }else{
    assert.equal(h.container.querySelector('.member-votes-attendance-line'),null);
    await act(async()=>releaseVotes());
  }
  assert.equal(reads[0].signal.aborted,true);
  await act(async()=>releaseAttendance());
});

test('unattempted attendance detail stays hidden with an empty sitting selection',async t=>{
  const h=await mount(t,{state:{week:WEEK,decisionId:decision(1)},handler:url=>Response.json(responseFor(url,{coverage:{scannedSittingIds:[]}}))});
  assert(visiblePane(h.container).querySelector('.member-votes-detail'));
  assert.equal(h.container.querySelector('.member-votes-attendance'),null);
});

for(const detail of [false])for(const failure of ['http','network','invalid'])test(`attendance ${failure} failure retries in ${detail?'detail':'list'} without implying source absence`,async t=>{
 let attempts=0;
 const h=await mount(t,{state:{week:WEEK,...(detail?{decisionId:decision(1)}:{})},attendanceHandler:()=>{
   attempts++;
   if(attempts>1)return Response.json(attendanceResponse());
   if(failure==='network')throw new TypeError('Network failure');
   return failure==='http'?Response.json({error:{code:'not_found'}},{status:404}):Response.json({version:0});
 }});
 const attendance=()=>h.container.querySelector(detail?'.member-votes-attendance':'.member-votes-attendance-line');
 assert.match(attendance().textContent,/Attendance couldn’t be loaded/);
 assert.doesNotMatch(attendance().textContent,/unavailable|not yet published/);
 await h.click('Retry attendance');
 assert.equal(attempts,2);assert.match(attendance().textContent,/Listed as present|listed present/);
 assert.equal(button(h.container,'Retry attendance'),undefined);
 assert.equal(h.state.decisionId,detail?decision(1):null);
});

test('a sole amendment heading is not repeated and unavailable wording has no text-language caption',async t=>{
 const h=await mountWording(t,{variants:[wordingVariant({wordingStatus:'unavailable',originalText:null,proposedText:null,authors:[{name:'Exact proposer'}]})]});
 const detail=h.container.querySelector('.member-votes-detail'),wording=detail.querySelector('.member-votes-wording');
 assert.equal(detail.querySelector('h2').textContent,'Amendment 7');assert.equal(wording.querySelector('h3'),null);
 assert.doesNotMatch(wording.textContent,/Text language/);assert.match(wording.textContent,/Proposed by Exact proposer/);
});

const linkedReportVote=()=>vote(1,{context:{...vote(1).context,relationships:[{from:'https://data.europarl.europa.eu/eli/dl/event/'+SUBJECT,field:'based_on_a_realization_of',to:'https://data.europarl.europa.eu/eli/dl/doc/'+DOCUMENT}]}});
const reportSubject=items=>subject(items,{titles:{fr:'Sujet français'},title:'Sujet français',titleLanguage:'fr',documentIds:[DOCUMENT]});
const reportResponse=(patch={})=>({sourceUrl:'https://data.europarl.europa.eu/api/v2/plenary-documents/'+DOCUMENT,payload:{data:[{id:'eli/dl/doc/'+DOCUMENT,identifier:DOCUMENT,work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Exact English report title'},...patch}]}});

test('a detail uses the requested-language report title only through an exact subject relationship',async t=>{
 const item=linkedReportVote();
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>String(url).includes('source-record?')?Response.json(reportResponse()):Response.json(responseFor(url,{items:[item],subjects:[reportSubject([item])]}))});
 const title=()=>h.container.querySelector('.member-votes-detail-subject');
 assert.equal(title().textContent,'Exact English report title');assert.equal(title().lang,'en');
 const route=new URL(h.calls.find(url=>url.includes('source-record?')),'http://localhost');
 assert.equal(route.searchParams.get('url'),reportResponse().sourceUrl);
 await h.updateProps({language:'fr'});assert.equal(title().textContent,'Sujet français');assert.equal(title().lang,'fr');
});

for(const patch of [{identifier:'A-10-2026-9999'},{id:'eli/dl/doc/A-10-2026-9999'},{work_type:'def/ep-document-types/OTHER'},{title_dcterms:{de:'Deutscher Titel'}},{id:null}])test('mismatched or missing report titles preserve the original subject and language '+JSON.stringify(patch),async t=>{
 const item=linkedReportVote();
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>String(url).includes('source-record?')?Response.json(reportResponse(patch)):Response.json(responseFor(url,{items:[item],subjects:[reportSubject([item])]}))});
 const title=h.container.querySelector('.member-votes-detail-subject');assert.equal(title.textContent,'Sujet français');assert.equal(title.lang,'fr');
});

for(const ambiguous of [false,true])test('unlinked or ambiguous report context starts no subject-title lookup '+ambiguous,async t=>{
 const item=ambiguous?linkedReportVote():vote(1),group=reportSubject([item]);if(ambiguous)group.documentIds.push('A-10-2026-9999');
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item],subjects:[group]}))});
 assert.equal(h.calls.some(url=>url.includes('source-record?')),false);assert.equal(h.container.querySelector('.member-votes-detail-subject').lang,'fr');
});

for(const relationships of [undefined,null,{},[null]])test('malformed report relationships keep the subject usable '+JSON.stringify(relationships),async t=>{
 const item=linkedReportVote();item.context.relationships=relationships;
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item],subjects:[reportSubject([item])]}))});
 assert.equal(h.calls.some(url=>url.includes('source-record?')),false);
 const title=h.container.querySelector('.member-votes-detail-subject');assert(title);assert.equal(title.textContent,'Sujet français');assert.equal(title.lang,'fr');
});

test('a mismatched subject URI cannot establish the report-title relationship',async t=>{
 const item=linkedReportVote(),group=reportSubject([item]);group.uri='https://data.europarl.europa.eu/eli/dl/event/another-subject';item.context.relationships[0].from=group.uri;
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>Response.json(responseFor(url,{items:[item],subjects:[group]}))});
 assert.equal(h.calls.some(url=>url.includes('source-record?')),false);assert.equal(h.container.querySelector('.member-votes-detail-subject').textContent,'Sujet français');
});

for(const empty of [{titles:{},title:null,titleLanguage:null},{titles:{en:'  '},title:'',titleLanguage:'en'}])test('an empty subject title can use the exact English report title '+JSON.stringify(empty),async t=>{
 const item=linkedReportVote(),group={...reportSubject([item]),...empty};
 const h=await mount(t,{state:{decisionId:item.id},handler:url=>String(url).includes('source-record?')?Response.json(reportResponse()):Response.json(responseFor(url,{items:[item],subjects:[group]}))});
 const lookups=h.calls.filter(url=>url.includes('source-record?'));assert(lookups.length>0);
 for(const lookup of lookups)assert.equal(new URL(lookup,'http://localhost').searchParams.get('url'),reportResponse().sourceUrl);
 const title=h.container.querySelector('.member-votes-detail-subject');assert.equal(title.textContent,'Exact English report title');assert.equal(title.lang,'en');
});

test('wording proposers get exact-ID country without current political group',async t=>{
 const h=await mountWording(t,{members:[{id:42,firstName:'Exact',lastName:'Proposer',countryCode:'HU',groupCode:'PPE'}],variants:[wordingVariant({authors:[{personId:'42',name:'Exact proposer'},{personId:'99',name:'Exact proposer'}]})]});
 const rows=h.container.querySelectorAll('.member-votes-wording .member-votes-muted>span');
 assert.equal(rows[0].querySelector('.member-affiliation').textContent,'HUHungary');
 assert.equal(rows[0].querySelector('.member-affiliation i'),null);
 assert.equal(rows[1].querySelector('.member-affiliation'),null);
});

test('Votes wording preserves vertical spans and shows a formatting-only edit in both modes',async t=>{
  const variant=wordingVariant({originalText:'CO2 note4',proposedText:'CO2 note4',originalFormatting:[{start:2,end:3,kind:'subscript'}],proposedFormatting:[{start:2,end:3,kind:'subscript'},{start:8,end:9,kind:'superscript'}]});
  const h=await mountWording(t,{variants:[variant]});
  const comparison=h.container.querySelector('.member-votes-comparison');
  assert.equal(comparison.querySelector('sub').textContent,'2');
  assert.equal(comparison.querySelector('ins sup').textContent,'4');
  assert.equal(wordingText(comparison,'original'),variant.originalText);assert.equal(wordingText(comparison,'proposed'),variant.proposedText);
  await h.click('Side by side');
  assert.equal(comparison.querySelectorAll('sub').length,2);assert.equal(comparison.querySelector('ins sup').textContent,'4');
  assert.equal(wordingText(comparison,'original'),variant.originalText);assert.equal(wordingText(comparison,'proposed'),variant.proposedText);
});

test('split amendment and whole-text context restore published part descriptions after remount',async t=>{
  for(const kind of ['amendment','whole-text'])await t.test(kind,async t=>{
    const context={documentId:DOCUMENT,view:'document'};
    const item=vote(1,{scope:{kind,basis:'exact-component-reference'},parts:[part(1,{contentByLanguage:{fr:{text:null,sourceLiteral:'Première phrase exacte.'}}})],context:{...vote(1).context,documentIds:[DOCUMENT]}});
    const h=await mount(t,{state:{week:WEEK,decisionId:item.id,context},renderContext:request=>createElement('section',null,request.summary,createElement('button',{onClick:request.onBack},'Back from context')),handler:url=>Response.json(responseFor(url,{items:[item]}))});
    const check=()=>{
      const summary=h.container.querySelector('[aria-label="Vote on this text"]');assert(summary);
      assert.equal(summary.querySelector('.member-votes-part p').textContent,'Première phrase exacte.');
      assert.equal(summary.querySelector('.member-votes-part p').lang,'fr');
      assert.match(summary.textContent,/Published description of part 1/);
      assert(summary.querySelector('.member-votes-position'));assert(summary.querySelector('.member-votes-result'));
    };
    check();await h.remount();check();await h.click('Back from context');
    assert.equal(h.state.context,null);assert.equal(h.state.decisionId,item.id);
  });
});

test('detail subordinates whole-text decisions and removes final-vote self links',async t=>{
 const item=vote(1),whole=vote(2,{scope:{kind:'whole-text'}}),items=[item,whole];
 const h=await mount(t,{state:{week:WEEK,decisionId:item.id},handler:url=>Response.json(responseFor(url,{items,subjects:[subject(items,{wholeTextDecisions:[whole]})]}))});
 const detail=h.container.querySelector('.member-votes-detail');
 assert.equal(detail.querySelector(':scope > .member-votes-whole'),null);
 assert.equal(detail.querySelector('details.member-votes-related summary').textContent,'Final vote on the whole text');
 await h.update({decisionId:whole.id});assert.equal(h.container.querySelector('.member-votes-detail .member-votes-whole'),null);
});

test('pending exact decision reads preserve page nodes and wording; changed filters cannot reuse them',async t=>{
 let release,hold=false;
 const item=vote(1),h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,expandedSubjectIds:[SUBJECT]},handler:async url=>{if(hold)await new Promise(resolve=>{release=resolve;});return Response.json(responseFor(url,{items:[item]}));}});
 const list=h.container.querySelector('.member-votes-pane'),row=list.querySelector('[data-vote-id]');
 hold=true;await h.update({decisionId:item.id});
 assert.equal(h.container.querySelector('.member-votes-pane'),list);assert.equal(list.querySelector('[data-vote-id]'),row);
 assert(h.container.querySelector('.member-votes-detail'));assert.doesNotMatch(h.container.textContent,/Loading voting records/);
 hold=false;await act(async()=>release());
 hold=true;await h.update({positions:'recorded'});assert.equal(h.container.querySelector('.member-votes-detail'),null);
 hold=false;await act(async()=>release());
});

test('an off-page selection keeps the list mounted while pending without claiming absence',async t=>{
 let release,hold=false;
 const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:async url=>{if(hold)await new Promise(resolve=>{release=resolve;});return Response.json(responseFor(url,{selected:stateFrom(url).decisionId?{status:'not-found-in-scanned-data',item:null}:{status:'not-requested',item:null}}));}});
 const list=h.container.querySelector('.member-votes-pane');hold=true;await h.update({decisionId:decision(99)});
 assert.equal(h.container.querySelector('.member-votes-pane'),list);
 assert.match(visiblePane(h.container).textContent,/Loading selected vote/);assert.doesNotMatch(visiblePane(h.container).textContent,/Vote unavailable/);
 hold=false;await act(async()=>release());assert.match(visiblePane(h.container).textContent,/Vote unavailable/);
});

test('settling a retained selection preserves control focus; new off-page selections focus once available',async t=>{
 let release,hold=false;
 const items=[vote(1)],h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:async url=>{
   if(hold)await new Promise(resolve=>{release=resolve;});
   const selectedId=stateFrom(url).decisionId;
   return Response.json(responseFor(url,{items,selected:selectedId?{status:'found',item:selectedId===decision(99)?vote(99):items[0]}:{status:'not-requested',item:null}}));
 }});
 hold=true;await h.update({decisionId:decision(1)});
 assert.equal(document.activeElement,visiblePane(h.container).querySelector('h2'));
 const back=button(h.container,'← Back to votes');back.focus();
 hold=false;await act(async()=>release());assert.equal(document.activeElement,back);
 hold=true;await h.update({decisionId:decision(99)});
 assert.match(visiblePane(h.container).textContent,/Loading selected vote/);
 hold=false;await act(async()=>release());
 assert.equal(document.activeElement,visiblePane(h.container).querySelector('h2'));
 assert.equal(document.activeElement.textContent,'Decision 99');
});

test('failed selection reads clear retained records before another selection starts',async t=>{
 let mode='ok',release;
 const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT},handler:async url=>{
   if(mode==='denied')return Response.json({error:{message:'Denied'}},{status:403});
   if(mode==='pending')await new Promise(resolve=>{release=resolve;});
   return Response.json(responseFor(url));
 }});
 mode='denied';await h.update({decisionId:decision(1)});assert.match(h.container.textContent,/Voting records could not be loaded/);
 mode='pending';await h.update({decisionId:decision(2)});assert.equal(h.container.querySelector('.member-votes-detail'),null);assert.equal(h.container.querySelector('[data-vote-id]'),null);
 mode='ok';await act(async()=>release());
});


test('period view keeps a subject larger than the old page together and canonicalizes old offsets',async t=>{
  const items=Array.from({length:65},(_,index)=>vote(index+1));
  const h=await mount(t,{state:{week:WEEK,offset:50,snapshotId:SNAPSHOT},handler:url=>Response.json(responseFor(url,{items,pagination:{mode:'period',offset:0,observedTotal:65,filteredTotal:65,recordedTotal:65}}))});
  assert.equal(h.state.offset,0);
  assert.equal(h.container.querySelectorAll('.member-votes-subject').length,1);
  assert.match(h.container.querySelector('.member-votes-subject-count').textContent,/^65 decisions$/);
  assert.equal(button(h.container,'Next page'),undefined);
  assert.equal(h.container.querySelectorAll('.member-votes-row').length,0);
  await h.click(h.container.querySelector('[data-vote-group]').textContent.trim());
  assert.equal(h.container.querySelectorAll('.member-votes-row').length,65);
  assert(h.calls.every(url=>new URL(url,'http://localhost').searchParams.get('view')==='period'));
});

test('chairing-only periods show no vote entries or Parliament outcome controls and clear omitted deep links',async t=>{
  const h=await mount(t,{state:{week:WEEK,snapshotId:SNAPSHOT,decisionId:decision(1)},handler:url=>Response.json(responseFor(url,{items:[],subjects:[],pagination:{omittedWhileChairingTotal:1},selected:stateFrom(url).decisionId?{status:'chairing',item:null}:{status:'not-requested',item:null}}))});
  assert.equal(h.state.decisionId,null);assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);assert.equal(h.container.querySelector('.member-votes-tools'),null);assert.equal(h.container.querySelector('.member-votes-subject'),null);assert.doesNotMatch(h.container.textContent,/Not individually recorded|Vote unavailable|No votes were recorded/);
});

test('an omitted deep link clears selection in the same update that pins its first snapshot',async t=>{
  const h=await mount(t,{state:{week:WEEK,snapshotId:null,decisionId:decision(1),context:{documentId:DOCUMENT,view:'document'}},handler:url=>Response.json(responseFor(url,{items:[],subjects:[],pagination:{omittedWhileChairingTotal:1},selected:stateFrom(url).decisionId?{status:'chairing',item:null}:{status:'not-requested',item:null}}))});
  assert.equal(h.state.decisionId,null);assert.equal(h.state.context,null);assert.equal(h.state.snapshotId,SNAPSHOT);
  const pinned=h.changes.filter(change=>change.state.snapshotId===SNAPSHOT);
  assert(pinned.length>0);assert(pinned.every(change=>change.state.decisionId===null&&change.state.context===null),'snapshot pinning must never reintroduce the omitted selection');
  assert.equal(h.calls.filter(route=>{const p=new URL(route,'http://localhost').searchParams;return p.get('snapshot')===SNAPSHOT&&p.get('decision')===decision(1);}).length,0);
  assert.match(visiblePane(h.container).textContent,/No recorded positions this week/);
});
