import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCounts,nearestSeat,seatMatches} from './hemicycleModel.mjs';
import {explorerParams,readExplorerParam} from './explorerQuery.mjs';

const weber={seat:14,x:10,y:10,r:5,member:1,name:'Weber',firstName:'Manfred',group:'PPE',country:'DE'};
const muresan={seat:16,x:30,y:10,r:5,member:2,name:'Mureşan',firstName:'Siegfried',group:'PPE',country:'RO'};
const garcia={seat:6,x:60,y:10,r:5,member:3,name:'García Pérez',firstName:'Iratxe',group:'S&D',country:'ES'};
const council={seat:1,x:90,y:10,r:5,institution:'council'};

test('search finds an exact seat by number and Members by unaccented name',()=>{
  assert(seatMatches(weber,{query:'14'}));
  assert(!seatMatches(weber,{query:'1'}),'a partial number is not that seat');
  assert(seatMatches(muresan,{query:'muresan'}));
  assert(seatMatches(garcia,{query:'iratxe garcia'}));
  assert(!seatMatches(weber,{query:'garcia'}));
});
test('group and country narrow Members; seats without a Member never match',()=>{
  assert(seatMatches(weber,{group:'PPE',country:'DE'}));
  assert(!seatMatches(weber,{group:'S&D'}));
  assert(!seatMatches(weber,{country:'FR'}));
  assert(!seatMatches(council));
  assert(seatMatches(council,{query:'1'}),'a seat number reaches a seat without a Member');
  assert(!seatMatches(council,{query:'1',group:'PPE'}));
  assert(!seatMatches(council,{query:'council'}));
});
test('groups are counted from Members only, largest first',()=>{
  assert.deepEqual(groupCounts([weber,garcia,muresan,council]),[{group:'PPE',count:2},{group:'S&D',count:1}]);
});
test('a press selects the closest seat within reach and nothing beyond it',()=>{
  assert.equal(nearestSeat([weber,muresan],18,10,14).seat,14);
  assert.equal(nearestSeat([weber,muresan],26,10,14).seat,16);
  assert.equal(nearestSeat([weber],200,200,14),null);
});
test('a shared link keeps the chamber, filters and Member and refuses a malformed Member',()=>{
  const query=new URLSearchParams('view=hemicycle&hc-chamber=bru&hc-member=28229&hc-group=PPE&hc-country=GR&other=1');
  assert.deepEqual([...explorerParams(query,'hemicycle').keys()],['hc-chamber','hc-member','hc-group','hc-country']);
  assert.equal(explorerParams(query,'hemicycle').get('hc-country'),'EL');
  assert.equal(readExplorerParam(query,'hc-member',null),'28229');
  assert.equal(readExplorerParam(new URLSearchParams('hc-member=x'),'hc-member',null),null);
  assert.equal(readExplorerParam(new URLSearchParams('hc-chamber=mars'),'hc-chamber','str',['str','bru']),'str');
});
