import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {contractDigest} from './api-contract.mjs';
import {API_VERSION} from '../server/api-version.mjs';

test('the staged runtime carries the contract digest of its own sources',async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const parent=await mkdtemp(path.join(tmpdir(),'ep-stage-runtime-'));
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const destination=path.join(parent,'server');
  execFileSync(process.execPath,[path.join(root,'scripts/stage-runtime.mjs'),destination],{timeout:30_000,stdio:'pipe'});
  const stamp=JSON.parse(await readFile(path.join(destination,'api-contract.json'),'utf8'));
  assert.deepEqual(Object.keys(stamp),['digest']);
  assert.equal(stamp.digest,contractDigest(root).digest);
  assert.equal(stamp.digest.slice(0,12),API_VERSION);
});
