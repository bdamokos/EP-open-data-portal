import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {documentRows,projectDocument,speechRows} from './activity-index-model.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {createInsights} from './insights.mjs';
import {PLENARY_REFRESH_MS} from './plenary-cache-policy.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {sharedRequest} from './request-budget.mjs';

async function warmAll(service) {
  let batches=0,delay;
  do {delay=await service.warmPlenary();assert(++batches<100);}while(delay===1000);
  return {batches,delay};
}
async function harness(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'plenary-details-'));
  const store=new ActivityStore(path.join(directory,'index'));
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const fixture=JSON.parse(await readFile(new URL('./fixtures/insights-live-20261014.json',import.meta.url),'utf8'));
  const progressHtml=await readFile(new URL('./fixtures/oeil-procedure-2026-2937-progress.html',import.meta.url),'utf8');
  let now=Date.parse('2026-10-29T12:00:00Z'),generation;
  const clock=()=>now,calls=[],officialCalls=[],priorities=[],warnings=[];
  store.acquire();({generation}=store.beginCycle());
  store.setMembers([{id:'257043',name:'Fixture member'}]);
  const speech=fixture.speech.payload.data[0],report=fixture.report.payload.data[0];
  store.putSource(generation,'/speeches/'+speech.activity_id,'speech',{id:speech.activity_id},new Date(fixture.speech.fetchedAt).toISOString(),speechRows(speech,new Date(fixture.speech.fetchedAt).toISOString()));
  store.putSource(generation,'/plenary-documents/'+report.identifier,'document',projectDocument(report),new Date(fixture.report.fetchedAt).toISOString(),documentRows(report,'/plenary-documents/'+report.identifier,new Date(fixture.report.fetchedAt).toISOString()).rows);
  const dates=['2026-10-07','2026-09-17','2026-11-11'];
  const meeting=fixture.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
  let failVotes=false,foreground=false,mixed=false;
  const request=async(endpoint,params,settings)=>{
    if(!mixed)assert.equal(settings.priority,foreground?'interactive':'background');
    if(settings.priority==='background')assert.equal(settings.cacheGroup,'plenary');
    calls.push({endpoint,params});
    if(failVotes&&endpoint.endsWith('/decisions'))throw Error('Vote source temporarily unavailable');
    let payload={data:[]};
    if(endpoint==='/meetings')payload={data:dates.filter(date=>Number(date.slice(0,4))===params.year).map(date=>JSON.parse(JSON.stringify(meeting).replaceAll('2026-10-07',date)))};
    else if(endpoint.endsWith('/foreseen-activities'))payload=endpoint.includes('2026-10-07')?fixture.foreseen.payload:{data:[]};
    else if(endpoint.startsWith('/procedures/')) {
      const id=endpoint.split('/').at(-1);
      payload={data:[{id:'eli/dl/proc/'+id,label:id.replace('-','/')+'(INI)',process_type:'def/ep-procedure-types/INI',consists_of:[]}]};
    }
    else if(endpoint.startsWith('/speeches/'))payload=fixture.speech.payload;
    else if(endpoint===('/events/'+fixture.speechParent.payload.data[0].activity_id))payload=fixture.speechParent.payload;
    else if(endpoint.startsWith('/events/'))payload={data:[]};
    else if(endpoint.endsWith('/vote-results'))payload=fixture.results.payload;
    else if(endpoint.endsWith('/decisions'))payload=fixture.decisions.payload;
    else if(endpoint.startsWith('/plenary-documents/'))payload=fixture.report.payload;
    else if(endpoint==='/speeches')payload={data:[],meta:{total:0}};
    else assert.fail('Unexpected source '+endpoint);
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now,payload};
  };
  const officialSources=new OfficialContextSources({clock,directory:path.join(directory,'official'),run:async(operation,settings)=>{priorities.push(settings.priority);return operation();},fetchSource:async input=>{
    const url=new URL(input);officialCalls.push(url);
    if(url.hostname==='publications.europa.eu')return Response.json({results:{bindings:[]}});
    const reference=url.searchParams.get('reference')||'2025/2117(INI)';
    const html=url.pathname.endsWith('/document-summary')?
      '<main><div class="es_product-subtitle">2025/2117(INI) 07/10/2026</div><div class="es_product-content"><p>Fixture summary.</p></div></main>':
      progressHtml.replaceAll('2026/2937(RSP)',reference).replace('</main>',`${reference==='2025/2117(INI)'?'<table><tr><td>07/10/2026</td><td>First reading <a href="/oeil/en/document-summary?id=1">Summary</a></td></tr></table>':''}</main>`);
    return new Response(html,{headers:{'content-type':'text/html'}});
  }});
  const options={clock,request,officialSources,eurovoc:{directory:path.join(directory,'eurovoc')},viewCache:{directory:path.join(directory,'views')},loadMetadata:async()=>new Map(),log:(...args)=>warnings.push(args)};
  return {store,options,calls,officialCalls,priorities,warnings,dates,fixture,clock,advance:ms=>now+=ms,setForeground:value=>foreground=value,setFailVotes:value=>failVotes=value,allowMixed:()=>mixed=true};
}

test('latest-week item details, remote votes, summaries and speech pages are warm before a visit and survive restart',async t=>{
  const h=await harness(t),service=createInsights(h.store,h.options);
  const {batches,delay}=await warmAll(service);
  assert(batches>1,'the real 18-item agenda is prepared in serial batches');
  assert.equal(delay,PLENARY_REFRESH_MS,'keep warming through a recess');
  assert.deepEqual(h.warnings,[]);
  assert(h.calls.some(call=>call.endpoint.endsWith('/decisions')));
  assert(h.calls.some(call=>call.endpoint==='/speeches'&&call.params['include-output']==='xml_fragment'));
  assert(h.officialCalls.some(url=>url.pathname.endsWith('/document-summary')));
  assert(h.priorities.length>0&&h.priorities.every(priority=>priority==='background'));
  assert(!h.calls.some(call=>/2026-09-17\/(decisions|vote-results)|2026-11-11\/(decisions|vote-results)/.test(call.endpoint)));
  h.setForeground(true);
  const count=h.calls.length,officialCount=h.officialCalls.length;
  const week=await service.query('legislation',new URLSearchParams('week=latest'));
  assert.equal(week.topics.length,18);
  for(const reader of [service,createInsights(h.store,h.options)]) {
    for(const topic of week.topics) {
      const result=await reader.query('legislation',new URLSearchParams({sitting:topic.sittingId,topic:topic.id,lang:'en'}));
      assert.equal(result.detail.id,topic.id);
      if(topic.id.endsWith('-V-48'))assert.equal(result.detail.selectedVote.namedCounts.for,454);
      if(topic.id.endsWith('-D-69'))assert.equal(result.detail.speeches[0].sourceId,h.fixture.speech.payload.data[0].activity_id);
    }
    const context=await reader.query('procedure-context',new URLSearchParams('reference=2025/2117(INI)'));
    assert.equal(context.summary.blocks[0].text,'Fixture summary.');
    await reader.query('procedure-progress',new URLSearchParams('reference=2025/2117(INI)'));
  }
  assert.equal(h.calls.length,count+3,'only the foreground calendar selection is checked once');
  assert.equal(h.officialCalls.length,officialCount,'linked official observations share the same retained cache');
});

test('failed remote votes stay explicit, later items still warm, and a later pass observes recovery',async t=>{
  const h=await harness(t),service=createInsights(h.store,h.options);
  h.setFailVotes(true);await warmAll(service);h.setForeground(true);
  const params=new URLSearchParams('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48');
  const failed=await service.query('legislation',params);
  assert.equal(failed.detail.selectedVote,null);
  assert.match(failed.detail.voteCoverage.error,/temporarily unavailable/);
  assert(failed.detail.coverage.gaps.some(gap=>gap.source==='named roll-calls'));
  const count=h.calls.length;
  await service.query('legislation',new URLSearchParams('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));
  assert.equal(h.calls.length,count,'a failed section does not block later items');
  h.setForeground(false);h.setFailVotes(false);h.advance(PLENARY_REFRESH_MS+1);
  await warmAll(service);h.setForeground(true);
  const recovered=await service.query('legislation',params);
  assert.equal(recovered.detail.voteCoverage.error,null);
  assert.equal(recovered.detail.selectedVote.namedCounts.for,454);
});

test('a newly held plenary week replaces the warm selection without enriching the next future week',async t=>{
  const h=await harness(t),service=createInsights(h.store,h.options);
  await warmAll(service);h.advance(14*86400_000);h.calls.length=0;
  await warmAll(service);h.setForeground(true);
  const latest=await service.query('legislation',new URLSearchParams('week=latest'));
  assert.equal(latest.week,'2026-11-09');
  assert(!h.calls.some(call=>call.endpoint.includes('/procedures/')),'the new empty agenda does not re-enrich the previous week');
});

test('index availability updates between batches do not starve the end of the agenda',async t=>{
  const h=await harness(t),service=createInsights(h.store,h.options);
  assert.equal(await service.warmPlenary(),1000);
  h.store.set('availabilityRevision',1);
  assert.equal(await service.warmPlenary(),1000);
  h.store.set('availabilityRevision',2);
  assert.equal(await service.warmPlenary(),PLENARY_REFRESH_MS);
  h.setForeground(true);
  const week=await service.query('legislation',new URLSearchParams('week=latest')),topic=week.topics.at(-1),count=h.calls.length;
  const result=await service.query('legislation',new URLSearchParams({sitting:topic.sittingId,topic:topic.id}));
  assert.equal(result.detail.id,topic.id);assert.equal(h.calls.length,count);
});

test('a visitor can use foreground capacity while its cold detail is queued for background warm-up',async t=>{
  const h=await harness(t);h.allowMixed();
  const queue=new UpstreamQueue(),release=await queue.acquire('background'),request=h.options.request;
  let foregroundCalls=0,blockedProcedure,entered;
  const queued=new Promise(resolve=>entered=resolve);
  h.options.request=(endpoint,params,settings)=>{
    if(!endpoint.startsWith('/procedures/'))return request(endpoint,params,settings);
    const pending=queue.run(()=>{if(settings.priority==='interactive')foregroundCalls++;return request(endpoint,params,settings);},settings);
    if(settings.priority==='background'){blockedProcedure=endpoint.split('/').at(-1);entered();}
    return pending;
  };
  const service=createInsights(h.store,h.options),warming=service.warmPlenary();
  try {
    await sharedRequest(()=>queued,2000);
    assert.equal(queue.waiters.length,1,'warm-up is waiting for the occupied background slot');
    const week=await service.query('legislation',new URLSearchParams('week=latest')),topic=week.topics.find(topic=>topic.procedureIds.includes(blockedProcedure));
    assert(topic,'the queued procedure belongs to an exact agenda item');
    const params=new URLSearchParams({sitting:topic.sittingId,topic:topic.id});
    const [first,second]=await sharedRequest(()=>Promise.all([service.query('legislation',params),service.query('legislation',params)]),1000);
    assert.equal(first.detail.id,topic.id);assert.deepEqual(second,first);
    assert(foregroundCalls>0,'the visitor reaches the normal foreground source admission');
    assert.equal(queue.waiters.length,1,'the background slot remains occupied');
  }finally{release();await warming;}
});
