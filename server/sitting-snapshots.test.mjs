import test from 'node:test';
import {snapshotHttpObservation} from './sitting-snapshot-source.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {SittingSnapshotCollector,sittingSnapshotNextCheck,sittingSourcesConfirmed,pastSittingRecheckDelay} from './sitting-snapshot-collector.mjs';
import {SittingSnapshotReader,SittingSnapshotHints} from './sitting-snapshot-store.mjs';
import {decisionVotes} from './decision-votes.mjs';
import {MemberVotes,memberVotesQuery,MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
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
  assert.deepEqual(h.store.db.prepare("SELECT kind,complete FROM sitting_snapshots WHERE id=? ORDER BY kind").all(SNAPSHOT_SITTING).map(row=>({...row})),[{kind:'agenda',complete:1},{kind:'attendance',complete:1},{kind:'votes',complete:1}]);
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
  assert.equal(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION+1,SNAPSHOT_SITTING),null);
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
  h.reader.enqueue('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING,{changedDeclarations:true});h.collector.admit();assert.equal(h.collector.due(),false);
});

test('one-request budgets resume disk-staged pages without repeating successful upstream reads',async t=>{
  const h=setup(t);h.worker.budget=1;
  for(let i=0;i<40&&h.collector.due();i++){h.worker.requests=0;await h.collector.step(h.worker);assert(h.worker.requests<=1);}
  assert.equal(h.collector.due(),false);
  assert.equal(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING)?.day.coverage.state,'complete');
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
  // Snapshot probes plus active/working projection-readiness probes stay bounded.
  assert(queries.length<=450);assert(queries.every(sql=>!sql.includes('body')&&!/COUNT|SUM|json_|staging/i.test(sql)));
  assert.equal(statSync(h.store.filename+'-wal').size,before);
});

test('snapshot writes remain fenced by the activity writer lease and enforce a disk cap',async t=>{
  const h=setup(t);await drain(h);h.store.release();
  assert.throws(()=>h.collector.admit(),/lease|writer/i);
  assert(h.store.acquire());h.collector.writer.diskLimit=1;
  const job={kind:'votes',version:MEMBER_VOTE_SNAPSHOT_VERSION,id:SNAPSHOT_SITTING,attempts:0};
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
  const saved=h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING);
  assert.equal(saved.day.coverage.state,'complete');assert.equal(saved.day.decisions.length,0);
  assert(saved.day.sources.decisions.every(source=>source.httpStatus===404&&source.contentHash));
  assert.equal(h.fixture.calls.filter(call=>call.endpoint.endsWith('/decisions')).length,2);
});


test('reader-version upgrades never publish new projections under obsolete job keys',async t=>{
  const h=setup(t);await drain(h);
  h.collector.writer.enqueue('votes',MEMBER_VOTE_SNAPSHOT_VERSION-1,SNAPSHOT_SITTING,100);
  h.collector.writer.stage({kind:'votes',version:MEMBER_VOTE_SNAPSHOT_VERSION-1,id:SNAPSHOT_SITTING},'old',{old:true},h.clock());
  h.hints.enqueue('votes',MEMBER_VOTE_SNAPSHOT_VERSION-1,SNAPSHOT_SITTING);
  h.store.set('sittingSnapshotDiscovery','older-reader-versions');
  assert.equal(h.collector.due(),true);h.collector.admit();
  assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshots WHERE kind='votes' AND version<>?").get(MEMBER_VOTE_SNAPSHOT_VERSION).n,0);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) n FROM sitting_snapshot_staging').get().n,0);
  assert.equal(h.collector.writer.due(h.clock()).kind,'calendar');
  await drain(h);assert(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING));
});

test('changed calendar declarations reject a monthly saved day and reopen its writer job',async t=>{
  const h=setup(t);
  h.advance(Date.parse('2026-10-25T12:00:00Z')-h.clock());
  await drain(h);
  assert(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING));
  const missing='eli/dl/event/'+SNAPSHOT_SITTING+'-VOT-ITM-999';
  h.fixture.meeting.consists_of.push(missing);
  h.advance(6*60*60_000);
  // Refresh only the calendar, leaving the monthly sitting observation intact.
  assert.equal(h.collector.writer.due(h.clock()).kind,'calendar');
  await h.collector.step(h.worker);
  assert(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING));
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
  const writer=h.collector.writer,job={kind:'votes',version:MEMBER_VOTE_SNAPSHOT_VERSION,id:SNAPSHOT_SITTING,attempts:0};
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
  assert.deepEqual(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING),value);
  writer.diskLimit=Infinity;writer.stage(job,'rollback',{staged:true},h.clock());
  h.store.db.exec("CREATE TRIGGER reject_stage_clear BEFORE DELETE ON sitting_snapshot_staging BEGIN SELECT RAISE(ABORT, 'probe rollback'); END");
  assert.throws(()=>writer.retain(job,{replacement:true},options),/probe rollback/);
  assert.deepEqual(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING),value);
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
  assert(h.reader.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,SNAPSHOT_SITTING));
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


test('cold decision reconstruction prefers verified persisted sitting and week observations',async t=>{
  const h=setup(t);await drain(h);
  const reader=()=>new MemberVotes({request:async()=>assert.fail('verified disk reconstruction must not fetch upstream'),snapshots:h.reader,clock:h.clock,readChairs:async()=>null});
  for(const selection of [{sitting:SNAPSHOT_SITTING},{week:'2026-10-05'}]){
    const original=await reader().snapshot(memberVotesQuery(new URLSearchParams(selection),{now:h.clock()}));
    const decision=original.days[0].decisions[0].activity_id;
    const query={sitting:SNAPSHOT_SITTING,decision,language:'en',snapshot:original.id};
    const result=await decisionVotes(query,{reader:reader()});
    assert.equal(result.snapshotId,original.id);
    assert.equal(result.decisionId,decision);
    assert.notEqual(result.status,'unavailable');
    await assert.rejects(decisionVotes({...query,snapshot:'f'.repeat(64)},{reader:reader()}),error=>error.status===409);
  }
});


test('latest member votes resolve entirely from persisted calendar and sitting snapshots',async t=>{
  const h=setup(t);await drain(h);
  const votes=new MemberVotes({request:()=>assert.fail('saved latest week must not read upstream'),clock:h.clock,snapshots:h.reader,readChairs:()=>assert.fail('saved chairing must not be collected')});
  const query=memberVotesQuery(new URLSearchParams('week=latest'),{now:h.clock()});
  const result=await votes.query('23868',query);
  assert.equal(result.period.week,'2026-10-05');
  assert.equal(result.coverage.collectionComplete,true);
  assert.deepEqual(result.coverage.scannedSittingIds,[SNAPSHOT_SITTING]);
});

test('agenda pages and exact debate links resume after restart and serve readers without upstream',async t=>{
  const h=setup(t);h.collector.admit();
  h.store.db.prepare('UPDATE sitting_snapshots SET next_check=?').run(Number.MAX_SAFE_INTEGER);
  const id=SNAPSHOT_SITTING,debate=id+'-PVCRE-ITM-9',speech=id+'-OTH-9';
  h.collector.discoverSittings([{activity_id:id,consists_of:['eli/dl/event/'+debate]}]);
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=0 WHERE kind='agenda'").run();
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=? WHERE kind='debate'").run(Number.MAX_SAFE_INTEGER);
  const calls=[];
  h.worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params]);
    const data=endpoint.startsWith('/events/')?[{id:'eli/dl/event/'+debate,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_date:id.slice(7),consists_of:['eli/dl/event/'+speech],executed:[]}]:Array.from({length:params.offset===0?50:1},(_,i)=>({id:'eli/dl/event/'+id+'-OJ-ITM-'+(params.offset+i)}));
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data}};
  };
  assert.equal(await h.collector.step(h.worker,{requestBudget:1}),false);
  assert.equal(calls.length,1);
  h.advance(2*60*60_000);
  const resumed=new SittingSnapshotCollector(h.store,{hints:h.hints,readCached:async()=>null});
  assert.equal(await resumed.step(h.worker,{requestBudget:1}),true);
  assert.equal(calls.length,2);assert.equal(calls[1][1].offset,50);
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=0 WHERE kind='debate'").run();
  assert.equal(await resumed.step(h.worker,{requestBudget:1}),true);
  const before=calls.length;
  const {LegislationInsights}=await import('./insights-legislation.mjs');
  const {cachedEvent}=await import('./insights-participation.mjs');
  const reader=new LegislationInsights(h.store,{snapshots:h.reader,request:()=>assert.fail('retained agenda must not fetch')});
  assert.equal((await reader.record('/meetings/'+id+'/foreseen-activities',{limit:50,offset:50})).payload.data.length,1);
  assert.equal((await cachedEvent(debate,undefined,h.reader)).payload.data[0].consists_of[0],'eli/dl/event/'+speech);
  assert.equal(calls.length,before);
  assert.equal(h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='agenda'").get().next_check,Number.MAX_SAFE_INTEGER);
});

test('collector adopts held raw agenda pages without downloading them again',async t=>{
  const h=setup(t);h.collector.admit();
  h.store.db.prepare('UPDATE sitting_snapshots SET next_check=?').run(Number.MAX_SAFE_INTEGER);
  h.collector.writer.enqueue('agenda',1,SNAPSHOT_SITTING);
  const retained={url:'https://data.europarl.europa.eu/api/v2/meetings/'+SNAPSHOT_SITTING+'/foreseen-activities?limit=50&offset=0',fetchedAt:SNAPSHOT_NOW,payload:{data:[]}};
  const collector=new SittingSnapshotCollector(h.store,{hints:h.hints,readCached:async()=>retained});
  h.worker.fetchRecord=()=>assert.fail('held data must not be downloaded again');
  assert(await collector.step(h.worker));
  assert.equal(h.worker.requests,0);
  assert.deepEqual(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages[0].payload.data,[]);
});

test('a failed later agenda page preserves earlier pages through retry backoff',async t=>{
  const h=setup(t);h.collector.admit();
  h.store.db.prepare('UPDATE sitting_snapshots SET next_check=?').run(Number.MAX_SAFE_INTEGER);
  h.collector.writer.enqueue('agenda',1,SNAPSHOT_SITTING);
  let fail=true;const offsets=[];
  h.worker.fetchRecord=async(endpoint,params)=>{
    offsets.push(params.offset);
    if(params.offset===50&&fail)throw Object.assign(Error('upstream unavailable'),{status:503,retryAfter:60});
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:params.offset===0?50:0},(_,i)=>({id:String(i)}))}};
  };
  assert(await h.collector.step(h.worker));
  assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshot_staging WHERE kind='agenda' AND key<>'agenda:cursor'").get().n,1);
  assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING),null);
  fail=false;h.advance(86400000);
  assert(await h.collector.step(h.worker));
  assert.deepEqual(offsets,[0,50,50]);
  assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages.length,2);
});

 test('background calendar can resume beyond the foreground ten-page cap',async t=>{
  const h=setup(t);h.collector.admit();
  h.store.db.prepare('UPDATE sitting_snapshots SET next_check=?').run(Number.MAX_SAFE_INTEGER);
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=0 WHERE kind='calendar' AND id='2024'").run();
  const offsets=[];h.worker.fetchRecord=async(endpoint,params)=>{
    offsets.push(params.offset);
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:params.offset<550?Array.from({length:50},(_,i)=>({id:'eli/dl/event/committee-'+(params.offset+i),had_activity_type:'def/ep-activities/COMMITTEE_MEETING'})):[]}};
  };
  for(let i=0;i<12;i++)await h.collector.step(h.worker,{requestBudget:1});
  assert.deepEqual(offsets,Array.from({length:12},(_,i)=>i*50));
  assert.equal(h.reader.read('calendar',1,'2024').coverage.state,'complete');
  const {MeetingsReader}=await import('./meetings-reader.mjs');
  const reader=new MeetingsReader({clock:h.clock,snapshots:h.reader,request:()=>assert.fail('retained calendar must not fetch')});
  assert.equal((await reader.year(2024)).coverage.state,'complete');
});

function isolateJob(h,kind,id){
  h.collector.admit();h.store.db.prepare('UPDATE sitting_snapshots SET next_check=?').run(Number.MAX_SAFE_INTEGER);
  h.collector.writer.enqueue(kind,1,id);h.store.db.prepare('UPDATE sitting_snapshots SET next_check=0 WHERE kind=? AND id=?').run(kind,id);
}
test('resuming an agenda after the week boundary refreshes preliminary staged pages',async t=>{
  const h=setup(t);h.advance(Date.parse('2026-10-11T12:00Z')-h.clock());
  isolateJob(h,'agenda',SNAPSHOT_SITTING);const offsets=[];
  h.worker.fetchRecord=async(endpoint,params)=>{offsets.push(params.offset);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:params.offset===0?50:1},(_,i)=>({id:'item-'+(params.offset+i),label:offsets.length===1?'preliminary':'final'}))}};};
  assert.equal(await h.collector.step(h.worker,{requestBudget:1}),false);
  h.advance(2*DAY);assert.equal(await h.collector.step(h.worker,{requestBudget:1}),false);
  assert(await h.collector.step(h.worker,{requestBudget:1}));
  assert.deepEqual(offsets,[0,0,50]);
  assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages[0].payload.data[0].label,'final');
});
test('calendar negative staging cannot prevent a later healthy upstream retry',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');let calls=0;
  h.worker.fetchRecord=async()=>{calls++;if(calls===1)throw Object.assign(Error('missing calendar'),{code:'odp_unavailable',upstreamStatus:404,source:{httpStatus:404}});return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);h.advance(2*DAY);await h.collector.step(h.worker);
  assert.equal(calls,2);assert.equal(h.reader.read('calendar',1,'2026').coverage.state,'complete');
});
test('singleton debate links are retained',async t=>{
  const h=setup(t),id=SNAPSHOT_SITTING+'-PVCRE-ITM-99';isolateJob(h,'debate',id);let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[{id:'eli/dl/event/'+id,activity_date:SNAPSHOT_SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:'eli/dl/event/'+SNAPSHOT_SITTING+'-OTH-9'}]}};};
  await h.collector.step(h.worker);assert(h.reader.read('debate',1,id));assert.equal(calls,1);
});

test('legacy staged calendar 404 and 204 observations expire before retry',async t=>{
  for(const code of ['odp_unavailable','odp_no_content']){
    const h=setup(t);isolateJob(h,'calendar','2026');const job={kind:'calendar',version:1,id:'2026'};
    const key=JSON.stringify(['/meetings',{year:2026,limit:50,offset:0}]);
    h.collector.writer.stage(job,key,{failure:{message:'old negative',code,upstreamStatus:404,source:{httpStatus:404}}},h.clock());
    let calls=0;h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
    await h.collector.step(h.worker);assert.equal(calls,1);assert(h.reader.read('calendar',1,'2026'));
  }
});
test('a rejected debate representation is not pinned as its retry source',async t=>{
  const h=setup(t),id=SNAPSHOT_SITTING+'-PVCRE-ITM-99';isolateJob(h,'debate',id);let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[{id:'eli/dl/event/'+id,activity_date:SNAPSHOT_SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:calls===1?null:{id:'eli/dl/event/'+SNAPSHOT_SITTING+'-OTH-9'}}]}};};
  await h.collector.step(h.worker);assert.equal(h.reader.read('debate',1,id),null);
  assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshot_staging WHERE kind='debate'").get().n,0);
  h.advance(DAY);await h.collector.step(h.worker);assert.equal(calls,2);assert(h.reader.read('debate',1,id));
});
test('missing agenda and calendar retries use age decay without reopening held data',async t=>{
  const now=Date.parse('2026-11-01T12:00Z');
  for(const [date,days] of [['2026-07-02',0],['2026-07-01',30],['2025-11-02',30],['2025-11-01',90],['2024-11-02',90],['2024-11-01',180]])
    assert.equal(pastSittingRecheckDelay(date,now,60000),days?days*DAY:60000,date);
  for(const [kind,id,days] of [['agenda','MTG-PL-2026-04-01',30],['agenda','MTG-PL-2025-04-01',90],['agenda','MTG-PL-2024-08-01',180],['calendar','2024',90]]){
    const h=setup(t);isolateJob(h,kind,id);let calls=0;
    h.worker.fetchRecord=async()=>{calls++;throw Object.assign(Error('missing'),{status:404});};
    await h.collector.step(h.worker);
    const row=h.store.db.prepare('SELECT next_check FROM sitting_snapshots WHERE kind=? AND id=?').get(kind,id);
    assert.equal(row.next_check,h.clock()+days*DAY);assert.equal(calls,1);
    assert.equal(h.store.get('sittingSnapshotRejection:'+JSON.stringify([kind,1,id])),null);
  }
  const h=setup(t);await drain(h);const before=h.fixture.calls.length;
  h.collector.discoverSittings([h.fixture.meeting]);await h.collector.step(h.worker);
  assert.equal(h.fixture.calls.length,before,'unchanged complete held agendas do not fetch again');
});

test('agenda collection advances past 500 rows under one-request budgets',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);const offsets=[];
  h.worker.fetchRecord=async(endpoint,params)=>{
    offsets.push(params.offset);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:params.offset<500?50:1},(_,i)=>({id:'item-'+(params.offset+i)}))}};
  };
  for(let i=0;i<12;i++)await h.collector.step(h.worker,{requestBudget:1});
  assert(offsets.includes(500));assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages.flatMap(p=>p.payload.data).length,501);
  assert.deepEqual(offsets,Array.from({length:11},(_,i)=>i*50));
});
test('a retry adopts a healthy held debate without another upstream download',async t=>{
  const h=setup(t),id=SNAPSHOT_SITTING+'-PVCRE-ITM-99';isolateJob(h,'debate',id);let cached=null,calls=0,lookups=0;
  h.collector.readCached=async()=>{lookups++;return cached;};
  h.worker.fetchRecord=async()=>{calls++;throw Object.assign(Error('transport unavailable'),{status:503});};
  await h.collector.step(h.worker);h.advance(DAY);
  cached={url:'https://data.europarl.europa.eu/api/v2/events/'+id,fetchedAt:h.clock(),payload:{data:[{id:'eli/dl/event/'+id,activity_date:SNAPSHOT_SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:[]}]}};
  await h.collector.step(h.worker);assert.equal(calls,1);assert.equal(lookups,2);assert(h.reader.read('debate',1,id));
});
test('missing old debate links use the sitting age decay',async t=>{
  for(const [date,days] of [['2026-04-01',30],['2025-04-01',90],['2024-08-01',180]]){
    const h=setup(t),id='MTG-PL-'+date+'-PVCRE-ITM-1';isolateJob(h,'debate',id);
    h.worker.fetchRecord=async()=>{throw Object.assign(Error('missing debate'),{status:404});};
    await h.collector.step(h.worker);
    assert.equal(h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id).next_check,h.clock()+days*DAY,date);
  }
});

test('agenda dispatches save their cursor and finish full terminal pages after restart',async t=>{
  for(const total of [500,1250]){
    const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);const offsets=[];
    h.worker.fetchRecord=async(endpoint,params)=>{offsets.push(params.offset);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:Math.min(50,total-params.offset)},(_,i)=>({id:'item-'+(params.offset+i)}))}};};
    await h.collector.step(h.worker);
    assert.equal(offsets.length,8);assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING),null);
    assert.equal(h.collector.writer.staged({kind:'agenda',version:1,id:SNAPSHOT_SITTING},'agenda:cursor',0).offset,400);
    const resumed=new SittingSnapshotCollector(h.store,{hints:h.hints,readCached:async()=>null});
    for(let i=0;i<4&&h.reader.read('agenda',1,SNAPSHOT_SITTING)===null;i++)await resumed.step(h.worker);
    assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages.flatMap(p=>p.payload.data).length,total);
    assert.deepEqual(offsets,Array.from({length:total/50+1},(_,i)=>i*50));
  }
});
test('agenda retries adopt held pages after a failure without losing their cursor',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);let cached=null,calls=0;
  h.collector.readCached=async()=>cached;
  h.worker.fetchRecord=async()=>{calls++;throw Object.assign(Error('unavailable'),{status:503});};
  await h.collector.step(h.worker);h.advance(DAY);
  cached={url:'https://data.europarl.europa.eu/api/v2/meetings/'+SNAPSHOT_SITTING+'/foreseen-activities',fetchedAt:h.clock(),payload:{data:[]}};
  await h.collector.step(h.worker);assert.equal(calls,1);assert(h.reader.read('agenda',1,SNAPSHOT_SITTING));
});
test('retries bypass an identical rejected cache payload but adopt corrected held data',async t=>{
  const h=setup(t),id=SNAPSHOT_SITTING+'-PVCRE-ITM-99';isolateJob(h,'debate',id);let calls=0,lookups=0;
  const payload={data:[{id:'eli/dl/event/'+id,activity_date:SNAPSHOT_SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:null}]};
  h.collector.readCached=async()=>{lookups++;return {fetchedAt:h.clock(),payload};};
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:structuredClone(payload)};};
  await h.collector.step(h.worker);h.advance(DAY);
  await h.collector.step(h.worker);assert.equal(calls,2);assert.equal(lookups,2);assert.equal(h.reader.read('debate',1,id),null);
  h.advance(DAY);payload.data[0].consists_of=[];
  await h.collector.step(h.worker);assert.equal(calls,2);assert(h.reader.read('debate',1,id));
});
test('calendar pagination can progress past the former 80-page and 4000-row stops',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2024');const offsets=[];
  h.worker.fetchRecord=async(endpoint,params)=>{offsets.push(params.offset);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:params.offset<4050?50:0},(_,i)=>({id:'eli/dl/event/committee-'+(params.offset+i),had_activity_type:'def/ep-activities/COMMITTEE_MEETING'}))}};};
  for(let i=0;i<82;i++)await h.collector.step(h.worker,{requestBudget:1});
  assert.equal(offsets.at(-1),4050);assert.equal(h.reader.read('calendar',1,'2024').coverage.state,'complete');
});
test('calendar retries can use fresh held pages rather than repeat a failed download',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');let cached=null,calls=0;
  h.collector.readCached=async()=>cached;
  h.worker.fetchRecord=async()=>{calls++;throw Object.assign(Error('unavailable'),{status:503});};
  await h.collector.step(h.worker);h.advance(DAY);
  cached={url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:h.clock(),payload:{data:[]}};
  await h.collector.step(h.worker);assert.equal(calls,1);assert(h.reader.read('calendar',1,'2026'));
});

test('a completed agenda cursor survives retention failure without fetching another terminal page',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  const retain=h.collector.writer.retain.bind(h.collector.writer);
  h.collector.writer.retain=()=>{throw Error('temporary storage failure');};
  await h.collector.step(h.worker);h.advance(DAY);h.collector.writer.retain=retain;
  await h.collector.step(h.worker);assert.equal(calls,1);assert(h.reader.read('agenda',1,SNAPSHOT_SITTING));
});
test('invalid agenda and calendar observations cannot stay pinned in staging',async t=>{
  for(const kind of ['agenda','calendar']){
    const h=setup(t),id=kind==='agenda'?SNAPSHOT_SITTING:'2026';isolateJob(h,kind,id);let calls=0;
    const bad=kind==='agenda'?{data:[null]}:{data:[{id:'eli/dl/event/MTG-PL-2025-10-07',activity_id:'MTG-PL-2025-10-07',activity_date:'2025-10-07',had_activity_type:'def/ep-activities/PLENARY_SITTING'}]};
    h.collector.readCached=async()=>({fetchedAt:h.clock(),payload:bad});
    h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:calls===1?bad:{data:[]}};};
    await h.collector.step(h.worker);assert.equal(h.reader.read(kind,1,id),null);h.advance(DAY);
    await h.collector.step(h.worker);assert.equal(calls,2);assert(h.reader.read(kind,1,id));
  }
});
test('repeated agenda and calendar pages are unpinned and corrected held pages finish the job',async t=>{
  for(const kind of ['agenda','calendar']){
    const h=setup(t),id=kind==='agenda'?SNAPSHOT_SITTING:'2026';isolateJob(h,kind,id);let calls=0,corrected=false;
    h.collector.readCached=async(_endpoint,params)=>corrected&&params.offset===50?{fetchedAt:h.clock(),payload:{data:[]}}:null;
    h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:50},(_,i)=>({id:'eli/dl/event/item-'+i}))}};};
    await h.collector.step(h.worker);assert.equal(h.reader.read(kind,1,id),null);assert.equal(calls,2);
    corrected=true;h.advance(DAY);await h.collector.step(h.worker);
    assert.equal(calls,2);assert(h.reader.read(kind,1,id));
  }
});

test('rewinding a preliminary cursor preserves already held post-week pages',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);
  const job={kind:'agenda',version:1,id:SNAPSHOT_SITTING},endpoint='/meetings/'+SNAPSHOT_SITTING+'/foreseen-activities';
  h.collector.writer.stage(job,JSON.stringify([endpoint,{limit:50,offset:0}]),{fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:50},(_,i)=>({id:'item-'+i}))}},h.clock());
  // Simulate a crash between retaining a post-boundary page and its cursor update.
  h.collector.writer.stage(job,'agenda:cursor',{offset:50,settled:false},h.clock());const offsets=[];
  h.worker.fetchRecord=async(_endpoint,params)=>{offsets.push(params.offset);assert.equal(params.offset,50);return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);assert.deepEqual(offsets,[50]);assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages.length,2);
});

test('a historical calendar needs post-year confirmation after worker downtime',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');let calls=0;
  const late={id:'eli/dl/event/MTG-PL-2026-12-20',activity_id:'MTG-PL-2026-12-20',activity_date:'2026-12-20',had_activity_type:'def/ep-activities/PLENARY_SITTING',consists_of:[]};
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:calls===1?[]:[late]}};};
  await h.collector.step(h.worker);assert.equal(calls,1);
  h.advance(Date.parse('2027-01-02T12:00Z')-h.clock());isolateJob(h,'calendar','2026');
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=? WHERE kind='calendar' AND id='2026'").run(h.clock()-1);
  await h.collector.step(h.worker);
  assert.equal(calls,2);assert.equal(h.reader.read('calendar',1,'2026').nodes[0].activity_id,late.activity_id);
  assert.equal(h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='calendar' AND id='2026'").get().next_check,Number.MAX_SAFE_INTEGER);
});
test('calendar staging cannot carry pre-year pages across the year boundary',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');const offsets=[];
  h.worker.fetchRecord=async(_endpoint,params)=>{offsets.push(params.offset);return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:params.offset===0?Array.from({length:50},(_,i)=>({id:'eli/dl/event/item-'+i})):[]}};};
  assert.equal(await h.collector.step(h.worker,{requestBudget:1}),false);
  h.advance(Date.parse('2027-01-02T12:00Z')-h.clock());isolateJob(h,'calendar','2026');
  await h.collector.step(h.worker);assert.deepEqual(offsets,[0,0,50]);
  assert(h.reader.read('calendar',1,'2026').coverage.sources.every(source=>Date.parse(source.fetchedAt)>=Date.parse('2027-01-01T00:00Z')));
});
test('calendar pages above the reader bound cannot pin retries or discard accepted predecessors',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');let healthy=false;const offsets=[];
  h.collector.readCached=async(_endpoint,params)=>healthy&&params.offset===50?{fetchedAt:h.clock(),payload:{data:[]}}:null;
  h.worker.fetchRecord=async(_endpoint,params)=>{offsets.push(params.offset);return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:params.offset===0?Array.from({length:50},(_,i)=>({id:'eli/dl/event/item-'+i})):[{id:'eli/dl/event/oversize',padding:'x'.repeat(9*1024*1024)}]}};};
  await h.collector.step(h.worker);assert.equal(h.reader.read('calendar',1,'2026'),null);
  healthy=true;h.advance(DAY);await h.collector.step(h.worker);
  assert(h.reader.read('calendar',1,'2026'));assert.deepEqual(offsets,[0,50]);
});

test('a confirmed post-year calendar stays held while an old frozen calendar is reopened',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=? WHERE kind='calendar' AND id='2026'").run(Number.MAX_SAFE_INTEGER);
  h.advance(Date.parse('2027-01-02T12:00Z')-h.clock());h.collector.admit();
  assert.equal(h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='calendar' AND id='2026'").get().next_check,0);
  isolateJob(h,'calendar','2026');await h.collector.step(h.worker);assert.equal(calls,2);
  h.advance(DAY);isolateJob(h,'calendar','2026');
  h.store.db.prepare("UPDATE sitting_snapshots SET next_check=? WHERE kind='calendar' AND id='2026'").run(h.clock()-1);
  await h.collector.step(h.worker);assert.equal(calls,2,'confirmed historical data must not download again');
});
test('calendar confirmation waits for the year boundary without rejecting fresh boundary-hour data',async t=>{
  const h=setup(t);h.advance(Date.parse('2026-12-31T23:30Z')-h.clock());isolateJob(h,'calendar','2026');let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);
  assert.equal(h.store.get('sittingSnapshotRejection:'+JSON.stringify(['calendar',1,'2026'])),null);
  assert.equal(h.reader.read('calendar',1,'2026'),null,'Brussels year rollover alone must not freeze an unconfirmed calendar');
  h.advance(2*60*60_000);isolateJob(h,'calendar','2026');await h.collector.step(h.worker);
  assert.equal(calls,2);assert(h.reader.read('calendar',1,'2026'));
});
test('the worker and calendar reader share the exact per-page byte bound',async t=>{
  const {MeetingsReader,MEETINGS_SOURCE_MAX_BYTES}=await import('./meetings-reader.mjs');
  assert.equal(new MeetingsReader().limits.sourceBytes,MEETINGS_SOURCE_MAX_BYTES);
  for(const extra of [0,1]){
    const h=setup(t);isolateJob(h,'calendar','2026');
    const payload={data:[{id:'eli/dl/event/item',padding:''}]};
    payload.data[0].padding='x'.repeat(MEETINGS_SOURCE_MAX_BYTES-Buffer.byteLength(JSON.stringify(payload))+extra);
    h.worker.fetchRecord=async()=>({fetchedAt:new Date(h.clock()).toISOString(),payload});
    await h.collector.step(h.worker);
    assert.equal(Boolean(h.reader.read('calendar',1,'2026')),extra===0);
    assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshot_staging WHERE kind='calendar'").get().n,0);
    if(extra)assert.equal(h.store.get('sittingSnapshotRejection:'+JSON.stringify(['calendar',1,'2026'])).count,1);
  }
});
test('legacy oversized calendar staging can be replaced by a valid held observation',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');const job={kind:'calendar',version:1,id:'2026'};
  h.collector.writer.stage(job,JSON.stringify(['/meetings',{year:2026,limit:50,offset:0}]),{fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[{id:'eli/dl/event/big',padding:'x'.repeat(9*1024*1024)}]}},h.clock());
  h.collector.readCached=async()=>({fetchedAt:h.clock(),payload:{data:[]}});
  h.worker.fetchRecord=()=>assert.fail('valid held replacement must be used');
  await h.collector.step(h.worker);assert(h.reader.read('calendar',1,'2026'));assert.equal(h.worker.requests,0);
});
test('legacy negative collection staging and new held observations cannot pin retries',async t=>{
  for(const kind of ['agenda','debate']){
    const h=setup(t),id=kind==='agenda'?SNAPSHOT_SITTING:SNAPSHOT_SITTING+'-PVCRE-ITM-99';isolateJob(h,kind,id);
    const endpoint=kind==='agenda'?'/meetings/'+id+'/foreseen-activities':'/events/'+id,params=kind==='agenda'?{limit:50,offset:0}:{};
    h.collector.writer.stage({kind,version:1,id},JSON.stringify([endpoint,params]),{failure:{message:'old missing observation',code:'odp_unavailable',upstreamStatus:404}},h.clock());
    h.collector.readCached=async()=>{h.advance(1000);return {fetchedAt:h.clock(),payload:{data:kind==='agenda'?[]:[{id:'eli/dl/event/'+id,activity_date:SNAPSHOT_SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:[]}]}};};
    h.worker.fetchRecord=()=>assert.fail('a valid observation published during cache lookup must be reused');
    await h.collector.step(h.worker);assert(h.reader.read(kind,1,id));assert.equal(h.worker.requests,0);
  }
});
test('agenda assembly revalidates pages instead of trusting a terminal cursor',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);const job={kind:'agenda',version:1,id:SNAPSHOT_SITTING};
  const endpoint='/meetings/'+SNAPSHOT_SITTING+'/foreseen-activities';
  h.collector.writer.stage(job,JSON.stringify([endpoint,{limit:50,offset:0}]),{fetchedAt:'2026-10-08T12:00Z',payload:{data:[]}},h.clock());
  h.collector.writer.stage(job,'agenda:cursor',{offset:50,settled:true,terminal:true},h.clock());let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING),null);
  await h.collector.step(h.worker);assert(h.reader.read('agenda',1,SNAPSHOT_SITTING));assert.equal(calls,1);
});

test('agenda settlement requires a real terminal page even when its cursor claims completion',async t=>{
  const h=setup(t);isolateJob(h,'agenda',SNAPSHOT_SITTING);const job={kind:'agenda',version:1,id:SNAPSHOT_SITTING};
  const endpoint='/meetings/'+SNAPSHOT_SITTING+'/foreseen-activities';
  h.collector.writer.stage(job,JSON.stringify([endpoint,{limit:50,offset:0}]),{fetchedAt:new Date(h.clock()).toISOString(),payload:{data:Array.from({length:50},(_,i)=>({id:'item-'+i}))}},h.clock());
  h.collector.writer.stage(job,'agenda:cursor',{offset:50,settled:true,terminal:true},h.clock());const offsets=[];
  h.worker.fetchRecord=async(_endpoint,params)=>{offsets.push(params.offset);return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:[]}};};
  await h.collector.step(h.worker);assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING),null);
  await h.collector.step(h.worker);assert.equal(h.reader.read('agenda',1,SNAPSHOT_SITTING).pages.length,2);assert.deepEqual(offsets,[50]);
});
test('reader-level calendar conflicts unstage only the rejected page through source classification',async t=>{
  const h=setup(t);isolateJob(h,'calendar','2026');const offsets=[];let healthy=false;
  h.collector.readCached=async(_endpoint,params)=>healthy&&params.offset===50?{fetchedAt:h.clock(),payload:{data:[]}}:null;
  h.worker.fetchRecord=async(_endpoint,params)=>{offsets.push(params.offset);return {fetchedAt:new Date(h.clock()).toISOString(),payload:{data:params.offset===0?Array.from({length:50},(_,i)=>({id:'eli/dl/event/item-'+i,label:'original'})):[{id:'eli/dl/event/item-0',label:'changed'}]}};};
  await h.collector.step(h.worker);assert.equal(h.reader.read('calendar',1,'2026'),null);
  assert.equal(h.store.db.prepare("SELECT COUNT(*) n FROM sitting_snapshot_staging WHERE kind='calendar'").get().n,1);
  assert.equal(h.store.get('sittingSnapshotRejection:'+JSON.stringify(['calendar',1,'2026'])).count,1);
  healthy=true;h.advance(DAY);await h.collector.step(h.worker);
  assert(h.reader.read('calendar',1,'2026'));assert.deepEqual(offsets,[0,50]);
});

const realEventShapes=JSON.parse(readFileSync(new URL('./fixtures/sitting-event-shapes.json',import.meta.url)));
test('real PVCRE procedural, explanation and debate shapes recover from old parser failures using held bytes',async t=>{
  for(const fixture of realEventShapes){
    const h=setup(t);h.advance(Date.parse('2026-11-02T12:00Z')-h.clock());
    const id=fixture.payload.data[0].activity_id;isolateJob(h,'debate',id);
    const key='sittingSnapshotRejection:'+JSON.stringify(['debate',1,id]);
    const {sourceObservationHash}=await import('./source-retry.mjs');
    const record={url:fixture.sourceUrl,fetchedAt:h.clock(),payload:fixture.payload};
    h.store.set(key,{hash:sourceObservationHash(record),parserVersion:1,count:3,firstSeen:h.clock()-2*DAY,descriptor:JSON.stringify(['/events/'+id,{}])});
    h.store.db.prepare("UPDATE sitting_snapshots SET attempts=12,error='Collection source has invalid metadata.',next_check=? WHERE kind='debate' AND id=?").run(h.clock()+180*DAY,id);
    h.store.db.prepare("DELETE FROM meta WHERE key='sittingDebateParser'").run();
    assert(h.collector.due());h.collector.admit();
    const row=h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id);
    assert.equal(row.next_check,h.clock());
    h.collector.readCached=async()=>record;
    h.worker.fetchRecord=()=>assert.fail('valid held bytes must not download again');
    h.advance(row.next_check-h.clock());await h.collector.step(h.worker);
    assert.deepEqual(h.reader.read('debate',1,id).payload,fixture.payload);
    assert.equal(h.store.get(key),null);
    assert.equal(h.store.db.prepare("SELECT attempts FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id).attempts,0);
  }
});
test('PVCRE identity, date, type, links and duplicate conflicts remain rejected',async t=>{
  for(const mutate of [
    node=>delete node.id,
    node=>node.activity_id+='-99',
    node=>node.activity_date='2026-10-21',
    node=>node.had_activity_type='def/ep-activities/COMMITTEE_MEETING',
    node=>node.consists_of=['eli/dl/event/MTG-PL-2025-01-01-OTH-1'],
    node=>node.consists_of=[{}],
    node=>node.consists_of=null,
    (node,data)=>data.push({...node,activity_label:{en:'Conflicting title'}}),
  ]){
    const h=setup(t);h.advance(Date.parse('2026-11-02T12:00Z')-h.clock());
    const payload=structuredClone(realEventShapes[1].payload),id=payload.data[0].activity_id;
    mutate(payload.data[0],payload.data);isolateJob(h,'debate',id);
    h.collector.readCached=async()=>null;
    h.worker.fetchRecord=async()=>({fetchedAt:h.clock(),payload});
    await h.collector.step(h.worker);assert.equal(h.reader.read('debate',1,id),null);
    assert.match(h.store.db.prepare("SELECT error FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id).error,/invalid metadata/);
  }
});
test('pre-boundary observations never confirm permanent byte rejection',async t=>{
  const h=setup(t),fixture=realEventShapes[0],id=fixture.payload.data[0].activity_id;
  h.advance(Date.parse('2026-11-02T12:00Z')-h.clock());isolateJob(h,'debate',id);
  const record={fetchedAt:Date.parse(id.slice(7,17)+'T12:00Z'),payload:fixture.payload};
  h.collector.readCached=async()=>record;let calls=0;
  h.worker.fetchRecord=async()=>{calls++;return record;};
  for(let i=0;i<4;i++){
    await h.collector.step(h.worker);
    assert.equal(h.store.get('sittingSnapshotRejection:'+JSON.stringify(['debate',1,id])),null);
    const row=h.store.db.prepare("SELECT next_check FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id);
    h.advance(row.next_check-h.clock());
  }
  assert.equal(calls,4);
});
test('PVCRE collection follows exact declared sub-items and accepts absolute identities and leaf items',async t=>{
  const h=setup(t);h.advance(Date.parse('2026-11-02T12:00Z')-h.clock());
  const parent=structuredClone(realEventShapes.find(f=>f.payload.data[0].activity_id==='MTG-PL-2026-10-22-PVCRE-ITM-11'));
  const id=parent.payload.data[0].activity_id;isolateJob(h,'debate',id);
  const child=structuredClone(realEventShapes.find(f=>f.payload.data[0].activity_id===id+'-4'));
  child.payload.data[0].id='https://data.europarl.europa.eu/'+child.payload.data[0].id;
  delete child.payload.data[0].activity_id;delete child.payload.data[0].consists_of;
  h.collector.readCached=async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:h.clock(),payload:endpoint.endsWith(id)?parent.payload:child.payload});
  h.worker.fetchRecord=()=>assert.fail('held parent and child must be reused');
  await h.collector.step(h.worker);
  assert(h.store.db.prepare("SELECT 1 FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id+'-4'));
  await h.collector.step(h.worker);assert(h.reader.read('debate',1,id+'-4'));
  const retained=h.store.db.prepare("SELECT next_check,body FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id);
  h.store.db.prepare("DELETE FROM meta WHERE key='sittingDebateParser'").run();h.collector.admit();
  assert.deepEqual(h.store.db.prepare("SELECT next_check,body FROM sitting_snapshots WHERE kind='debate' AND id=?").get(id),retained);
});

test('parser upgrades immediately requeue never-collected rejections at every age, preserving held rows and other backoffs',t=>{
  const h=setup(t);h.collector.admit();
  const next=h.clock()+180*DAY,body=gzipSync(JSON.stringify({held:'observation'}));
  const metadataError='Collection source has invalid metadata.',linksError='Exact debate links unavailable.';
  const cases=[
    {date:'2026-10-07',error:metadataError,requeue:true},
    {date:'2026-04-01',error:metadataError,requeue:true},
    {date:'2025-04-01',error:linksError,requeue:true},
    {date:'2024-07-17',error:metadataError,requeue:true},
    {error:metadataError,body},
    {error:metadataError,complete:1,body},
    {error:metadataError,complete:1},
    {complete:1,body},
    {error:'Upstream returned 429'},
    {error:'Service unavailable'},
    {error:metadataError,kind:'agenda'},
    {},
  ];
  const insert=h.store.db.prepare('INSERT INTO sitting_snapshots(kind,version,id,complete,checked_at,next_check,attempts,error,body) VALUES (?,1,?,?,?,?,12,?,?)');
  const read=h.store.db.prepare('SELECT * FROM sitting_snapshots WHERE kind=? AND version=1 AND id=?');
  for(const [i,c] of cases.entries()){
    c.kind??='debate';c.id='MTG-PL-'+(c.date||'2024-07-17')+'-PVCRE-ITM-'+(i+1);
    insert.run(c.kind,c.id,c.complete||0,h.clock()-DAY,next,c.error??null,c.body??null);
    c.before=read.get(c.kind,c.id);
  }
  h.store.set('sittingDebateParser',2);assert(h.collector.due());h.collector.admit();
  assert.equal(h.store.get('sittingDebateParser'),3);
  for(const c of cases)assert.deepEqual({...read.get(c.kind,c.id)},{...c.before,next_check:c.requeue?h.clock():next},c.id);
  assert.equal(h.fixture.calls.length,0,'admission only changes due times; shared collection still controls requests');
  // Ordinary retries after this upgrade retain their schedule on every admission.
  const c=cases[0];h.store.db.prepare("UPDATE sitting_snapshots SET next_check=? WHERE kind='debate' AND id=?").run(next,c.id);
  h.collector.admit();assert.equal(read.get(c.kind,c.id).next_check,next);
});
