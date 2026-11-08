import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMajorities,differentFromMajority,allGroupsAgree,fisherExactTwoSided,delegationBreaks,delegationsDiffering} from './voteGroupMetrics.mjs';
const rows=(group,country,f,a,ab=0)=>['for','against','abstaining'].flatMap((position,i)=>Array.from({length:[f,a,ab][i]},()=>({group,country,position})));
test('plurality, abstentions, ties and exclusions',()=>{
 for(const [counts,majority] of [[[2,1,0],'for'],[[1,2,0],'against'],[[1,2,3],'abstaining'],[[2,2,1],null],[[12,13,13],null]])assert.equal(groupMajorities(rows('PPE','FR',...counts))[0].majority,majority);
 const voters=[...rows('PPE','FR',171,0,2),...rows('NI','PL',2,3),...rows('unavailable',null,2,3),...rows(null,null,2,3)];
 assert.equal(groupMajorities(voters).length,1);assert.equal(groupMajorities(voters)[0].unity,171/173);assert.equal(differentFromMajority(voters),2);
 assert(!allGroupsAgree(groupMajorities(voters)));assert(allGroupsAgree(groupMajorities([...voters,...rows('S&D','FR',3,1)])));assert(!allGroupsAgree([]));assert(!allGroupsAgree(groupMajorities([...voters,...rows('S&D','FR',2,2)])));assert(!allGroupsAgree(groupMajorities([...voters,...rows('S&D','FR',0,2)])));
});
test('exact two-sided Fisher values and row/column symmetries',()=>{
 for(const [a,b,c,d,expected] of [[1,9,11,3,.00275945618522],[4,0,4,117,7.2235619306e-6],[3,0,0,10,.0034965034965],[23,0,0,151,3.471066092408436e-29]]) {
  for(const args of [[a,b,c,d],[c,d,a,b],[b,a,d,c]])assert(Math.abs(fisherExactTwoSided(...args)/expected-1)<.001,`${args}`);
 }
 assert.equal(fisherExactTwoSided(0,0,0,0),1);
});
test('delegation threshold, opposite rest, abstentions and unavailable countries',()=>{
 const voters=[...rows('PPE','PL',4,0,50),...rows('PPE','FR',4,117),...rows('PPE',null,40,0),...rows('NI','PL',30,0),...rows('NI','FR',0,100)];
 // Abstention is a group-majority position, so use fewer abstentions for this case.
 const actual=voters.filter(v=>v.position!=='abstaining');
 const breaks=delegationBreaks(actual);assert.equal(breaks.length,1);assert.equal(breaks[0].country,'PL');assert.equal(breaks[0].restFor,4);assert.equal(breaks[0].restAgainst,117);
 assert.deepEqual(delegationBreaks([...rows('PPE','PL',2,0),...rows('PPE','FR',0,150)]),[]);
 assert.deepEqual(delegationBreaks([...rows('PPE','PL',2,2),...rows('PPE','FR',0,150)]),[]);
 assert.deepEqual(delegationBreaks([...rows('PPE','PL',3,0),...rows('PPE','FR',0,10)]),[]);
 assert.deepEqual(delegationBreaks([...rows('PPE','PL',4,0,2),...rows('PPE','FR',4,117)]),delegationBreaks([...rows('PPE','PL',4,0),...rows('PPE','FR',4,117)]));
});
test('metrics have no country-filter input',()=>{
 const voters=[...rows('PPE','PL',21,0),...rows('PPE','FR',20,132)];
 const before=groupMajorities(voters);delegationBreaks(voters).filter(r=>r.country==='PL');assert.deepEqual(groupMajorities(voters),before);assert.equal(differentFromMajority(voters),41);
});

test('a delegation differs when more than half of its voters left the group majority, abstaining included',()=>{
  // DEC-198357 (21 Oct 2026): all seven Greek EPP members abstained while EPP voted for.
  const voters=[...rows('PPE','GR',0,0,7),...rows('PPE','DE',28,0,0),...rows('PPE','HR',2,1,0),...rows('PPE','MT',0,1,1),
    ...rows('ECR','BE',0,0,3),...rows('ECR','IT',0,21,0),...rows('NI','DE',1,5,2),...rows('The Left','BE',1,0,1),...rows('The Left','FR',9,0,0),
    ...rows('Renew','FR',2,2,0),...rows('Renew','DE',2,2,0)];
  const found=delegationsDiffering(voters).map(row=>row.country+' '+row.group).sort();
  assert.deepEqual(found,['BE ECR','EL PPE','MT PPE'],'Croatia (1 of 3), a 1–1 split, NI and a group without a majority are left out');
  const greece=delegationsDiffering(voters).find(row=>row.country==='EL');
  assert.deepEqual(greece,{group:'PPE',country:'EL',counts:{for:0,against:0,abstaining:7},rest:{for:30,against:2,abstaining:1},majority:'for'},'the rest is the same group from every other country');
  assert.deepEqual(delegationsDiffering([]),[]);
});
test('exactly half differing is not enough, and an against majority works the same way',()=>{
  const voters=[...rows('ECR','PL',0,18,0),...rows('ECR','CZ',1,1,0),...rows('ECR','SE',2,0,1),...rows('ECR','LV',0,1,0)];
  assert.deepEqual(delegationsDiffering(voters).map(row=>row.country),['SE'],'Czechia 1 of 2 against is half, not more; Sweden 3 of 3 left an against majority');
  assert.deepEqual(delegationsDiffering(voters)[0].rest,{for:1,against:20,abstaining:0});
});
