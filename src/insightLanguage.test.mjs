import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

// Empty lang is an explicit unknown boundary, not permission to keep climbing.
function effectiveLanguage(node) {
  const element=node.nodeType===3?node.parentElement:node;
  return element.closest('[lang]')?.getAttribute('lang')??null;
}
const date=(value,language)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value+'T12:00:00Z'));
const stats={uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,denominator:0,referenceDate:'2026-10-07',dimensions:{country:[],group:[],gender:[],age:[]}};
const sitting={id:'MTG-PL-2026-10-07',date:'2026-10-07',phase:'past'};

async function harness(t,language,query='') {
  const window=new Window({url:'http://localhost/'+query});
  window.document.documentElement.lang=language;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,DOMParser:window.DOMParser,CSS:window.CSS,
    innerWidth:1440,requestAnimationFrame:window.requestAnimationFrame.bind(window),
    ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,respond=()=>{throw new Error('Unexpected fixture fetch');};
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,window.location.href);calls.push(url);return Response.json(await respond(url));});
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const load=async(path,name)=>(await vite.ssrLoadModule('/src/'+path+'.tsx'))[name];
  const render=element=>act(async()=>root.render(element));
  const click=async text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(button,'Missing button '+text);button.click();});
  const navigate=query=>act(async()=>{history.replaceState(null,'','/'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});
  return {window,container,calls,load,render,click,navigate,respond:handler=>{respond=handler;}};
}

test('insight controls and charts restore selected Intl language inside English UI in EN, HU and FR',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language);
    const CountryFilter=await h.load('CountryFilter','CountryFilter'),AnalysisPeriod=await h.load('AnalysisPeriod','AnalysisPeriod');
    const QuestionTrend=await h.load('InsightCharts','QuestionTrend');
    await h.render(createElement('div',null,
      createElement(CountryFilter,{country:'HU',language,onChange(){}}),
      createElement(AnalysisPeriod,{value:90,periods:[30,90],onChange(){}}),
      createElement(QuestionTrend,{language,selected:true,comparison:true,scope:'Eau',scopeLanguage:'fr',
        data:{interval:'week',bins:[{start:'2026-10-01',end:'2026-10-07',count:3,total:8,share:37.5}]},onRange(){}})));
    const labels=[...h.container.querySelectorAll('label')];
    assert.equal(effectiveLanguage(labels[0].firstChild),'en');
    assert.equal(effectiveLanguage(labels[0].querySelector('option[value=""]')),'en');
    const country=labels[0].querySelector('option[value="HU"]');
    assert.equal(effectiveLanguage(country),language);
    assert.equal(country.textContent,new Intl.DisplayNames([language],{type:'region'}).of('HU'));
    assert.equal(effectiveLanguage(labels[1].querySelector('option[value="term"]')),'en');
    assert.equal(effectiveLanguage(h.container.querySelector('h2 span')),'fr');
    assert.equal(effectiveLanguage(h.container.querySelector('h2').lastChild),'en');
    const axis=h.container.querySelector('svg text[lang]');
    assert.equal(effectiveLanguage(axis),language);
    assert.equal(h.container.querySelectorAll('svg [role="button"]').length,1);
    const option=h.container.querySelector('.insight-week-select option[value="2026-10-01"]');
    assert.equal(option.textContent,`${date('2026-10-01',language)}–${date('2026-10-07',language)} · 3 questions, 8 total`);
    assert.equal(option.getAttribute('lang'),language==='en'?'en':'','mixed native option remains unknown without copy changes');
    await act(async()=>h.container.querySelector('svg [role="button"]').dispatchEvent(new h.window.FocusEvent('focusin',{bubbles:true})));
    const shownDate=h.container.querySelector('.insight-chart-caption span[lang]');
    assert.equal(effectiveLanguage(shownDate),language);
    assert.equal(shownDate.textContent,`${date('2026-10-01',language)}–${date('2026-10-07',language)}`);
    assert.equal(effectiveLanguage(shownDate.parentElement.lastChild),'en');
  });
});

const questions=analysisLanguage=>({window:{start:'2026-07-01',end:'2026-09-30'},counts:{selectedQuestions:5},selection:{},
  clusters:[{id:'water',label:'eau',questionCount:5}],words:[{word:'water',label:'eau',questionCount:5}],stats,selectedStats:stats,
  analysis:{language:analysisLanguage,unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:true,truncated:false},
  questions:['fr','en',null,'mul','und'].map((titleLanguage,index)=>({id:'E-10-2026-00000'+index,date:'2026-10-01',kind:'QUESTION_WRITTEN',title:'Exact source title '+index,titleLanguage,authors:[],answers:[]})),offset:0,nextOffset:null});

test('question analysis labels and source titles retain their actual languages through English return controls',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language,'?view=questions&q-word=water');
    h.respond(url=>{assert(url.pathname.endsWith('/insights/questions'));return questions('fr');});
    const Questions=await h.load('QuestionTopics','QuestionTopics');
    await h.render(createElement(Questions,{language,onBack(){}}));
    const titles=[...h.container.querySelectorAll('.insight-question-heading h3')];
    assert.deepEqual(titles.map(effectiveLanguage),['fr','en','','mul','und']);
    assert.equal(titles[2].getAttribute('lang'),'','absent metadata explicitly stops UI inheritance');
    assert.equal(effectiveLanguage(h.container.querySelector('[data-word] span')),'fr');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-question-results h2')),'fr');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-reading-actions button')),'en');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-record-meta span')),language);
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-pagination button')),'en');
    await h.click('Clear topic');
    assert.equal(h.container.querySelector('.insight-question-results h2').textContent,'All questions');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-question-results h2')),'en');
    assert.equal(h.container.querySelector('.insight-question-heading h3').textContent,'Exact source title 0');
    assert(h.calls.every(url=>url.pathname.endsWith('/insights/questions')),'local view changes never acquire source data');
  });
});

test('topic timelines keep official metadata, missing titles and localized dates separate from English milestones',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language,'?trend-days=90');
    h.respond(url=>{assert(url.pathname.endsWith('/insights/topic-trends'));return {
      window:{start:'2026-07-01',end:'2026-09-30'},weeks:['2026-09-07'],nextPage:null,
      coverage:{procedures:6,mapped:6,indexComplete:true},
      dossiers:Object.fromEntries(['fr','en',null,'mul','und'].map((titleLanguage,index)=>['2025-000'+index,{reference:'2025/000'+index+'(COD)',title:'Exact dossier title '+index,titleLanguage,status:{state:'signed',date:'2026-09-10'},fetchedAt:'2026-10-15T08:00:00Z'}])),
      topics:[{id:'http://eurovoc.europa.eu/1',label:'Eau',language:'fr',dossiers:6,series:[{week:'2026-09-07',debates:1,votes:0,committee:0}],events:[{id:'exact-event',date:'2026-09-10',kind:'debates',procedures:Array.from({length:6},(_,index)=>({id:'2025-000'+index,reference:'2025/000'+index+'(COD)'}))}]}]};});
    const Trends=await h.load('TopicTrends','TopicTrends');
    await h.render(createElement(Trends,{language}));
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-trend-list button span')),'fr');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-trend-detail h3')),'fr');
    const titles=[...h.container.querySelectorAll('.insight-trend-dossier-title')];
    assert.deepEqual(titles.map(effectiveLanguage),['fr','en','','mul','und','en']);
    assert.equal(titles[5].textContent,'Title unavailable');
    const status=h.container.querySelector('.insight-trend-dossier-status');
    assert.equal(effectiveLanguage(status.firstChild),'en');
    assert.equal(effectiveLanguage(status.querySelector('span')),language);
    assert.equal(status.textContent,'Final act signed · '+date('2026-09-10',language));
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-trend-events time')),language);
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-trend-chart text[y="222"]')),language);
    assert.equal(h.container.querySelector('.insight-trend-week option[value="2026-09-07"]').textContent,date('2026-09-07',language)+' · 1');
    assert.equal(h.calls.length,1,'title language markup does not fetch individual dossiers');
  });
});

test('participation preserves exact source language and restores UI language after each title and date',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language,'?hot-period=sitting%3AMTG-PL-2026-10-07');
    const rows=['fr',null,'mul','und'].map((titleLanguage,index)=>({id:'exact-topic-'+index,title:'Exact agenda '+index,titleLanguage,date:sitting.date,sittingId:sitting.id,upcoming:false,speakers:4-index,voters:null,amendmentVotes:null,rollCalls:0}));
    h.respond(url=>{assert(url.pathname.endsWith('/insights/participation'));return {window:{start:sitting.date,end:sitting.date},topics:rows,series:[],coverage:{topicsWithSpeechLinks:4,topics:4,gaps:[]}};});
    const Participation=await h.load('Participation','Participation');
    await h.render(createElement(Participation,{language,sittings:[sitting],onTopic(){}}));
    assert.deepEqual([...h.container.querySelectorAll('.insight-participation-row strong')].map(effectiveLanguage),['fr','','mul','und']);
    const row=h.container.querySelector('.insight-participation-row');
    assert.equal(effectiveLanguage(row.querySelector('small span')),language);
    assert.equal(effectiveLanguage(row.querySelector('span:nth-child(2) small')),'en');
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-participation-search').firstChild),'en');
    assert.equal(h.container.querySelector('option[value="week:2026-10-05"]').textContent,'Week of '+date('2026-10-05',language));
    assert.equal(h.container.querySelector('option[value="sitting:'+sitting.id+'"]').getAttribute('lang'),language);
    assert.equal(h.calls.length,1);
  });
});

test('named vote titles preserve subject-first fallback and never add a first-dictionary-entry choice',async t=>{
  const language='hu',h=await harness(t,language,'?view=legislation&pl-sitting='+sitting.id+'&agenda-topic=exact-topic');
  const cases=[
    {subjects:{hu:'Magyar tárgy',en:'English subject'},titles:{hu:'Magyar cím'},text:'Magyar tárgy',lang:'hu'},
    {subjects:{en:'English subject'},titles:{hu:'Magyar cím'},text:'English subject',lang:'en'},
    {subjects:{fr:'Sujet non sélectionné'},titles:{hu:'Magyar cím',en:'English title'},text:'Magyar cím',lang:'hu'},
    {subjects:{},titles:{en:'English title'},text:'English title',lang:'en'},
    {subjects:{fr:'Sujet non sélectionné'},titles:{fr:'Titre non sélectionné'},text:'Szavazás',lang:'hu'},
  ];
  const votes=cases.map((fixture,index)=>({id:'exact-vote-'+index,date:sitting.date,scope:'final-text',outcome:'ADOPTED',subjects:fixture.subjects,titles:fixture.titles,aggregateTotals:{for:2,against:0,abstaining:0},namedVotersAvailable:false,intendedCorrections:{for:[],against:[],abstaining:[]}}));
  const topic={id:'exact-topic',title:'Source français',titleLanguage:'fr',date:sitting.date,kind:'PLENARY_VOTE',documentIds:[]};
  h.respond(url=>{assert(url.pathname.endsWith('/insights/legislation'));return {view:'legislation',sitting,sittings:[sitting],topics:[topic],coverage:{agendaError:null},detail:url.searchParams.has('topic')?{...topic,phase:'past',procedures:[],committeeWork:[],roles:[],people:[],stats,speeches:[],votes:votes.map(vote=>({...vote,title:'Exact summary',subject:null})),selectedVote:votes.find(vote=>vote.id===url.searchParams.get('vote'))||votes[0],voteCoverage:{truncated:false},coverage:{roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}}:null};});
  const Legislation=await h.load('Legislation','Legislation');
  await h.render(createElement(Legislation,{language,onBack(){}}));
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-topic-detail h2')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-agenda strong')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-eyebrow span')),'hu');
  assert.equal(h.container.querySelector('.insight-eyebrow span').textContent,'Szavazás');
  const agendaOption=h.container.querySelector('.insight-agenda-select option[value="exact-topic"]');
  assert.equal(agendaOption.textContent,'Szavazás · Source français');assert.equal(effectiveLanguage(agendaOption),'','UI translation does not relabel a French fallback title');
  const scopeOption=h.container.querySelector('.insight-vote-select option');
  assert.equal(scopeOption.textContent,'Végleges szöveg · Exact summary');assert.equal(effectiveLanguage(scopeOption),'','vote previews still lack source-title language metadata');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-mode-nav button')),'en');
  for(const [index,fixture] of cases.entries()) {
    if(index)await act(async()=>{const select=h.container.querySelector('.insight-vote-select select');select.value=votes[index].id;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
    const title=h.container.querySelector('.insight-vote-detail h3');
    assert.equal(title.textContent,fixture.text);
    assert.equal(effectiveLanguage(title),fixture.lang);
    assert.equal(effectiveLanguage(h.container.querySelector('.insight-vote-totals h3')),'en');
    const scope=h.container.querySelector('.insight-vote-detail .insight-record-meta span');
    assert.equal(scope.textContent,'Végleges szöveg');assert.equal(effectiveLanguage(scope),'hu');
    assert.equal(h.container.querySelector('.insight-topic-detail h2').textContent,'Source français');
  }
});
