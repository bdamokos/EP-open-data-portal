import test from 'node:test';
import assert from 'node:assert/strict';
import {BREAKDOWN,memberBreakdown} from './member-vote-record-breakdown.mjs';

// One sitting row: `marks` is the member's vector, `tagged` gives the tags of each decision.
const sitting=(marks,tagFor)=>({vector:marks,tags:[...marks].map((_,index)=>[`D${index}`,...tagFor(index)])});
const procedures=count=>Array.from({length:count},(_,index)=>'2026-'+String(1000+index));
const only=(micro,count=3)=>()=>[procedures(count),micro,[]];

test('the thresholds are named once and a row needs both enough votes and enough distinct procedures',()=>{
  assert.deepEqual(BREAKDOWN,{minVotes:20,minProcedures:3,margin:0.05,rows:5});
  // 100 votes, 20 of them tagged and against the group: the tagged share is 0%, the overall 80%.
  const make=(votes,procedureCount)=>[sitting('w'.repeat(80)+'a'.repeat(votes),index=>index>=80?[procedures(procedureCount),['100195'],[]]:[[],[],[]])];
  assert.equal(memberBreakdown(make(20,3)).topics.rows.length,1);
  assert.equal(memberBreakdown(make(19,3)).topics.eligible,0,'one vote short');
  assert.equal(memberBreakdown(make(20,2)).topics.eligible,0,'one text short: each amendment is its own vote');
});

function topicRows(shares,votes=100) {
  let marks='';const tags=[];
  for(const [topic,pct] of Object.entries(shares))for(let vote=0;vote<votes;vote++){marks+=vote<pct*votes/100?'w':'a';tags.push(['D'+topic+'-'+vote,procedures(3),[topic],[]]);}
  return [{vector:marks,tags}];
}

test('a row is shown only when it is at least five points below the overall share, lowest first, five at most',()=>{
  const low={a:50,b:55,c:60,d:65,e:70,f:75,g:80,h:85},high=Object.fromEntries(Array.from({length:22},(_,index)=>['z'+index,100]));
  const result=memberBreakdown(topicRows({...low,...high}));
  assert.equal(result.topics.eligible,30);
  assert.deepEqual(result.topics.rows.map(row=>row.key),['topic:a','topic:b','topic:c','topic:d','topic:e'],'lowest first, five at most');
  // Exactly five points below the overall share still shows; four points does not.
  const edge=memberBreakdown(topicRows({x:85,y:95}));
  assert.equal(edge.overall,0.9);
  assert.deepEqual(edge.topics.rows.map(row=>[row.key,row.share]),[['topic:x',0.85]]);
  assert.deepEqual(memberBreakdown(topicRows({x:86,y:94})).topics.rows,[],'four points below is not enough');
});

test('abstentions and votes that cannot be compared are not comparable votes',()=>{
  const marks='w'.repeat(10)+'a'.repeat(10)+'b'.repeat(30)+'n'.repeat(30)+'-'.repeat(5)+'w'.repeat(60);
  const result=memberBreakdown([sitting(marks,only(['7'],3))]);
  assert.equal(result.overall,70/80);
  assert.equal(result.topics.eligible,1);
  assert.equal(result.topics.rows.length,0,'no row is below the overall share when every vote has the same tag');
});

test('the final scope counts whole-text votes only, and untagged votes count towards the overall share only',()=>{
  const marks='W'.repeat(40)+'A'.repeat(20)+'w'.repeat(100)+'a'.repeat(0);
  const tagFor=index=>index<60?[procedures(4),['9'],['FRA']]:[[],[],[]];
  const all=memberBreakdown([sitting(marks,tagFor)],'all'),final=memberBreakdown([sitting(marks,tagFor)],'final');
  assert.equal(all.overall,140/160);
  assert.equal(final.overall,40/60);
  assert.equal(final.topics.eligible,1);assert.equal(final.topics.rows.length,0,'the tagged votes are all the final votes, so they match the overall share');
  assert.equal(all.topics.rows[0].comparable,60,'untagged votes belong to no row');
  assert.equal(all.topics.rows[0].share,40/60);
});

test('with no comparable vote there is no overall share and nothing is shown',()=>{
  const result=memberBreakdown([sitting('b'.repeat(30)+'n'.repeat(30),only(['1'],5))]);
  assert.equal(result.overall,null);assert.equal(result.topics.eligible,0);assert.deepEqual(result.countries.rows,[]);
});
