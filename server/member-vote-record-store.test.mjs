import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {groupHistorySchema} from './group-history.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';
import {writeMemberVoteRecord,missingMemberVoteRecord,retainMemberVoteRecord} from './member-vote-record-store.mjs';

const recordsComplete=day=>{day.coverage={...day.coverage,completeness:{...day.coverage?.completeness,complete:false,votingRecordsComplete:true}};return day;};
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'member-vote-record-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse('2026-10-08T12:00:00Z')});
  assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return store;
}
const snapshotRow=(store,{id,version=7,complete=1,error=null,kind='votes',body=Buffer.from('x')})=>store.db.prepare('INSERT INTO sitting_snapshots(kind,version,id,complete,error,body) VALUES(?,?,?,?,?,?)').run(kind,version,id,complete,error,body);

test('one sitting write replaces member rows and adjusts term totals by the difference',async t=>{
  const store=setup(t),fixture=voteFixture(),groupOn=createGroupOn(fixture.history);recordsComplete(fixture.day);
  writeMemberVoteRecord(store,fixture.day,{groupOn,groupGeneration:'g1',snapshotVersion:7});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM member_vote_record_sittings').get().n,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM member_vote_record_members').get().n,4);
  assert.deepEqual(JSON.parse(store.db.prepare("SELECT body FROM member_vote_record_totals WHERE member_id='197591'").get().body),{withGroup:1,comparable:1,finalWithGroup:0,finalComparable:0});
  assert.equal(store.db.prepare("SELECT snapshot_version AS version,group_generation AS generation,complete FROM member_vote_record_sittings").get().version,7);
  assert.equal(store.db.prepare("SELECT group_generation AS generation FROM member_vote_record_sittings").get().generation,'g1');

  const changed=structuredClone(fixture.day),raw=changed.decisions[0];
  raw.had_voter_favor=['person/124846'];raw.had_voter_against=['person/197481'];raw.had_voter_abstention=['person/197591'];
  writeMemberVoteRecord(store,changed,{groupOn,groupGeneration:'g1',snapshotVersion:7});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM member_vote_record_members').get().n,3,'the sitting is replaced, never duplicated');
  // A lone abstention is now the group's own line, so it counts as with the group.
  assert.deepEqual(JSON.parse(store.db.prepare("SELECT body FROM member_vote_record_totals WHERE member_id='197591'").get().body),{withGroup:1,comparable:1,finalWithGroup:0,finalComparable:0});
  assert.deepEqual(JSON.parse(store.db.prepare("SELECT body FROM member_vote_record_members WHERE member_id='197591'").get().body).bySitting,
    {sittingId:'MTG-PL-2026-10-07',date:'2026-10-07',withGroup:1,comparable:1,finalWithGroup:null,finalComparable:null});
});

test('a complete votes snapshot without a current projection becomes one bounded backfill unit',async t=>{
  const store=setup(t),fixture=voteFixture(),id=fixture.day.sittingId;recordsComplete(fixture.day);
  snapshotRow(store,{id});
  assert.equal(missingMemberVoteRecord(store,7,'g1'),id);
  writeMemberVoteRecord(store,fixture.day,{groupOn:createGroupOn(fixture.history),groupGeneration:'g1',snapshotVersion:7});
  assert.equal(missingMemberVoteRecord(store,7,'g1'),null,'a current projection is not due again');
  assert.equal(missingMemberVoteRecord(store,8,'g1'),null,'another snapshot version is not this projection');
  assert.equal(missingMemberVoteRecord(store,7,'g2'),id,'a new group generation makes the projection stale');
  snapshotRow(store,{id:'MTG-PL-2026-10-08',version:7,complete:0});
  snapshotRow(store,{id:'MTG-PL-2026-10-09',version:7,complete:1,error:'source unavailable'});
  assert.equal(missingMemberVoteRecord(store,7,'g1'),'MTG-PL-2026-10-09','a failed refresh does not take a complete sitting out of the backfill');
  assert.equal(missingMemberVoteRecord(store,7,'g1',['MTG-PL-2026-10-09']),'MTG-PL-2026-10-08','a sitting that never became complete is examined too: its voting records may be');
  assert.equal(missingMemberVoteRecord(store,7,'g1',['MTG-PL-2026-10-09','MTG-PL-2026-10-08']),null);
  snapshotRow(store,{id:'MTG-PL-2026-10-10',version:7,complete:0,body:null});
  assert.equal(missingMemberVoteRecord(store,7,'g1',['MTG-PL-2026-10-09','MTG-PL-2026-10-08']),null,'a row never collected has nothing to examine');
  assert.equal(missingMemberVoteRecord(store,7,'g2',['MTG-PL-2026-10-09','MTG-PL-2026-10-08']),id,'a skipped sitting does not block older ones');
});

test('retaining a sitting records the active group generation only when its history exists',async t=>{
  const store=setup(t),fixture=voteFixture();recordsComplete(fixture.day);groupHistorySchema(store.db);
  store.set('active',3);
  retainMemberVoteRecord(store,fixture.day,7);
  assert.equal(store.db.prepare('SELECT group_generation AS generation FROM member_vote_record_sittings').get().generation,null,
    'missing group history must stay unavailable rather than invent a generation');
  store.db.prepare('INSERT INTO group_history_snapshots(generation,body) VALUES(?,?)').run(3,JSON.stringify(fixture.history));
  retainMemberVoteRecord(store,fixture.day,7);
  assert.equal(store.db.prepare('SELECT group_generation AS generation FROM member_vote_record_sittings').get().generation,3);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM member_vote_record_members WHERE member_id='197591'").get().body).groupCode,'S&D');
});

test('a sitting is projected on complete voting records even with an unfinished agenda; no decisions is empty; conflicts are excluded',async t=>{
  const store=setup(t),fixture=voteFixture(),groupOn=createGroupOn(fixture.history);
  const status=(day)=>{writeMemberVoteRecord(store,day,{groupOn,groupGeneration:'g1',snapshotVersion:7});return store.db.prepare('SELECT status,reason,named FROM member_vote_record_sittings WHERE sitting_id=?').get(day.sittingId);};
  const agendaOpen=structuredClone(fixture.day);
  agendaOpen.coverage={completeness:{complete:false,votingRecordsComplete:true,unresolvedAgendaItemIds:['eli/dl/event/x'],conflictingDecisionIds:[]}};
  assert.deepEqual({...status(agendaOpen)},{status:'projected',reason:null,named:1});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM member_vote_record_members').get().n,4);
  const noDecisions=structuredClone(fixture.day);noDecisions.decisions=[];
  noDecisions.coverage={completeness:{complete:false,votingRecordsComplete:false,declaredDecisionCount:0}};
  assert.deepEqual({...status(noDecisions)},{status:'empty',reason:null,named:0});
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM member_vote_record_members').get().n,0,'a later empty read replaces the earlier rows');
  assert.deepEqual(JSON.parse(store.db.prepare("SELECT body FROM member_vote_record_totals WHERE member_id='197591'").get().body),{withGroup:0,comparable:0,finalWithGroup:0,finalComparable:0});
  const conflicting=structuredClone(fixture.day);
  conflicting.coverage={completeness:{complete:false,votingRecordsComplete:false,conflictingDecisionIds:['eli/dl/event/y']}};
  assert.deepEqual({...status(conflicting)},{status:'excluded',reason:'conflicting-decisions',named:0});
  const unread=structuredClone(fixture.day);
  unread.coverage={completeness:{complete:false,votingRecordsComplete:false,declaredDecisionCount:3,conflictingDecisionIds:[]}};
  assert.equal(status(unread).reason,'records-incomplete');
});
