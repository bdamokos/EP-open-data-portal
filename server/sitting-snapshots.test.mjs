import test from 'node:test';
import {snapshotHttpObservation} from './sitting-snapshot-source.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {SittingSnapshotCollector,sittingSnapshotNextCheck,sittingSourcesConfirmed} from './sitting-snapshot-collector.mjs';
import {SittingSnapshotReader,SittingSnapshotHints} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTES_VERSION} from './member-votes.mjs';
import {sittingConfirmationDay,DAY} from './refresh-policy.mjs';
import {snapshotFixture,snapshotResponses,SNAPSHOT_SITTING,SNAPSHOT_NOW} from './test-support/sitting-snapshots.mjs';

function setup(t,options={}){
  let now=SNAPSHOT_NOW;const clock=()=>now;
  const directory=mkdtempSync(path.join(os.tmpdir(),'sitting-snapshots-'));
  const store=new ActivityStore(directory,{clock});assert(store.acquire());
  const fixture=snapshotFixture({clock,...options}),hints=new SittingSnapshotHints();
  const collector=new SittingSnapshotCollector(store,{hints,readChairs:async()=>null});
  const worker=new ActivityWorker(store,{clock,fetchRecord:fixture.request});
  worker.runDeadline=Infinity;worker.sittingSnapshots=collector;
  const reader=new SittingSnapshotReader({directory,clock,hints});
  t.after(()=>{reader.close();store.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,store,worker,reader,collector,hints,fixture,clock,advance:ms=>{store.release();now+=ms;assert(store.acquire());}};
}
async function drain(h){for(let i=0;i<20&&h.collector.due();i++)assert(await h.collector.step(h.worker));assert(!h.collector.due());}

test('collector discovers held current-term sittings and persists identical member-independent responses',async t=>{
  const h=setup(t);await drain(h);
  assert(h.fixture.calls.every(call=>call.options.priority==='background'));
  assert.deepEqual(h.store.db.prepare("SELECT kind,complete FROM sitting_snapshots WHERE id=? ORDER BY kind").all(SNAPSHOT_SITTING).map(row=>({...row})),[{kind:'attendance',complete:1},{kind:'votes',complete:1}]);
  const direct=await snapshotResponses({request:h.fixture.request,clock:h.clock});
  for(const language of ['en','fr','hu'])for(const week of [false,true]){
    const before=h.fixture.calls.length;
    const saved=await snapshotResponses({request:async()=>assert.fail('snapshot hit must not contact upstream'),snapshots:h.reader,clock:h.clock,language,week});
    assert.equal(h.fixture.calls.length,before);
    const expected=language==='en'&&!week?direct:await snapshotResponses({request:h.fixture.request,clock:h.clock,language,week});
    assert.deepEqual(saved,expected,'response, snapshot identity and all provenance remain unchanged');
  }
  const other=await snapshotResponses({request:async()=>assert.fail('another member must reuse disk observations'),snapshots:h.reader,clock:h.clock,member:'99'});
  assert.equal(other.attendance.sittings[0].memberStatus,'not-listed');
  assert.equal(other.votes.snapshotId,direct.votes.snapshotId);
});

test('missing, stale and version-mismatched snapshots fall back and enqueue high-priority IDs without reader writes',async t=>{
  const h=setup(t);
  await snapshotResponses({request:h.fixture.request,snapshots:h.reader,clock:h.clock});
  assert(h.hints.size>=2);assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM sitting_snapshots').get().n,0);
  await drain(h);h.advance(6*60*60_000);
  const before=h.fixture.calls.length;await snapshotResponses({request:h.fixture.request,snapshots:h.reader,clock:h.clock});
  assert(h.fixture.calls.length>before);assert(h.hints.size>=2);
  h.collector.admit();assert.equal(h.store.db.prepare("SELECT priority FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING).priority,100);
  assert.equal(h.reader.read('votes',MEMBER_VOTES_VERSION+1,SNAPSHOT_SITTING),null);
});

test('correction-window refresh, post-window confirmation and monthly old-sitting checks reuse the outcome rule',async t=>{
  const h=setup(t);await drain(h);const before=h.fixture.calls.length;
  h.advance(6*60*60_000-1);assert.equal(h.collector.due(),false);
  h.advance(1);assert(h.collector.due());await drain(h);assert(h.fixture.calls.length>before);
  const boundary=Date.parse(sittingConfirmationDay(SNAPSHOT_SITTING)+'T12:00:00Z');
  assert.equal(sittingSnapshotNextCheck(SNAPSHOT_SITTING,boundary),boundary+30*DAY);
  assert.equal(sittingSnapshotNextCheck(SNAPSHOT_SITTING,boundary-3*DAY),boundary-3*DAY+6*60*60_000);
  assert.equal(sittingSnapshotNextCheck(SNAPSHOT_SITTING,boundary,{confirmed:false}),boundary+6*60*60_000);
  assert.equal(sittingSourcesConfirmed(SNAPSHOT_SITTING,[{fetchedAt:new Date(boundary-2*DAY).toISOString()}]),false);
  assert.equal(sittingSourcesConfirmed(SNAPSHOT_SITTING,[{fetchedAt:new Date(boundary).toISOString()}]),true);
  const backoff=sittingSnapshotNextCheck(SNAPSHOT_SITTING,boundary,{complete:false,attempts:8});assert.equal(backoff,boundary+7*DAY);
});

test('partial vote pages remain partial and not-published attendance never becomes zero',async t=>{
  const h=setup(t,{partial:true,notPublished:true});await drain(h);
  assert.equal(h.store.db.prepare("SELECT complete FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING).complete,0);
  const result=await snapshotResponses({request:h.fixture.request,snapshots:h.reader,clock:h.clock});
  assert.equal(result.votes.coverage.status,'partial');assert.equal(result.votes.coverage.collectionComplete,false);
  assert.equal(result.attendance.sittings[0].status,'not-published');assert.equal(result.attendance.sittings[0].counts.present,null);assert.equal(result.attendance.sittings[0].memberStatus,null);
});

test('transient failures keep durable backoff and reader hints cannot bypass it',async t=>{
  const h=setup(t,{fail:endpoint=>{if(endpoint==='/meetings/'+SNAPSHOT_SITTING)throw Object.assign(new Error('Service unavailable'),{retryAfter:12*60*60});}});
  await drain(h);
  const row=h.store.db.prepare("SELECT * FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING);
  assert.equal(row.attempts,1);assert(row.next_check>=h.clock()+12*60*60_000);assert.match(row.error,/metadata unavailable/);
  h.reader.enqueue('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING,{changedDeclarations:true});h.collector.admit();assert.equal(h.collector.due(),false);
});

test('one-request budgets resume disk-staged pages without repeating successful upstream reads',async t=>{
  const h=setup(t);h.worker.budget=1;
  for(let i=0;i<40&&h.collector.due();i++){h.worker.requests=0;await h.collector.step(h.worker);assert(h.worker.requests<=1);}
  assert.equal(h.collector.due(),false);
  assert.equal(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING)?.day.coverage.state,'complete');
  assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM sitting_snapshot_staging').get().n,0);
  const calls=h.fixture.calls.filter(call=>call.endpoint.endsWith('/decisions'));
  assert.equal(calls.length,2,'one census and one named stream, even across run boundaries');
});

test('idle ticks use indexed metadata only and neither acquire a lease nor decode payloads',async t=>{
  const h=setup(t);await drain(h);h.store.release();
  const before=statSync(h.store.filename+'-wal').size,queries=[];
  const prepare=h.store.db.prepare.bind(h.store.db);h.store.db.prepare=sql=>{queries.push(sql);return prepare(sql);};
  h.store.acquire=()=>assert.fail('idle snapshot tick must not acquire writer lease');
  h.worker.due=()=>false;
  for(let i=0;i<50;i++)await h.worker.run();
  assert(queries.length<=150);assert(queries.every(sql=>!sql.includes('body')&&!/COUNT|SUM|json_|staging/i.test(sql)));
  assert.equal(statSync(h.store.filename+'-wal').size,before);
});

test('snapshot writes remain fenced by the activity writer lease and enforce a disk cap',async t=>{
  const h=setup(t);await drain(h);h.store.release();
  assert.throws(()=>h.collector.admit(),/lease|writer/i);
  assert(h.store.acquire());h.collector.writer.diskLimit=1;
  const job={kind:'votes',version:MEMBER_VOTES_VERSION,id:SNAPSHOT_SITTING,attempts:0};
  assert.throws(()=>h.collector.writer.retain(job,{large:'x'.repeat(500)},{complete:true,now:h.clock(),next:h.clock()+DAY}),/disk limit/);
});


test('persisted conflicting source observations retain their alternatives and cannot establish completeness',async t=>{
  const h=setup(t,{namedConflict:true});await drain(h);
  const row=h.store.db.prepare("SELECT complete,body FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING);
  assert.equal(row.complete,0);
  const saved=JSON.parse(gunzipSync(row.body));
  assert.equal(saved.day.coverage.completeness.conflictingDecisionIds.length,1);
  const direct=await snapshotResponses({request:h.fixture.request,clock:h.clock});
  const fallback=await snapshotResponses({request:h.fixture.request,clock:h.clock,snapshots:h.reader});
  assert.deepEqual(fallback,direct);assert.equal(fallback.votes.items[0].actualPosition.status,'conflicting');
});

test('collector also respects the overall activity database disk cap',async t=>{
  const h=setup(t);h.worker.diskLimit=0;
  assert.equal(await h.collector.step(h.worker),false);assert.equal(h.fixture.calls.length,0);
  const failed=h.store.db.prepare('SELECT error,next_check FROM sitting_snapshots WHERE error IS NOT NULL').get();
  assert.match(failed.error,/disk limit/);assert.equal(failed.next_check,h.clock()+60*60_000);
});


test('first-page 204 never becomes a complete empty background vote list',async t=>{
  const h=setup(t,{fail:async endpoint=>{if(endpoint.endsWith('/decisions'))await snapshotHttpObservation(new Response(null,{status:204}),'https://example.test');}});
  await drain(h);
  assert.equal(h.store.db.prepare("SELECT complete FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING).complete,0);
});

test('verified historical 404 collections retain empty coverage and resume under a one-request budget',async t=>{
  const h=setup(t,{fail:async(endpoint,params)=>{
    if(!/\/(decisions|vote-results|foreseen-activities)$/.test(endpoint))return;
    const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
    await snapshotHttpObservation(new Response('Not found',{status:404}),url,{clock:()=>SNAPSHOT_NOW});
  }});
  h.fixture.meeting.consists_of=[];h.worker.budget=1;
  for(let i=0;i<40&&h.collector.due();i++){h.worker.requests=0;await h.collector.step(h.worker);assert(h.worker.requests<=1);}
  assert.equal(h.collector.due(),false);
  const saved=h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING);
  assert.equal(saved.day.coverage.state,'complete');assert.equal(saved.day.decisions.length,0);
  assert(saved.day.sources.decisions.every(source=>source.httpStatus===404&&source.contentHash));
  assert.equal(h.fixture.calls.filter(call=>call.endpoint.endsWith('/decisions')).length,2);
});


test('reader-version upgrades never publish new projections under obsolete job keys',async t=>{
  const h=setup(t);await drain(h);
  h.collector.writer.enqueue('votes',MEMBER_VOTES_VERSION-1,SNAPSHOT_SITTING,100);
  h.collector.writer.stage({kind:'votes',version:MEMBER_VOTES_VERSION-1,id:SNAPSHOT_SITTING},'old',{old:true},h.clock());
  h.hints.enqueue('votes',MEMBER_VOTES_VERSION-1,SNAPSHOT_SITTING);
  h.store.set('sittingSnapshotDiscovery','older-reader-versions');
  assert.equal(h.collector.due(),true);h.collector.admit();
  assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshots WHERE kind='votes' AND version<>?").get(MEMBER_VOTES_VERSION).n,0);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM sitting_snapshot_staging').get().n,0);
  assert.equal(h.collector.writer.due(h.clock()).kind,'calendar');
  await drain(h);assert(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING));
});

test('changed calendar declarations reject a monthly saved day and reopen its writer job',async t=>{
  const h=setup(t);
  h.advance(Date.parse('2026-10-25T12:00:00Z')-h.clock());
  await drain(h);
  assert(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING));
  const missing='eli/dl/event/'+SNAPSHOT_SITTING+'-VOT-ITM-999';
  h.fixture.meeting.consists_of.push(missing);
  h.advance(6*60*60_000);
  // Refresh only the calendar, leaving the monthly sitting observation intact.
  assert.equal(h.collector.writer.due(h.clock()).kind,'calendar');
  await h.collector.step(h.worker);
  assert(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING));
  const result=await snapshotResponses({request:h.fixture.request,snapshots:h.reader,clock:h.clock,week:true});
  assert.equal(result.votes.coverage.status,'partial');
  assert.equal(result.votes.coverage.collectionComplete,false);
  const direct=await snapshotResponses({request:h.fixture.request,clock:h.clock,week:true});
  assert.deepEqual(result.votes,direct.votes);
  assert(JSON.stringify(result.votes).includes(missing));
  h.collector.admit();
  const job=h.collector.writer.due(h.clock());
  assert.equal(job.kind,'votes');assert.equal(job.id,SNAPSHOT_SITTING);
  assert.equal(h.store.db.prepare("SELECT priority FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING).priority,100);
});

test('near-cap retention atomically replaces old snapshot and this jobs staging',async t=>{
  const h=setup(t);await drain(h);
  const writer=h.collector.writer,job={kind:'votes',version:MEMBER_VOTES_VERSION,id:SNAPSHOT_SITTING,attempts:0};
  const options={complete:true,now:h.clock(),next:h.clock()+DAY};
  const value={probe:Array.from({length:10000},(_,i)=>'value-'+i)};
  writer.stage(job,'probe',value,h.clock());
  const before=writer.usage();
  const old=h.store.db.prepare("SELECT length(body) n FROM sitting_snapshots WHERE kind='votes' AND id=?").get(SNAPSHOT_SITTING).n;
  const staged=h.store.db.prepare('SELECT SUM(length(body)) n FROM sitting_snapshot_staging').get().n;
  const final=before-old-staged+gzipSync(JSON.stringify(value)).length;
  writer.diskLimit=Math.max(before,final);
  assert(before-old+gzipSync(JSON.stringify(value)).length>writer.diskLimit);
  writer.retain(job,value,options);
  assert.equal(writer.usage(),final);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM sitting_snapshot_staging').get().n,0);
  assert.deepEqual(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING),value);
  writer.diskLimit=Infinity;writer.stage(job,'rollback',{staged:true},h.clock());
  h.store.db.exec("CREATE TRIGGER reject_stage_clear BEFORE DELETE ON sitting_snapshot_staging BEGIN SELECT RAISE(ABORT, 'probe rollback'); END");
  assert.throws(()=>writer.retain(job,{replacement:true},options),/probe rollback/);
  assert.deepEqual(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING),value);
  assert.deepEqual(writer.staged(job,'rollback',h.clock()),{staged:true});
});

test('snapshot dispatch request shares resume staging while leaving budget for core work',async t=>{
  const h=setup(t);h.worker.budget=1000;
  for(let i=0;i<40&&h.collector.due();i++){
    const before=h.worker.requests;
    await h.collector.step(h.worker,{requestBudget:1});
    assert(h.worker.requests-before<=1);
    assert(h.worker.requests<h.worker.budget);
  }
  assert.equal(h.collector.due(),false);
  assert(h.reader.read('votes',MEMBER_VOTES_VERSION,SNAPSHOT_SITTING));
});

test('snapshot retries use shared transient and byte-confirmed permanent classification',async t=>{
  let error=Object.assign(new Error('Transport unavailable'),{status:503});
  const h=setup(t,{fail:()=>{throw error;}});
  h.collector.admit();
  h.store.db.prepare("DELETE FROM sitting_snapshots WHERE kind<>'calendar' OR id<>'2026'").run();
  h.store.db.prepare('UPDATE sitting_snapshots SET attempts=8').run();
  await h.collector.step(h.worker);
  let row=h.store.db.prepare('SELECT next_check FROM sitting_snapshots').get();
  assert.equal(row.next_check,h.clock()+DAY);
  error=Object.assign(new Error('Rejected source'),{code:'source_parser_rejection',sourceHash:'a'.repeat(64)});
  for(let i=0;i<3;i++){
    h.advance(DAY);
    await h.collector.step(h.worker);
  }
  row=h.store.db.prepare('SELECT next_check FROM sitting_snapshots').get();
  assert.equal(row.next_check,h.clock()+30*DAY);
  // A transport failure interrupts byte confirmation even for the same source.
  h.advance(30*DAY);error=new Error('Transport unavailable');
  await h.collector.step(h.worker);
  row=h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE id='2026'").get();
  assert.equal(row.next_check,h.clock()+DAY);
});
