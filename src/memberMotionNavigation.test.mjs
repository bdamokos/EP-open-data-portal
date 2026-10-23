import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const DOCUMENT='B-10-2026-0424',JOINT='RC-10-2026-0441',TA1='TA-10-2026-0342',TA2='TA-10-2026-0343';
const binding={memberId:1,sourceId:DOCUMENT,ownerId:'motion-activity',choices:[{id:DOCUMENT,kind:'original',title:'Synthetic motion',titleLanguage:'en'},{id:JOINT,kind:'joint',title:'Synthetic joint motion',titleLanguage:'en'}]};
const environment={language:'en',activity:DOCUMENT,category:'motions',offset:0};

async function harness(t,{query,initialJourney,config:initialConfig={}}={}) {
  const window=new Window({url:'http://localhost/?member=1&module=activities'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule,latest;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await loadModule('/src/useMemberMotionJourney.ts'),helper=await loadModule('/src/motionJourney.mjs'),{createRoot}=await import('react-dom/client');
  const initial=query?new URLSearchParams(query):helper.motionJourneyUrl(location.href,binding,initialJourney?.(helper.createMotionJourney(binding))||helper.createMotionJourney(binding)).searchParams;
  history.replaceState(null,'','/?'+initial);
  let config={member:1,active:true,environment:{...environment},activities:true,activitiesPending:false,motionPending:false,contextPending:false,body:true,error:false,...initialConfig};
  const Parent=()=>{
    latest=module.useMemberMotionJourney(config.member,config.active,initial,config.environment);
    return createElement('main',{className:'explorer'},createElement('div',{className:'explorer-profile-body'},config.active?config.activities&&createElement('section',{className:'explorer-activities','data-activities-pending':config.activitiesPending?'true':undefined},
      createElement('div',{'data-motion-pending':config.motionPending?'true':undefined},
        createElement('section',{className:'document-context-reader','data-context-pending':config.contextPending?'true':undefined},
          config.body?createElement('p',{'data-source-paragraph':'0'},'Synthetic readable source body.'):config.error?createElement('p',{role:'alert'},'Document could not be loaded.'):createElement('p',{role:'status'},'Loading document…')))):createElement('p',null,'Profile')));
  };
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const draw=()=>root.render(createElement(Parent));
  await act(async()=>draw());
  const update=async patch=>{await act(async()=>{config={...config,...patch};draw();});};
  const scroll=(main,profile,notify=true)=>{
    container.querySelector('main.explorer').scrollTop=main;container.querySelector('.explorer-profile-body').scrollTop=profile;
    if(notify)container.querySelector('.explorer-profile-body').dispatchEvent(new window.Event('scroll',{bubbles:true}));
  };
  return {module,helper,container,window,initial:new URLSearchParams(initial),get latest(){return latest;},get config(){return config;},update,scroll,
    positions:()=>[container.querySelector('main.explorer').scrollTop,container.querySelector('.explorer-profile-body').scrollTop],
    async depart(){await act(async()=>{latest.remember();config={...config,active:false};draw();});},
    async restore(nextQuery,patch={}){await act(async()=>{const member=patch.member??config.member;latest.restore(new URLSearchParams(nextQuery),member);history.replaceState(null,'','/?'+nextQuery);config={...config,...patch};draw();});},
    async navigate(next,reason){await act(async()=>latest.onJourneyChange(binding,next,reason));},
    state:()=>helper.readMotionJourney(latest.query,binding),
  };
}

test('motion scroll keys are independent of field order while preserving raw duplicate and invalid selections',async t=>{
  const h=await harness(t),key=h.module.memberMotionScrollKey;
  const first=new URLSearchParams('member=1&ma-text='+DOCUMENT+'&ma-scope=member&ma-list=exact');
  const reordered=new URLSearchParams('member=1&ma-list=exact&ma-scope=member&ma-text='+DOCUMENT);
  assert.equal(key(1,first,environment),key(1,reordered,environment));
  const duplicate=new URLSearchParams(first);duplicate.append('ma-text',JOINT);
  const reverseDuplicate=new URLSearchParams('member=1&ma-text='+JOINT+'&ma-scope=member&ma-list=exact&ma-text='+DOCUMENT);
  for(const other of [duplicate,reverseDuplicate,new URLSearchParams('member=1&ma-offset=Infinity'),new URLSearchParams('member=1&ma-offset=NaN'),new URLSearchParams('member=1&ma-toString=unsupported')])assert.notEqual(key(1,first,environment),key(1,other,environment));
  assert.notEqual(key(1,duplicate,environment),key(1,reverseDuplicate,environment),'contradictory duplicate order stays exact');
  for(const patch of [{language:'hu'},{activity:JOINT},{category:'all'},{offset:20}])assert.notEqual(key(1,first,environment),key(1,first,{...environment,...patch}));
  assert.notEqual(key(1,first,environment),key(2,first,environment));
  const raw=new URLSearchParams('member=1&ma-text='+DOCUMENT+'&ma-text='+JOINT+'&ma-unsupported=x');
  await h.restore(raw);
  assert.deepEqual(h.latest.query.getAll('ma-text'),[DOCUMENT,JOINT]);assert.equal(h.latest.query.get('ma-unsupported'),'x');
});

test('App-lifetime motion state and outer scroll survive activity-tab unmount and direct return',async t=>{
  const h=await harness(t),query=h.latest.query.toString(),length=history.length;
  h.scroll(713,4237);h.latest.remember();
  await h.depart();h.scroll(41,91);
  assert.equal(Boolean(h.container.querySelector('.explorer-activities')),false);
  await h.update({active:true});
  assert.deepEqual(h.positions(),[713,4237]);assert.equal(h.latest.query.toString(),query);assert.equal(h.latest.hasSavedScroll,true);
  assert.equal(history.length,length,'restoration does not create a second navigation step');
});

test('closing and reopening an activity restores its saved position while Activities stays mounted',async t=>{
  const h=await harness(t);
  h.scroll(713,4237);h.latest.remember();
  await h.update({environment:{...environment,activity:null}});
  h.scroll(99,180);h.latest.remember();
  await h.update({environment:{...environment,activity:DOCUMENT}});
  assert.deepEqual(h.positions(),[713,4237]);assert.equal(h.latest.hasSavedScroll,true);
  h.latest.remember();
  await h.update({environment:{...environment,activity:null}});
  assert.deepEqual(h.positions(),[99,180]);
  h.latest.remember();
  await h.update({environment:{...environment,category:'all',offset:20}});
  assert.deepEqual(h.positions(),[99,180],'a new surrounding page leaves its reveal policy to App');
});

test('motion reader navigation pushes once and restores each adopted text to its own position',async t=>{
  const h=await harness(t,{initialJourney:journey=>({...journey,amendments:{...journey.amendments,open:true,view:'context',contextView:'adopted'},selectedTA:TA1})});
  const length=history.length;let notices=0;h.window.addEventListener('explorer-query-change',()=>notices++);
  h.scroll(713,4237);
  await h.navigate({...h.state(),selectedTA:TA2},'adopted');
  assert.equal(history.length,length+1);assert.equal(notices,1);assert.equal(h.latest.query.get('ma-ta'),TA2);
  assert.deepEqual(h.positions(),[0,0],'an unread adopted text does not inherit the previous text position');
  h.scroll(221,622);
  await h.navigate({...h.state(),selectedTA:TA1},'adopted');
  assert.deepEqual(h.positions(),[713,4237]);assert.equal(history.length,length+2);assert.equal(h.latest.query.get('ma-ta'),TA1);
  await h.navigate({...h.state(),selectedTA:TA2},'adopted');
  assert.deepEqual(h.positions(),[221,622]);assert.equal(history.length,length+3);assert.equal(notices,3);
});

test('opening a reader retains the activity position while a new exact text starts at the beginning',async t=>{
  const h=await harness(t,{query:'member=1&module=activities'}),length=history.length;
  h.scroll(713,4237);
  const next=h.helper.createMotionJourney(binding);
  await h.navigate({...next,amendments:{...next.amendments,open:true}},'open');
  assert.deepEqual(h.positions(),[713,4237]);assert.equal(history.length,length+1);
  await h.navigate(h.helper.changeMotionText(JOINT,binding),'text');
  assert.deepEqual(h.positions(),[0,0]);assert.equal(h.latest.query.get('ma-text'),JOINT);assert.equal(history.length,length+2);
});

test('a delayed uncached source waits through activities, host and body loading without consuming saved scroll',async t=>{
  const h=await harness(t),query=h.initial;
  h.scroll(713,4237);await h.depart();h.scroll(0,0);
  await h.restore(query,{active:true,activities:false,body:false});
  assert.deepEqual(h.positions(),[0,0]);
  await h.update({activities:true,activitiesPending:true});
  assert.deepEqual(h.positions(),[0,0]);
  await h.update({activitiesPending:false,motionPending:true});assert.deepEqual(h.positions(),[0,0]);
  await h.update({motionPending:false,contextPending:true});assert.deepEqual(h.positions(),[0,0]);
  await h.update({contextPending:false,body:true});assert.deepEqual(h.positions(),[713,4237]);
  assert.equal(h.latest.hasSavedScroll,true);
});

test('leaving a pending reader preserves its earlier readable position for the next return',async t=>{
  const h=await harness(t),query=h.initial;
  h.scroll(713,4237);await h.depart();h.scroll(0,0);
  await h.restore(query,{active:true,contextPending:true,body:false});
  h.scroll(0,0);h.latest.remember();await h.depart();
  await h.restore(query,{active:true,contextPending:false,body:true});
  assert.deepEqual(h.positions(),[713,4237]);
});

test('terminal source errors settle pending restoration without requiring readable paragraphs',async t=>{
  const h=await harness(t),query=h.initial;
  h.scroll(713,4237);await h.depart();h.scroll(0,0);
  await h.restore(query,{active:true,contextPending:true,body:false});assert.deepEqual(h.positions(),[0,0]);
  await h.update({contextPending:false,error:true});assert.deepEqual(h.positions(),[713,4237]);
  assert.equal(h.container.querySelector('[role="alert"]')?.textContent,'Document could not be loaded.');
});

test('another member cannot consume retained motion state or scroll, while exact history return restores the owner',async t=>{
  const h=await harness(t),query=h.initial;
  h.scroll(713,4237);h.latest.remember();
  await h.restore(query,{member:2});
  assert.equal(h.latest.query.get('member'),'2');assert.equal([...h.latest.query.keys()].some(key=>key.startsWith('ma-')),false);assert.equal(h.latest.hasSavedScroll,false);
  h.scroll(21,82);
  await h.restore(query,{member:1});assert.deepEqual(h.positions(),[713,4237]);assert.equal(h.latest.query.get('ma-source'),DOCUMENT);
});

test('the numeric scroll history evicts old views after forty destinations',async t=>{
  const h=await harness(t),first=h.initial;
  h.scroll(100,200);h.latest.remember();
  let retained;
  for(let page=1;page<=41;page++){
    const next=h.state();await h.navigate({...next,amendments:{...next.amendments,offset:page*20}},'page');
    h.scroll(100+page,200+page);h.latest.remember();
    if(page===3)retained=new URLSearchParams(h.latest.query);
  }
  await h.restore(first);assert.equal(h.latest.hasSavedScroll,false,'the oldest view is evicted instead of growing an unbounded history');
  await h.restore(retained);assert.equal(h.latest.hasSavedScroll,true);assert.deepEqual(h.positions(),[103,203]);
});
