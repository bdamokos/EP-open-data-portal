import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GROUP_VOICE_DEFAULTS as defaults,readGroupVoicesState,changeGroupVoicesState,groupVoicesUrl,visibleGroupPeople} from './groupVoicesState.mjs';
test('retired time links normalise while preserving exact filters and route-owned parameters',()=>{
 const url=new URL('https://example.test/?poc=1&lang=hu&view=groups&gv-tab=time&gv-person=42&gv-subject=foreign&gv-period=2026-09');const state=readGroupVoicesState(url.searchParams),next=groupVoicesUrl(url.href,state);
 assert.equal(state.tab,'subjects');assert.equal(next.searchParams.get('gv-person'),'42');assert.equal(next.searchParams.get('gv-subject'),'foreign');assert.equal(next.searchParams.get('lang'),'hu');assert.equal(next.searchParams.has('gv-tab'),false);assert.deepEqual(readGroupVoicesState(next.searchParams),state);
});
test('person toggles preserve subject and list limit; other list facets reset expansion',()=>{
 const state={...defaults,tab:'people',peopleLimit:50,subject:'foreign',person:'42',offset:40};
 assert.deepEqual(changeGroupVoicesState(state,{person:null}),{...state,person:null,offset:0});
 for(const patch of [{subject:'climate'},{q:'Éva'},{period:'2026-09'},{group:'PPE'}])assert.equal(changeGroupVoicesState(state,patch).peopleLimit,15);
 assert.equal(changeGroupVoicesState(state,{group:'PPE'}).person,null);
});
test('People remains an independent selector, with exact active counts and selected rows past 15',()=>{
 const people=Array.from({length:24},(_,i)=>({id:String(i+1),name:'Person '+(i+1),total:50-i,subjects:{foreign:30-i,climate:20}}));
 const selected={...defaults,person:'22',tab:'people',subject:'foreign'};const list=visibleGroupPeople(people,selected);
 assert.equal(list.rows.length,24);assert.equal(list.visible.length,22);assert.equal(list.visible.at(-1).id,'22');assert.equal(selected.peopleLimit,15);assert.equal(list.visible.at(-1).count,9);assert.equal(list.visible.at(-1).subjects.climate,20);
 assert.equal(visibleGroupPeople(people,{...selected,person:null}).visible.length,15);
 const greek={id:'99',name:'Geadis Geadi',nameVariants:[{value:'Γεάδης Γεάδη'}],total:1,subjects:{foreign:1}};assert.equal(visibleGroupPeople([greek],{...defaults,q:'Γεάδης'}).rows[0].id,'99');
});
test('malformed limits and identifiers never become filter state',()=>{
 const result=readGroupVoicesState(new URLSearchParams('gv-person=abc&gv-group=NI&gv-subject=unknown&gv-people-limit=1001&gv-offset=-1'));
 assert.deepEqual(result,defaults);
});

test('months outside the current term normalise without losing the other filters',()=>{
 const now=Date.parse('2026-10-17T12:00Z');
 for(const period of ['2023-05','2024-06','2026-11','2099-01']){const state=readGroupVoicesState(new URLSearchParams('gv-period='+period+'&gv-person=42&gv-subject=foreign'),{now});assert.equal(state.period,'term');assert.equal(state.person,'42');assert.equal(state.subject,'foreign');}
 assert.equal(readGroupVoicesState(new URLSearchParams('gv-period=2024-07'),{now}).period,'2024-07');
 assert.equal(readGroupVoicesState(new URLSearchParams('gv-period=2026-11'),{now:Date.parse('2026-10-31T23:30Z')}).period,'2026-11');
});
test('the 1000-person cap has no inert Show all action',()=>{
 const people=Array.from({length:1002},(_,i)=>({id:String(i+1),name:'Speaker '+i,total:1,subjects:{foreign:1}})),state={...defaults,peopleLimit:1000};
 const list=visibleGroupPeople(people,state);assert.equal(list.visible.length,1000);assert.equal(list.hasMore,false);
 const selected=visibleGroupPeople(people,{...state,person:list.rows.at(-1).id});assert.equal(selected.visible.length,1002);assert.equal(selected.hasMore,false);
});
