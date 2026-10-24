import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ActivityStore} from './activity-index-store.mjs';
import {amendmentLinkIndexVersion} from './amendments-store.mjs';
import {prepareStartupIndexes} from './migrate-indexes.mjs';

function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'startup-indexes-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new ActivityStore(directory);assert(store.acquire());
  store.db.exec('DROP INDEX amendment_link_invalidation');store.set('amendmentLinkIndexVersion',null);
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
  const ready=new ActivityStore(directory);assert.equal(ready.get('amendmentLinkIndexVersion'),amendmentLinkIndexVersion);ready.close();
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
});
