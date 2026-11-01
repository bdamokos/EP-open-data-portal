import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SITTING_SNAPSHOT_SCHEMA} from './sitting-snapshot-store.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {amendmentLinkIndexVersion} from './amendments-store.mjs';
import {activityAvailabilityIndexVersion} from './availability-evidence.mjs';
import {prepareStartupIndexes} from './migrate-indexes.mjs';

function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'startup-indexes-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new ActivityStore(directory);assert(store.acquire());
  store.db.exec('DROP INDEX amendment_link_invalidation');store.set('amendmentLinkIndexVersion',null);
  store.db.exec('DROP INDEX activity_role_frontier');store.set('activityAvailabilityIndexVersion',null);
  store.db.exec('DROP INDEX activity_member_roles');
  store.db.exec('DROP TABLE sitting_snapshots; DROP TABLE sitting_snapshot_staging');store.set('sittingSnapshotSchema',null);
  return {directory,store};
}
function environment(t,directory) {
  for(const [key,value] of Object.entries({ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_DIR:directory,CORPUS_ENABLED:'false'})){
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
  }
}
test('startup prepares enabled data before service construction and skips disabled directories',t=>{
  const {directory,store}=fixture(t);store.release();store.close();environment(t,directory);
  t.mock.method(console,'log',()=>{});
  assert.equal(prepareStartupIndexes()[0].noop,false);
  const ready=new ActivityStore(directory);assert.equal(ready.get('sittingSnapshotSchema'),SITTING_SNAPSHOT_SCHEMA);assert(ready.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sitting_snapshots'").get());assert.equal(ready.get('amendmentLinkIndexVersion'),amendmentLinkIndexVersion);assert.equal(ready.get('activityAvailabilityIndexVersion'),activityAvailabilityIndexVersion);ready.close();
  assert.equal(prepareStartupIndexes()[0].noop,true);
  process.env.ACTIVITY_INDEX_ENABLED='false';assert.deepEqual(prepareStartupIndexes(),[]);
});
test('entry point prepares a mounted legacy index before opening HTTP',async t=>{
  const {directory,store}=fixture(t);store.release();store.close();
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(32000+Math.floor(Math.random()*20000)),HOST:'127.0.0.1',ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_DIR:directory,CORPUS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit',{signal:AbortSignal.timeout(10000)});
  t.after(()=>child.kill('SIGKILL'));
  let output='',stopping=false;for(const stream of [child.stdout,child.stderr])stream.setEncoding('utf8').on('data',chunk=>{output+=chunk;if(!stopping&&output.includes('listening on')){stopping=true;child.kill('SIGTERM');}});
  const [code]=await exited;
  assert.equal(code,0,output);
  assert.match(output,/amendment_link_invalidation/);assert.match(output,/listening on/);
  assert.match(output,/activity_role_frontier/);
  assert.match(output,/activity_member_roles/);
  assert(output.indexOf('activity_member_roles')<output.indexOf('listening on'));
  assert(output.indexOf('activity_role_frontier')<output.indexOf('listening on'));
  assert(output.indexOf('amendment_link_invalidation')<output.indexOf('listening on'));
  const ready=new ActivityStore(directory);assert.equal(ready.get('amendmentLinkIndexVersion'),amendmentLinkIndexVersion);ready.close();
});
test('entry point exits before listening when another writer holds the mounted data',async t=>{
  const {directory,store}=fixture(t);t.after(()=>store.close());
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_DIR:directory,CORPUS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGKILL'));
  let output='';for(const stream of [child.stdout,child.stderr])stream.setEncoding('utf8').on('data',chunk=>{output+=chunk;});
  const [code]=await once(child,'exit',{signal:AbortSignal.timeout(10000)});
  assert.equal(code,1);assert.match(output,/writer lease is active/);assert.doesNotMatch(output,/listening on/);
  assert.equal(store.get('amendmentLinkIndexVersion'),null);
  assert.equal(store.get('activityAvailabilityIndexVersion'),null);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='activity_role_frontier'").get(),undefined);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='activity_member_roles'").get(),undefined);
});

test('startup upgrades the frontier-only version without rebuilding its existing index',t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'startup-member-index-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new ActivityStore(directory);assert(store.acquire());
  const root=store.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='activity_role_frontier'").get().rootpage;
  store.db.exec('DROP INDEX activity_member_roles');store.set('activityAvailabilityIndexVersion',1);
  store.release();store.close();environment(t,directory);t.mock.method(console,'log',()=>{});
  assert.equal(prepareStartupIndexes()[0].noop,false);
  const ready=new ActivityStore(directory);
  assert.equal(ready.get('activityAvailabilityIndexVersion'),activityAvailabilityIndexVersion);
  assert.equal(ready.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='activity_role_frontier'").get().rootpage,root);
  assert(ready.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='activity_member_roles'").get());
  ready.close();assert.equal(prepareStartupIndexes()[0].noop,true);
});
