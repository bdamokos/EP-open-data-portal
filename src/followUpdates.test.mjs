import test from 'node:test';
import assert from 'node:assert/strict';
import {NEW_WINDOW_MS,LIST_LIMIT,isNewEntry,followEntries,itemHasNew,nextExpiry,compactEntries,summarizeByType,markEntryRead,markAllRead,migrateUnread} from './followUpdates.mjs';

const now=Date.parse('2026-10-23T10:00:00Z');
const entry=(id,extra={})=>({id,kind:'activity',recordKind:'speech',title:'A source title',titleLanguage:'en',date:'2026-10-22',discoveredAt:now-1000,readAt:null,...extra});

test('new lasts strictly less than 24 hours from discovery and requires an unread entry',()=>{
  assert.equal(NEW_WINDOW_MS,86_400_000);
  assert(isNewEntry(entry('just-under',{discoveredAt:now-NEW_WINDOW_MS+1}),now));
  assert(!isNewEntry(entry('at',{discoveredAt:now-NEW_WINDOW_MS}),now));
  assert(!isNewEntry(entry('older',{discoveredAt:now-NEW_WINDOW_MS-1}),now));
  assert(!isNewEntry(entry('read',{readAt:now-500}),now));
  assert(!isNewEntry(entry('missing-time',{discoveredAt:undefined}),now));
  assert(!isNewEntry(entry('missing-read',{readAt:undefined}),now));
});

test('reading one MEP leaves the other MEP new and keeps the read entry as history',()=>{
  const first={entries:[entry('same-id')]},second={entries:[entry('same-id')]};
  const read={...first,entries:markEntryRead(first.entries,'activity','same-id',now)};
  assert(!itemHasNew(read,now));assert(itemHasNew(second,now));
  assert.deepEqual(followEntries(read,now).history,[{...first.entries[0],readAt:now}]);
  assert.equal(first.entries[0].readAt,null);assert.equal(second.entries[0].readAt,null);
  // Merely deriving the displayed state (including leaving/remounting) is read-only.
  assert.deepEqual(followEntries(second,now),followEntries(second,now));
  assert.equal(second.entries[0].readAt,null);
});

test('read operations use the exact kind and ID, retain timestamps and preserve metadata',()=>{
  const entries=[entry('shared'),entry('shared',{kind:'answer',recordKind:'answer',category:'written-questions',relatedQuestionId:'question',mark:7}),entry('already-read',{readAt:now-50}),entry('expired',{discoveredAt:now-NEW_WINDOW_MS})];
  const read=markEntryRead(entries,'answer','shared',now);
  assert.equal(read[0].readAt,null);assert.deepEqual(read[1],{...entries[1],readAt:now});
  assert.equal(markEntryRead(read,'answer','shared',now+1)[1].readAt,now);
  assert.deepEqual(markEntryRead(entries,'activity','missing',now),entries);
  const all=markAllRead(entries,now);
  assert.deepEqual(all.map(item=>item.readAt),[now,now,now-50,null]);
  assert.equal(entries[1].readAt,null);
});

test('entries sort by discovery then source date, with five recent history entries and an accumulated omission count',()=>{
  const history=Array.from({length:8},(_,i)=>entry('history-'+i,{discoveredAt:now-i-1,readAt:now}));
  const expired=entry('expired',{discoveredAt:now-NEW_WINDOW_MS}),earlier=entry('earlier',{date:'2026-10-20'}),later=entry('later',{date:'2026-10-21'}),newest=entry('newest',{discoveredAt:now-1,date:'2024-07-16'});
  const entries=[earlier,...history.toReversed(),expired,newest,later],original=structuredClone(entries);
  const result=followEntries({entries,historyOmitted:3},now);
  assert.deepEqual(result.fresh.map(item=>item.id),['newest','later','earlier']);
  assert.deepEqual(result.history.map(item=>item.id),history.slice(0,5).map(item=>item.id));
  assert.equal(result.historyOmitted,7);assert.equal(result.unresolved,false);
  assert.deepEqual(entries,original);
  assert.deepEqual(followEntries({},now),{fresh:[],history:[],historyOmitted:0,unresolved:false});
});

test('unresolved signals expire independently by kind without restarting their window',()=>{
  const item={unresolved:{activity:true,answer:true},signalledAt:{activity:now-NEW_WINDOW_MS,answer:now-100}};
  assert(itemHasNew(item,now));assert(followEntries(item,now).unresolved);
  assert.equal(nextExpiry([item],now),now-100+NEW_WINDOW_MS);
  assert(!itemHasNew(item,now-100+NEW_WINDOW_MS));
  assert(!followEntries({...item,unresolved:{activity:true,answer:false}},now).unresolved);
  assert(itemHasNew({unresolved:true,signalledAt:now},now));
  assert(itemHasNew({...item,unresolved:true},now));
  assert(!itemHasNew({unresolved:true},now));
  assert(!itemHasNew({unresolved:false,signalledAt:now},now));
});

test('unresolved signal lists use only the latest rise per kind for badge and expiry',()=>{
  const item={unresolved:{activity:true,answer:true},signals:{activity:[[5,now-NEW_WINDOW_MS-1],[7,now-100]],answer:[[3,now-NEW_WINDOW_MS+1],[4,now-50]]}};
  assert(itemHasNew(item,now));assert(followEntries(item,now).unresolved);
  assert.equal(nextExpiry([item],now),now-100+NEW_WINDOW_MS);
  assert.equal(nextExpiry([item],now-100+NEW_WINDOW_MS),now-50+NEW_WINDOW_MS);
  assert(!itemHasNew(item,now-50+NEW_WINDOW_MS));assert.equal(nextExpiry([item],now-50+NEW_WINDOW_MS),null);
  const resolved={...item,unresolved:false};assert(!itemHasNew(resolved,now));assert.equal(nextExpiry([resolved],now),null);
  const single={unresolved:{activity:true},signals:{activity:[[5,now-100]]}};
  assert(itemHasNew(single,now));assert.equal(nextExpiry([single],now),now-100+NEW_WINDOW_MS);
  assert(!itemHasNew(single,now-100+NEW_WINDOW_MS));
});

test('nextExpiry selects the earliest future unread or unresolved expiry and ignores read and expired entries',()=>{
  const earliest=entry('first',{discoveredAt:now-NEW_WINDOW_MS+1});
  const items=[{entries:[entry('read',{readAt:now,discoveredAt:now-NEW_WINDOW_MS+0.5}),entry('expired',{discoveredAt:now-NEW_WINDOW_MS}),entry('last')]},{entries:[earliest]}];
  assert.equal(nextExpiry(items,now),now+1);
  assert.equal(nextExpiry(items,now+1),now-1000+NEW_WINDOW_MS);
  assert.equal(nextExpiry(items,now+NEW_WINDOW_MS),null);
  assert.equal(nextExpiry([],now),null);
});

test('compaction keeps 200 fresh and five history entries and trims history titles only',()=>{
  const fresh=Array.from({length:202},(_,i)=>entry('new-'+i,{discoveredAt:now-i,title:'n'.repeat(400)}));
  const history=Array.from({length:8},(_,i)=>entry('old-'+i,{discoveredAt:now-NEW_WINDOW_MS-i,title:'h'.repeat(400),category:'written-questions',relatedQuestionId:'exact-question',mark:2}));
  const input=[...history,...fresh].toReversed(),copy=structuredClone(input),result=compactEntries(input,now);
  assert.equal(result.entries.length,205);assert.equal(result.historyOmitted,3);
  assert.deepEqual(result.entries.slice(0,200).map(item=>item.id),fresh.slice(0,200).map(item=>item.id));
  assert(result.entries.slice(0,200).every(item=>item.title.length===400));
  assert.deepEqual(result.entries.slice(200),history.slice(0,5).map(item=>({...item,title:'h'.repeat(300)})));
  assert.deepEqual(input,copy);
  const smaller=compactEntries(input,now,{historyLimit:2,newLimit:3});
  assert.equal(smaller.entries.length,5);assert.equal(smaller.historyOmitted,6);
  const expired=compactEntries(result.entries,now+NEW_WINDOW_MS);
  assert.equal(expired.entries.length,5);assert.equal(expired.historyOmitted,200);
  assert(expired.entries.every(item=>item.title.length===300));
});

test('summary above ten entries uses known categories, record kinds, plurals and omitted counts',()=>{
  assert.equal(LIST_LIMIT,10);
  const entries=[...Array.from({length:3},(_,i)=>entry('s'+i)),...Array.from({length:7},(_,i)=>entry('q'+i,{recordKind:'document',category:'written-questions'})),entry('a1',{kind:'answer',recordKind:'answer',category:'written-questions'}),entry('a2',{recordKind:'answer'}),entry('m',{recordKind:'document',category:'motions'})];
  assert.equal(summarizeByType(entries,4),'3 speeches · 7 written questions · 2 answers · 1 motion · and 4 more');
  const unknowns=[entry('a',{recordKind:'document',category:'future-category'}),entry('b',{recordKind:undefined,category:'toString'})];
  assert.equal(summarizeByType(unknowns),'2 other activities');
  assert.equal(summarizeByType(unknowns.slice(0,1)),'1 other activity');
  assert.equal(summarizeByType([]),'');assert.equal(summarizeByType([],2),'and 2 more');
});

test('every known profile category has a readable singular and plural summary',()=>{
  const categories=['plenary-contributions','reports-rapporteur','reports-shadow','opinions-rapporteur','opinions-shadow','motions','written-questions','oral-questions','written-vote-explanations','individual-motions','union-act-proposals'];
  for(const category of categories) {
    const value=entry(category,{recordKind:'document',category});
    const singular=summarizeByType([value]),plural=summarizeByType([value,value]);
    assert.match(singular,/^1 /);assert.match(plural,/^2 /);assert.notEqual(singular.slice(2),plural.slice(2));
    assert(!singular.includes('other activity'));assert(!plural.includes('other activities'));
  }
});

test('migration stamps existing unread entries at upgrade time, preserves IDs and source metadata, and infers legacy kinds',()=>{
  const unread=[{id:'exact-id',title:'Titre',titleLanguage:'fr',date:'2024-07-16',recordKind:'speech',mark:9},{id:'answer-id',kind:'answer',recordKind:'answer',category:'written-questions',title:'Question',date:'2026-10-22',relatedQuestionId:'question-id'},entry('legacy-answer',{kind:undefined,recordKind:'answer',discoveredAt:0,readAt:now-10})];
  const original=structuredClone(unread),migrated=migrateUnread(unread,now);
  assert.deepEqual(migrated.map(item=>[item.kind,item.discoveredAt,item.readAt]),[['activity',now,null],['answer',now,null],['answer',now,null]]);
  assert.deepEqual(migrated[0],{...unread[0],kind:'activity',discoveredAt:now,readAt:null});
  assert(migrated.every(item=>isNewEntry(item,now+NEW_WINDOW_MS-1)));
  assert(!migrated.some(item=>isNewEntry(item,now+NEW_WINDOW_MS)));
  assert.deepEqual(unread,original);
});
