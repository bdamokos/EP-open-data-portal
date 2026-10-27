import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileAsync,registerSubprocesses} from '../server/test-support/subprocess.mjs';
import {SCHEMA,hash,snapshotId,sourceUrl,allowedSource,loadSnapshot,responseHash,compareBaseline,summarize} from './agenda-benchmark-model.mjs';
import {capture} from './agenda-benchmark-capture.mjs';
import {options} from './agenda-benchmark.mjs';

beforeEach(registerSubprocesses);
const asOf='2026-10-27T12:00:00.000Z',days=['2026-10-19','2026-10-20'];
const meeting=date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,activity_label:{en:'Plenary sitting'},had_activity_type:'def/ep-activities/PLENARY_SITTING',was_scheduled_in:['eli/dl/event/MTG-PL-'+date+'-PART-1']});
const agenda=(date,count=1)=>{
  const prefix='MTG-PL-'+date;
  const items=Array.from({length:count},(_,i)=>({id:'eli/dl/event/'+prefix+'-OJ-ITM-'+i,activity_id:prefix+'-OJ-ITM-'+i,activity_date:date,activity_label:{en:'Public debate '+i,hu:'Vita '+i},had_activity_type:'def/ep-activities/PLENARY_DEBATE'}));
  const part={id:'eli/dl/event/'+prefix+'-PART-1',activity_id:prefix+'-PART-1',had_activity_type:'def/ep-activities/MEETING_PART',consists_of:items.map(row=>row.id)};
  return [{...meeting(date),was_scheduled_in:[part.id]},part,...items];
};
async function fixture(directory,{missingDay=false}={}) {
  const readinessBody=JSON.stringify({currentMeps:1,servingGeneration:1,complete:false,rosterFetchedAt:asOf,lastSuccessfulRefresh:asOf});
  await writeFile(path.join(directory,'index-status.json'),JSON.stringify({url:'https://benchmark.example/api/activity-index/status',retrievedAt:asOf,sha256:hash(readinessBody),body:readinessBody}));
  const entries=[...['2024','2025','2026'].map(year=>[sourceUrl('/meetings',{year,limit:50,offset:0}),year==='2026'?days.map(meeting):[],200]),
    ...days.map((date,index)=>[sourceUrl('/meetings/MTG-PL-'+date+'/foreseen-activities',{limit:50,offset:0}),agenda(date),missingDay&&index===1?404:200])];
  const sources=[];
  for(const [url,data,status] of entries) {
    const body=Buffer.from(JSON.stringify({data}));
    sources.push({url,status,contentType:'application/ld+json',retrievedAt:asOf,bytes:body.length,sha256:hash(body),headersMs:5,bodyMs:2});await writeFile(path.join(directory,hash(url)+'.body'),body);
  }
  const snapshot={schemaVersion:SCHEMA,sample:{asOf,query:{lang:'en',week:'latest'},resolvedWeek:'2026-10-19',sittings:days.map(day=>'MTG-PL-'+day)},sources};snapshot.snapshotId=snapshotId(snapshot);await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot));return snapshot;
}
test('CLI validates bounded acquisition and exact selections',()=>{
  assert.equal(options([]).iterations,5);assert.equal(options([]).fetch,false);
  for(const args of [['--iterations','0'],['--latency','live'],['--delay-ms','1'],['--week','2026-10-20'],['--week','2026-99-99'],['--sitting','MTG-PL-2026-10-19suffix'],['--lang','zz'],['--fetch','--week','2026-10-19','--sitting','MTG-PL-2026-10-19']])assert.throws(()=>options(args));
  assert(allowedSource(sourceUrl('/meetings',{year:2026,limit:50,offset:0})));
  for(const url of ['http://data.europarl.europa.eu/api/v2/meetings','https://example.org/api/v2/meetings',sourceUrl('/meps',{limit:50,offset:0}),sourceUrl('/meetings',{year:2026,limit:1000,offset:0}),sourceUrl('/meetings',{year:2026,limit:50,offset:0,token:'x'})])assert.equal(allowedSource(url),false);
});
test('semantic gate retains exact text, identities, order, languages, gaps and freshness',()=>{
  const before={topics:[{id:'a',title:'First',language:'hu',fetchedAt:asOf},{id:'b'}],coverage:{agendaComplete:false,agendaError:'Unavailable',stale:true},viewCache:{computedAt:asOf,stale:false}};
  const same=structuredClone(before);same.topics[0].fetchedAt='2026-10-28';same.viewCache.computedAt='2026-10-28';assert.equal(responseHash(before),responseHash(same));
  for(const change of [v=>v.topics.reverse(),v=>v.topics[0].id='c',v=>v.topics[0].title='Different',v=>v.topics[0].language='en',v=>v.coverage.agendaComplete=true,v=>v.coverage.agendaError=null,v=>v.coverage.stale=false]){const after=structuredClone(before);change(after);assert.notEqual(responseHash(before),responseHash(after));}
});
test('baseline refuses incompatible inputs, instrumentation and environments and catches response/request/time regressions',()=>{
  const run={scenario:'empty-caches',elapsedMs:100,cpuMs:10,transportRequests:5,responseBytes:1000},report={schemaVersion:SCHEMA,snapshotId:'same',protocol:{latency:'zero'},environment:{node:'same'},harnessHash:'same',semanticHash:'same',summary:summarize([run])};
  assert.equal(compareBaseline(report,report).failed,false);
  assert.equal(compareBaseline(report,{...report,failed:true}).refused,true);
  for(const field of ['snapshotId','protocol','environment','harnessHash'])assert.equal(compareBaseline({...report,[field]:'different'},report).refused,true);
  assert.equal(compareBaseline({...report,semanticHash:'lost topics'},report).failed,true);
  assert.equal(compareBaseline({...report,summary:summarize([{...run,transportRequests:6}])},report).failed,true);
  assert.equal(compareBaseline({...report,summary:summarize([{...run,elapsedMs:140}])},report).failed,true);
  assert.equal(compareBaseline({...report,summary:summarize([{...run,elapsedMs:115}])},report).failed,false,'absolute and relative noise margins both apply');
  const session={case:'past-aged-view',returnedWhileHeld:true,recheckRequests:0,topicsHash:'same',refreshedTopicsHash:'same',initialSemanticHash:'same',nextResponse:{topics:[],coverage:{agendaComplete:true,agendaError:null}}};
  const withSession={...report,sessionCases:[session]},lostCoverage=structuredClone(withSession);
  lostCoverage.sessionCases[0].nextResponse.coverage={agendaComplete:false,agendaError:'Source unavailable'};
  assert(compareBaseline(lostCoverage,withSession).regressions.includes('Refreshed session response differs: past-aged-view'));
});
test('sealed inputs reject body and manifest changes',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'agenda-input-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const snapshot=await fixture(directory);assert.equal((await loadSnapshot(directory)).inputs.size,5);
  await writeFile(path.join(directory,hash(snapshot.sources[0].url)+'.body'),'changed');await assert.rejects(loadSnapshot(directory),/hash mismatch/);
  snapshot.sample.query.week='2026-10-05';await writeFile(path.join(directory,'snapshot.json'),JSON.stringify(snapshot));await assert.rejects(loadSnapshot(directory),/manifest/);
});
test('capture is sequential, capped and independently follows catalogue and agenda pagination',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'agenda-capture-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const calls=[],waits=[];
  const fake=async(url,opts)=>{
    assert.equal(opts.redirect,'error');calls.push(url);const u=new URL(url),year=u.searchParams.get('year'),offset=Number(u.searchParams.get('offset'));
    if(year)return Response.json({data:year==='2026'?(offset===0?Array.from({length:50},(_,i)=>meeting(new Date(Date.UTC(2026,7,i+1)).toISOString().slice(0,10))):[meeting(days[0])]):[]});
    return Response.json({data:offset===0?agenda(days[0],48):[]});
  };
  const snapshot=await capture(directory,{fetcher:fake,wait:async ms=>waits.push(ms),now:()=>Date.parse(asOf)});
  assert.equal(calls.length,6);assert.equal(new Set(calls).size,6);assert(waits.slice(1).every(ms=>ms>=750));assert.deepEqual(snapshot.sample.sittings,['MTG-PL-'+days[0]]);
  assert.equal((await loadSnapshot(directory)).inputs.size,6);
  const second=await mkdtemp(path.join(os.tmpdir(),'agenda-cap-test-'));t.after(()=>rm(second,{recursive:true,force:true}));
  await assert.rejects(capture(second,{cap:1,fetcher:fake,wait:async()=>{},now:()=>Date.parse(asOf)}),/cap exhausted/);
  await assert.rejects(readFile(path.join(second,'snapshot.json')),e=>e.code==='ENOENT');
});
test('transient acquisition failures abort without sealing or retrying and redirects are rejected',async t=>{
  for(const status of [429,503,302]) {
    const directory=await mkdtemp(path.join(os.tmpdir(),'agenda-error-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));let attempts=0;
    await assert.rejects(capture(directory,{fetcher:async()=>{attempts++;return new Response('pause',{status,headers:{'Retry-After':'120'}});},wait:async()=>{}}),new RegExp('HTTP '+status));assert.equal(attempts,1);
    await assert.rejects(readFile(path.join(directory,'snapshot.json')),e=>e.code==='ENOENT');
  }
});
test('actual CLI replays the production queue and caches across isolated process restarts, preserving unavailable agendas',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'agenda-cli-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const input=path.join(directory,'inputs'),output=path.join(directory,'output');await mkdir(input);await fixture(input,{missingDay:true});
  const cli=fileURLToPath(new URL('./agenda-benchmark.mjs',import.meta.url));
  const {stdout}=await execFileAsync(t,process.execPath,[cli,'--cache-dir',input,'--output-dir',output,'--iterations','1','--latency','zero']);
  const result=JSON.parse(stdout),report=JSON.parse(await readFile(result.jsonPath));assert.equal(report.failed,false);assert.equal(report.runs.length,4);
  const cold=report.runs.find(run=>run.scenario==='empty-caches');assert.equal(cold.transportRequests,5);assert.equal(cold.coverage.agendaComplete,false);assert(cold.coverage.agendaError);assert.equal(cold.topics,1);
  assert(cold.spans.some(span=>span.stage==='index-status'));assert(cold.spans.some(span=>span.stage==='catalogue-year'));assert(cold.spans.some(span=>span.stage==='serialize'));
  assert.equal(report.runs.find(run=>run.scenario==='warm-repeat').transportRequests,0);assert.equal(report.runs.find(run=>run.scenario==='retained-view').transportRequests,0);
  assert.equal(report.runs.find(run=>run.scenario==='retained-sources').transportRequests,1,'negative ODP observations are not seeded as successful source records');
  assert.equal(new Set(report.runs.map(run=>run.semanticHash)).size,1);
  const badBaseline=path.join(directory,'bad-baseline.json');await writeFile(badBaseline,JSON.stringify({...report,semanticHash:'changed response'}));
  await assert.rejects(execFileAsync(t,process.execPath,[cli,'--cache-dir',input,'--output-dir',output,'--iterations','1','--latency','zero','--baseline',badBaseline]),error=>{assert.equal(error.code,1);const result=JSON.parse(error.stdout);assert.equal(result.comparison.failed,true);assert(result.comparison.regressions.some(reason=>reason.includes('Agenda response changed')));return true;});
  const manifest=JSON.parse(await readFile(path.join(input,'snapshot.json')));const missing=manifest.sources.pop();manifest.snapshotId=snapshotId(manifest);await writeFile(path.join(input,'snapshot.json'),JSON.stringify(manifest));
  await assert.rejects(execFileAsync(t,process.execPath,[cli,'--cache-dir',input,'--output-dir',output,'--iterations','1','--latency','zero']),error=>{assert.match(error.stderr,/outside the frozen manifest/);assert(error.stderr.includes(missing.url));return true;});
});
