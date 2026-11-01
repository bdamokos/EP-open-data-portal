import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {alternateAmendmentDispatch} from './activity-index-worker.mjs';

test('a higher-priority amendment backlog alternates with due core refresh work',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'amendment-alternation-'));
  const store=new ActivityStore(dir,{initializeIndexes:true});store.acquire();
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const core={key:'/plenary-documents/B-10-2026-0422',priority:106},amendment={key:'amendment:members:10',priority:108,amendmentJob:true};
  const picks=Array.from({length:6},()=>alternateAmendmentDispatch(store,21,core,amendment).key);
  assert.deepEqual(picks,[amendment.key,core.key,amendment.key,core.key,amendment.key,core.key]);
  assert.equal(alternateAmendmentDispatch(store,21,null,amendment),amendment,'amendment work runs alone when no core task is due');
  assert.equal(alternateAmendmentDispatch(store,21,core,null),core);
  assert.equal(alternateAmendmentDispatch(store,21,{...core,priority:110},amendment).priority,110,'higher-priority core work keeps winning');
  const reopened=new ActivityStore(dir,{initializeIndexes:true});t.after(()=>reopened.close());
  assert.equal(store.get('amendmentDispatch').generation,21,'the turn is persisted across restarts');
});
