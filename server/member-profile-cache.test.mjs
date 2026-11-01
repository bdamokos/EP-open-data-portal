import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';

test('member profiles are parsed once per generation and refreshed by profile writes only',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'member-profiles-'));
  const store=new ActivityStore(dir);store.acquire();
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const fetched='2026-10-20T09:00:00.000Z',profile=id=>({id,givenName:'Alex',familyName:'Member '+id});
  store.putSource(1,'amendment:member:101','amendment-member',profile('101'),fetched);
  const first=store.memberProfiles(1);
  assert.deepEqual(first.map(source=>source.work.id),['101']);
  assert.equal(store.memberProfiles(1),first,'repeated rebuilds reuse one parse');
  assert(Object.isFrozen(first[0].work),'shared profiles cannot be mutated by a rebuild');
  store.putSource(1,'amendment:roster:2026-10-20','amendment-roster',{members:[]},fetched);
  assert.equal(store.memberProfiles(1),first,'unrelated source writes keep the parse');
  assert.deepEqual(store.memberProfiles(2),[],'generations are cached separately');
  store.putSource(1,'amendment:member:102','amendment-member',profile('102'),fetched);
  assert.deepEqual(store.memberProfiles(1).map(source=>source.work.id).sort(),['101','102'],'a profile write invalidates the parse');
});
