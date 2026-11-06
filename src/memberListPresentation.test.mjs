import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveMemberView,memberCommittees,memberListPageSize,memberParty,queryMemberView,sortMembers} from './memberListPresentation.mjs';

const committees=[{id:'1',code:'PETI'},{id:'2',code:'IMCO'},{id:'3',code:'AGRI'}];
const row=(id,role,current=true)=>({id,role,current,classification:'COMMITTEE_PARLIAMENTARY_STANDING'});

test('committees list members before substitutes and skip ended or unlisted rows',()=>{
  const member={memberships:[row('3','MEMBER_SUBSTITUTE'),row('1','MEMBER'),row('2','CHAIR_VICE'),row('9','MEMBER'),row('2','MEMBER',false)]};
  assert.deepEqual(memberCommittees(member,committees),[{code:'IMCO',substitute:false},{code:'PETI',substitute:false},{code:'AGRI',substitute:true}]);
});
test('a full seat outranks a substitute seat in the same committee',()=>{
  assert.deepEqual(memberCommittees({memberships:[row('1','MEMBER_SUBSTITUTE'),row('1','MEMBER')]},committees),[{code:'PETI',substitute:false}]);
});
test('unknown memberships stay unknown while none is an empty list',()=>{
  assert.equal(memberCommittees({memberships:null},committees),null);
  assert.deepEqual(memberCommittees({memberships:[]},committees),[]);
});
const party=(id,current=true)=>({id,current,classification:'NATIONAL_POLITICAL_GROUP'});
test('the national party needs exactly one current membership and a label',()=>{
  const parties={10:'PL',11:'PN'};
  assert.equal(memberParty({organizationMemberships:[party('10'),party('11',false)]},parties),'PL');
  assert.equal(memberParty({organizationMemberships:[party('10'),party('11')]},parties),null);
  assert.equal(memberParty({organizationMemberships:[party('12')]},parties),null);
  assert.equal(memberParty({organizationMemberships:[party('10',null)]},parties),null);
  assert.equal(memberParty({organizationMemberships:null},parties),null);
  assert.equal(memberParty({organizationMemberships:[party('toString')]},parties),null);
  assert.equal(memberParty({organizationMemberships:[party('10')]},undefined),null);
});
const people=[{id:1,lastName:'Bay',firstName:'A',g:'S&D',c:'Malta'},{id:2,lastName:'Cox',firstName:'B',g:'EPP',c:''},{id:3,lastName:'Dee',firstName:'C',g:'EPP',c:'Austria'},{id:4,lastName:'Eve',firstName:'D',g:'',c:'Malta'}];
const labels={group:m=>m.g,country:m=>m.c,collate:(a,b)=>a.localeCompare(b,'en')};
test('sorting keeps every member, orders ties by name and puts unknown labels last in both directions',()=>{
  assert.deepEqual(sortMembers(people,{key:'group'},labels).map(m=>m.id),[2,3,1,4]);
  assert.deepEqual(sortMembers(people,{key:'group',descending:true},labels).map(m=>m.id),[1,2,3,4]);
  assert.deepEqual(sortMembers(people,{key:'country'},labels).map(m=>m.id),[3,1,4,2]);
  assert.deepEqual(sortMembers(people,{key:'name',descending:true},labels).map(m=>m.id),[4,3,2,1]);
  assert.equal(sortMembers(people,{key:null},labels),people);
});
test('views default by screen width and an explicit choice wins',()=>{
  assert.equal(queryMemberView('list'),'list');assert.equal(queryMemberView('cards'),'cards');assert.equal(queryMemberView('grid'),null);assert.equal(queryMemberView(null),null);
  assert.equal(effectiveMemberView(null,true),'list');assert.equal(effectiveMemberView(null,false),'cards');
  assert.equal(effectiveMemberView('cards',true),'cards');assert.equal(effectiveMemberView('list',false),'list');
  assert.equal(memberListPageSize,50);
});
