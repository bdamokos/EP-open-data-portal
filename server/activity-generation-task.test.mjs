import {groupVoicesPage,initializeGroupVoices} from './group-voices-store.mjs';
import {groupVoicesQuery} from './group-voices-model.mjs';
import {RecordTopics} from './topics-store.mjs';
import {storyFacts} from './story-facts-reader.mjs';
import {RECORD_TOPICS_VERSION} from './record-topics.mjs';
import {STORY_FACTS_VERSION} from './story-facts-model.mjs';
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {Worker} from 'node:worker_threads';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {ActivityStore} from './activity-index-store.mjs';
import {documentRows} from './activity-index-model.mjs';
import {followingResponse} from './insights-following.mjs';
import {activityGenerationTask,topicBuildResourceLimits} from './activity-generation-task.mjs';
import {topicBuildBackoff,topicBuildWindowKey} from './topic-build-gate.mjs';
import {loopback} from './test-support/loopback.mjs';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';

const pending=new WeakMap();
beforeEach(t=>{
  registerSubprocesses(t);const tasks=[];pending.set(t,tasks);
  t.after(async()=>{for(const task of tasks)task.controller.abort();await Promise.allSettled(tasks.map(task=>task.promise));});
});
function fixture(t,options={}) {
  const directory=mkdtempSync(path.join(tmpdir(),'activity-generation-')),store=new ActivityStore(directory,options);
  assert(store.acquire());
  const endpoint='/plenary-documents/B-10-2026-0001',stamp='2026-10-28T12:00:00Z';
  const work={id:'eli/dl/doc/B-10-2026-0001',identifier:'B-10-2026-0001',work_type:'def/ep-document-types/RESOLUTION_MOTION',parliamentary_term:'org/ep-10',document_date:'2026-10-28',title_dcterms:{en:'Motion'},creator:['person/101']};
  for(let i=0;i<2;i++){const cycle=store.beginCycle();store.setMembers([{id:'101',name:'Member'}]);store.putSource(cycle.generation,endpoint,'document',work,stamp,documentRows(work,endpoint,stamp).rows);store.publish(cycle.generation);}
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,store};
}
function run(t,store,operation,options={}) {
  const controller=new AbortController(),promise=activityGenerationTask(store,operation,{...options,signal:controller.signal});
  pending.get(t).push({controller,promise});return {controller,promise};
}

test('long locked generation preparation renews only its qualified owner, without increasing the lease duration',t=>{
  let now=Date.now();const {directory,store}=fixture(t,{clock:()=>now}),other=new ActivityStore(directory,{clock:()=>now});
  other.db.exec('PRAGMA busy_timeout=0');t.after(()=>other.close());
  const prune=store.pruneGenerations.bind(store);
  store.pruneGenerations=(...args)=>{
    now+=120_000;
    assert.throws(()=>other.acquire(),/locked|busy/i,'expired wall time cannot transfer an unbroken SQLite write lock');
    prune(...args);
  };
  const cycle=store.beginCycle();assert.equal(cycle.generation,3);
  assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);
  assert.equal(other.acquire(),false);store.assertWriter();
  store.publish(cycle.generation);assert.equal(store.get('active'),3);
  assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);
  now+=91_000;assert(other.acquire());assert.throws(()=>store.beginCycle(),/lease/);
});

test('owner mismatch inside generation preparation rolls back the whole rotation',t=>{
  const {store}=fixture(t),prune=store.pruneGenerations.bind(store);
  store.pruneGenerations=(...args)=>{prune(...args);store.db.prepare("UPDATE lease SET owner='different-owner'").run();};
  assert.throws(()=>store.beginCycle(),/lease/);
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);store.assertWriter();
});

for(const fail of [false,true])test('nested publication checks keep lock qualification and clear it after '+(fail?'rollback':'commit'),t=>{
  let now=Date.now();const {store}=fixture(t,{clock:()=>now}),cycle=store.beginCycle();
  const publish=()=>store.publish(cycle.generation,()=>{now+=120_000;store.assertWriter();if(fail)throw new Error('Interrupted publication');return [];});
  if(fail){assert.throws(publish,/Interrupted publication/);assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,3);}
  else {publish();assert.equal(store.get('active'),3);assert.equal(store.get('working'),null);assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);now+=91_000;}
  assert.throws(()=>store.assertWriter(),/lease/,'expired ownership is fenced outside the qualified write transaction');
  store.readSnapshot(()=>assert.throws(()=>store.assertWriter(),/lease/,'a read transaction cannot reuse the old write qualification'));
});

for(const view of ['following-manifest','following-member'])test(view+' pins a populated previous generation while the writer prunes it',t=>{
  const {directory,store}=fixture(t),writer=new ActivityStore(directory);store.release();assert(writer.acquire());t.after(()=>writer.close());
  const search=new URLSearchParams({epoch:store.get('marksEpoch'),generation:'1',...(view==='following-member'?{member:'101',lang:'en'}:{})});
  const expected=followingResponse(store,view,search);assert.equal(expected.status,200);
  if(view==='following-manifest')assert(Object.hasOwn(expected.body.members,'101'));else assert(expected.body.ids.length>0);
  const prepare=store.db.prepare.bind(store.db);let pruned=false;
  store.db.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.startsWith(view==='following-manifest'?'SELECT * FROM follow_summary':'SELECT 1 FROM follow_summary')) {
      const method=view==='following-manifest'?'all':'get',read=statement[method].bind(statement);
      statement[method]=(...args)=>{if(!pruned&&args[0]===1){pruned=true;writer.beginCycle();}return read(...args);};
    }
    return statement;
  };
  try {assert.deepEqual(followingResponse(store,view,search),expected);assert(pruned);assert.equal(writer.get('previous'),null);assert.equal(followingResponse(store,view,search).status,409);}
  finally {store.db.prepare=prepare;}
});

test('off-thread preparation and publication preserve frozen snapshots and reject a stale caller',async t=>{
  const {directory,store}=fixture(t),epoch=store.get('marksEpoch');
  const cycle=await run(t,store,'begin').promise;
  assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,cycle.generation);assert.equal(store.get('marksEpoch'),epoch);
  assert.equal(store.db.prepare('SELECT generation FROM follow_generations WHERE generation=2').get().generation,2);
  await run(t,store,'publish',{generation:cycle.generation}).promise;
  assert.equal(store.get('active'),3);assert.equal(store.get('previous'),2);assert.equal(store.get('working'),null);assert.equal(store.get('marksEpoch'),epoch);
  assert.deepEqual(store.db.prepare('SELECT generation FROM follow_generations ORDER BY generation').all().map(row=>row.generation),[2,3]);
  const other=new ActivityStore(directory);t.after(()=>other.close());
  store.release();assert(other.acquire());
  await assert.rejects(run(t,store,'begin').promise,/lease/);
  assert.equal(store.get('sequence'),3);
});

test('a failure in off-thread publication leaves the accepted generation and working cursor intact',async t=>{
  const {store}=fixture(t),cycle=await run(t,store,'begin').promise;
  store.enqueue(cycle.generation,'saved','document',{endpoint:'/plenary-documents/B-10-2026-0001',offset:750},101);
  await assert.rejects(run(t,store,'publish',{generation:cycle.generation}).promise,/incomplete/);
  assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,3);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM tasks WHERE generation=3 AND key='saved'").get().body).offset,750);store.assertWriter();
});

test('lease takeover after dispatch still fences the preparation thread and preserves the new owner',async t=>{
  const {directory,store}=fixture(t),other=new ActivityStore(directory);t.after(()=>other.close());
  const createWorker=(url,options)=>{store.release();assert(other.acquire());return new Worker(url,options);};
  await assert.rejects(run(t,store,'begin',{createWorker}).promise,/lease/);
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);
  assert.equal(store.db.prepare('SELECT owner FROM lease').get().owner,other.owner);other.assertWriter();
});

for(const operation of ['begin','publish'])test(operation+' renews a live logical lease after delayed commit/exit before returning to preparation',async t=>{
  let now=Date.now();const {store}=fixture(t,{clock:()=>now});
  const generation=operation==='publish'?store.beginCycle().generation:undefined;
  const createWorker=(_url,{workerData})=>{
    const thread=new EventEmitter();thread.terminate=async()=>0;
    queueMicrotask(()=>{
      const value=workerData.operation==='topics'?null:operation==='begin'?store.beginCycle():store.finalize(generation);
      now+=55_000;
      thread.emit('message',{type:'complete',value});thread.emit('exit',0);
    });return thread;
  };
  await run(t,store,operation,{generation,createWorker}).promise;
  assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);
  now+=45_000;store.assertWriter();
});

for(const replaced of [false,true])test('completed helper cannot revive an '+(replaced?'expired and replaced':'expired')+' lease',async t=>{
  let now=Date.now();const {directory,store}=fixture(t,{clock:()=>now}),other=new ActivityStore(directory,{clock:()=>now});t.after(()=>other.close());
  let owner;
  const createWorker=()=>{
    const thread=new EventEmitter();thread.terminate=async()=>0;
    queueMicrotask(()=>{
      const value=store.beginCycle();now+=91_000;
      if(replaced)assert(other.acquire());
      owner=store.db.prepare('SELECT * FROM lease').get();
      thread.emit('message',{type:'complete',value});thread.emit('exit',0);
    });return thread;
  };
  await assert.rejects(run(t,store,'begin',{createWorker}).promise,/lease/);
  assert.deepEqual(store.db.prepare('SELECT * FROM lease').get(),owner);
  assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,3);
  assert.equal(store.generationTaskActive,false);
});

test('HTTP starts and stays responsive while generation rotation holds the writer lock; shutdown rolls it back',loopback,async t=>{
  const {directory,store}=fixture(t);store.release();
  const preload=path.join(directory,'delay.mjs');
  writeFileSync(preload,`import {isMainThread} from 'node:worker_threads';
    import {ActivityStore} from ${JSON.stringify(new URL('./activity-index-store.mjs',import.meta.url).href)};
    if(isMainThread){const original=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>original(fn,ms===20000?25:ms,...args);}
    else {const prune=ActivityStore.prototype.pruneGenerations;ActivityStore.prototype.pruneGenerations=function(...args){console.log('GENERATION_LOCK_HELD');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);return prune.apply(this,args);};}`);
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const execution=execFileAsync(t,process.execPath,['--import',preload,new URL('./index.mjs',import.meta.url).pathname],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ACTIVITY_INDEX_DIR:directory,ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_RECOVERY_MODE:'backfill',CORPUS_ENABLED:'false',ODP_CACHE_DIR:'',EXPLORER_SERVE_STATIC:'false'}});
  const child=execution.child;let output='';
  const locked=new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('GENERATION_LOCK_HELD'))resolve();});
    child.once('exit',()=>reject(new Error('Server exited before preparation: '+output)));
  });
  const finished=execution.then(value=>({value}),error=>({error}));
  await locked;assert.match(output,/listening on/);
  await delay(100); // Several real heartbeat ticks occur while SQLite is locked.
  const health=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1500)});assert.equal(health.status,200);
  const response=await fetch(`http://127.0.0.1:${port}/api/activity-index/status`,{signal:AbortSignal.timeout(1500)});assert.equal(response.status,200);
  const status=await response.json();assert.equal(status.servingGeneration,2);assert.equal(store.get('active'),2);assert.equal(store.get('working'),null);
  child.kill('SIGTERM');const result=await finished;if(result.error)assert.equal(result.error.signal,'SIGTERM');
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);
  assert(store.acquire(),'the preparation thread exited before the logical lease was released');
});

test('publication exits before a memory-bounded topics follow-up under the same logical writer',async t=>{
 const {store}=fixture(t),cycle=store.beginCycle(),steps=[];
 const createWorker=(_url,options)=>{
  const thread=new EventEmitter(),step=options.workerData.operation;thread.terminate=async()=>0;steps.push(step);store.assertWriter();assert(store.generationTaskActive);
  if(step==='publish')assert.equal(options.resourceLimits,undefined,'core publication retains its existing memory policy');
  else {assert.equal(store.get('active'),cycle.generation);assert.equal(store.get('working'),null);assert.deepEqual(options.resourceLimits,topicBuildResourceLimits());}
  queueMicrotask(()=>{if(step==='publish')store.finalize(cycle.generation);thread.emit('message',{type:'complete',value:step});thread.emit('exit',0);});return thread;
 };
 assert.equal(await run(t,store,'publish',{generation:cycle.generation,createWorker,rebuildWindow:'00:00-24:00'}).promise,'topics');assert.deepEqual(steps,['publish','topics']);store.assertWriter();assert.equal(store.generationTaskActive,false);
});


test('daytime publication defers graph work while retaining dirty input state',async t=>{
 const {store}=fixture(t);readableProjection(store);const cycle=store.beginCycle();store.clock=()=>Date.parse('2026-11-02T11:00:00Z');store.acquire();const steps=[];const createWorker=(_url,options)=>{const thread=new EventEmitter();steps.push(options.workerData.operation);queueMicrotask(()=>{store.finalize(cycle.generation);thread.emit('message',{type:'complete',value:'published'});thread.emit('exit',0);});return thread;};
 assert.equal(await run(t,store,'publish',{generation:cycle.generation,createWorker}).promise,'published');assert.deepEqual(steps,['publish']);assert(store.get('topicProjectionDirty'));assert.deepEqual(await run(t,store,'topics',{generation:cycle.generation,createWorker:()=>assert.fail('daytime graph worker started')}).promise,{deferred:true,generation:cycle.generation});store.assertWriter();
});

for(const operation of ['topics','stories','publish'])test(operation+' refresh started inside the window completes after it closes',async t=>{
 const {store}=fixture(t);let now=Date.parse('2026-11-02T03:59:59.999Z');store.clock=()=>now;store.acquire();readableProjection(store);const generation=operation==='publish'?store.beginCycle().generation:store.get('active'),steps=[];let terminated=false;const createWorker=(_url,options)=>{const thread=new EventEmitter(),step=options.workerData.operation;steps.push(step);thread.terminate=async()=>{terminated=true;thread.emit('exit',1);};if(step==='publish')queueMicrotask(()=>{store.finalize(generation);thread.emit('message',{type:'complete',value:'published'});thread.emit('exit',0);});else setTimeout(()=>{now+=50;thread.emit('message',{type:'complete',value:'built'});thread.emit('exit',0);},25);return thread;};
 assert.equal(await run(t,store,operation,{generation,createWorker}).promise,'built');assert.equal(terminated,false);assert.deepEqual(steps,operation==='publish'?['publish','topics']:[operation]);store.assertWriter();assert.equal(store.generationTaskActive,false);
});


test('core publication finishing after the window does not start its graph follow-up',async t=>{
 const {store}=fixture(t);let now=Date.parse('2026-11-02T03:59:59Z');store.clock=()=>now;store.acquire();readableProjection(store);const cycle=store.beginCycle(),steps=[];const createWorker=(_url,options)=>{const thread=new EventEmitter();steps.push(options.workerData.operation);queueMicrotask(()=>{store.finalize(cycle.generation);now+=2000;thread.emit('message',{type:'complete',value:'published'});thread.emit('exit',0);});return thread;};assert.equal(await run(t,store,'publish',{generation:cycle.generation,createWorker}).promise,'published');assert.deepEqual(steps,['publish']);assert(store.get('topicProjectionDirty'));
});


function readableProjection(store){const generation=store.get('active');store.set('recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation,dataGeneration:1000000001,askerSubsets:['all','home','elsewhere','not-home']});store.set('storyProjection',{version:STORY_FACTS_VERSION,generation,dataGeneration:1000000001});}
for(const mode of ['missing','record-version','story-version'])test('daytime '+mode+' bootstrap starts immediately with bounded worker memory',async t=>{
 const {store}=fixture(t);readableProjection(store);if(mode==='missing'){store.set('recordTopicProjection',null);store.set('storyProjection',null);}else if(mode==='record-version')store.set('recordTopicProjection',{...store.get('recordTopicProjection'),version:RECORD_TOPICS_VERSION-1});else store.set('storyProjection',{...store.get('storyProjection'),version:7});store.clock=()=>Date.parse('2026-11-02T11:00Z');store.acquire();let starts=0;const createWorker=(_url,options)=>{starts++;assert.deepEqual(options.resourceLimits,topicBuildResourceLimits());const thread=new EventEmitter();queueMicrotask(()=>{thread.emit('message',{type:'complete',value:'built'});thread.emit('exit',0);});return thread;};assert.equal(await run(t,store,'topics',{generation:store.get('active'),createWorker}).promise,'built');assert.equal(starts,1);store.assertWriter();
});
for(const operation of ['topics','stories','publish'])test(operation+' bootstrap is not terminated when the nightly window closes',async t=>{
 const {store}=fixture(t);let now=Date.parse('2026-11-02T03:59:59.999Z');store.clock=()=>now;store.acquire();const generation=operation==='publish'?store.beginCycle().generation:store.get('active'),steps=[];let terminated=false;const createWorker=(_url,options)=>{const thread=new EventEmitter(),step=options.workerData.operation;steps.push(step);thread.terminate=async()=>{terminated=true;thread.emit('exit',1);};if(step==='publish')queueMicrotask(()=>{store.finalize(generation);now+=2;thread.emit('message',{type:'complete',value:'published'});thread.emit('exit',0);});else setTimeout(()=>{now+=50;thread.emit('message',{type:'complete',value:'built'});thread.emit('exit',0);},25);return thread;};assert.equal(await run(t,store,operation,{generation,createWorker}).promise,'built');assert.equal(terminated,false);assert.deepEqual(steps,operation==='publish'?['publish','topics']:[operation]);store.assertWriter();
});


test('a real background bootstrap publishes readable topics and stories outside the window',async t=>{
 const {store}=fixture(t),parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(Date.now()),minute=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value),format=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'),start=(minute+10)%1440,end=(minute+11)%1440,rebuildWindow=format(start)+'-'+format(end);
 initializeGroupVoices({store,clock:Date.now},store.get('active'),[]);store.setMembers([{id:'101',name:'Member',countryCode:'CY'}]);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(store.get('active'),'/questions/E-10-2026-000001','E-10-2026-000001','101','written-questions','2026-10-28',JSON.stringify({titles:{en:'Greece'}}));
 const createWorker=(url,options)=>new Worker(url,{...options,env:{...process.env,ODP_CACHE_DIR:''}});await run(t,store,'topics',{generation:store.get('active'),rebuildWindow,createWorker}).promise;
 assert.equal(new RecordTopics(store).query(new URLSearchParams(),'overview').ready,true);assert.equal(new RecordTopics(store).query(new URLSearchParams('ids=B-10-2026-0001')).ready,true);assert.equal(storyFacts(store,new URLSearchParams('scope=map&askers=not-home')).ready,true);assert.equal(new RecordTopics(store).query(new URLSearchParams('role=place&askers=not-home'),'overview').items[0].id,'GRC');assert.equal(storyFacts(store,new URLSearchParams('scope=place&key=GRC&askers=not-home')).counts.questions,1);assert(groupVoicesPage(store,groupVoicesQuery(new URLSearchParams('group=PPE'))).ready);assert.equal(store.get('topicProjectionDirty'),false);store.assertWriter();
});


test('explicit refresh cancellation still waits for worker exit and logs one cancelled build',async t=>{
 const {store}=fixture(t);store.clock=()=>Date.parse('2026-11-02T03:59:59Z');store.acquire();readableProjection(store);const logs=[];t.mock.method(console,'info',(...args)=>logs.push(args));let terminated=false,exit;const createWorker=()=>{const thread=new EventEmitter();exit=()=>thread.emit('exit',1);thread.terminate=async()=>{terminated=true;};return thread;},task=run(t,store,'topics',{generation:store.get('active'),createWorker});
 task.controller.abort(new Error('service shutdown'));assert(terminated);assert(store.generationTaskActive);store.assertWriter();assert.equal(logs.length,0);exit();await assert.rejects(task.promise,/service shutdown/);assert.equal(store.generationTaskActive,false);store.assertWriter();assert.equal(logs.length,1);assert.equal(logs[0][0],'[topics-build]');assert.equal(JSON.parse(logs[0][1]).outcome,'cancelled');
});

const completing=(value='built',{fail}={})=>(_url,options)=>{const thread=new EventEmitter();thread.terminate=async()=>0;queueMicrotask(()=>{if(fail)thread.emit('message',{type:'failed',error:fail,peakHeapMiB:12.5});else thread.emit('message',{type:'complete',value,peakHeapMiB:12.5});thread.emit('exit',0);});return thread;};
test('a failed build backs off from 15 minutes, doubling to a day, without stopping the writer',async t=>{
 const {store}=fixture(t);let now=Date.parse('2026-11-02T11:00:00Z');store.clock=()=>now;store.acquire();const logs=[];t.mock.method(console,'info',(...args)=>logs.push(JSON.parse(args[1])));let starts=0;const failing=(...args)=>{starts++;return completing('built',{fail:'Worker heap exhausted'})(...args);};
 assert.deepEqual(await run(t,store,'topics',{generation:store.get('active'),createWorker:failing}).promise,{failed:true,generation:store.get('active')});store.assertWriter();assert.equal(store.generationTaskActive,false);
 let state=store.get('topicBuildState');assert.equal(state.failures,1);assert.equal(state.error,'Worker heap exhausted');assert.equal(state.retryAt,now+15*60_000);assert(store.get('topicProjectionDirty'));
 assert.equal(logs.at(-1).outcome,'failed');assert.equal(logs.at(-1).failures,1);assert.equal(logs.at(-1).peakHeapMiB,12.5);assert.equal(logs.at(-1).heapLimitMiB,topicBuildResourceLimits().maxOldGenerationSizeMb);
 now+=15*60_000-1;store.acquire();assert.deepEqual(await run(t,store,'topics',{generation:store.get('active'),createWorker:failing}).promise,{deferred:true,generation:store.get('active')});assert.equal(starts,1);
 now+=1;store.acquire();await run(t,store,'topics',{generation:store.get('active'),createWorker:failing}).promise;assert.equal(starts,2);state=store.get('topicBuildState');assert.equal(state.failures,2);assert.equal(state.retryAt,now+30*60_000);
 assert.deepEqual([1,2,3,7,8,30].map(topicBuildBackoff),[15,30,60,960,1440,1440].map(m=>m*60_000));
 now=state.retryAt;store.acquire();assert.equal(await run(t,store,'topics',{generation:store.get('active'),createWorker:completing()}).promise,'built');assert.equal(store.get('topicBuildState'),null,'a bootstrap success clears the failure record');
});
test('a failed topics follow-up keeps the published core generation',async t=>{
 const {store}=fixture(t),cycle=store.beginCycle();store.clock=()=>Date.parse('2026-11-02T03:30:00Z');store.acquire();t.mock.method(console,'info',()=>{});
 const createWorker=(_url,options)=>{const thread=new EventEmitter();thread.terminate=async()=>0;queueMicrotask(()=>{if(options.workerData.operation==='publish'){store.finalize(cycle.generation);thread.emit('message',{type:'complete',value:'published'});}else thread.emit('message',{type:'failed',error:'graph failed'});thread.emit('exit',0);});return thread;};
 assert.equal(await run(t,store,'publish',{generation:cycle.generation,createWorker}).promise,'published');assert.equal(store.get('active'),cycle.generation);assert.equal(store.get('topicBuildState').failures,1);store.assertWriter();
});
test('a refresh starts at most once per window; bootstraps are not window-limited',async t=>{
 const {store}=fixture(t);let now=Date.parse('2026-11-02T02:10:00Z');store.clock=()=>now;store.acquire();readableProjection(store);t.mock.method(console,'info',()=>{});let starts=0;const createWorker=(...args)=>{starts++;return completing()(...args);};
 assert.equal(topicBuildWindowKey(now,'23:00-01:00'),'2026-11-01');assert.equal(topicBuildWindowKey(Date.parse('2026-11-01T22:30:00Z'),'23:00-01:00'),'2026-11-01');
 assert.equal(await run(t,store,'topics',{generation:store.get('active'),createWorker}).promise,'built');now+=30*60_000;store.acquire();
 assert.deepEqual(await run(t,store,'topics',{generation:store.get('active'),createWorker}).promise,{deferred:true,generation:store.get('active')});assert.equal(starts,1);assert(store.get('topicProjectionDirty'));
 store.set('storyProjection',null);assert.equal(await run(t,store,'stories',{generation:store.get('active'),createWorker}).promise,'built');assert.equal(starts,2,'a missing projection still bootstraps');readableProjection(store);
 now+=86400_000;store.acquire();assert.equal(await run(t,store,'topics',{generation:store.get('active'),createWorker}).promise,'built');assert.equal(starts,3);
});
test('a build that would exceed the index disk limit is skipped with backoff',async t=>{
 const {store}=fixture(t);store.clock=()=>Date.parse('2026-11-02T11:00:00Z');store.acquire();const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));store.set('topicProjectionSize',{bytes:64*1024**2});
 assert.deepEqual(await run(t,store,'topics',{generation:store.get('active'),diskLimit:32*1024**2,createWorker:()=>assert.fail('build started')}).promise,{skipped:true,generation:store.get('active')});
 const state=store.get('topicBuildState');assert.equal(state.skipped,true);assert.equal(state.failures,1);assert.match(state.error,/disk limit/);assert.equal(warnings[0][0],'[topics-build]');assert.equal(JSON.parse(warnings[0][1]).reason,'disk-limit');store.assertWriter();
 store.set('topicBuildState',null);t.mock.method(console,'info',()=>{});assert.equal(await run(t,store,'topics',{generation:store.get('active'),diskLimit:8*1024**3,createWorker:completing()}).promise,'built');
});
