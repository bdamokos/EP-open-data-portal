import test from 'node:test';import assert from 'node:assert/strict';
import {createElement,act,StrictMode,Fragment} from 'react';import {Window} from 'happy-dom';import {freshLoader} from './test-support/viteRunner.mjs';
const baseline={activityVersion:3,activityIdsComplete:true,revision:'old',answerIds:[],latestIds:['old']};
const member=(extra={})=>({kind:'mep',id:'42',title:'Fixture member',savedAt:1,...extra});
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
async function harness(t,items=[member()],v2=false) {
 const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 window.localStorage.setItem(v2?'ep.following.v2':'ep.bookmarks.v1',JSON.stringify({version:v2?2:1,items}));
 const requests=[],opened=[],waiting=[];let root,loadModule,fail='',conflict=0,defer=false,inflight=0,maxInflight=0,memberGate=null;
 let status={epoch:'one',generation:5,marksReady:true,indexComplete:true,publishedAt:null};
 let ids=[['old',0,5]],entries=[],questionAnswers=[],membershipLists={incoming:{status:'fresh'},outgoing:{status:'fresh'}},invalidMembership=false;
 t.after(async()=>{if(root)await act(async()=>root.unmount());for(const finish of waiting.splice(0))finish();if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input,window.location.href),route=url.pathname.split('/').at(-1);requests.push({url,route,options});
  if(fail===route)return Response.json({error:{code:'fixture_failure',message:'Fixture unavailable'}},{status:503});
  if(conflict&&route==='following-manifest'){conflict--;return Response.json({error:{code:'generation_changed',message:'Changed'}},{status:409});}
  if(route==='following-status')return Response.json(status);
  if(route==='following-groups')return Response.json({epoch:status.epoch,generation:status.generation,members:{'42':{coverage:'complete',stale:false}},events:status.generation>=6?[{id:'42:group:2026-06-17:7035',mep:'42',type:'group-changed',date:'2026-06-17',mark:6,from:{org:'org/7038',groupId:'org/SD',code:'S&D'},to:{org:'org/7035',groupId:'org/RENEW',code:'Renew'}}]:[]});
  if(route==='following-membership')return Response.json({epoch:invalidMembership?'invalid':status.epoch,generation:status.generation,lists:membershipLists,members:{'42':{status:'former',roster:'absent',endDate:'2026-04-13'}},events:status.generation>=6?[{id:'42-m-1:end',mep:'42',type:'mandate-ended',subtype:null,date:'2026-04-13',mark:6}]:[]});
  if(route==='following-manifest')return Response.json({epoch:status.epoch,generation:status.generation,rosterBasis:'publication',indexComplete:true,members:Object.fromEntries([...items.filter(x=>x.kind==='mep'),member()].map(x=>[x.id,[status.generation,3,1,0]]))});
  if(route==='following-member'){
   const response=Response.json({epoch:status.epoch,generation:status.generation,member:url.searchParams.get('member'),status:'available',rosterBasis:'publication',ids,entries,truncated:0});
   const gate=memberGate;memberGate=null;if(gate){gate.started();await gate.wait;}
   inflight++;maxInflight=Math.max(maxInflight,inflight);
   if(defer)await new Promise(resolve=>waiting.push(resolve));inflight--;
   return response;
  }
  if(route==='saved')return Response.json({questions:(JSON.parse(options.body).questions||[]).map(id=>({id,status:'available',title:'Question',revision:'one',answers:questionAnswers})),coverage:{indexComplete:true}});
  assert.fail('Unexpected route '+url);
 });
 loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {Saved}=await loadModule('/src/Saved.tsx'),controls=await loadModule('/src/SavedControls.tsx'),{createRoot}=await import('react-dom/client');
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 function Checks({language}){controls.useSavedChecks(language);return null;}
 const render=(language='en',strict=false)=>act(async()=>root.render(createElement(strict?StrictMode:Fragment,null,harness.focusChecks&&createElement(Checks,{language}),createElement(controls.SavedNav,{onClick(){}}),createElement(Saved,{language,onBack(){},onMember:(...args)=>opened.push(args),renderActivity:({member,sourceId,profileHref,onOpenProfile})=>createElement('div',null,'Inline '+member+' '+sourceId,createElement('a',{href:profileHref,onClick:event=>{event.preventDefault();onOpenProfile();}},'Open in profile'))}))));
 const click=async(text,scope=container)=>{await act(async()=>{const button=[...scope.querySelectorAll('button')].find(x=>x.textContent===text);assert(button,'Missing '+text+' in '+scope.textContent);button.click();});await settle();};
 const check=()=>click('Check for updates');
 const background=(force=false,lang='en')=>act(async()=>{await controls.checkSaved(lang,force).catch(()=>{});});
 const holdNextDetail=()=>{let started,release;const ready=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);memberGate={started,wait};return {ready,release};};
 return {setMembershipLists:lists=>membershipLists=lists,invalidMembership:value=>invalidMembership=value,window,container,controls,requests,opened,holdNextDetail,setQuestionAnswers:answers=>questionAnswers=answers,render,click,check,background,setStatus:extra=>Object.assign(status,extra),setDetail:(next,rich=[])=>{ids=next;entries=rich;},fail:route=>fail=route,conflict:()=>conflict++,item:()=>controls.savedStore.snapshot().items[0],clear:()=>act(async()=>root.render(null)),defer:()=>defer=true,finish:()=>act(async()=>{for(const finish of waiting.splice(0))finish();}),max:()=>maxInflight};
}
const cards=h=>[...h.container.querySelectorAll('.explorer-saved-items>article')];
const rows=card=>[...card.querySelectorAll('.explorer-saved-disclosure')];
const dispatch=async(h,node,extra={},type='click')=>{const event=new h.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,...extra});await act(async()=>node.dispatchEvent(event));return event;};
const speech={id:'late',title:'Late speech',titleLanguage:'fr',date:'2026-01-01',kind:'activity',recordKind:'speech',category:'plenary-contributions',mark:6};
async function newSpeech(h){await h.render('en',true);await h.check();h.setStatus({generation:6});h.setDetail([['old',0,5],['late',0,6]],[speech]);await h.check();await settle();}

test('visible Following auto-resolves; inline read leaves the other MEP new and leaving acknowledges nothing',async t=>{
 const h=await harness(t,[member(),member({id:'43',title:'Second member'})]);await newSpeech(h);
 assert.equal(h.requests.filter(x=>x.route==='following-member').length,2);assert.doesNotMatch(h.container.textContent,/Open updates|Refresh updates/);
 const [first,second]=cards(h),row=rows(first)[0];assert.equal(row.getAttribute('aria-expanded'),'false');assert.equal(row.querySelector('[lang="fr"]').textContent,'Late speech');assert.match(row.href,/member=42&module=activities&activity=late/);
 await dispatch(h,row);assert.equal(row.getAttribute('aria-expanded'),'true');assert.match(first.textContent,/Inline 42 late/);assert(!row.querySelector('.explorer-saved-new'));assert(second.querySelector('.explorer-saved-new'));assert.equal(h.container.querySelector('.explorer-saved-count').textContent,'1 new');
 assert.equal(rows(first)[0],row,'read row keeps DOM position');await dispatch(h,first.querySelector('.explorer-saved-detail a'));assert.deepEqual(h.opened,[[42,'late']]);
 await act(async()=>h.window.dispatchEvent(new h.window.Event('pagehide')));await h.clear();assert.equal(h.controls.savedStore.snapshot().items[1].entries[0].readAt,null);
 await h.render();assert.equal(cards(h)[0].querySelector('details summary').textContent,'Earlier updates (1)');assert(cards(h)[1].querySelector('.explorer-saved-new'));
});
test('Profile marks nothing; modified and middle clicks preserve href and mark only that entry',async t=>{
 const h=await harness(t,[member(),member({id:'43',title:'Second member'})]);await newSpeech(h);await h.click('Profile',cards(h)[0]);assert.equal(h.item().entries[0].readAt,null);assert.deepEqual(h.opened,[[42,undefined]]);
 const row=rows(cards(h)[0])[0];const event=await dispatch(h,row,{ctrlKey:true});assert.equal(event.defaultPrevented,false);assert.equal(row.getAttribute('aria-expanded'),'false');assert(Number.isFinite(h.item().entries[0].readAt));
 const other=rows(cards(h)[1])[0];const middle=await dispatch(h,other,{button:1},'auxclick');assert.equal(middle.defaultPrevented,false);assert(Number.isFinite(h.controls.savedStore.snapshot().items[1].entries[0].readAt));
});
test('one expiry timer drops the badge and moves expired entries to Earlier updates without a storage write',async t=>{
 const now=Date.now(),entry={...speech,discoveredAt:now-86_400_000+1500,readAt:null};
 const h=await harness(t,[member({seen:{activity:6,answer:3},entries:[entry]})],true);await h.render();assert.equal(h.container.querySelector('.explorer-saved-count').textContent,'1 new');
 const before=h.window.localStorage.getItem('ep.following.v2');await act(async()=>new Promise(resolve=>setTimeout(resolve,1550)));
 assert(!h.container.querySelector('.explorer-saved-count'));assert.equal(cards(h)[0].querySelector('summary').textContent,'Earlier updates (1)');assert(!cards(h)[0].querySelector('.explorer-saved-new'));assert.equal(h.window.localStorage.getItem('ep.following.v2'),before);
});
test('history shows five expandable entries and a full-profile link; Mark all read retains recent history',async t=>{
 const now=Date.now(),entries=Array.from({length:8},(_,i)=>({...speech,id:'old-'+i,discoveredAt:now-i,readAt:now}));
 const h=await harness(t,[member({seen:{activity:6,answer:3},entries})],true);await h.render();const card=cards(h)[0];assert.equal(rows(card).length,5);assert.equal(card.querySelector('summary').textContent,'Earlier updates (8)');assert.equal(card.querySelector('details>a').textContent,'See all activity in the full profile');
 card.querySelector('details').open=true;await dispatch(h,rows(card)[0]);assert.match(card.textContent,/Inline 42 old-0/);assert(!card.querySelector('.explorer-saved-new'));
});
test('above ten fresh entries or any overflow shows a type summary; Mark all read advances and retains five history entries',async t=>{
 const h=await harness(t);await h.render();await h.check();h.setStatus({generation:6});h.setDetail(Array.from({length:202},(_,i)=>['id-'+i,0,6]),Array.from({length:200},(_,i)=>({...speech,id:'id-'+i})));await h.check();await settle();
 const card=cards(h)[0];assert.equal(rows(card).length,0);assert.match(card.textContent,/200 speeches · and 2 more/);assert.match(card.querySelector('a').href,/module=activities/);assert(!card.querySelector('a').href.includes('activity='));assert.match(card.textContent,/Open the profile to read them/);
 await h.click('Mark all read');assert(!h.container.querySelector('.explorer-saved-count'));assert.equal(rows(card).length,5);assert.equal(h.item().unreadOmitted,0);assert.equal(h.item().seen.activity,6);
});
test('auto-resolution is at most four concurrent, dedupes StrictMode and repeated checks, and waits while hidden',async t=>{
 const h=await harness(t,Array.from({length:9},(_,i)=>member({id:String(42+i)})));await h.render('en',true);await h.check();h.defer();h.setStatus({generation:6});h.setDetail([['late',0,6]],[speech]);
 Object.defineProperty(h.window.document,'visibilityState',{value:'hidden',configurable:true});await h.check();assert.equal(h.requests.filter(x=>x.route==='following-member').length,0);
 Object.defineProperty(h.window.document,'visibilityState',{value:'visible',configurable:true});await act(async()=>h.window.document.dispatchEvent(new h.window.Event('visibilitychange')));await settle();assert.equal(h.requests.filter(x=>x.route==='following-member').length,4);assert.equal(h.max(),4);
 await h.check();assert.equal(h.requests.filter(x=>x.route==='following-member').length,4);await h.finish();await settle();assert.equal(h.requests.filter(x=>x.route==='following-member').length,8);await h.finish();await settle();await h.finish();await settle();assert.equal(h.requests.filter(x=>x.route==='following-member').length,9);assert.equal(h.max(),4);
 await h.render('en',true);await h.check();assert.equal(h.requests.filter(x=>x.route==='following-member').length,9);
});
test('failed auto-resolution retries explicitly and on focus no more than once per minute',async t=>{
 const h=await harness(t);await h.render();await h.check();h.fail('following-member');h.setStatus({generation:6});h.setDetail([['late',0,6]],[speech]);await h.check();await settle();assert.match(cards(h)[0].textContent,/Couldn't load new activity/);
 const count=()=>h.requests.filter(x=>x.route==='following-member').length,first=count();await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));await settle();assert.equal(count(),first);
 await h.click('Retry',cards(h)[0]);assert.equal(count(),first+1);let now=Date.now();t.mock.method(Date,'now',()=>now);now+=60_001;h.fail('');await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));await settle();assert.equal(count(),first+2);assert.match(cards(h)[0].textContent,/Late speech/);
});
test('marksReady false retains uncertainty; conflicts and failed migration/question tasks retry independently',async t=>{
 const q={kind:'question',id:'E-10-2026-003031',title:'Question'},h=await harness(t,[member({baseline}),q]);h.setStatus({marksReady:false});await h.render();await h.check();assert.equal(h.item().seen,null);assert.match(h.container.textContent,/Update checks are not available yet/);assert.doesNotMatch(cards(h)[0].textContent,/No new updates/);
 h.setStatus({marksReady:true});h.conflict();h.fail('following-member');await h.check();assert(h.item().legacy);assert.match(h.container.textContent,/Update check pending/);assert.equal(h.requests.filter(x=>x.route==='saved').length,2);
 h.fail('');h.setDetail([['old',0,5],['late',0,5]]);await h.click('Retry',cards(h)[0]);assert(!h.item().legacy);assert.equal(h.item().entries[0].id,'late');assert.equal(h.requests.filter(x=>x.route==='saved').length,2);await h.background(false,'fr');assert.equal(h.requests.filter(x=>x.route==='saved').length,3);
});
test('background storage errors retain entries and failed follow changes revert with alerts',async t=>{
 const h=await harness(t);await h.render();await h.check();const prototype=h.window.localStorage,original=prototype.setItem;
 t.mock.method(prototype,'setItem',function(...args){if(this===h.window.localStorage)throw Object.assign(Error('full'),{name:'QuotaExceededError'});return original.apply(this,args);});
 h.setStatus({generation:6});h.setDetail([['late',0,6]],[speech]);await h.check();await settle();assert.equal(h.item().entries[0].id,'late');assert.match(h.container.querySelector('[role="alert"]').textContent,/will be lost on reload/);
 await act(async()=>cards(h)[0].querySelector('.explorer-save-button').click());assert.equal(h.controls.savedStore.snapshot().items.length,1);assert.match(h.container.textContent,/follow change was not kept/);t.mock.restoreAll();await h.click('Retry saving');assert.equal(h.controls.savedStore.snapshot().storageError,null);
});
test('empty Following makes no requests; epoch reset keeps readable entries',async t=>{
 const h=await harness(t,[]);await h.render();assert(h.container.querySelector('.explorer-saved-heading button').disabled);assert.equal(h.requests.length,0);
 await act(async()=>h.controls.savedStore.toggle(member()));await h.background();h.setStatus({generation:6});h.setDetail([['late',0,6]],[speech]);await h.check();await settle();h.setStatus({epoch:'two',generation:1});await h.check();assert.equal(h.item().entries.length,1);assert.match(h.container.textContent,/Update tracking restarted/);
});

test('question answers update when MEP marks are unready and remain independent when the manifest fails',async t=>{
 const q={kind:'question',id:'E-10-2026-003031',title:'Question',baseline:{answerIds:[]}},h=await harness(t,[member(),q]);h.setQuestionAnswers([{id:'new-answer'}]);
 h.setStatus({marksReady:false});await h.render();await h.check();
 const snapshot=()=>h.controls.savedStore.snapshot();
 assert.equal(snapshot().checkState,'unavailable');assert.equal(snapshot().questionCheckState,'available');assert.equal(snapshot().items[1].availability,'available');
 assert.match(h.container.textContent,/Update checks are not available yet for MEPs/);assert.match(h.container.textContent,/Answer available/);assert.equal(snapshot().items[1].entries[0].id,'new-answer');
 assert.equal(h.requests.filter(x=>x.route==='saved').length,1);assert(!h.requests.some(x=>x.route==='following-manifest'));
 h.setStatus({marksReady:true});h.fail('following-manifest');await h.check();
 assert.equal(snapshot().checkState,'error');assert.equal(snapshot().questionCheckState,'available');assert.equal(h.requests.filter(x=>x.route==='saved').length,2);
 assert.match(h.container.textContent,/Couldn't check for MEP updates/);assert.doesNotMatch(h.container.textContent,/Couldn't check for question answers/);
 h.fail('');await h.click('Retry');assert.equal(snapshot().checkState,'available');assert.equal(h.requests.filter(x=>x.route==='saved').length,2,'successful questions are not repeated on manifest retry');
});
test('question-only selections check answers without ready markers, a manifest or working status',async t=>{
 const h=await harness(t,[{kind:'question',id:'E-10-2026-003031',title:'Question'}]);h.setStatus({marksReady:false});await h.render();await h.check();
 assert.equal(h.item().availability,'available');assert(!h.requests.some(x=>x.route==='following-manifest'));assert.doesNotMatch(h.container.textContent,/Update checks are not available|Couldn't check/);
 h.fail('following-status');await h.background(true,'fr');assert.equal(h.requests.filter(x=>x.route==='saved').length,2);assert.equal(h.controls.savedStore.snapshot().questionCheckState,'available');
});
test('question failures do not turn successful MEP checks into failures and retry independently',async t=>{
 const h=await harness(t,[member(),{kind:'question',id:'E-10-2026-003031',title:'Question'}]);await h.render();h.fail('saved');await h.check();
 assert.equal(h.controls.savedStore.snapshot().checkState,'available');assert.equal(h.controls.savedStore.snapshot().questionCheckState,'error');
 assert.match(h.container.textContent,/Couldn't check for question answers/);assert.doesNotMatch(h.container.textContent,/Couldn't check for MEP updates/);
 const count=h.requests.filter(x=>x.route==='following-manifest').length;h.fail('');await h.click('Retry');assert.equal(h.controls.savedStore.snapshot().questionCheckState,'available');assert.equal(h.requests.filter(x=>x.route==='following-manifest').length,count);
});
test('opening updates retries a detail rejected after a concurrent manifest advance',async t=>{
 const h=await harness(t);await h.render();await h.check();await h.clear();h.setStatus({generation:6});h.setDetail([['late',0,6]],[{id:'late',title:'Late speech',kind:'activity'}]);await h.background(true);
 await h.clear();const gate=h.holdNextDetail();const opening=h.controls.openSavedMember(h.item(),'en');await gate.ready;
 h.setStatus({generation:7});h.setDetail([['late',0,6],['latest',0,7]],[{id:'latest',title:'Latest speech',kind:'activity'}]);await h.background(true);
 await act(async()=>{gate.release();await opening;});await h.render();
 assert.equal(h.item().seen.activity,7);assert.match(h.container.textContent,/Latest speech/);
 assert.deepEqual(h.requests.filter(x=>x.route==='following-member').map(x=>x.url.searchParams.get('generation')),['6','7']);
});
test('a second manifest advance surfaces the opening error instead of silently completing',async t=>{
 const h=await harness(t);await h.render();await h.check();await h.clear();h.setStatus({generation:6});h.setDetail([['late',0,6]]);await h.background(true);
 await h.clear();const first=h.holdNextDetail();const opening=h.controls.openSavedMember(h.item(),'en');const rejected=assert.rejects(opening,/The index generation has changed/);await first.ready;
 h.setStatus({generation:7});await h.background(true);const second=h.holdNextDetail();await act(async()=>first.release());await second.ready;
 h.setStatus({generation:8});await h.background(true);await act(async()=>{second.release();await rejected;});

 assert.equal(h.requests.filter(x=>x.route==='following-member').length,2,'only one retry');assert.equal(h.item().seen.activity,5);
});

test('focus checks status at most once per minute; failed tasks retry without a generation change',async t=>{
 harness.focusChecks=true;t.after(()=>harness.focusChecks=false);const h=await harness(t,[member({baseline})]);await h.render();h.fail('following-member');await h.background();
 let now=Date.now();t.mock.method(Date,'now',()=>now);const count=()=>h.requests.filter(x=>x.route==='following-status').length,initial=count();
 await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));assert.equal(count(),initial);
 now+=60_001;h.fail('');await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));assert.equal(count(),initial+1);assert(!h.item().legacy);
});

test('opening the first of simultaneous entries keeps its row and reader above the remaining unread entries',async t=>{
 const now=Date.now(),entries=['first','second','third'].map(id=>({...speech,id,title:id,discoveredAt:now,readAt:null}));
 const h=await harness(t,[member({seen:{activity:6,answer:3},entries})],true);await h.render();
 const card=cards(h)[0],first=rows(card)[0];await dispatch(h,first);
 assert.equal(rows(card)[0],first);assert.deepEqual(rows(card).map(row=>row.querySelector('[lang]').textContent),['first','second','third']);
 assert.match(first.parentElement.textContent,/Inline 42 first/);assert.equal(card.querySelectorAll('.explorer-saved-new').length,2);
});

const membershipEpoch='00000000-0000-0000-0000-000000000001';
test('membership updates are independent of activity read actions and open the profile overview',async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,membershipReady:true});await newSpeech(h);
 const card=cards(h)[0];assert.match(card.textContent,/Former MEP · mandate ended 13 April 2026/);
 const membership=()=>[...card.querySelectorAll('a')].find(node=>node.textContent.includes('Left Parliament'));
 assert.match(membership().href,/member=42/);assert.doesNotMatch(membership().href,/module=activities|activity=/);
 assert.equal(membership().querySelector('[lang="en"]').textContent,'13 April 2026');
 await dispatch(h,rows(card)[0]);assert.equal(h.item().entries[0].readAt!==null,true);assert(membership().querySelector('.explorer-saved-new'));
 await dispatch(h,membership());assert.deepEqual(h.opened,[[42]]);assert.equal(h.controls.membershipStore.snapshot().entries[0].readAt!==null,true);
 assert.equal(h.controls.savedStore.snapshot().items.length,1);assert.match(card.textContent,/Earlier membership updates \(1\)/);
 const requests=h.requests.filter(request=>request.route==='following-membership');assert(requests.length);assert(requests.every(request=>!request.url.searchParams.has('member')&&!request.options?.body));
});
test('Mark all read clears activity and membership together',async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,membershipReady:true});await newSpeech(h);await h.click('Mark all read',cards(h)[0]);
 assert.notEqual(h.item().entries[0].readAt,null);assert.notEqual(h.controls.membershipStore.snapshot().entries[0].readAt,null);
});

test('reading a membership entry leaves activity unread',async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,membershipReady:true});await newSpeech(h);
 const link=[...cards(h)[0].querySelectorAll('a')].find(node=>node.textContent.includes('Left Parliament'));await dispatch(h,link);
 assert.equal(h.item().entries[0].readAt,null);assert.notEqual(h.controls.membershipStore.snapshot().entries[0].readAt,null);
 assert.equal(h.container.querySelector('.explorer-saved-count').textContent,'1 new');
});

for(const failure of ['fetch','verification'])test(`membership ${failure} failure preserves baselines and later discoveries`,async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,membershipReady:true});await h.render();await h.check();
 const before=h.controls.membershipStore.snapshot();
 if(failure==='fetch')h.fail('following-membership');else h.invalidMembership(true);
 h.setStatus({generation:6});await h.check();
 assert.deepEqual(h.controls.membershipStore.snapshot(),before);
 assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,1);
 assert.match(h.container.querySelector('.explorer-membership-status').textContent,/Couldn't check membership updates/);
 assert(!h.window.localStorage.getItem('ep.following.membership.v1').includes('error'));
 h.fail('');h.invalidMembership(false);h.setStatus({generation:7});await h.click('Retry membership updates');
 assert.equal(h.controls.membershipStore.snapshot().baselines['42'].generation,5);
 assert.equal(h.controls.membershipStore.snapshot().entries[0].mark,6);
 assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,0);
 assert.match(cards(h)[0].textContent,/Left Parliament/);
});
test('server membership unavailability appears once on Following and never in cards',async t=>{
 const h=await harness(t,[member(),member({id:'43',title:'Second member'})]);
 await h.render();assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,0);
 h.setStatus({epoch:membershipEpoch,membershipReady:false});await h.check();
 assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,1);
 for(const card of cards(h))assert.doesNotMatch(card.textContent,/Membership updates are unavailable/);
 h.setStatus({membershipReady:true});h.setMembershipLists({outgoing:{status:'unavailable'},incoming:{status:'fresh'}});await h.check();
 assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,1);
 assert.deepEqual(h.controls.membershipStore.snapshot().availability,{outgoing:false,incoming:true});
 h.setMembershipLists({outgoing:{status:'fresh'},incoming:{status:'fresh'}});await h.check();
 assert.equal(h.container.querySelectorAll('.explorer-membership-status').length,0);
});


test('group changes baseline separately, show accessible card text and Mark all read clears every update kind',async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,membershipReady:true,groupsReady:true});await newSpeech(h);
 const card=cards(h)[0],change=[...card.querySelectorAll('a')].find(a=>a.textContent.includes('Changed group:'));
 assert(change);assert.match(change.textContent,/Changed group: S&D → Renew · 17 June 2026/);
 assert(card.querySelector('button[aria-label="Mark Changed group: S&D → Renew · 17 June 2026 update read"]'));
 assert.equal(h.controls.groupsStore.snapshot().baselines['42'].generation,5);
 await h.click('Mark all read',card);
 assert.notEqual(h.item().entries[0].readAt,null);assert.notEqual(h.controls.membershipStore.snapshot().entries[0].readAt,null);assert.notEqual(h.controls.groupsStore.snapshot().entries[0].readAt,null);
 assert.match(card.textContent,/Earlier group updates \(1\)/);
 const requests=h.requests.filter(request=>request.route==='following-groups');assert(requests.length);assert(requests.every(request=>!request.url.searchParams.has('member')&&!request.options?.body));
});
test('group transport errors preserve baseline and retry discovers the switch',async t=>{
 const h=await harness(t);h.setStatus({epoch:membershipEpoch,groupsReady:true});await h.render();await h.check();const before=h.controls.groupsStore.snapshot();
 h.fail('following-groups');h.setStatus({generation:6});await h.check();assert.deepEqual(h.controls.groupsStore.snapshot(),before);assert.match(h.container.textContent,/Couldn't check group updates/);
 h.fail('');h.setStatus({generation:7});await h.click('Retry group updates');assert.equal(h.controls.groupsStore.snapshot().baselines['42'].generation,5);assert.equal(h.controls.groupsStore.snapshot().entries[0].mark,6);
});
