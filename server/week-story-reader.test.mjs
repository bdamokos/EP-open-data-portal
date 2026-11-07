import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {retainedWeekVoteFacts} from './week-story-reader.mjs';
import {SerialFactReads} from './week-story-queue.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';

test('real vote worker reads exact snapshots and group history without a writer',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'week-worker-')),db=new DatabaseSync(path.join(directory,'activities-v1.sqlite'));
 try {
  const f=voteFixture();delete f.raw.decided_on_a_realization_of;f.raw.referenceText={en:'Commission proposal'};f.day.coverage={state:'complete'};
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE group_history_snapshots(generation INTEGER PRIMARY KEY,body TEXT); CREATE TABLE sitting_snapshots(kind TEXT,version INTEGER,id TEXT,complete INTEGER,body BLOB,PRIMARY KEY(kind,version,id));');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('marksEpoch','1');
  db.prepare('INSERT INTO group_history_snapshots VALUES (?,?)').run(1,JSON.stringify(f.history));
  db.prepare('INSERT INTO sitting_snapshots VALUES (?,?,?,?,?)').run('votes',MEMBER_VOTE_SNAPSHOT_VERSION,f.day.sittingId,1,gzipSync(JSON.stringify({day:f.day})));
  const result=await retainedWeekVoteFacts({ids:[f.day.sittingId],directory,generation:1});
  assert.equal(result.completeVotes,true);assert(result.votes.some(v=>v.id===f.raw.activity_id));assert.equal(result.votes.find(v=>v.id===f.raw.activity_id).differing,0);
  const missing=await retainedWeekVoteFacts({ids:[f.day.sittingId,'MTG-PL-2026-10-08'],directory,generation:1});assert.equal(missing.completeVotes,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sitting_snapshots').get().n,1);
 }finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
test('fact reader serializes different keys and coalesces identical keys with bounded waiting',async()=>{
 const queue=new SerialFactReads({maxPending:2});let active=0,maxActive=0,loads=0,release;
 const first=queue.read('one',async()=>{loads++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>release=resolve);active--;return 1;});
 const same=queue.read('one',()=>assert.fail('duplicate load'));
 const next=queue.read('two',async()=>{loads++;active++;maxActive=Math.max(maxActive,active);active--;return 2;});
 await assert.rejects(queue.read('three',async()=>3),/queue is full/);
 while(!release)await new Promise(resolve=>setImmediate(resolve));release();
 assert.deepEqual(await Promise.all([first,same,next]),[1,1,2]);assert.equal(loads,2);assert.equal(maxActive,1);
});
