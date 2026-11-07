import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {MemberVoteRecordService} from './member-vote-record-reader.mjs';

test('bounded HTTP reader runs off-thread, rejects overlap, and releases its worker',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'member-record-reader-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new ActivityStore(directory);assert(store.acquire());store.close();
  const service=new MemberVoteRecordService({directory});
  const request=service.query('1',{language:'en',scope:'all',tag:null,limit:5,offset:0});
  await assert.rejects(service.query('2',{}),error=>error.code==='member_vote_record_busy');
  const data=await request;assert.equal(data.member.id,'1');assert.equal(data.coverage.status,'unavailable');
  assert.equal(service.busy,false);
  assert.equal((await service.query('2',{language:'en',scope:'all',tag:null,limit:0,offset:0})).member.id,'2');
});
