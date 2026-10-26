import test from 'node:test';import assert from 'node:assert/strict';
import {createSavedStore,savedKey,readSaved,savedLinks,SAVED_KEY,LEGACY_KEY} from './bookmarks.mjs';
import {followEntries,itemHasNew,nextExpiry,NEW_WINDOW_MS} from './followUpdates.mjs';
import {orderedMemberships,ongoingLabels} from './memberships.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const mep={kind:'mep',id:'42',title:'Member'},question={kind:'question',id:'E-10-2026-003031',title:'Question',baseline:{answerIds:[]}};
const manifest=(activity=5,answer=3,epoch='one',generation=activity)=>({epoch,generation,indexComplete:true,rosterBasis:'publication',members:{42:[activity,answer,1,1]}});
const detail=(ids,entries=[],extra={})=>({epoch:'one',generation:6,member:'42',status:'available',rosterBasis:'publication',ids,entries,...extra});
const item=store=>store.snapshot().items[0];
const legacy=(disk,items)=>disk.setItem(LEGACY_KEY,JSON.stringify({version:1,items}));
const fresh=store=>followEntries(item(store),Date.now()).fresh;
function changedStore(disk=storage()){const store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6));return store;}
test('questions retain exact answer baselines and read history through reloads',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(question);
 const state={id:question.id,status:'available',revision:'one',answers:[{id:'answer-one'}]};store.observe({questions:[state]});assert(item(store).newAnswer);
 store.observe({questions:[{...state,revision:'two',answers:[...state.answers,{id:'answer-two'}]}]});
 store.markEntryRead(savedKey(question),'answer','answer-one');assert.deepEqual(fresh(store).map(x=>x.id),['answer-two']);
 store.markRead(savedKey(question));assert(!item(createSavedStore(disk)).updated);assert.equal(followEntries(item(store),Date.now()).history.length,2);
});
test('following primes archive; only unseen per-kind marks produce entries, and retained read entries are never re-added',()=>{
 const store=changedStore();assert(item(store).unresolved.activity);assert.equal(savedLinks(item(store)).length,0);
 store.materialize(detail([['old',0,5],['new',0,6],['answer',1,3]],[{id:'new',title:'Late activity',titleLanguage:'fr',kind:'activity',recordKind:'speech',category:'plenary-contributions',mark:6}]));
 assert.deepEqual(fresh(store).map(x=>[x.id,x.title,x.titleLanguage,x.category]),[['new','Late activity','fr','plenary-contributions']]);assert.deepEqual(item(store).seen,{activity:6,answer:3});assert.deepEqual(item(store).signals,{});
 store.markEntryRead('mep:42','activity','new');const readAt=item(store).entries[0].readAt;
 store.materialize(detail([['new',0,6],['old',0,5],['answer',1,3]]));assert(!item(store).updated);assert.equal(item(store).entries[0].readAt,readAt);
});
test('two MEPs with speeches: reading one and leaving/reloading preserves the other new',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.toggle({...mep,id:'43'});
 const both=generation=>({...manifest(generation),members:{42:[generation,null,1,0],43:[generation,null,1,0]}});
 store.applyManifest(both(5));store.applyManifest(both(6));for(const id of ['42','43'])store.materialize(detail([['speech-'+id,0,6]],[],{member:id}));
 store.markEntryRead('mep:42','activity','speech-42');const reloaded=createSavedStore(disk);
 assert(!itemHasNew(reloaded.snapshot().items[0],Date.now()));assert(itemHasNew(reloaded.snapshot().items[1],Date.now()));
 assert.equal(store.markVisitRead,undefined);assert.equal(store.markActivityRead,undefined);
});
test('seen never decreases; epoch resets rebaseline while preserving entries, and stale detail is rejected',()=>{
 const store=changedStore();store.materialize(detail([['new',0,6],['a',1,3]]));store.materialize(detail([['old',0,2],['a',1,1]]));assert.deepEqual(item(store).seen,{activity:6,answer:3});
 store.applyManifest(manifest(1,1,'two',1));assert.deepEqual(item(store).seen,{activity:1,answer:1});assert.equal(item(store).entries[0].id,'new');assert(store.snapshot().restarted);
 assert.equal(store.materialize(detail([['wrong',0,20]])),false);assert.equal(item(store).entries.length,1);
});
test('complete v3 migration preserves late-indexed identities; incomplete baselines do not announce archive',()=>{
 for(const complete of [false,true]){
  const disk=storage();legacy(disk,[{...mep,baseline:{activityVersion:3,activityIdsComplete:complete,latestIds:['old'],answerIds:['old-answer']},updated:true,unreadAnswers:[{id:'carried',title:'Carried',titleLanguage:'hu',recordKind:'answer'}]}]);
  const store=createSavedStore(disk);store.applyManifest(manifest(6));if(complete)store.materialize(detail([['old',0,5],['old-answer',1,3],['late',0,6],['late-answer',1,6]]));
  assert.deepEqual(new Set(savedLinks(item(store)).map(x=>x.id)),new Set(complete?['carried','late','late-answer']:['carried']));assert(!item(store).legacyUpdated);
  assert.equal(item(createSavedStore(disk)).entries.find(x=>x.id==='carried').titleLanguage,'hu');assert(!item(createSavedStore(disk)).legacy);
  assert.equal(JSON.parse(disk.getItem(LEGACY_KEY)).items[0].baseline,undefined);
 }
});
test('v1 and existing v2 unread migrations stamp discovery once and legacy signals expire',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 for(const version of [1,2]){
  const disk=storage();if(version===1)legacy(disk,[{...mep,unreadActivities:[{id:'new',title:'Speech'}]}]);
  else disk.setItem(SAVED_KEY,JSON.stringify({version:2,items:[{...mep,unread:[{id:'new',title:'Speech',kind:'activity'}]}]}));
  const store=createSavedStore(disk);assert.equal(item(store).entries[0].discoveredAt,1000);assert.equal(item(store).entries[0].readAt,null);store.publish();now=2000;
  assert.equal(item(createSavedStore(disk)).entries[0].discoveredAt,1000);now=1000;
 }
 const disk=storage();legacy(disk,[{...mep,updated:true}]);const store=createSavedStore(disk);assert.equal(item(store).legacyAt,1000);assert(itemHasNew(item(store),now));
 assert(!itemHasNew(item(store),now+NEW_WINDOW_MS));store.markRead('mep:42');assert(!item(store).legacyUpdated);
});
test('resolved discoveries inherit first per-kind signal, including delayed resolution beyond expiry',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const store=changedStore();assert.deepEqual(item(store).signals.activity,[[6,1000]]);
 now+=500;store.applyManifest(manifest(6,4,'one',6));assert.deepEqual(item(store).signals.activity,[[6,1000]]);assert.deepEqual(item(store).signals.answer,[[4,1500]]);
 now=1000+NEW_WINDOW_MS;store.materialize(detail([['speech',0,6],['answer',1,4]]));
 assert.deepEqual(item(store).entries.map(x=>[x.id,x.discoveredAt]),[['answer',1500],['speech',1000]]);assert.deepEqual(fresh(store).map(x=>x.id),['answer']);assert.equal(followEntries(item(store),now).history[0].id,'speech');
});
test('later manifest rises get their own 24-hour window before and after delayed resolution',t=>{
 const hour=60*60*1000,t0=1000;let now=t0;t.mock.method(Date,'now',()=>now);
 const disk=storage();let store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest(4));store.applyManifest(manifest(5));
 assert.deepEqual(item(store).signals.activity,[[5,t0]]);
 now=t0+25*hour;assert(!itemHasNew(item(store),now));store.applyManifest(manifest(7));
 assert(item(store).updated);assert(followEntries(item(store),now).unresolved);assert.equal(nextExpiry([item(store)],now),t0+49*hour);
 store=createSavedStore(disk);store.applyManifest(manifest(7));
 assert.deepEqual(item(store).signals.activity,[[5,t0],[7,t0+25*hour]]);
 now=t0+26*hour;store.materialize(detail([['old',0,5],['new',0,7]],[],{generation:7}));
 const view=followEntries(item(store),now);
 assert.deepEqual(view.history.map(x=>[x.id,x.discoveredAt]),[['old',t0]]);
 assert.deepEqual(view.fresh.map(x=>[x.id,x.discoveredAt]),[['new',t0+25*hour]]);
 assert.deepEqual(item(store).signals,{});assert(!view.unresolved);assert(item(store).updated);
 assert.equal(nextExpiry([item(store)],now),t0+49*hour);
 assert(itemHasNew(item(store),t0+49*hour-1));assert(!itemHasNew(item(store),t0+49*hour));
});
test('signal lists drop oldest pairs at twenty without backdating later retained marks',t=>{
 const t0=1000;let now=t0;t.mock.method(Date,'now',()=>now);const disk=storage();let store=createSavedStore(disk);
 store.toggle(mep);store.applyManifest(manifest(4));
 for(let value=5;value<=26;value++) {now=t0+(value-5)*1000;store.applyManifest(manifest(value));}
 const expected=Array.from({length:20},(_,i)=>[i+7,t0+(i+2)*1000]);
 assert.deepEqual(item(store).signals.activity,expected);
 store=createSavedStore(disk);store.applyManifest(manifest(26));assert.deepEqual(item(store).signals.activity,expected);
 now+=1000;store.materialize(detail([['dropped',0,5],['earliest-kept',0,7],['later-kept',0,8],['latest',0,26]],[],{generation:26}));
 assert.deepEqual(Object.fromEntries(item(store).entries.map(x=>[x.id,x.discoveredAt])),{'dropped':t0+2000,'earliest-kept':t0+2000,'later-kept':t0+3000,'latest':t0+21000});
 store.applyManifest(manifest(27));assert.equal(item(store).signals.activity.length,1);
 store.markRead('mep:42');assert.deepEqual(item(store).signals,{});assert(!item(store).updated);
});
test('stored v2 scalar signals migrate once and preserve discovery through later rises',t=>{
 const t0=1000;let now=t0+NEW_WINDOW_MS+1000;t.mock.method(Date,'now',()=>now);
 for(const signalledAt of [{activity:t0},t0]) {
  const disk=storage();disk.setItem(SAVED_KEY,JSON.stringify({version:2,epoch:'one',items:[{...mep,seen:{activity:4,answer:3},entries:[],signalledAt}],legacyKeys:[]}));
  let store=createSavedStore(disk);assert.deepEqual(item(store).signals.activity,[[4,t0]]);
  assert.equal(JSON.parse(disk.getItem(SAVED_KEY)).items[0].signalledAt,undefined);
  store=createSavedStore(disk);store.applyManifest(manifest(5));assert.deepEqual(item(store).signals.activity,[[5,t0]]);assert(!item(store).updated);
  store.applyManifest(manifest(7));assert.deepEqual(item(store).signals.activity,[[5,t0],[7,now]]);assert(item(store).updated);
  store.materialize(detail([['old',0,5],['new',0,7]],[],{generation:7}));
  assert.deepEqual(fresh(store).map(x=>[x.id,x.discoveredAt]),[['new',now]]);assert.equal(followEntries(item(store),now).history[0].discoveredAt,t0);
 }
});
test('trimmed marks never inherit a future retained time and missing covering signals use resolution time',t=>{
 const now=1000;t.mock.method(Date,'now',()=>now);const disk=storage();
 disk.setItem(SAVED_KEY,JSON.stringify({version:2,epoch:'one',items:[{...mep,seen:{activity:4,answer:3},entries:[],signals:{activity:[[7,now+1000]]}}],legacyKeys:[]}));
 const store=createSavedStore(disk);store.applyManifest(manifest(7));
 store.materialize(detail([['below-retained',0,5],['above-retained',0,8]],[],{generation:7}));
 assert(item(store).entries.every(entry=>entry.discoveredAt===now));
});
test('compaction retains five history entries, accumulates omissions, and expiry requires no write',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const disk=storage(),store=changedStore(disk);store.materialize(detail(Array.from({length:8},(_,i)=>['item-'+i,0,6])));
 const raw=disk.getItem(SAVED_KEY);now+=NEW_WINDOW_MS;assert.equal(fresh(store).length,0);assert.equal(followEntries(item(store),now).history.length,5);assert.equal(followEntries(item(store),now).historyOmitted,3);assert.equal(disk.getItem(SAVED_KEY),raw);
 store.markRead('mep:42');assert.equal(item(store).entries.length,5);assert.equal(item(store).historyOmitted,3);store.markRead('mep:42');assert.equal(item(store).historyOmitted,3);
});
test('overflow is bounded and honest, expires, and Mark all read clears omissions and unresolved marks',()=>{
 const store=changedStore();const ids=Array.from({length:205},(_,i)=>['activity-'+i,0,6]);store.materialize(detail(ids));assert.equal(item(store).entries.length,200);assert.equal(item(store).unreadOmitted,5);
 store.materialize(detail(ids));assert.equal(item(store).unreadOmitted,5);assert(!itemHasNew(item(store),Date.now()+NEW_WINDOW_MS));
 store.applyManifest(manifest(7));store.markRead('mep:42');assert.deepEqual(item(store).seen,{activity:7,answer:3});assert(!item(store).updated);assert.equal(item(store).entries.length,5);assert.equal(item(store).historyOmitted,195);assert.equal(item(store).unreadOmitted,0);
});
test('question revision signals expire without refreshing, clear on open, and new revisions signal again',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const store=createSavedStore(storage());store.toggle({...question,baseline:{revision:'old',answerIds:[]}});
 const observe=revision=>store.observe({questions:[{id:question.id,status:'available',revision,answers:[]}]});observe('new');assert.equal(item(store).changedAt,1000);
 now+=NEW_WINDOW_MS;observe('new');assert(!itemHasNew(item(store),now));observe('newer');assert(itemHasNew(item(store),now));store.openQuestion(savedKey(question));assert(!item(store).updated);
});
test('late v1 tabs reconcile follows without discarding v2 history or announcing archive',()=>{
 const disk=storage(),store=changedStore(disk);store.materialize(detail([['new',0,6]]));const other={...mep,id:'43'};legacy(disk,[mep,other]);store.reload(LEGACY_KEY);assert.equal(store.snapshot().items.length,2);assert.equal(item(store).entries[0].id,'new');
 store.applyManifest({...manifest(6),members:{42:[6,3,1,1],43:[6,null,1,0]}});assert(!store.snapshot().items[1].updated);legacy(disk,[mep]);store.reload(LEGACY_KEY);assert.equal(store.snapshot().items.length,1);
});
test('failed follow writes revert; failed background writes retain entries and retry; tab-only follows work',()=>{
 const disk=storage(),store=createSavedStore(disk),set=disk.setItem;let fail=true;disk.setItem=(...args)=>{if(fail)throw Object.assign(Error('full'),{name:'QuotaExceededError'});set(...args);};
 assert.throws(()=>store.toggle(mep),/Couldn't save in this browser/);assert.equal(store.snapshot().items.length,0);assert.equal(store.snapshot().storageError,'quota');
 fail=false;store.toggle(mep);store.applyManifest(manifest());fail=true;store.applyManifest(manifest(6));store.materialize(detail([['unread',0,6]]));assert.equal(item(store).entries[0].id,'unread');assert(store.snapshot().unsavedSince);
 fail=false;assert(store.retryStorage());assert.equal(item(createSavedStore(disk)).entries[0].id,'unread');const memory=createSavedStore(null);memory.toggle(mep);assert.equal(memory.snapshot().persistent,false);
});
test('roster and question guards, corrupt input and unavailable roster semantics remain intact',()=>{
 const store=createSavedStore(null);for(let id=1;id<=720;id++)store.toggle({...mep,id:String(id)});assert.equal(store.snapshot().items.length,720);
 assert.equal(readSaved(JSON.stringify({version:1,items:Array.from({length:1100},(_,i)=>({...mep,id:i+1}))})).length,1000);
 for(let i=0;i<100;i++)store.toggle({...question,id:'E-10-2026-'+String(i).padStart(6,'0')});assert.throws(()=>store.toggle(question),/100 questions/);assert.deepEqual(readSaved('{broken'),[]);assert.throws(()=>store.toggle({...mep,id:'javascript:bad'}));
 const small=createSavedStore(null);small.toggle(mep);small.applyManifest({...manifest(),rosterBasis:'preparation',members:{}});assert.equal(item(small).availability,undefined);small.applyManifest({...manifest(),members:{}});assert.equal(item(small).availability,'outside-roster');
 assert.equal(ongoingLabels.hu,'jelenleg');assert.equal(Object.keys(ongoingLabels).length,24);assert.deepEqual(orderedMemberships([{id:'AFET',role:'MEMBER',current:true}],[{id:'AFET',code:'AFET'}]).map(x=>x.id),['AFET']);
});
test('late detail and question responses cannot mutate newly refollowed identities',()=>{
 const store=createSavedStore(storage());store.toggle(mep);store.applyManifest(manifest());const old=item(store);store.toggle(mep);store.toggle(mep);store.applyManifest(manifest(6));store.materialize(detail([['late',0,6]]),old);assert.equal(item(store).entries.length,0);
 store.toggle(question);const before=store.snapshot().items.find(x=>x.kind==='question');store.toggle(question);store.toggle({...question,baseline:undefined});store.observe({questions:[{id:question.id,status:'available',revision:'stale',answers:[{id:'old-answer'}]}]},[before]);assert.equal(store.snapshot().items.find(x=>x.kind==='question').current,undefined);
});
test('failed migration persistence protects original baseline until retry succeeds',()=>{
 const disk=storage();legacy(disk,[{...mep,baseline:{activityVersion:3,activityIdsComplete:true,latestIds:['old'],answerIds:[]},unreadAnswers:[{id:'carried'}]}]);const original=disk.getItem(LEGACY_KEY),store=createSavedStore(disk),set=disk.setItem;disk.setItem=()=>{throw Error('blocked');};
 assert.equal(store.applyManifest(manifest(6)),false);assert.equal(disk.getItem(LEGACY_KEY),original);assert(item(store).legacy);assert.equal(item(store).entries.length,1);disk.setItem=set;assert(store.retryStorage());assert.equal(JSON.parse(disk.getItem(LEGACY_KEY)).items[0].baseline,undefined);assert(item(createSavedStore(disk)).legacy);
});

test('opening a newly observed answer leaves no revision-only signal from that answer arrival',()=>{
 const store=createSavedStore(storage());store.toggle({...question,baseline:{revision:'old',answerIds:[]}});store.observe({questions:[{id:question.id,status:'available',revision:'with-answer',answers:[{id:'answer'}]}]});
 assert.equal(item(store).changedAt,undefined);store.markEntryRead(savedKey(question),'answer','answer');assert(!item(store).updated);
});

test('overflow uses discovery time, and expired overflow cannot suppress a later batch',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const store=changedStore();now+=1000;
 store.materialize(detail(Array.from({length:205},(_,i)=>['first-'+i,0,6])));assert.equal(item(store).unreadOmittedAt,1000);
 now=1000+NEW_WINDOW_MS;store.applyManifest(manifest(7));store.materialize(detail(Array.from({length:203},(_,i)=>['second-'+i,0,7]),[],{generation:7}));
 assert.equal(item(store).unreadOmitted,3);assert.equal(item(store).unreadOmittedAt,now);
});

test('old-client truncated writes preserve follows beyond the 100-MEP mirror and their unread',()=>{
 const disk=storage(),store=createSavedStore(disk);
 for(let id=1;id<=105;id++)store.toggle({...mep,id:String(id)});
 store.applyManifest({...manifest(),members:{105:[5,null,1,0]}});
 store.applyManifest({...manifest(6),members:{105:[6,null,2,0]}});
 store.materialize(detail([['extra-unread',0,6]],[],{member:'105'}));
 const mirrored=JSON.parse(disk.getItem(LEGACY_KEY)).items,raw=JSON.parse(disk.getItem(SAVED_KEY));
 assert.equal(mirrored.length,100);assert.deepEqual(mirrored.map(x=>x.id),Array.from({length:100},(_,i)=>String(i+1)));
 assert.deepEqual(raw.legacyKeys,mirrored.map(savedKey).sort());
 // Simulate the old reader's per-kind cap followed by an acknowledgement write.
 const oldClientItems=mirrored.filter(x=>x.kind==='mep').slice(0,100);
 legacy(disk,oldClientItems);store.reload(LEGACY_KEY);
 assert.equal(store.snapshot().items.length,105);assert.equal(store.snapshot().items.find(x=>x.id==='105').entries[0].id,'extra-unread');
 // An intentional removal of a representable follow still works.
 legacy(disk,oldClientItems.filter(x=>x.id!=='1'));store.reload(LEGACY_KEY);
 assert.equal(store.snapshot().items.length,104);assert(!store.snapshot().items.some(x=>x.id==='1'));
 assert.equal(store.snapshot().items.find(x=>x.id==='105').entries[0].id,'extra-unread');
 const restarted=createSavedStore(disk);assert.equal(restarted.snapshot().items.length,104);
 assert.equal(restarted.snapshot().items.find(x=>x.id==='105').entries[0].id,'extra-unread');
});
test('stores with the former oversized mirror survive an old tab truncating before reload',()=>{
 const disk=storage(),items=Array.from({length:105},(_,i)=>({...mep,id:String(i+1),savedAt:i+1,seen:{activity:5,answer:null},unread:i===104?[{id:'kept',kind:'activity',mark:5,title:'Kept'}]:[]}));
 disk.setItem(SAVED_KEY,JSON.stringify({version:2,epoch:'one',items,legacyKeys:items.map(savedKey).sort()}));
 legacy(disk,items.slice(0,100));const store=createSavedStore(disk);
 assert.equal(store.snapshot().items.length,105);assert.equal(store.snapshot().items.at(-1).entries[0].id,'kept');
 store.publish(true);assert.equal(JSON.parse(disk.getItem(LEGACY_KEY)).items.length,100);
 assert.equal(JSON.parse(disk.getItem(SAVED_KEY)).legacyKeys.length,100);
});
test('legacy mirror uses earliest savedAt deterministically and caps each kind separately',()=>{
 const disk=storage(),items=Array.from({length:105},(_,i)=>({...mep,id:String(i+1),savedAt:105-i}));
 legacy(disk,[...items,...Array.from({length:100},(_,i)=>({...question,id:'E-10-2026-'+String(i).padStart(6,'0'),savedAt:i}))]);
 const store=createSavedStore(disk);store.publish(true);
 const mirrored=JSON.parse(disk.getItem(LEGACY_KEY)).items;
 assert.deepEqual(mirrored.filter(x=>x.kind==='mep').map(x=>x.id),Array.from({length:100},(_,i)=>String(105-i)));
 assert.equal(mirrored.filter(x=>x.kind==='question').length,100);
 assert.deepEqual(JSON.parse(disk.getItem(SAVED_KEY)).legacyKeys,mirrored.map(savedKey).sort());
});
test('fresh rich metadata updates existing unread without reviving read entries or losing missing identities',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6,6));
 const ids=[['same',0,6],['same',1,6],['read',0,6],['vanished',0,6]];
 store.materialize(detail(ids,[{id:'same',kind:'activity',title:'Old title',titleLanguage:'en',date:'2026-01-01'},{id:'same',kind:'answer',title:'Old answer',titleLanguage:'en'}]));
 store.markEntryRead('mep:42','activity','read');const seen=item(store).seen;
 store.materialize(detail(ids.slice(0,3),[{id:'same',kind:'activity',title:'Nouveau titre',titleLanguage:'fr',date:'2026-02-02'},{id:'same',kind:'answer',title:'Réponse',titleLanguage:'fr',date:'2026-03-03',relatedQuestionId:question.id},{id:'read',kind:'activity',title:'Already read'}]));
 assert.deepEqual(item(store).seen,seen);assert.deepEqual(fresh(store).map(x=>[x.kind,x.id]).sort(),[['activity','same'],['activity','vanished'],['answer','same']]);
 assert.deepEqual(fresh(store).filter(x=>x.id==='same').sort((a,b)=>a.kind.localeCompare(b.kind)).map(x=>[x.title,x.titleLanguage,x.date,x.relatedQuestionId]),[['Nouveau titre','fr','2026-02-02',undefined],['Réponse','fr','2026-03-03',question.id]]);
 assert.equal(item(store).entries.find(x=>x.kind==='answer').recordKind,'answer','metadata refresh preserves the answer link and acknowledgement kind');
 assert.equal(item(createSavedStore(disk)).entries.find(x=>x.id==='same'&&x.kind==='activity').title,'Nouveau titre');
});
test('materialize reports stale rejection separately from accepted in-memory changes when storage fails',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(7));
 assert.equal(store.materialize(detail([['stale',0,6]])),false);assert.equal(item(store).entries.length,0);
 disk.setItem=()=>{throw Error('blocked');};
 assert.equal(store.materialize(detail([['fresh',0,7]],[],{generation:7})),true);
 assert.equal(item(store).entries[0].id,'fresh');assert.equal(store.snapshot().storageError,'unavailable');
});
