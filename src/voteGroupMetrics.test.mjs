import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMajorities,differentFromMajority,allGroupsAgree,fisherExactTwoSided,delegationBreaks} from './voteGroupMetrics.mjs';
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
