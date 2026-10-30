import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement as el} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {amendmentContextSelection,amendmentHref,amendmentRoute,committeeAmendmentIdentity,supportedAmendmentTarget} from './amendmentModel.mjs';
import {legislationAmendmentCounts,legislationContributors,legislationLatestSpeech} from './legislationContributors.mjs';
import {mergeDossierPage,retainDossierContributors,dossierAmendmentVotes} from './dossierActivityModel.mjs';
import {readExplorerParam} from './explorerQuery.mjs';
import {readMemberVotesJourney} from './memberVotesJourney.mjs';

const list='AGRI-AM-773343',target='AGRI-PR-773115',reference='2024/0318(COD)';
const source={url:'https://data.europarl.europa.eu/api/v2/documents/'+list,language:'en',fetchedAt:'2026-10-30T12:00:00Z'};
const amendment={id:'committee:'+list+':51',scope:'committee',contributionKind:'tabled-amendment',number:51,listId:list,targetDocumentId:target,targetRelationship:{status:'verified'},procedureIds:['2024-0318'],committees:[{code:'AGRI',name:'Agriculture'}],committeeDocumentKind:'draft-report',documentDate:'2025-05-20',dateBasis:'amendment-list-document',language:'en',originalText:'Old wording',proposedText:'New wording',authors:[{name:'An author',personId:'1'}],outcome:'unavailable',sources:[source]};

test('committee identities preserve exact list/number and cannot enter plenary member-vote routes',()=>{
  assert.deepEqual(committeeAmendmentIdentity(amendment.id),{listId:list,number:'51'});
  assert.deepEqual(committeeAmendmentIdentity('committee:CJ61-AM-778402:40'),{listId:'CJ61-AM-778402',number:'40'});
  for(const value of ['committee:'+list+':0','committee:AGRI-PR-773115:51','committee:agri-AM-773343:51','A-10-2026-0001-AM-51'])assert.equal(committeeAmendmentIdentity(value),null);
  assert.equal(supportedAmendmentTarget(target),false);
  const params=new URLSearchParams({member:'1','mv-decision':'exact','mv-document':target,'mv-amendment':amendment.id,'mv-list':list,'mv-view':'document'});
  assert.equal(readMemberVotesJourney(params,'1').invalid,true);
  const legacy=new URLSearchParams(amendmentRoute().split('?')[1]);assert.equal(legacy.has('scope'),false);assert.equal(legacy.has('list'),false);
  const route=new URLSearchParams(amendmentRoute({scope:'committee',list,procedure:'2024/0318(COD)',committee:'AGRI'}).split('?')[1]);
  assert.equal(route.get('scope'),'committee');assert.equal(route.get('list'),list);assert.equal(route.has('document'),false);assert.equal(route.get('procedure'),'2024-0318');
  const query=new URL(amendmentHref('/explore',{scope:'committee',list,procedure:'2024-0318'}),'https://example.test').searchParams;
  assert.equal(readExplorerParam(query,'am-list',''),list);
  assert.equal(readExplorerParam(new URLSearchParams('am-list=committee:AGRI-AM-773343:51'),'am-list',''),'');
  assert.equal(readExplorerParam(new URLSearchParams('dossier-committee=CJ61'),'dossier-committee',''),'CJ61');
  assert.equal(readExplorerParam(new URLSearchParams('dossier-stage=adopted'),'dossier-stage','all'),'all');
});

test('context selection pins exact list, wording language and verified draft without inventing a target',()=>{
  assert.deepEqual(amendmentContextSelection(amendment),{documentId:target,amendmentId:amendment.id,listId:list,scope:'committee',wordingLanguage:'en',view:'document'});
  for(const patch of [{targetDocumentId:null},{targetRelationship:{status:'unavailable'}},{targetRelationship:{status:'conflicting'}},{listId:'IMCO-AM-772127'},{number:52},{conflicted:true}])assert.equal(amendmentContextSelection({...amendment,...patch}),null);
  assert.equal(amendmentContextSelection({...amendment,wordingSource:{language:null}}).wordingLanguage,null);
  assert.equal(dossierAmendmentVotes({amendment:{...amendment,decisions:[{id:'same'}]}},[{vote:{id:'same'}}]).length,0);
});

const person=id=>({id,name:'Person '+id,currentMep:true,demographics:{country:'HU',group:'PPE',gender:'Female',age:'50–64'}});
function agendaDetail(){
  const people=['1','2','3','4'].map(person);
  return {id:'exact-agenda',date:'2025-06-01',people,roles:[],speeches:[{sourceId:'chair',date:'2025-06-01',people:[people[0],people[2]],kind:'PLENARY_DEBATE_SPEECH'}],amendments:{counts:{'1':2,'2':3},countsByStage:{'1':{committee:2,plenary:null},'2':{committee:null,plenary:3},'4':{committee:9,plenary:0}},authorIds:['1','2','4'],authorDates:{'1':'2025-05-20','2':'2025-05-21','4':'2025-06-02'}},stats:{dimensions:Object.fromEntries(Object.entries(people[0].demographics).map(([key,label])=>[key,[{label,count:4}]])),denominator:4,uniquePeople:4,uniqueCurrentMeps:4,peopleOutsideCurrentRoster:0}};
}
test('checked amendment-only authors survive chair exclusion, with stage-specific filters and denominators',()=>{
  const detail=agendaDetail(),headers={chair:{'1':{role:'Chairing the sitting'},'3':{role:'Chairing the sitting'}}};
  const before=structuredClone(detail),all=legislationContributors(detail,headers);
  assert.deepEqual(all.people.map(p=>p.id),['1','2']);assert.equal(all.stats.denominator,2);
  for(const rows of Object.values(all.stats.dimensions))assert.equal(rows[0].count,2);
  for(const [stage,id] of [['committee','1'],['plenary','2']]){const result=legislationContributors(detail,headers,stage);assert.deepEqual(result.people.map(p=>p.id),[id]);assert.equal(result.stats.denominator,1);for(const rows of Object.values(result.stats.dimensions))assert.equal(rows[0].count,1);}
  assert.deepEqual(legislationAmendmentCounts(detail,'4'),{committee:null,plenary:null});
  assert.deepEqual(legislationAmendmentCounts({amendments:{countsByStage:{'1':{committee:0,plenary:null}}}},'1'),{committee:0,plenary:null});
  assert.deepEqual(legislationAmendmentCounts({amendments:{counts:{'1':3}}},'1'),{committee:null,plenary:3});
  assert.deepEqual(legislationAmendmentCounts({amendments:{counts:{'1':3},countsByStage:{}}},'1'),{committee:null,plenary:null});
  assert.deepEqual(detail,before);
});
test('latest plenary shortcut uses only exact agenda speeches on or before the selected sitting',()=>{
  const detail=agendaDetail();detail.speeches=[{sourceId:'old',date:'2025-05-20',people:[person('2')]},{sourceId:'future',date:'2025-06-02',people:[person('2')]},{sourceId:'other-person',date:'2025-06-01',people:[person('1')]},{sourceId:'chair',date:'2025-06-01',people:[person('2')]}];
  assert.equal(legislationLatestSpeech(detail,{chair:{'2':{role:'Chairing the sitting'}}},'2').sourceId,'old');
  assert.equal(legislationLatestSpeech(detail,{},'9'),null);
  detail.speeches=[{sourceId:'one',date:'2025-06-01',people:[person('2')]},{sourceId:'two',date:'2025-06-01',people:[person('2')]}];
  assert.equal(legislationLatestSpeech(detail,{},'2'),null,'same-day IDs cannot establish the latest contribution');
  detail.speeches[0].start='2025-06-01T09:00:00Z';detail.speeches[1].start='2025-06-01T10:00:00Z';
  assert.equal(legislationLatestSpeech(detail,{},'2').sourceId,'two');
  detail.speeches[1].start=detail.speeches[0].start;
  assert.equal(legislationLatestSpeech(detail,{},'2'),null,'equal timestamps retain unresolved order');
});

function participantPage(participants,coverage={status:'partial',retryable:true,uncheckedTargets:[list],gaps:[],sources:[]}){
  return {procedure:{reference},generation:1,amendmentGeneration:1,memberId:null,section:'roles',participants,participantCoverage:coverage,items:[],pagination:{offset:0,targetOffset:0,next:null},coverage:{status:'complete',gaps:[],sources:[]}};
}
test('partial participant retries retain amendment evidence and nullable lower bounds only in the same scope',()=>{
  const evidence={id:amendment.id,scope:'committee',listId:list,targetDocumentId:target,date:'2025-05-20',source};
  const before=participantPage([{id:'1',name:'An author',roles:[],amendments:[evidence],amendmentCounts:{committee:1,plenary:null}}]);
  const failed=participantPage([]),kept=retainDossierContributors(before,failed);
  assert.equal(kept.participants[0].amendments[0].id,amendment.id);assert.deepEqual(kept.participants[0].amendmentCounts,{committee:1,plenary:null});assert.equal(kept.participantCoverage.retained,true);
  const translated=mergeDossierPage(before,participantPage([{id:'1',name:'An author',roles:[],amendments:[{...evidence,source:{...source,language:'fr'}}],amendmentCounts:{committee:1,plenary:0}}]));
  assert.equal(translated.participants[0].amendments.length,1);assert.deepEqual(translated.participants[0].amendmentCounts,{committee:1,plenary:null});
  const withheld=mergeDossierPage(before,participantPage([{id:'1',name:'An author',roles:[],amendments:[{...evidence,id:'committee:IMCO-AM-772127:51',listId:'IMCO-AM-772127',countConflict:true}],amendmentCounts:{committee:null,plenary:null}}]));assert.equal(withheld.participants[0].amendmentCounts.committee,null,'explicit distinct-count conflicts stay unavailable despite retained identities');
  const later=mergeDossierPage(before,participantPage([{id:'1',name:'An author',roles:[],amendments:[],amendmentCounts:{committee:null,plenary:null}}]));
  assert.equal(later.participants[0].amendmentCounts.committee,1,'a page without this person’s amendments preserves established evidence');
  const stillConflicted=mergeDossierPage(withheld,participantPage([{id:'1',name:'An author',roles:[],amendments:[],amendmentCounts:{committee:null,plenary:null}}]));
  assert.equal(stillConflicted.participants[0].amendmentCounts.committee,null);
  const repeated=mergeDossierPage(withheld,participantPage([{id:'1',name:'An author',roles:[],amendments:[{...evidence,id:'committee:IMCO-AM-772127:51',listId:'IMCO-AM-772127'}],amendmentCounts:{committee:1,plenary:null}}]));
  assert.equal(repeated.participants[0].amendmentCounts.committee,null,'a page-local count cannot resolve an explicit conflict from another page');
  const two=participantPage([{id:'1',name:'An author',roles:[],amendments:[evidence,{...evidence,id:'committee:IMCO-AM-772127:51',listId:'IMCO-AM-772127'}],amendmentCounts:{committee:2,plenary:null}}]);
  const scoped=retainDossierContributors(two,failed);
  assert.equal(scoped.participants[0].amendments.length,1);assert.equal(scoped.participants[0].amendmentCounts.committee,1,'a failed-target retry retains only the count supported by that target');
  for(const patch of [{generation:2},{amendmentGeneration:2},{stage:'committee'},{committee:'IMCO'},{participantCoverage:{status:'complete',retryable:false,gaps:[],sources:[]}}])assert.deepEqual(retainDossierContributors(before,{...failed,...patch}).participants,[]);
});

async function harness(t,handler,query='?view=amendments'){
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,IntersectionObserver:window.IntersectionObserver,ResizeObserver:window.ResizeObserver,requestAnimationFrame:callback=>{callback();return 0;},innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,load;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,location.href);calls.push(url);return await handler(url);});
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  const change=async(selector,value)=>act(async()=>{const node=container.querySelector(selector);assert(node,selector);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  return {window,load,container,calls,render,change};
}
test('committee cards retain list identities, public sources, empty edits and separate decisions without final-text UI',async t=>{
  const h=await harness(t,()=>{throw new Error('Closed card must not fetch');}),{AmendmentCard}=await h.load('/src/Amendments.tsx');
  const joint={...amendment,id:'committee:CJ61-AM-778402:51',listId:'CJ61-AM-778402',targetDocumentId:null,targetRelationship:{status:'unavailable'},committees:[{code:'CJ61'}],committeeDocumentKind:'draft-opinion',originalText:'',proposedText:'Inserted wording',decisions:[{id:'committee-decision',stage:'committee',outcome:'REJECTED'}],sources:[{...source,url:'https://data.europarl.europa.eu/api/v2/documents/CJ61-AM-778402'}]};
  await h.render(el('div',null,el(AmendmentCard,{item:amendment,language:'en'}),el(AmendmentCard,{item:joint,language:'en'})));
  const cards=h.container.querySelectorAll('.explorer-amendment-card');assert.equal(cards.length,2);assert.notEqual(cards[0].id,cards[1].id);
  assert.match(cards[0].textContent,/Committee amendment · AGRI · Draft report/);assert.match(cards[0].textContent,/Document date/);assert.match(cards[1].textContent,/CJ61 · Draft opinion/);assert.match(cards[1].textContent,/Committee decision · Whole amendment/);
  assert.equal(cards[1].querySelector('.explorer-amendment-context'),null);assert.equal(cards[0].querySelector('.explorer-amendment-context').open,false);
  assert.equal(cards[1].querySelectorAll('ins').length,1);assert.equal(h.calls.length,0);
  const links=[...h.container.querySelectorAll('a')].map(a=>a.href);assert(links.includes('https://www.europarl.europa.eu/doceo/document/CJ61-AM-778402_EN.html'));assert(links.every(href=>!href.includes('data.europarl')));
  assert(!h.container.textContent.includes(amendment.id));assert.doesNotMatch(h.container.textContent,/Made it into law|Survived|Successful amendment|Final text|fetchedAt|2026-10-30T/);
});
test('stage count links preserve exact person/procedure and offer a procedure chooser',async t=>{
  const h=await harness(t,()=>{throw new Error('Count links must not fetch');}),{DossierAmendmentLinks}=await h.load('/src/DossierActivity.tsx');
  await h.render(el(DossierAmendmentLinks,{references:[{id:'2024-0318',reference},{id:'2025-0176',reference:'2025/0176(COD)'}],person:'1',stage:'committee',count:2}));
  assert.match(h.container.querySelector('summary').textContent,/choose a procedure/);assert.equal(h.container.querySelector('details').open,false);
  const links=h.container.querySelectorAll('a');assert.equal(links.length,2);
  assert.match(h.container.querySelector('summary').textContent,/2\+ committee amendments/);
  for(const link of links){const query=new URL(link.href).searchParams;assert.equal(query.get('dossier-person'),'1');assert.equal(query.get('dossier-show'),'amendments');assert.equal(query.get('dossier-stage'),'committee');assert.equal(link.getAttribute('aria-label'),'Committee amendments · '+query.get('dossier-ref'));assert.doesNotMatch(link.textContent,/2\+|At least/);}
  await h.render(el(DossierAmendmentLinks,{references:[{id:'2024-0318',reference}],person:'1',stage:'committee',count:2}));
  assert.equal(h.container.querySelector('a').getAttribute('aria-label'),'At least 2 committee amendments');assert.match(h.container.querySelector('a').textContent,/2\+ committee amendments/);
});

test('source conversion includes exact joint lists and rejects machine collections',async t=>{
  const h=await harness(t,()=>{throw new Error('Source conversion must not fetch');}),{sourcePageUrl}=await h.load('/src/SourceLink.tsx');
  assert.equal(sourcePageUrl('https://data.europarl.europa.eu/distribution/reds_iCmDoc_Amd/CJ61-AM-778402/CJ61-AM-778402_fr.docx'),'https://www.europarl.europa.eu/doceo/document/CJ61-AM-778402_FR.html');
  assert.equal(sourcePageUrl('https://data.europarl.europa.eu/api/v2/documents?committee=CJ61'),null);
});

const waitFor=async predicate=>{const until=Date.now()+5000;while(!predicate()){assert(Date.now()<until,'Reader did not settle');await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));}};
test('contribution filters preserve the exact speech reader and committee work loads only the selected list',async t=>{
  const detail={...agendaDetail(),kind:'PLENARY_VOTE',phase:'past',title:'Agenda item',documentIds:[],procedures:[{id:'2024-0318',reference}],committeeWork:[{id:'exact-tabling',kind:'COMMITTEE_TABLING_AMENDMENT',date:'2025-05-20',documentIds:['CJ61-AM-778402'],committees:[{code:'CJ61',name:'Joint committee'}],procedureId:'2024-0318'}],speeches:[{sourceId:'exact-speech',date:'2025-05-21',start:null,people:[person('3')],kind:'PLENARY_DEBATE_SPEECH'}],votes:[],selectedVote:null,voteCoverage:{truncated:false},coverage:{missingDocumentIds:[],roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}};
  const topic={id:detail.id,title:detail.title,kind:detail.kind,date:detail.date,documentIds:[]};
  const h=await harness(t,url=>{
    if(url.pathname.endsWith('/insights/legislation'))return Response.json({view:'legislation',sitting:{id:'MTG-PL-2025-06-01',date:detail.date,phase:'past'},sittings:[{id:'MTG-PL-2025-06-01',date:detail.date,phase:'past'}],topics:[topic],detail:url.searchParams.has('topic')?detail:null,coverage:{agendaError:null}});
    if(url.pathname.endsWith('/insights/procedure-context'))return Response.json({reference,language:'en',summaries:[],summary:null,topics:[],subjects:[],source:{url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2024%2F0318(COD)'}});
    if(url.pathname.includes('/speech-transcript/'))return Response.json({id:'exact-speech',available:false});
    if(url.pathname.includes('/speech-context/'))return Response.json({speechId:'exact-speech',unavailable:true,debates:[]});
    if(url.pathname.includes('/speech/'))return Response.json({id:'exact-speech',xml:'<root><p>Exact linked speech</p></root>',speakers:[],availableTextLanguages:['en'],textLanguage:'en'});
    if(url.pathname.endsWith('/amendments'))return Response.json({items:[],total:0,offset:0,limit:20,coverage:{complete:false,pending:false}});
    throw new Error('Unexpected read '+url.href);
  },'?view=legislation&pl-sitting=MTG-PL-2025-06-01&agenda-topic=exact-agenda');
  const {Legislation}=await h.load('/src/Legislation.tsx');await h.render(el(Legislation,{language:'en',onBack(){}}));
  const cards=()=>[...h.container.querySelectorAll('.insight-participants .insight-people>article')];
  assert.equal(cards().length,3);assert(cards().some(card=>card.textContent.includes('Person 1')));assert(cards().some(card=>card.textContent.includes('Person 2')));
  assert.equal(h.calls.filter(url=>url.pathname.endsWith('/amendments')).length,0);
  const reader=h.container.querySelector('.insight-speech-panel'),speechCalls=h.calls.filter(url=>url.pathname.includes('/speech/')).length;
  await h.change('.insight-contribution-filter select','committee');
  assert.equal(cards().length,1);assert.match(cards()[0].textContent,/Person 1/);assert.equal(h.container.querySelector('.insight-speech-panel'),reader);assert.equal(h.calls.filter(url=>url.pathname.includes('/speech/')).length,speechCalls);
  assert.equal(cards()[0].querySelector('button'),null,'an amendment-only author has no generic speech shortcut');
  await h.change('.insight-contribution-filter select','plenary');assert.equal(cards().length,1);assert.match(cards()[0].textContent,/Person 2/);assert.equal(h.container.querySelector('.insight-speech-panel'),reader);
  await h.change('.insight-contribution-filter select','all');assert.equal(cards().length,3);
  const summary=h.container.querySelector('.insight-committee-amendments summary');assert(summary);await act(async()=>summary.click());
  await waitFor(()=>h.calls.some(url=>url.pathname.endsWith('/amendments')));
  const query=h.calls.find(url=>url.pathname.endsWith('/amendments')).searchParams;assert.equal(query.get('scope'),'committee');assert.equal(query.get('list'),'CJ61-AM-778402');assert.equal(query.get('procedure'),'2024-0318');assert.equal(query.has('document'),false);
  assert.equal(h.container.querySelector('.insight-speech-panel'),reader);
});

test('committee context opens lazily with exact typed identity and restores disclosure focus',async t=>{
  const h=await harness(t,url=>{
    assert(url.pathname.endsWith('/document-context/'+target));
    return Response.json({version:42,documentId:target,requestedLanguage:'en',requestedWordingLanguage:'en',document:null,amendment:{id:amendment.id,status:'unavailable',variants:[],gaps:[]},target:{status:'unavailable',paragraphs:[]},related:{status:'not-requested',items:[],gaps:[]},sources:[]});
  }),{AmendmentCard}=await h.load('/src/Amendments.tsx');
  await h.render(el(AmendmentCard,{item:amendment,language:'en'}));assert.equal(h.calls.length,0);
  const summary=h.container.querySelector('.explorer-amendment-context summary');await act(async()=>summary.click());await waitFor(()=>h.container.querySelector('.document-context-back'));
  const query=h.calls[0].searchParams;assert.equal(query.get('scope'),'committee');assert.equal(query.get('amendment'),amendment.id);assert.equal(query.get('list'),list);assert.equal(query.get('wording-lang'),'en');
  await act(async()=>h.container.querySelector('.document-context-back').click());assert.equal(h.container.querySelector('.explorer-amendment-context').open,false);assert.equal(document.activeElement,summary);
});
