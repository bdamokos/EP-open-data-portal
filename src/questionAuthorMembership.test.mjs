import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {sourceTitle} from '../server/source-titles.mjs';

const stats=()=>({uniquePeople:3,uniqueCurrentMeps:1,peopleOutsideCurrentRoster:2,denominator:1,referenceDate:'2026-10-17',basis:'current roster',metadataSourceDates:{from:null,to:null},
  dimensions:{country:[{label:'HU',count:1}],group:[{label:'PPE',count:1}],gender:[{label:'Female',count:1}],age:[]}});
const person=(id,name,currentMep,extra={})=>({id,name,currentMep,personUri:'https://data.europarl.europa.eu/person/'+id,...extra});
const authors=()=>[
  person('1001','Current author',true,{country:'HU',group:'PPE'}),
  person('1002','Former author',false,{profileUrl:'https://www.europarl.europa.eu/meps/en/1002'}),
  person('1003','Second former author',false),
];
const questions=(selectedStats=stats(),people=authors())=>({window:{start:'2026-07-01',end:'2026-10-17'},counts:{selectedQuestions:1},selection:{},clusters:[],words:[],stats:selectedStats,selectedStats,
  analysis:{language:'en',unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:true,truncated:false},
  questions:[{id:'E-10-2026-000001',date:'2026-10-01',kind:'QUESTION_WRITTEN',title:'Fixture question',titleLanguage:'en',authors:people,answers:[]}],offset:0,nextOffset:null});

async function harness(t,{response=questions(),language='en'}={}) {
  const window=new Window({url:'http://localhost/?view=questions'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,CSS:window.CSS,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},
    IntersectionObserver:class {constructor(callback){this.callback=callback;}observe(target){this.callback([{target,isIntersecting:true}]);}disconnect(){}},
    requestAnimationFrame:window.requestAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[],memberCalls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    assert.equal(url.origin,'http://localhost','membership tests must never use remote source data');
    if(/^\/api\/portrait\/\d+$/.test(url.pathname))return new Response('',{status:404});
    assert(url.pathname.endsWith('/insights/questions'),'only the fixture Questions endpoint and portrait placeholders are allowed');
    return Response.json(response);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {QuestionTopics}=await vite.ssrLoadModule('/src/QuestionTopics.tsx'),shared=await vite.ssrLoadModule('/src/InsightShared.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  await render(createElement(QuestionTopics,{language,onBack(){},onMember:(...args)=>memberCalls.push(args)}));
  return {window,container,calls,memberCalls,render,shared,caption:()=>container.querySelector('.insight-demographics > small')};
}

test('Questions counts current and former authors together and labels former MEPs without changing current-roster charts or navigation',async t=>{
  const h=await harness(t);
  assert.equal(h.container.querySelector('.insight-question-results > .insight-section-heading > span').textContent,'1 question · 3 MEP authors');
  assert.equal(h.caption().textContent,'1 current MEPs · 2 former MEPs · each person counted once');
  assert.doesNotMatch(h.caption().textContent,/other speakers|outside the current roster/);
  assert.equal(h.container.querySelector('.insight-donut-total').textContent,'1','former authors do not inflate the current-roster charts');
  assert.equal(h.container.querySelector('.insight-country-table li strong').textContent,'1');
  assert.equal(h.container.querySelector('.insight-country-table li small').textContent,'100%');
  assert.equal(h.container.querySelector('.insight-gender-strip').getAttribute('aria-label'),'Female: 1');
  const cards=[...h.container.querySelectorAll('.insight-people article')];
  assert.equal(cards.length,3);
  assert.deepEqual(cards.map(card=>card.querySelector('.insight-person-membership')?.textContent||null),[null,'Former MEP','Former MEP']);
  const current=cards[0].querySelector('a'),former=cards[1].querySelector('a');
  assert.equal(new URL(current.href).searchParams.get('member'),'1001');
  assert.equal(new URL(current.href).searchParams.get('module'),'profile');
  assert.equal(former.href,'https://www.europarl.europa.eu/meps/en/1002');
  assert.equal(former.target,'_blank');
  await act(async()=>current.click());
  assert.deepEqual(h.memberCalls,[[1001,undefined]]);
  assert(h.calls.some(url=>url.pathname==='/api/portrait/1001'),'portrait requests use the fixture handler');
});

test('Questions labels former MEPs in English when the selected display language is Hungarian',async t=>{
  const h=await harness(t,{language:'hu'});
  assert.equal(h.caption().closest('[lang]').lang,'en');
  const labels=[...h.container.querySelectorAll('.insight-person-membership')];
  assert.equal(labels.length,2);
  assert(labels.every(node=>node.textContent==='Former MEP'&&node.lang==='en'));
  assert.equal(h.container.querySelector('.insight-country-table li span').lang,'hu','existing localized country labels retain their own boundary');
});

test('Questions suppresses the former-MEP caption when zero and uses singular wording for one former MEP',async t=>{
  for(const formerCount of [0,1])await t.test(String(formerCount),async t=>{
    const selectedStats={...stats(),uniquePeople:1+formerCount,peopleOutsideCurrentRoster:formerCount};
    const h=await harness(t,{response:questions(selectedStats,authors().slice(0,1+formerCount))});
    assert.equal(h.caption().textContent,'1 current MEPs'+(formerCount?' · 1 former MEP':'')+' · each person counted once');
    assert.equal(h.container.querySelectorAll('.insight-person-membership').length,formerCount);
    assert.equal(h.container.querySelector('.insight-question-results > .insight-section-heading > span').textContent,`1 question · ${1+formerCount} MEP author${formerCount?'s':''}`);
  });
});

test('shared plenary demographics and people keep their default captions and do not acquire former-MEP labels',async t=>{
  const h=await harness(t);
  await h.render(createElement('div',null,
    createElement(h.shared.InsightDemographics,{stats:stats()}),
    createElement(h.shared.InsightPeople,{people:authors()})));
  assert.equal(h.caption().textContent,'1 current MEPs · 2 other speakers · each person counted once');
  assert.equal(h.container.querySelectorAll('.insight-person-membership').length,0,'the question-specific label does not affect plenary or other callers');
  assert.equal(h.container.querySelectorAll('.insight-people article').length,3);
});

test('Questions renders decoded title entities and markup-shaped source text as escaped text',async t=>{
  const response=questions(),literal='DYPA&nbsp; &amp; &lt;img src=x onerror=alert(1)&gt; <b>literal</b> &amp;nbsp;';
  response.questions[0].title=sourceTitle(literal);
  const h=await harness(t,{response}),heading=h.container.querySelector('.insight-question-heading h3');
  assert.equal(heading.textContent,'DYPA\u00a0 & <img src=x onerror=alert(1)> <b>literal</b> &nbsp;');
  assert.equal(heading.getAttribute('lang'),'en');
  assert.equal(heading.children.length,0,'decoded markup never creates elements');
  assert(heading.innerHTML.includes('&lt;img'));assert(heading.innerHTML.includes('&lt;b&gt;'));
});
