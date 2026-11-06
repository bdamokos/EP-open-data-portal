import test from 'node:test';
import assert from 'node:assert/strict';
import {panelVoters,listFor} from './voterPanelModel.mjs';

const person=(id,name,country)=>({id,name,country});
const votes={for:[person('3','Zoë Ñandú','ES'),person('1','Ana Beta','DE')],against:[person('2','Carl Gamma','DE')],abstaining:[person('4','Dora Delta','FR'),person('5','Eve Epsilon',null)]};
const groups={1:'PPE',2:'ESN',3:'PPE',4:'S&D'};
const options={groupOf:id=>groups[id]};

test('everyone who recorded a position is listed, For first then by name, and the counts add up',()=>{
  const {rows,counts}=panelVoters(votes,options);
  assert.deepEqual(rows.map(row=>row.id),['1','3','2','4','5']);
  assert.deepEqual(counts,{all:5,for:2,against:1,abstaining:2});
  assert.equal(rows.find(row=>row.id==='5').group,'unavailable','a voter without a group is not dropped');
  assert.deepEqual(listFor(rows,'against').map(row=>row.id),['2']);
  assert.equal(listFor(rows,'all').length,5);
});
test('country, group and name search narrow the rows and the tab counts together, ignoring accents and case',()=>{
  assert.deepEqual(panelVoters(votes,{...options,matchesCountry:country=>country==='DE'}).counts,{all:2,for:1,against:1,abstaining:0});
  assert.deepEqual(panelVoters(votes,{...options,group:'PPE'}).rows.map(row=>row.id),['1','3']);
  assert.deepEqual(panelVoters(votes,{...options,query:'  nandu '}).rows.map(row=>row.id),['3']);
  assert.deepEqual(panelVoters(votes,{...options,query:'zzz'}).counts,{all:0,for:0,against:0,abstaining:0});
});
