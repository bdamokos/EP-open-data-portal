import test from 'node:test';
import assert from 'node:assert/strict';
import {createDossiersStore,DOSSIERS_KEY,dossierHref,itemHasNew,followEntries} from './followDossiers.mjs';
import {createSavedStore} from './bookmarks.mjs';
const id='2025/0407A(COD)',epoch='12345678-1234-1234-1234-123456789abc';
const entry=(id,mark=1)=>({id,title:id,eventKind:'document',mark,date:'2026-10-20'});
function setup() {
  let now=Date.parse('2026-10-23T10:00:00Z');const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const store=createDossiersStore(storage,()=>{},()=>now);store.toggle({id,title:'Dossier'});
  const item=()=>store.snapshot().items[0],expected=()=>structuredClone(item());
  const index=(generation,entries,extra={})=>store.observeIndex({epoch,generation,indexComplete:true,items:[{reference:id,status:'available',entries,...extra}]},[expected()]);
  return {store,item,expected,index,values,storage,now:()=>now,tick:delta=>now+=delta};
}
const progress=(date,events,extra={})=>({reference:id,state:'mapped',coverage:{limited:false},source:{fetchedAt:date},events,...extra});
const event=(id,date='2026-10-23',status='recorded',label=id)=>({id,date,status,label,labelLanguage:'en',issues:[],statuses:[]});
function press(mark,items=[],extra={}) {
  return {reference:id,watermark:mark,items,coverage:{followingSince:'2026-10-20',procedureLinks:{status:'available'},feeds:[]},dossier:{title:'Dossier title',language:'en',summaries:[],source:{fetchedAt:'2026-10-23T10:00:00Z'}},...extra};
}
test('separate storage survives older tabs, reloads and exact full reference suffixes',()=>{
  const h=setup(),old=createSavedStore(h.storage);old.toggle({kind:'mep',id:'42',title:'MEP'});old.publish(true);
  assert(h.values.has(DOSSIERS_KEY));const reload=createDossiersStore(h.storage);assert.equal(reload.snapshot().items[0].id,id);
  h.store.toggle({id:'2025/0407(COD)'});assert.equal(h.store.snapshot().items.length,2);
  h.store.toggle({id});assert.equal(h.store.snapshot().items.length,1);
  assert.equal(new URL(dossierHref(id,'hu'),'http://localhost').searchParams.get('dossier-ref'),id);
});
test('first checks are quiet; durable marks catch backdated events and survive read, reload, gaps and epoch reset',()=>{
  const h=setup();h.index(4,[entry('old',2)]);assert.equal(h.item().entries.length,0);
  h.index(9,[entry('old',2),entry('backdated',6)]);assert.equal(h.item().entries.length,1);assert(itemHasNew(h.item(),h.now()));
  h.store.markEntryRead(id,'backdated');assert(!itemHasNew(h.item(),h.now()));assert.equal(followEntries(h.item(),h.now()).history.length,1);
  h.index(10,[],{status:'unavailable'});assert.equal(h.item().observations.index.generation,9);
  h.index(11,[entry('new',11),entry('backdated',6)]);assert.equal(h.item().entries.length,2);
  h.store.observeIndex({epoch:'new-epoch',generation:1,indexComplete:true,items:[{reference:id,status:'available',entries:[entry('archive')]}]},[h.expected()]);
  assert.equal(h.item().entries.length,2);assert(h.store.snapshot().restarted);
  h.index(12,[],{limited:true});assert.equal(h.item().observations.index.epoch,'new-epoch');
  const reload=createDossiersStore(h.storage,()=>{},h.now);assert.equal(reload.snapshot().items[0].entries[0].readAt,null);
});
test('stale index responses, unfollow/refollow races and 24-hour expiry preserve reading state',()=>{
  const h=setup();h.index(4,[]);h.index(5,[entry('new',5)]);h.index(3,[entry('old',3)]);assert.equal(h.item().observations.index.generation,5);
  const old=h.expected();h.store.toggle({id});h.store.toggle({id});
  h.store.observeIndex({epoch,generation:6,indexComplete:true,items:[{reference:id,status:'available',entries:[entry('racing',6)]}]},[old]);assert.equal(h.item().entries.length,0);assert.deepEqual(h.item().observations,{});
  h.index(6,[]);h.index(7,[entry('next',7)]);h.tick(24*3600_000);assert(!itemHasNew(h.item(),h.now()));assert.equal(followEntries(h.item(),h.now()).history.length,1);
});
test('progress compares exact identities and status/date codes, never labels; capped, old or failed observations retain baseline',()=>{
  const h=setup();h.store.observeProgress(id,progress('2026-10-23T09:00:00Z',[event('a')]),h.expected());assert.equal(h.item().entries.length,0);
  h.store.observeProgress(id,progress('2026-10-23T09:01:00Z',[event('a',undefined,undefined,'Autre titre')]),h.expected());assert.equal(h.item().entries.length,0);
  h.store.observeProgress(id,progress('2026-10-23T09:02:00Z',[event('a'),event('b',undefined,'projected')],{coverage:{limited:true}}),h.expected());assert.equal(h.item().entries.length,0);assert(h.item().gaps.progress);
  h.store.observeProgress(id,progress('2026-10-23T09:03:00Z',[event('a'),event('b',undefined,'projected')]),h.expected());assert.equal(h.item().entries[0].change,'scheduled');
  h.store.observeProgress(id,progress('2026-10-23T09:04:00Z',[event('b',undefined,'recorded')]),h.expected());assert.equal(h.item().entries.at(-1).change,'status');
  h.store.observeProgress(id,progress('2026-10-23T09:05:00Z',[event('a'),event('b','2026-11-01','recorded')]),h.expected());assert.equal(h.item().entries.length,3);assert(h.item().entries.some(entry=>entry.change==='date'));
  h.store.observeProgress(id,progress('2026-10-23T09:02:00Z',[event('b',undefined,'projected')]),h.expected());assert.equal(h.item().entries.length,3);
  const baseline=structuredClone(h.item().observations.progress);h.store.observeProgress(id,progress('2026-10-23T09:06:00Z',[],{state:'unmapped'}),h.expected());assert.deepEqual(h.item().observations.progress,baseline);
});
test('press catch-up is independent of OEIL failures, latest-five previews and old publication dates',()=>{
  const h=setup();h.store.observePress(id,press(10),h.expected());assert.equal(h.item().entries.length,0);
  const releases=Array.from({length:8},(_,i)=>({id:'release-'+i,linkedAt:11+i,publishedAt:'2020-01-01',title:'Press '+i,url:'https://www.europarl.europa.eu/news/en/press-room/example'}));
  h.store.observePress(id,press(18,releases,{dossier:null}),h.expected());assert.equal(h.item().observations.press.mark,10);
  h.store.observePress(id,press(18,releases),h.expected());assert.equal(h.item().entries.length,8);
  h.store.markRead(id);h.store.observePress(id,press(18,releases),h.expected());assert(!itemHasNew(h.item(),h.now()));
  h.store.observePress(id,press(25,releases,{limited:true}),h.expected());assert.equal(h.item().observations.press.mark,18);
});
test('failed storage preserves a follow toggle and exposes failed acknowledgments for retry',()=>{
  const h=setup();let fail=true;const storage={getItem:h.storage.getItem,setItem(key,value){if(fail)throw Error('blocked');h.storage.setItem(key,value);}},store=createDossiersStore(storage);
  assert.throws(()=>store.toggle({id}),/Couldn't save/);assert.equal(store.snapshot().items.length,1);assert(store.snapshot().storageError);
  fail=false;assert(store.retryStorage());assert(!store.snapshot().storageError);
});

test('summary IDs are independent of labels and older observations, and source baselines survive reloads',()=>{
  const h=setup(),summary=id=>({id,date:'2026-10-23',url:'https://oeil.europarl.europa.eu/oeil/en/document-summary?id='+id});
  const response=(time,summaries)=>press(1,[],{dossier:{title:'Source title',language:'en',summaries,source:{fetchedAt:time}}});
  h.store.observePress(id,response('2026-10-23T10:00:00Z',[summary('1')]),h.expected());
  h.store.observePress(id,response('2026-10-23T11:00:00Z',[summary('1'),summary('2')]),h.expected());assert.equal(h.item().entries.length,1);assert.equal(h.item().entries[0].summaryId,'2');
  h.store.observePress(id,response('2026-10-23T09:00:00Z',[summary('3')]),h.expected());assert.equal(h.item().entries.length,1);
  const again=createDossiersStore(h.storage,()=>{},h.now),expected=again.snapshot().items[0];again.observePress(id,response('2026-10-23T12:00:00Z',[summary('1'),summary('2')]),expected);assert.equal(again.snapshot().items[0].entries.length,1);
});


test('a press release first matched through a later OEIL association is new once despite an already observed global watermark',()=>{
  const h=setup(),release={id:'later-association',linkedAt:20,title:'Newly linked release',publishedAt:'2026-10-23'};
  h.store.observePress(id,press(10),h.expected());
  h.store.observePress(id,press(20),h.expected());assert.equal(h.item().entries.length,0);
  h.store.observePress(id,press(20,[release]),h.expected());assert.equal(h.item().entries.length,1);
  h.store.markRead(id);h.store.observePress(id,press(21,[]),h.expected());h.store.observePress(id,press(22,[release]),h.expected());assert(!itemHasNew(h.item(),h.now()));
  h.store.observePress(id,press(1,[{...release,id:'archive',linkedAt:1}],{coverage:{followingSince:'2026-10-24',feeds:[],procedureLinks:{status:'available'}}}),h.expected());
  assert.equal(h.item().entries.length,1);assert.equal(h.item().observations.press.mark,1);assert(h.store.snapshot().restarted);
});

test('unread overflow expires with the shared window and Mark all read keeps the bounded history',()=>{
  const h=setup();h.index(1,[]);h.index(2,Array.from({length:205},(_,i)=>entry('entry-'+i,2)));
  assert.equal(h.item().entries.length,200);assert.equal(h.item().unreadOmitted,5);assert(itemHasNew(h.item(),h.now()));
  h.store.markRead(id);assert.equal(h.item().entries.length,5);assert.equal(h.item().unreadOmitted,0);assert(!itemHasNew(h.item(),h.now()));
  const next=setup();next.index(1,[]);next.index(2,Array.from({length:205},(_,i)=>entry('entry-'+i,2)));next.tick(24*3600_000);
  assert(!itemHasNew(next.item(),next.now()));assert.equal(followEntries(next.item(),next.now()).fresh.length,0);
});
