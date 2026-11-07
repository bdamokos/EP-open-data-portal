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
  await assert.rejects(service.query('2',{}),error=>error.code==='busy'&&error.retryAfter===1);
  const data=await request;assert.equal(data.member.id,'1');assert.equal(data.coverage.status,'unavailable');
  assert.equal(service.busy,false);
  assert.equal((await service.query('2',{language:'en',scope:'all',tag:null,limit:0,offset:0})).member.id,'2');
});


test('a reader timeout is a retryable client error and releases the service',async()=>{
  const service=new MemberVoteRecordService({directory:'/nonexistent-member-record-fixture',timeoutMs:1});
  await assert.rejects(service.query('1',{}),error=>error.code==='request_timeout'&&error.retryAfter===1);
  assert.equal(service.busy,false);
});

test('a real exclusive database lock retains retry metadata across the worker boundary',async t=>{
  const {DatabaseSync}=await import('node:sqlite');
  const directory=mkdtempSync(path.join(os.tmpdir(),'member-record-lock-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new ActivityStore(directory);assert(store.acquire());store.close();
  const lock=new DatabaseSync(path.join(directory,'activities-v1.sqlite'));
  const service=new MemberVoteRecordService({directory});
  try{
    lock.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
    await assert.rejects(service.query('1',{language:'en',scope:'all',tag:null,limit:0,offset:0}),error=>error.status===503&&error.code==='busy'&&error.retryAfter===1);
  }finally{lock.exec('ROLLBACK');lock.close();}
  assert.equal(service.busy,false);
  assert.equal((await service.query('1',{language:'en',scope:'all',tag:null,limit:0,offset:0})).member.id,'1');
});
