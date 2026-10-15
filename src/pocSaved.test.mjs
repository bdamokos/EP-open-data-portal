import test from 'node:test';import assert from 'node:assert/strict';
import {createSavedStore,savedKey,readSaved} from './pocBookmarks.mjs';
import {orderedMemberships,ongoingLabels} from './pocMemberships.mjs';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
const question={kind:'question',id:'E-10-2026-003031',title:'Blue Flag',baseline:{answerIds:[]}};
test('bookmarks survive a new browser store, detect a new answer and stay unread until acknowledged',()=>{
  const disk=storage(),one=createSavedStore(disk);one.toggle(question);
  const two=createSavedStore(disk);assert.equal(two.snapshot().items.length,1);
  const state={questions:[{id:question.id,status:'available',revision:'r1',answers:[{id:question.id+'-ASW'}]}],members:[]};
  two.observe(state);assert(two.snapshot().items[0].newAnswer);two.observe(state);assert(two.snapshot().items[0].updated);
  two.markRead(savedKey(question));assert.equal(two.snapshot().items[0].updated,false);two.observe(state);assert.equal(two.snapshot().items[0].newAnswer,false);
  two.toggle(question);assert.equal(createSavedStore(disk).snapshot().items.length,0);
});
test('first unknown baseline is primed without a false update; new MEP activity differs from a date correction',()=>{
  const store=createSavedStore(storage());store.toggle({kind:'mep',id:'257043',title:'Abadia'});
  const observe=(revision,total,latest)=>store.observe({questions:[],members:[{id:'257043',status:'available',revision,total,latest}]});
  observe('a',1,[{id:'old',date:'2026-10-01'}]);assert(!store.snapshot().items[0].updated);
  observe('b',1,[{id:'old',date:'2026-10-02'}]);assert(store.snapshot().items[0].updated);assert(!store.snapshot().items[0].newActivity);
  store.markRead('mep:257043');observe('c',2,[{id:'new',date:'2026-10-03'},{id:'old',date:'2026-10-02'}]);assert(store.snapshot().items[0].newActivity);
});
test('unavailable storage remains usable in memory; corrupt schema and invalid IDs cannot create bookmarks',()=>{
  const store=createSavedStore({getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}});store.toggle(question);assert.equal(store.snapshot().persistent,false);assert.equal(store.snapshot().items.length,1);
  assert.deepEqual(readSaved('{broken'),[]);assert.deepEqual(readSaved(JSON.stringify({version:2,items:[question]})),[]);assert.throws(()=>store.toggle({...question,id:'javascript:bad'}));
});
test('membership hierarchy precedes the official committee list and all 24 period-end labels are supplied',()=>{
  const committees=['PETI','AFET','SEDE'].map(code=>({id:code,code})),input=[{id:'AFET',role:'MEMBER_SUBSTITUTE',current:true},{id:'SEDE',role:'MEMBER',current:true},{id:'PETI',role:'CHAIR',current:true},{id:'AFET',role:'MEMBER',current:true},{id:'SEDE',role:'CHAIR_VICE',current:true},{id:'PETI',role:'MEMBER',current:false}];
  assert.deepEqual(orderedMemberships(input,committees).map(x=>[x.role,x.id]),[['CHAIR','PETI'],['CHAIR_VICE','SEDE'],['MEMBER','AFET'],['MEMBER','SEDE'],['MEMBER_SUBSTITUTE','AFET']]);assert.equal(input.length,6);assert.equal(Object.keys(ongoingLabels).length,24);assert.equal(ongoingLabels.hu,'jelenleg');assert.equal(ongoingLabels.fr,'à ce jour');
});
test('stored bookmarks are bounded per kind and malformed baseline values cannot break checks',()=>{
 const items=Array.from({length:150},(_,i)=>({kind:'mep',id:i+1,title:'Person',baseline:{answerIds:5,latestIds:'bad',revision:{bad:true},total:-3},updated:'false'}));
 const read=readSaved(JSON.stringify({version:1,items}));assert.equal(read.length,100);assert.equal(read[0].id,'1');assert.equal(read[0].updated,false);assert.deepEqual(read[0].baseline.answerIds,[]);assert.deepEqual(read[0].baseline.latestIds,[]);
 const disk=storage();disk.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items:[question]}));const store=createSavedStore(disk);disk.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items:[]}));store.reload();assert.deepEqual(store.snapshot().items,[]);
});
