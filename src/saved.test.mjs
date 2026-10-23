import test from 'node:test';import assert from 'node:assert/strict';
import {createSavedStore,savedKey,readSaved,savedLinks,SAVED_KEY,LEGACY_KEY} from './bookmarks.mjs';
import {orderedMemberships,ongoingLabels} from './memberships.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const mep={kind:'mep',id:'42',title:'Member'},question={kind:'question',id:'E-10-2026-003031',title:'Question',baseline:{answerIds:[]}};
const manifest=(activity=5,answer=3,epoch='one',generation=activity)=>({epoch,generation,indexComplete:true,rosterBasis:'publication',members:{42:[activity,answer,1,1]}});
const detail=(ids,entries=[],extra={})=>({epoch:'one',generation:6,member:'42',status:'available',rosterBasis:'publication',ids,entries,...extra});
const item=store=>store.snapshot().items[0];
const legacy=(disk,items)=>disk.setItem(LEGACY_KEY,JSON.stringify({version:1,items}));
test('questions retain answer baselines, unread and individual acknowledgement through reloads',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(question);
 const state={questions:[{id:question.id,status:'available',revision:'one',answers:[{id:'answer-one'}]}]};
 store.observe(state);assert(item(store).newAnswer);const displayed=store.snapshot().items;
 store.observe({questions:[{...state.questions[0],revision:'two',answers:[{id:'answer-one'},{id:'answer-two'}]}]});store.markVisitRead(displayed);
 assert.deepEqual(savedLinks(item(store)).map(x=>x.id),['answer-two']);assert(item(store).updated);
 store.markAnswerRead(savedKey(question),'answer-two');assert(!item(createSavedStore(disk)).updated);
});
test('following primes the archive; only unseen per-kind marks produce unread and metadata corrections do not',()=>{
 const store=createSavedStore(storage());store.toggle(mep);store.applyManifest(manifest());assert(!item(store).updated);
 store.applyManifest(manifest(6));assert(item(store).unresolved);assert.equal(savedLinks(item(store)).length,0);
 store.materialize(detail([['old',0,5],['new',0,6],['answer',1,3]],[{id:'new',title:'Late activity',titleLanguage:'fr',kind:'activity',mark:6}]));
 assert.deepEqual(savedLinks(item(store)).map(x=>[x.id,x.title,x.titleLanguage]),[['new','Late activity','fr']]);assert.deepEqual(item(store).seen,{activity:6,answer:3});
 store.markActivityRead('mep:42','new');store.materialize(detail([['new',0,6],['old',0,5],['answer',1,3]]));assert(!item(store).updated);
});
test('seen never decreases within an epoch; epoch resets rebaseline while preserving unread and omitted',()=>{
 const store=createSavedStore(storage());store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6));store.materialize(detail([['new',0,6],['a',1,3]]));
 store.materialize(detail([['old',0,2],['a',1,1]]));assert.deepEqual(item(store).seen,{activity:6,answer:3});
 store.applyManifest(manifest(1,1,'two',1));assert.deepEqual(item(store).seen,{activity:1,answer:1});assert.equal(item(store).unread[0].id,'new');assert(store.snapshot().restarted);
 store.materialize(detail([['wrong',0,20]]));assert.equal(item(store).unread.length,1,'stale epoch rejected');
});
test('incomplete legacy baselines never announce archive; complete v3 migration preserves late-indexed identities and carried unread',()=>{
 for(const complete of [false,true]){
  const disk=storage();legacy(disk,[{...mep,baseline:{activityVersion:3,activityIdsComplete:complete,latestIds:['old'],answerIds:['old-answer']},updated:true,unreadAnswers:[{id:'carried',title:'Carried',titleLanguage:'hu',recordKind:'answer'}]}]);
  const store=createSavedStore(disk);store.applyManifest(manifest(6));
  if(complete){assert(item(store).legacy);store.materialize(detail([['old',0,5],['old-answer',1,3],['late',0,6],['late-answer',1,6]]));}
  assert.deepEqual(savedLinks(item(store)).map(x=>x.id),complete?['carried','late','late-answer']:['carried']);assert(!item(store).legacyUpdated);
  const restart=createSavedStore(disk);assert.equal(item(restart).unread[0].titleLanguage,'hu');assert(!item(restart).legacy);
  const v1=JSON.parse(disk.getItem(LEGACY_KEY));assert.deepEqual(Object.keys(v1.items[0]).sort(),['id','kind','memberId','title','titleLanguage'],'minimal mirror has no baselines');
 }
});
test('legacy updated without identities remains explicit until displayed or marked read',()=>{
 const disk=storage();legacy(disk,[{...mep,updated:true}]);const store=createSavedStore(disk);store.applyManifest(manifest());assert(item(store).legacyUpdated);store.markVisitRead(store.snapshot().items);assert(!item(store).updated);
});
test('bounded unread is honest; complete IDs advance marks so omitted items are not repeatedly added',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6));
 const ids=Array.from({length:205},(_,i)=>['activity-'+i,0,6]);store.materialize(detail(ids));assert.equal(item(store).unread.length,200);assert.equal(item(store).unreadOmitted,5);
 store.materialize(detail(ids));assert.equal(item(store).unreadOmitted,5);store.markVisitRead(store.snapshot().items);assert.equal(item(store).unread.length,0);assert.equal(item(store).unreadOmitted,5);
 store.markRead('mep:42');assert(!item(createSavedStore(disk)).updated);
});
test('visit acknowledgement preserves arrivals after display and refollowed entries',()=>{
 const store=createSavedStore(storage());store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6));store.materialize(detail([['first',0,6]]));const displayed=store.snapshot().items;
 store.applyManifest(manifest(7));store.materialize(detail([['second',0,7]],[],{generation:7}));store.markVisitRead(displayed);assert.deepEqual(item(store).unread.map(x=>x.id),['second']);
 store.toggle(mep);store.toggle(mep);store.applyManifest(manifest(8));store.materialize(detail([['third',0,8]],[],{generation:8}));store.markVisitRead(displayed);assert.equal(item(store).unread[0].id,'third');
});
test('late v1 tabs reconcile additions/removals without discarding v2 unread or announcing archive',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(6));store.materialize(detail([['new',0,6]]));
 const other={...mep,id:'43'};legacy(disk,[mep,other]);store.reload(LEGACY_KEY);assert.equal(store.snapshot().items.length,2);assert.equal(item(store).unread[0].id,'new');
 store.applyManifest({...manifest(6),members:{42:[6,3,1,1],43:[6,null,1,0]}});assert(!store.snapshot().items[1].updated);
 legacy(disk,[mep]);store.reload(LEGACY_KEY);assert.equal(store.snapshot().items.length,1);assert.equal(item(store).unread[0].id,'new');
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
 assert.equal(store.snapshot().items.length,105);assert.equal(store.snapshot().items.find(x=>x.id==='105').unread[0].id,'extra-unread');
 // An intentional removal of a representable follow still works.
 legacy(disk,oldClientItems.filter(x=>x.id!=='1'));store.reload(LEGACY_KEY);
 assert.equal(store.snapshot().items.length,104);assert(!store.snapshot().items.some(x=>x.id==='1'));
 assert.equal(store.snapshot().items.find(x=>x.id==='105').unread[0].id,'extra-unread');
 const restarted=createSavedStore(disk);assert.equal(restarted.snapshot().items.length,104);
 assert.equal(restarted.snapshot().items.find(x=>x.id==='105').unread[0].id,'extra-unread');
});
test('stores with the former oversized mirror survive an old tab truncating before reload',()=>{
 const disk=storage(),items=Array.from({length:105},(_,i)=>({...mep,id:String(i+1),savedAt:i+1,seen:{activity:5,answer:null},unread:i===104?[{id:'kept',kind:'activity',mark:5,title:'Kept'}]:[]}));
 disk.setItem(SAVED_KEY,JSON.stringify({version:2,epoch:'one',items,legacyKeys:items.map(savedKey).sort()}));
 legacy(disk,items.slice(0,100));const store=createSavedStore(disk);
 assert.equal(store.snapshot().items.length,105);assert.equal(store.snapshot().items.at(-1).unread[0].id,'kept');
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
 store.markActivityRead('mep:42','read');const seen=item(store).seen;
 store.materialize(detail(ids.slice(0,3),[{id:'same',kind:'activity',title:'Nouveau titre',titleLanguage:'fr',date:'2026-02-02'},{id:'same',kind:'answer',title:'Réponse',titleLanguage:'fr',date:'2026-03-03',relatedQuestionId:question.id},{id:'read',kind:'activity',title:'Already read'}]));
 assert.deepEqual(item(store).seen,seen);assert.deepEqual(item(store).unread.map(x=>[x.kind,x.id]),[['activity','same'],['answer','same'],['activity','vanished']]);
 assert.deepEqual(item(store).unread.slice(0,2).map(x=>[x.title,x.titleLanguage,x.date,x.relatedQuestionId]),[['Nouveau titre','fr','2026-02-02',undefined],['Réponse','fr','2026-03-03',question.id]]);
 assert.equal(item(store).unread[1].recordKind,'answer','metadata refresh preserves the answer link and acknowledgement kind');
 assert.equal(item(createSavedStore(disk)).unread[0].title,'Nouveau titre');
});
test('materialize reports stale rejection separately from accepted in-memory changes when storage fails',()=>{
 const disk=storage(),store=createSavedStore(disk);store.toggle(mep);store.applyManifest(manifest());store.applyManifest(manifest(7));
 assert.equal(store.materialize(detail([['stale',0,6]])),false);assert.equal(item(store).unread.length,0);
 disk.setItem=()=>{throw Error('blocked');};
 assert.equal(store.materialize(detail([['fresh',0,7]],[],{generation:7})),true);
 assert.equal(item(store).unread[0].id,'fresh');assert.equal(store.snapshot().storageError,'unavailable');
});
test('failed toggles revert, background writes retain unread with a persistent retry error; tab-only works',()=>{
 const disk=storage(),store=createSavedStore(disk),set=disk.setItem;let fail=true;
 disk.setItem=(...args)=>{if(fail)throw Object.assign(Error('full'),{name:'QuotaExceededError'});set(...args);};
 assert.throws(()=>store.toggle(mep),/not kept/);assert.equal(store.snapshot().items.length,0);assert.equal(store.snapshot().storageError,'quota');
 fail=false;store.toggle(mep);store.applyManifest(manifest());fail=true;assert.equal(store.applyManifest(manifest(6)),false);store.materialize(detail([['unread',0,6]]));assert.equal(item(store).unread[0].id,'unread');assert(store.snapshot().unsavedSince);
 fail=false;assert(store.retryStorage());assert.equal(store.snapshot().storageError,null);assert.equal(item(createSavedStore(disk)).unread[0].id,'unread');
 const memory=createSavedStore(null);memory.toggle(mep);assert.equal(memory.snapshot().persistent,false);assert.equal(memory.snapshot().items.length,1);
});
test('caps accept a full roster and keep question guard; corrupt input and IDs are rejected',()=>{
 const store=createSavedStore(null);for(let id=1;id<=720;id++)store.toggle({...mep,id:String(id)});assert.equal(store.snapshot().items.length,720);
 assert.equal(readSaved(JSON.stringify({version:1,items:Array.from({length:1100},(_,i)=>({...mep,id:i+1}))})).length,1000);
 for(let i=0;i<100;i++)store.toggle({...question,id:'E-10-2026-'+String(i).padStart(6,'0')});assert.throws(()=>store.toggle(question),/100 questions/);
 assert.deepEqual(readSaved('{broken'),[]);assert.throws(()=>store.toggle({...mep,id:'javascript:bad'}));
});
test('preparation absence never claims outside roster',()=>{
 const store=createSavedStore(null);store.toggle(mep);store.applyManifest({...manifest(),rosterBasis:'preparation',members:{}});assert.equal(item(store).availability,undefined);
 store.applyManifest({...manifest(),members:{}});assert.equal(item(store).availability,'outside-roster');
});
test('membership ordering and period-end labels remain complete',()=>{
 assert.equal(ongoingLabels.hu,'jelenleg');assert.equal(Object.keys(ongoingLabels).length,24);assert.deepEqual(orderedMemberships([{id:'AFET',role:'MEMBER',current:true}],[{id:'AFET',code:'AFET'}]).map(x=>x.id),['AFET']);
});
test('late detail and question responses cannot mutate a newly refollowed item with the same ID',()=>{
 const store=createSavedStore(storage());store.toggle(mep);store.applyManifest(manifest());const old=item(store);store.toggle(mep);store.toggle(mep);store.applyManifest(manifest(6));
 store.materialize(detail([['late',0,6]]),old);assert.equal(item(store).unread.length,0);assert.equal(item(store).seen.activity,5);
 store.toggle(question);const before=store.snapshot().items.find(x=>x.kind==='question');store.toggle(question);store.toggle({...question,baseline:undefined});
 store.observe({questions:[{id:question.id,status:'available',revision:'stale',answers:[{id:'old-answer'}]}]},[before]);
 assert.equal(store.snapshot().items.find(x=>x.kind==='question').current,undefined);
});
test('failed migration persistence keeps the original legacy baseline intact until retry succeeds',()=>{
 const disk=storage();legacy(disk,[{...mep,baseline:{activityVersion:3,activityIdsComplete:true,latestIds:['old'],answerIds:[]},unreadAnswers:[{id:'carried'}]}]);
 const original=disk.getItem(LEGACY_KEY),store=createSavedStore(disk),set=disk.setItem;disk.setItem=()=>{throw Error('blocked');};
 assert.equal(store.applyManifest(manifest(6)),false);assert.equal(disk.getItem(LEGACY_KEY),original);assert(item(store).legacy);assert.equal(item(store).unread.length,1);
 disk.setItem=set;assert(store.retryStorage());assert.equal(JSON.parse(disk.getItem(LEGACY_KEY)).items[0].baseline,undefined);assert(item(createSavedStore(disk)).legacy);
});
