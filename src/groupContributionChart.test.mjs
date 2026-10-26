import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {legislationContributors,mergeSpeechSpeakers} from './legislationContributors.mjs';

test('group charts distinguish observed, assigned, unavailable and zero contributions across selections',async t=>{
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {InsightDemographics}=await load('/src/InsightShared.tsx'),{GroupDonut}=await load('/src/InsightCharts.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const stats={uniquePeople:2,uniqueCurrentMeps:2,peopleOutsideCurrentRoster:0,denominator:2,referenceDate:'2026-10-19',dimensions:{group:[{label:'PPE',count:2}],country:[{label:'FR',count:2}],gender:[{label:'Female',count:2}],age:[]}};
  const render=contributions=>act(async()=>root.render(createElement(InsightDemographics,{stats:{...stats,groupContributions:contributions}})));
  const figure=()=>container.querySelector('.insight-donut');
  const total=()=>figure().querySelector('.insight-donut-total')?.textContent;
  const rows=[{label:'S&D',count:4},{label:'Renew',count:2}];
  await render({rows,total:8,unavailable:2});
  assert.equal(total(),'6');
  assert.match(figure().textContent,/6 of 8 contributions assigned · Percentages of assigned contributions/);
  assert.match(figure().querySelector('svg').getAttribute('aria-label'),/6 of 8 contributions assigned\. Percentages of assigned contributions/);
  assert.match(figure().querySelector('svg circle[aria-label]').getAttribute('aria-label'),/66.7% of assigned contributions/);
  assert.equal(container.querySelector('.insight-country-table li strong').textContent,'2','person counts are independent of contribution counts');
  assert.doesNotMatch(figure().textContent,/EPP/,'current roster groups do not fill missing dated assignments');

  await render({rows:[],total:8,unavailable:8});
  assert.equal(figure().querySelector('svg'),null);
  assert.match(figure().textContent,/Group breakdown unavailable8 contributions/);
  assert.match(figure().querySelector('[role="img"]').getAttribute('aria-label'),/Group breakdown unavailable\. 8 contributions observed/);
  assert.doesNotMatch(figure().textContent,/0|EPP|Assigned/);

  await render({rows,total:6,unavailable:0});
  assert.equal(total(),'6');assert.match(figure().textContent,/6 contributions/);
  assert.equal(figure().querySelector('.insight-donut-caption').textContent,'Contributions');
  assert.match(figure().querySelector('svg circle[aria-label]').getAttribute('aria-label'),/66.7% of contributions/);
  assert.doesNotMatch(figure().textContent,/assigned|unavailable/);
  await render({rows:[],total:0,unavailable:0});
  assert.equal(total(),'0');assert.match(figure().textContent,/0 contributions/);assert.doesNotMatch(figure().textContent,/unavailable|assigned/);
  await render(undefined);
  assert.equal(total(),'2');assert.equal(figure().querySelector('.insight-donut-caption').textContent,'MEPs');

  const changes=[];
  const interactive=(nextRows,contributions,selected)=>act(async()=>root.render(createElement(GroupDonut,{rows:nextRows,contributions,totalLabel:'Contributions',selected,onSelect:value=>changes.push(value)})));
  await interactive(rows,{total:8,unavailable:2},'S&D');
  let segment=figure().querySelector('svg [role="button"]');
  assert.equal(segment.getAttribute('aria-pressed'),'true');
  await act(async()=>segment.dispatchEvent(new window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})));
  assert.equal(changes.at(-1),null);
  await act(async()=>segment.dispatchEvent(new window.FocusEvent('focusin',{bubbles:true})));
  assert.equal(total(),'4');
  await interactive([{label:'Renew',count:1}],{total:2,unavailable:1},null);
  assert.equal(total(),'1','a country/selection change drops stale hover totals');
  assert.match(figure().textContent,/1 of 2 contributions assigned/);
  segment=figure().querySelector('svg [role="button"]');
  assert.match(segment.getAttribute('aria-label'),/100% of assigned contributions/);
  await act(async()=>segment.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.equal(changes.at(-1),'Renew');

  const chair={id:'1',currentMep:true,demographics:{country:'FR',group:'PPE',gender:'Female',age:'50–64'}},speaker={...chair,id:'2',contributionGroup:'S&D'};
  const detail={people:[chair,speaker],speeches:[{sourceId:'chair-speech',kind:'PLENARY_DEBATE_SPEECH',people:[chair]},{sourceId:'debate-speech',kind:'PLENARY_DEBATE_SPEECH',people:[speaker]}],roles:[],stats:{...stats,groupContributions:{rows:[{label:'S&D',count:1}],total:2,unavailable:1}}};
  const filtered=legislationContributors(detail,mergeSpeechSpeakers({},[{id:'chair-speech',people:[{id:'1',role:'Chairing the sitting'}]}]));
  await render(filtered.stats.groupContributions);
  assert.equal(total(),'1');assert.match(figure().textContent,/1 contribution/);assert.doesNotMatch(figure().textContent,/assigned|unavailable/);
  assert.equal(filtered.stats.denominator,1);
});
