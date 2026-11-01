import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

beforeEach(registerSubprocesses);
const moduleUrl=new URL('./odp.mjs',import.meta.url).href;

async function fixture(t,scenario) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'odp-memory-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const script=`
    import assert from 'node:assert/strict';
    import {writeFile,rm,stat,truncate,readdir,mkdir,utimes} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    import path from 'node:path';
    const directory=process.env.ODP_CACHE_DIR;
    let calls=0,allowed=false;
    let networkPayload={data:[{identifier:'network'}]};
    globalThis.fetch=async()=>{
      calls++;
      if(!allowed)throw new Error('Synthetic upstream disabled');
      return Response.json(networkPayload);
    };
    const {odp,ODP_BASE}=await import(${JSON.stringify(moduleUrl)});
    async function save(endpoint,payload={data:[{identifier:endpoint}]},{legacy=false,padding=0}={}) {
      const url=new URL(ODP_BASE+endpoint);
      url.searchParams.set('format','application/ld+json');
      const record={url:url.href,fetchedAt:Date.now(),payload};
      const name=legacy?Buffer.from(url.href).toString('base64url'):createHash('sha256').update(url.href).digest('hex');
      const file=path.join(directory,name+'.json'),serialized=JSON.stringify(record);
      await writeFile(file,serialized);
      if(padding)await truncate(file,Buffer.byteLength(serialized)+padding);
      return record;
    }
    ${scenario}
    console.log('fixture passed');
  `;
  const result=await execFileAsync(t,process.execPath,['--input-type=module','--eval',script],{
    env:{...process.env,ODP_CACHE_DIR:directory},maxBuffer:1024*1024,
  });
  assert.match(result.stdout,/fixture passed/);
  for(const line of result.stdout.split('\n'))if(line.startsWith('{'))t.diagnostic(line);
}

test('disk and network ODP records share the memory entry limit without losing their source fields',async t=>{
  await fixture(t,`
    for(let i=0;i<1801;i++){
      const expected=await save('/memory-count-'+i);
      assert.deepEqual(await odp('/memory-count-'+i),expected);
    }
    assert.equal(calls,0);
    allowed=true;
    const fresh=await odp('/memory-network');
    assert.equal(fresh.payload.data[0].identifier,'network');
    allowed=false;
    await rm(directory,{recursive:true});
    await assert.rejects(odp('/memory-count-0'),/Synthetic upstream disabled/);
    await assert.rejects(odp('/memory-count-1'),/Synthetic upstream disabled/);
    assert.equal((await odp('/memory-count-2')).payload.data[0].identifier,'/memory-count-2');
    assert.deepEqual(await odp('/memory-network'),fresh);
    assert.equal(calls,3);
  `);
});

test('automatic plenary sources share a disk entry budget across week changes and remain readable after restart',async t=>{
  await fixture(t,`
    const retained=await save('/unrelated-retained-source');
    const bounded=path.join(directory,'plenary-sources-v1');await mkdir(bounded);
    let oldest;
    for(let offset=0;offset<1800;offset++) {
      const url=new URL(ODP_BASE+'/speeches');
      for(const [key,value] of Object.entries({'sitting-date':'2026-10-05',offset,format:'application/ld+json'}))url.searchParams.set(key,String(value));
      const file=path.join(bounded,createHash('sha256').update(url.href).digest('hex')+'.json');
      await writeFile(file,JSON.stringify({url:url.href,fetchedAt:Date.now(),payload:{data:[]}}));
      if(!offset){oldest=file;await utimes(file,new Date(0),new Date(0));}
    }
    allowed=true;
    const params={'sitting-date':'2026-10-12',offset:0};
    const current=await odp('/speeches',params,{cacheGroup:'plenary',priority:'background'});
    const files=await readdir(bounded);assert.equal(files.length,1800);
    await assert.rejects(stat(oldest),error=>error.code==='ENOENT');
    assert.equal((await readdir(directory)).filter(name=>/^[a-f0-9]{64}\\.json$/.test(name)).length,1,'the automatic walk does not publish into the general directory');
    allowed=false;const cold=await import(${JSON.stringify(moduleUrl+'?bounded-plenary-restart')});
    assert.deepEqual(await cold.odp('/speeches',params),current);assert.equal(calls,1);
    assert.deepEqual(await cold.odp('/unrelated-retained-source'),retained,'unrelated retained data is preserved');
  `);
});

test('the aggregate plenary source byte budget evicts old weeks without touching unrelated caches',async t=>{
  await fixture(t,`
    const retained=await save('/unrelated-byte-budget-source');
    const bounded=path.join(directory,'plenary-sources-v1');await mkdir(bounded);
    const old=[];
    for(let i=0;i<3;i++) {
      const file=path.join(bounded,String(i).padStart(64,'0')+'.json');old.push(file);
      await writeFile(file,'{}');await truncate(file,50*1024*1024);
      await utimes(file,new Date(1000+i),new Date(1000+i));
    }
    allowed=true;
    await odp('/speeches',{'sitting-date':'2026-10-19'},{cacheGroup:'plenary',priority:'background'});
    const files=await readdir(bounded),sizes=await Promise.all(files.map(name=>stat(path.join(bounded,name))));
    assert(sizes.reduce((sum,file)=>sum+file.size,0)<=128*1024*1024);
    await assert.rejects(stat(old[0]),error=>error.code==='ENOENT');
    assert.deepEqual(await odp('/unrelated-byte-budget-source'),retained);
  `);
});

test('foreground reads and stale refreshes reuse bounded plenary sources without duplicating flat files',async t=>{
  await fixture(t,`
    let time=Date.parse('2026-10-19T12:00:00Z');Date.now=()=>time;
    allowed=true;
    const params={'sitting-date':'2026-10-19'},first=await odp('/speeches',params,{cacheGroup:'plenary',priority:'background'});
    const flat=path.join(directory,createHash('sha256').update(first.url).digest('hex')+'.json');
    const cold=await import(${JSON.stringify(moduleUrl+'?bounded-plenary-swr')});
    assert.deepEqual(await cold.odp('/speeches',params),first);
    time+=7*60*60_000;networkPayload={data:[{identifier:'later publication'}]};
    assert.equal((await cold.odp('/speeches',params,{staleWhileRevalidate:true})).stale,true);
    const updated=await cold.odp('/speeches',params,{force:true});
    assert.equal(updated.payload.data[0].identifier,'later publication');
    await assert.rejects(stat(flat),error=>error.code==='ENOENT');
    assert.equal((await readdir(path.join(directory,'plenary-sources-v1'))).length,1);
    allowed=false;const restarted=await import(${JSON.stringify(moduleUrl+'?bounded-plenary-swr-restart')});
    assert.deepEqual(await restarted.odp('/speeches',params),updated);assert.equal(calls,2);
  `);
});

test('a warm-up joining a foreground source keeps their shared publication in the bounded directory',async t=>{
  await fixture(t,`
    let finish,started;
    const fetching=new Promise(resolve=>started=resolve);
    globalThis.fetch=async()=>{calls++;const response=new Promise(resolve=>finish=()=>resolve(Response.json({data:[]})));started();return response;};
    const params={'sitting-date':'2026-10-26'},foreground=odp('/speeches',params);
    await Promise.race([fetching,foreground]);
    assert(finish);
    const background=odp('/speeches',params,{cacheGroup:'plenary',priority:'background'});
    const {upstreamStatus}=await import(${JSON.stringify(moduleUrl)});
    const deadline=Date.now()+5000;
    while(upstreamStatus().background!==1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(upstreamStatus().background,1);finish();
    assert.deepEqual(await foreground,await background);assert.equal(calls,1);
    assert.equal((await readdir(directory)).filter(name=>/^[a-f0-9]{64}\\.json$/.test(name)).length,0);
    assert.equal((await readdir(path.join(directory,'plenary-sources-v1'))).length,1);
  `);
});

test('evicting a warmed correction cannot reveal its superseded general-cache source',async t=>{
  await fixture(t,`
    const old=await save('/procedures/2026-0001');
    const flat=path.join(directory,createHash('sha256').update(old.url).digest('hex')+'.json');
    allowed=true;networkPayload={data:[{identifier:'corrected source'}]};
    await odp('/procedures/2026-0001',{}, {force:true,cacheGroup:'plenary',priority:'background'});
    await assert.rejects(stat(flat),error=>error.code==='ENOENT');
    await rm(path.join(directory,'plenary-sources-v1',createHash('sha256').update(old.url).digest('hex')+'.json'));
    const cold=await import(${JSON.stringify(moduleUrl+'?evicted-plenary-correction')});
    assert.equal((await cold.odp('/procedures/2026-0001')).payload.data[0].identifier,'corrected source');
    assert.equal(calls,2,'the evicted observation is re-read rather than replaced with superseded bytes');
  `);
});

test('a forced foreground refresh after restart preserves the warmed source location and correction',async t=>{
  await fixture(t,`
    let time=Date.parse('2026-10-19T12:00:00Z');Date.now=()=>time;
    allowed=true;networkPayload={data:[{identifier:'first observation'}]};
    await odp('/procedures/2026-0002',{}, {cacheGroup:'plenary',priority:'background'});
    time+=1000;networkPayload={data:[{identifier:'corrected observation'}]};
    const cold=await import(${JSON.stringify(moduleUrl+'?plenary-force-after-restart')});
    const corrected=await cold.odp('/procedures/2026-0002',{}, {force:true});
    allowed=false;const restarted=await import(${JSON.stringify(moduleUrl+'?plenary-force-correction')});
    assert.deepEqual(await restarted.odp('/procedures/2026-0002'),corrected);
    assert.equal((await readdir(directory)).filter(name=>/^[a-f0-9]{64}\\.json$/.test(name)).length,0);
    assert.equal(calls,2);
  `);
});

test('a stale general source reports its refresh pending before storage-location discovery',async t=>{
  await fixture(t,`
    let time=Date.parse('2026-10-19T12:00:00Z');Date.now=()=>time;
    const old=await save('/procedures/2026-0003');time+=7*60*60_000;
    let finish,started;const fetching=new Promise(resolve=>started=resolve);
    globalThis.fetch=async()=>{calls++;const response=new Promise(resolve=>finish=()=>resolve(Response.json({data:[{identifier:'refreshed'}]})));started();return response;};
    const stale=await odp('/procedures/2026-0003',{}, {staleWhileRevalidate:true});
    assert.deepEqual(stale.payload,old.payload);assert.equal(stale.refreshInProgress,true);
    const refreshing=odp('/procedures/2026-0003',{}, {force:true});
    await fetching;finish();
    assert.equal((await refreshing).payload.data[0].identifier,'refreshed');assert.equal(calls,1);
  `);
});

test('ODP memory has a byte limit and replacing a record releases its previous byte charge',async t=>{
  await fixture(t,`
    const text='é'.repeat(3*1024*1024);
    for(let i=0;i<11;i++){
      await save('/memory-bytes-'+i,{data:[{identifier:String(i),text}]});
      assert.equal((await odp('/memory-bytes-'+i)).payload.data[0].identifier,String(i));
    }
    allowed=true;
    networkPayload={data:[{identifier:'10',text}]};
    for(let i=0;i<3;i++)await odp('/memory-bytes-10',{}, {force:true});
    allowed=false;
    await rm(directory,{recursive:true});
    await assert.rejects(odp('/memory-bytes-0'),/Synthetic upstream disabled/);
    for(let i=1;i<11;i++)assert.equal((await odp('/memory-bytes-'+i)).payload.data[0].identifier,String(i));
    assert.equal(calls,4);
  `);
});

test('oversized hashed and legacy disk records are not parsed or promoted, while valid legacy records remain readable',async t=>{
  await fixture(t,`
    allowed=true;
    for(const legacy of [false,true]){
      const endpoint='/memory-oversized-'+legacy;
      const record=await save(endpoint,{data:[{identifier:'disk'}]},{legacy,padding:80*1024*1024});
      const name=legacy?Buffer.from(record.url).toString('base64url'):createHash('sha256').update(record.url).digest('hex');
      const info=await stat(path.join(directory,name+'.json'));
      // Match the production serialized-record ceiling, including its overflow byte.
      const maxDiskRecordBytes=6*12*1024*1024+64*1024;
      assert.equal(info.size,Buffer.byteLength(JSON.stringify(record))+80*1024*1024);
      assert(info.size>maxDiskRecordBytes);
      console.log(JSON.stringify({legacy,logicalBytes:info.size,physicalBytes:info.blocks*512,maxDiskRecordBytes}));
      const parse=JSON.parse;let oversizedParses=0;
      JSON.parse=function(text,...args){if(typeof text==='string'&&text.includes(record.url))oversizedParses++;return parse(text,...args);};
      try {assert.equal((await odp(endpoint)).payload.data[0].identifier,'network');}
      finally {JSON.parse=parse;}
      assert.equal(oversizedParses,0,'reject the overflowing stream before attempting JSON.parse');
    }
    allowed=false;
    const expected=await save('/memory-valid-legacy',undefined,{legacy:true});
    assert.deepEqual(await odp('/memory-valid-legacy'),expected);
    const controller=new AbortController();controller.abort(new Error('Cancelled fixture reader'));
    await assert.rejects(odp('/memory-valid-legacy',{}, {signal:controller.signal}),/Cancelled fixture reader/);
    assert.equal(calls,2);
  `);
});

test('accepted network records remain readable from disk after JSON number normalization expands them',async t=>{
  await fixture(t,`
    const body='{"data":['+'1e20,'.repeat(599999)+'1e20]}';
    assert(Buffer.byteLength(body)<12*1024*1024);
    globalThis.fetch=async()=>{calls++;return new Response(body,{headers:{'Content-Type':'application/json'}});};
    const expected=await odp('/memory-normalized');
    const file=path.join(directory,createHash('sha256').update(expected.url).digest('hex')+'.json');
    assert((await stat(file)).size>12*1024*1024+64*1024);
    globalThis.fetch=async()=>assert.fail('A valid fresh saved record must not need upstream');
    const cold=await import(${JSON.stringify(moduleUrl+'?normalized-cold')});
    const saved=await cold.odp('/memory-normalized');
    assert.equal(saved.url,expected.url);assert.equal(saved.fetchedAt,expected.fetchedAt);
    assert.equal(saved.payload.data.length,600000);assert.equal(saved.payload.data.at(-1),1e20);
    assert.equal(calls,1);
  `);
});

test('agenda sources survive restart, retain provenance on failed refresh and recover',async t=>{
  await fixture(t,`
    const endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities';
    allowed=true;
    const expected=await odp(endpoint,{limit:50,offset:0});
    const file=path.join(directory,'plenary-agendas-v1',createHash('sha256').update(expected.url).digest('hex')+'.json');
    assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(file,'utf8')).fetchedAt,expected.fetchedAt);
    const cold=await import(${JSON.stringify(moduleUrl+'?agenda-cold')});
    allowed=false;
    assert.deepEqual(await cold.odp(endpoint,{limit:50,offset:0}),expected);assert.equal(calls,1);
    await assert.rejects(cold.odp(endpoint,{limit:50,offset:0},{force:true}),/Synthetic upstream disabled/);
    assert.deepEqual((await cold.odp(endpoint,{limit:50,offset:0},{cachedOnly:true})).payload,expected.payload);
    assert.equal((await cold.odp(endpoint,{limit:50,offset:0},{cachedOnly:true})).fetchedAt,expected.fetchedAt);
    allowed=true;networkPayload={data:[{identifier:'recovered'}]};
    assert.equal((await cold.odp(endpoint,{limit:50,offset:0},{force:true})).payload.data[0].identifier,'recovered');
  `);
});

test('agenda disk budget evicts older files without touching general sources and reads former locations',async t=>{
  await fixture(t,`
    const agendaDir=path.join(directory,'plenary-agendas-v1');await mkdir(agendaDir);
    const oldTime=new Date(Date.now()-86400_000);
    for(let i=0;i<5;i++){
      const file=path.join(agendaDir,createHash('sha256').update('old-'+i).digest('hex')+'.json');
      await writeFile(file,'{}');await truncate(file,8*1024*1024);await utimes(file,oldTime,oldTime);
    }
    const general=await save('/unrelated-source');
    const legacy=await save('/meetings/MTG-PL-2026-09-16/foreseen-activities');
    assert.deepEqual(await odp('/meetings/MTG-PL-2026-09-16/foreseen-activities'),legacy);
    allowed=true;await odp('/meetings/MTG-PL-2026-10-07/foreseen-activities');
    const sizes=await Promise.all((await readdir(agendaDir)).map(async name=>(await stat(path.join(agendaDir,name))).size));
    assert(sizes.reduce((a,b)=>a+b,0)<=32*1024*1024);
    assert.deepEqual(await odp('/unrelated-source'),general);
    const cold=await import(${JSON.stringify(moduleUrl+'?agenda-legacy')});allowed=false;
    assert.deepEqual(await cold.odp('/meetings/MTG-PL-2026-09-16/foreseen-activities'),legacy);
  `);
});

test('all consumers reuse an aged completed-week agenda across restart without source rechecks',async t=>{
  await fixture(t,`
    const endpoint='/meetings/MTG-PL-2024-07-17/foreseen-activities';
    allowed=true;const expected=await odp(endpoint);assert.equal(calls,1);allowed=false;
    const time=Date.now();Date.now=()=>time+60*86400_000;
    const cold=await import(${JSON.stringify(moduleUrl+'?settled-agenda')});
    const retained=await cold.odp(endpoint,{}, {ttl:60_000,staleWhileRevalidate:true});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(retained,expected);assert.equal(calls,1);
  `);
});

test('a shorter live-reader TTL cannot recheck the active agenda before one hour',async t=>{
  await fixture(t,`
    let time=Date.parse('2026-10-20T12:00:00Z');Date.now=()=>time;
    const endpoint='/meetings/MTG-PL-2026-10-20/foreseen-activities';
    allowed=true;const expected=await odp(endpoint,{}, {ttl:60_000});assert.equal(calls,1);
    allowed=false;time+=5*60_000;
    assert.deepEqual(await odp(endpoint,{}, {ttl:60_000}),expected);assert.equal(calls,1);
    time+=55*60_000+1;allowed=true;networkPayload={data:[{identifier:'hourly update'}]};
    assert.equal((await odp(endpoint,{}, {ttl:60_000})).payload.data[0].identifier,'hourly update');assert.equal(calls,2);
  `);
});

test('a preliminary agenda gets one post-week read, retains bytes on failure, then settles',async t=>{
  await fixture(t,`
    let time=Date.parse('2026-11-01T12:00:00Z');Date.now=()=>time;
    const endpoint='/meetings/MTG-PL-2026-11-11/foreseen-activities';
    allowed=true;const preliminary=await odp(endpoint),fetchMock=globalThis.fetch;
    time=Date.parse('2026-11-16T12:00:00Z');
    const cold=await import(${JSON.stringify(moduleUrl+'?preliminary-agenda')});
    let fail;globalThis.fetch=async()=>{calls++;return new Promise((resolve,reject)=>fail=()=>reject(Error('Final source unavailable')));};
    const retained=await cold.odp(endpoint,{}, {staleWhileRevalidate:true});
    assert.equal(retained.stale,true);assert.deepEqual(retained.payload,preliminary.payload);
    await new Promise(resolve=>setImmediate(resolve));
    const pending=assert.rejects(cold.odp(endpoint,{}, {force:true}),/Final source unavailable/);fail();await pending;
    assert.equal((await cold.odp(endpoint,{}, {cachedOnly:true})).fetchedAt,preliminary.fetchedAt);
    assert.equal((await cold.odp(endpoint,{}, {cachedOnly:true})).stale,true);
    globalThis.fetch=fetchMock;networkPayload={data:[{identifier:'final agenda'}]};time+=60*60_000+1;
    const final=await cold.odp(endpoint);assert.equal(final.payload.data[0].identifier,'final agenda');
    const count=calls;time+=60*86400_000;allowed=false;
    const restarted=await import(${JSON.stringify(moduleUrl+'?final-agenda')});
    assert.deepEqual(await restarted.odp(endpoint),final);assert.equal(calls,count);
  `);
});

test('actual agenda changes invalidate retained records and views; unchanged reads do not',async t=>{
  await fixture(t,`
    const {readFile}=await import('node:fs/promises');
    const inputs=JSON.parse(await readFile(new URL('./fixtures/insights-live-20261014.json',${JSON.stringify(moduleUrl)}),'utf8'));
    const endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities',params={limit:50,offset:0};
    let agenda=structuredClone(inputs.foreseen.payload);
    const meeting=inputs.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
    globalThis.fetch=async value=>{
      calls++;const url=new URL(value);
      return Response.json(url.pathname.endsWith('/meetings')?{data:url.searchParams.get('year')==='2026'?[meeting]:[]}:agenda);
    };
    const {LegislationInsights}=await import(${JSON.stringify(moduleUrl.replace('odp.mjs','insights-legislation.mjs'))});
    const {createInsights}=await import(${JSON.stringify(moduleUrl.replace('odp.mjs','insights.mjs'))});
    const {agendaCacheRevision}=await import(${JSON.stringify(moduleUrl)});
    const store={get:()=>null,status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined})}};
    const reader=new LegislationInsights(store),service=createInsights(store),query=new URLSearchParams('week=2026-10-05');
    await reader.record(endpoint,params);const before=await service.query('legislation',query),revision=await agendaCacheRevision();
    const topic=before.topics[0];assert(topic);
    await odp(endpoint,params,{force:true});assert.equal(await agendaCacheRevision(),revision,'identical source content does not invalidate derived caches');
    const corrected=agenda.data.find(node=>node.activity_id===topic.id);corrected.activity_label.en='Corrected exact agenda title';
    await odp(endpoint,params,{force:true});assert.notEqual(await agendaCacheRevision(),revision);
    assert.equal((await reader.record(endpoint,params)).payload.data.find(node=>node.activity_id===topic.id).activity_label.en,'Corrected exact agenda title');
    const after=await service.query('legislation',query);assert.equal(after.topics.find(node=>node.id===topic.id).title,'Corrected exact agenda title');
    const cold=await import(${JSON.stringify(moduleUrl+'?revision-restart')});assert.equal(await cold.agendaCacheRevision(),await agendaCacheRevision());
    const restarted=createInsights(store);assert.equal((await restarted.query('legislation',query)).topics.find(node=>node.id===topic.id).title,'Corrected exact agenda title');
    const count=calls;await service.query('legislation',query);assert.equal(calls,count,'retained correction needs no periodic source read');
  `);
});

test('bounded agenda eviction cannot restore a superseded flat-cache observation',async t=>{
  await fixture(t,`
    const endpoint='/meetings/MTG-PL-2024-07-17/foreseen-activities';
    const old=await save(endpoint),flat=path.join(directory,createHash('sha256').update(old.url).digest('hex')+'.json');
    allowed=true;networkPayload={data:[{identifier:'accepted correction'}]};
    const corrected=await odp(endpoint,{}, {force:true});assert.equal(corrected.payload.data[0].identifier,'accepted correction');
    await assert.rejects(stat(flat),error=>error.code==='ENOENT');
    await rm(path.join(directory,'plenary-agendas-v1',createHash('sha256').update(old.url).digest('hex')+'.json'));
    const cold=await import(${JSON.stringify(moduleUrl+'?evicted-migration')});
    assert.equal((await cold.odp(endpoint)).payload.data[0].identifier,'accepted correction');assert.equal(calls,2);
  `);
});

test('failed revision persistence leaves source and historical views consistent across restart and recovers on identical content',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    const {InsightViewCache}=await import(${JSON.stringify(new URL('./insights-view-cache.mjs',import.meta.url).href)});
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities';
    allowed=true;networkPayload={data:[{identifier:'original'}]};
    const first=await odp(endpoint),{agendaCacheRevision,agendaCacheRevisionIsDurable}=await import(${JSON.stringify(moduleUrl)});
    const originalRevision=await agendaCacheRevision();
    const recordFile=path.join(directory,'plenary-agendas-v1',createHash('sha256').update(first.url).digest('hex')+'.json');
    const revisionFile=path.join(directory,'plenary-agendas-v1','revision.json');
    const views=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    const options={freshMs:()=>Infinity};
    await views.get(['agenda',originalRevision],async()=>({title:'original'}),options);
    const rename=fs.rename,warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
    fs.rename=async(from,to)=>{if(to===revisionFile)throw Object.assign(new Error('Revision denied'),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
    time++;networkPayload={data:[{identifier:'corrected'}]};
    const fresh=await odp(endpoint,{}, {force:true});assert.equal(fresh.payload.data[0].identifier,'corrected');
    const memoryRevision=await agendaCacheRevision();assert.notEqual(memoryRevision,originalRevision);
    assert.equal(JSON.parse(await fs.readFile(recordFile,'utf8')).payload.data[0].identifier,'original','new source bytes require durable invalidation');
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).revision,originalRevision);
    assert(warnings.some(args=>args[0]==='[agenda-cache-revision]'));
    await views.get(['agenda',memoryRevision],async()=>({title:'corrected'}),{...options,persist:()=>agendaCacheRevisionIsDurable(memoryRevision)});
    await assert.rejects(fs.stat(path.join(directory,'views',views.key(['agenda',memoryRevision])+'.json')),error=>error.code==='ENOENT');
    const cold=await import(${JSON.stringify(moduleUrl+'?revision-write-failed')});
    const retained=await cold.odp(endpoint,{}, {cachedOnly:true});
    const restartedViews=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    const restored=await restartedViews.get(['agenda',await cold.agendaCacheRevision()],async()=>assert.fail('reuse the retained view'),options);
    assert.equal(restored.title,retained.payload.data[0].identifier,'restart never pairs an old view with a newly published source');
    fs.rename=rename;syncBuiltinESMExports();console.warn=warn;
    time++;await odp(endpoint,{}, {force:true});
    const committed=await agendaCacheRevision();
    assert.notEqual(committed,memoryRevision,'recovery never makes memory-only view keys durable');
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).revision,committed);
    const recovered=await import(${JSON.stringify(moduleUrl+'?revision-write-recovered')});
    assert.equal(await recovered.agendaCacheRevision(),committed);
    assert.equal((await recovered.odp(endpoint,{}, {cachedOnly:true})).payload.data[0].identifier,'corrected');
    assert.equal(calls,3);
  `);
});

for(const group of ['agenda','plenary'])test(group+' cleanup failure serves fresh data without saving an update behind old aliases',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const group=${JSON.stringify(group)},endpoint=group==='agenda'?'/meetings/MTG-PL-2026-10-07/foreseen-activities':'/procedures/2026-0001';
    const settings=group==='agenda'?{}:{cacheGroup:'plenary'};
    const old=await save(endpoint,{data:[{identifier:'original'}]});
    await save(endpoint,old.payload,{legacy:true});
    const hash=createHash('sha256').update(old.url).digest('hex');
    const aliases=[path.join(directory,hash+'.json'),path.join(directory,Buffer.from(old.url).toString('base64url')+'.json')];
    const canonical=path.join(directory,group==='agenda'?'plenary-agendas-v1':'plenary-sources-v1',hash+'.json');
    const unlink=fs.unlink,rename=fs.rename,warn=console.warn,warnings=[];console.warn=(...args)=>warnings.push(args);
    fs.unlink=async file=>{if(file===aliases[0])throw Object.assign(new Error('Cleanup denied'),{code:'EACCES'});return unlink(file);};syncBuiltinESMExports();
    time++;allowed=true;networkPayload={data:[{identifier:'corrected'}]};
    const fresh=await odp(endpoint,{}, {...settings,force:true});
    assert.equal(fresh.payload.data[0].identifier,'corrected','local cleanup must not turn a validated source into an upstream error');
    assert.equal((await odp(endpoint,{}, {...settings,cachedOnly:true})).refreshError,undefined);
    assert.equal(JSON.parse(await fs.readFile(canonical,'utf8')).payload.data[0].identifier,'original');
    assert.equal(JSON.parse(await fs.readFile(aliases[0],'utf8')).payload.data[0].identifier,'original');
    assert(warnings.some(args=>args[0]==='[source-cache-migration]'));
    fs.unlink=unlink;
    fs.rename=async(from,to)=>{if(to===canonical)throw Object.assign(new Error('Fresh write denied'),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
    time++;assert.equal((await odp(endpoint,{}, {...settings,force:true})).payload.data[0].identifier,'corrected');
    assert.equal(JSON.parse(await fs.readFile(canonical,'utf8')).payload.data[0].identifier,'original','failed fresh publication preserves the migrated observation');
    fs.rename=rename;syncBuiltinESMExports();console.warn=warn;
    time++;await odp(endpoint,{}, {...settings,force:true});
    assert.equal(JSON.parse(await fs.readFile(canonical,'utf8')).payload.data[0].identifier,'corrected');
    for(const alias of aliases)await assert.rejects(fs.stat(alias),error=>error.code==='ENOENT');
    await fs.rm(canonical);
    const recovered=await import(${JSON.stringify(moduleUrl+'?cleanup-recovered-')}+group),count=calls;
    networkPayload={data:[{identifier:'after eviction'}]};
    assert.equal((await recovered.odp(endpoint,{},settings)).payload.data[0].identifier,'after eviction');
    assert.equal(calls,count+1,'eviction cannot resurrect the retired observation');
  `);
});

for(const failure of ['revision','cleanup'])for(const recovery of ['identical','changed','restart'])test(failure+' failure keeps another agenda from committing an unsaved source before '+recovery+' recovery',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    const {InsightViewCache}=await import(${JSON.stringify(new URL('./insights-view-cache.mjs',import.meta.url).href)});
    const failure=${JSON.stringify(failure)},recovery=${JSON.stringify(recovery)};
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const a='/meetings/MTG-PL-2026-10-07/foreseen-activities',b='/meetings/MTG-PL-2026-09-17/foreseen-activities';
    const oldA=await save(a,{data:[{identifier:'old A'}]}),oldB=await save(b,{data:[{identifier:'old B'}]});
    const revisionFile=path.join(directory,'plenary-agendas-v1','revision.json');
    const alias=path.join(directory,createHash('sha256').update(oldA.url).digest('hex')+'.json');
    const rename=fs.rename,unlink=fs.unlink,warn=console.warn;console.warn=()=>{};
    if(failure==='revision')fs.rename=async(from,to)=>{if(to===revisionFile)throw Object.assign(new Error('Denied revision'),{code:'EACCES'});return rename(from,to);};
    else fs.unlink=async file=>{if(file===alias)throw Object.assign(new Error('Denied cleanup'),{code:'EACCES'});return unlink(file);};
    syncBuiltinESMExports();allowed=true;time++;networkPayload={data:[{identifier:'new A'}]};
    await odp(a,{}, {force:true});
    fs.rename=rename;syncBuiltinESMExports();
    time++;networkPayload={data:[{identifier:'new B'}]};await odp(b,{}, {force:true});
    const {agendaCacheRevision,agendaCacheRevisionIsDurable}=await import(${JSON.stringify(moduleUrl)});
    const memoryRevision=await agendaCacheRevision();
    assert.equal(await agendaCacheRevisionIsDurable(memoryRevision),false);
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).pending,true,'B must leave the pending publication journal open');
    const views=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    const key=['agenda',memoryRevision],options={freshMs:()=>Infinity,persist:()=>agendaCacheRevisionIsDurable(memoryRevision)};
    assert.equal((await views.get(key,async()=>({title:'new A'}),options)).title,'new A');
    await assert.rejects(fs.stat(path.join(directory,'views',views.key(key)+'.json')),error=>error.code==='ENOENT','an unsaved view stays memory-only');
    fs.unlink=unlink;syncBuiltinESMExports();console.warn=warn;
    if(recovery!=='restart') {
      time++;networkPayload={data:[{identifier:recovery==='identical'?'new A':'newest A'}]};await odp(a,{}, {force:true});
      const committed=await agendaCacheRevision();assert.equal(await agendaCacheRevisionIsDurable(committed),true);
      assert.notEqual(committed,memoryRevision);
      assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).pending,undefined);
    }
    const cold=await import(${JSON.stringify(moduleUrl+'?multi-agenda-')}+failure+'-'+recovery);
    const coldRevision=await cold.agendaCacheRevision();assert.notEqual(coldRevision,memoryRevision);
    const source=await cold.odp(a,{}, {cachedOnly:true}),sourceB=await cold.odp(b,{}, {cachedOnly:true});
    const restartedViews=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    const restored=await restartedViews.get(['agenda',coldRevision],async()=>({title:source.payload.data[0].identifier}),{freshMs:()=>Infinity});
    assert.equal(restored.title,recovery==='restart'?'old A':recovery==='identical'?'new A':'newest A');
    assert.equal(sourceB.payload.data[0].identifier,'new B');
  `);
});

test('an oversized migrated agenda keeps its legacy copy when the disk budget removes the canonical record',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities';
    const old=await save(endpoint,{data:[{identifier:'oversized retained agenda',text:'x'.repeat(33*1024*1024)}]});
    const hash=createHash('sha256').update(old.url).digest('hex'),alias=path.join(directory,hash+'.json');
    const canonical=path.join(directory,'plenary-agendas-v1',hash+'.json'),rename=fs.rename;
    fs.rename=async(from,to)=>{if(to===canonical&&(await fs.stat(from)).size<1024)throw Object.assign(new Error('Fresh write denied'),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
    time++;allowed=true;networkPayload={data:[{identifier:'fresh small agenda'}]};
    assert.equal((await odp(endpoint,{}, {force:true})).payload.data[0].identifier,'fresh small agenda');
    assert((await fs.stat(alias)).size>32*1024*1024);
    await assert.rejects(fs.stat(canonical),error=>error.code==='ENOENT');
    fs.rename=rename;syncBuiltinESMExports();
    const cold=await import(${JSON.stringify(moduleUrl+'?oversized-migration')});
    assert.equal((await cold.odp(endpoint,{}, {cachedOnly:true})).payload.data[0].identifier,'oversized retained agenda');
    assert.equal(calls,1);
  `);
});

for(const failure of ['revision','cleanup'])test('real legislation views stay memory-only when '+failure+' fails during a cold load',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    const {createInsights}=await import(${JSON.stringify(new URL('./insights.mjs',import.meta.url).href)});
    const {agendaCacheRevision,agendaCacheRevisionIsDurable}=await import(${JSON.stringify(moduleUrl)});
    const inputs=JSON.parse(await fs.readFile(new URL('./fixtures/insights-live-20261014.json',${JSON.stringify(moduleUrl)}),'utf8'));
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const failure=${JSON.stringify(failure)},endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities',params={limit:50,offset:0};
    const agenda=structuredClone(inputs.foreseen.payload),topic=agenda.data.find(node=>node.activity_id?.includes('-OJ-ITM-'));
    topic.activity_label.en='New exact agenda title';
    const meeting=inputs.meetings.payload.data.find(node=>node.activity_id==='MTG-PL-2026-10-07');
    globalThis.fetch=async value=>{calls++;const url=new URL(value);return Response.json(url.pathname.endsWith('/meetings')?{data:url.searchParams.get('year')==='2026'?[meeting]:[]}:agenda);};
    const sourceUrl=new URL(ODP_BASE+endpoint);for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))sourceUrl.searchParams.set(key,String(value));
    const alias=path.join(directory,createHash('sha256').update(sourceUrl.href).digest('hex')+'.json');
    if(failure==='cleanup')await fs.writeFile(alias,JSON.stringify({url:sourceUrl.href,fetchedAt:time,payload:inputs.foreseen.payload}));
    const revisionFile=path.join(directory,'plenary-agendas-v1','revision.json'),rename=fs.rename,unlink=fs.unlink,warn=console.warn;console.warn=()=>{};
    if(failure==='revision')fs.rename=async(from,to)=>{if(to===revisionFile)throw Object.assign(new Error('Denied'),{code:'EACCES'});return rename(from,to);};
    else fs.unlink=async file=>{if(file===alias)throw Object.assign(new Error('Denied'),{code:'EACCES'});return unlink(file);};
    syncBuiltinESMExports();time++;
    const viewsDirectory=path.join(directory,'real-views');
    const store={get:()=>null,status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined})}};
    const request=(name,values,settings)=>odp(name,values,{...settings,force:name===endpoint,staleWhileRevalidate:false});
    const service=createInsights(store,{clock:()=>time,request,viewCache:{directory:viewsDirectory}}),query=new URLSearchParams('week=2026-10-05');
    const before=await agendaCacheRevision(),result=await service.query('legislation',query);
    assert.equal(result.topics.find(row=>row.id===topic.activity_id).title,'New exact agenda title');
    const during=await agendaCacheRevision();assert.notEqual(during,before);
    assert.equal(await agendaCacheRevisionIsDurable(during),false);
    assert.deepEqual(await fs.readdir(viewsDirectory).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[],'neither the old key nor a memory-only revision may reach disk');
    fs.rename=rename;fs.unlink=unlink;syncBuiltinESMExports();console.warn=warn;
    time++;await odp(endpoint,params,{force:true});
    const committed=await agendaCacheRevision();assert.equal(await agendaCacheRevisionIsDurable(committed),true);
    assert.notEqual(committed,during);
    const recovered=await service.query('legislation',query);
    assert.equal(recovered.topics.find(row=>row.id===topic.activity_id).title,'New exact agenda title');
    assert.equal((await fs.readdir(viewsDirectory)).filter(name=>name.endsWith('.json')).length,1,'durable source recovery enables persistent views again');
  `);
});

test('a failed revision commit after durable source bytes invalidates pre-change views on restart',async t=>{
  await fixture(t,`
    const fs=(await import('node:fs/promises')).default;
    const {syncBuiltinESMExports}=await import('node:module');
    const {InsightViewCache}=await import(${JSON.stringify(new URL('./insights-view-cache.mjs',import.meta.url).href)});
    const {agendaCacheRevision,agendaCacheRevisionIsDurable}=await import(${JSON.stringify(moduleUrl)});
    let time=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>time;
    const endpoint='/meetings/MTG-PL-2026-10-07/foreseen-activities';
    allowed=true;networkPayload={data:[{identifier:'original'}]};await odp(endpoint);
    const original=await agendaCacheRevision(),views=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    await views.get(original,async()=>({title:'original'}),{freshMs:()=>Infinity});
    const revisionFile=path.join(directory,'plenary-agendas-v1','revision.json'),rename=fs.rename,warn=console.warn;console.warn=()=>{};
    fs.rename=async(from,to)=>{if(to===revisionFile&&!JSON.parse(await fs.readFile(from,'utf8')).pending)throw Object.assign(new Error('Commit denied'),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
    time++;networkPayload={data:[{identifier:'corrected'}]};await odp(endpoint,{}, {force:true});
    const memoryRevision=await agendaCacheRevision();assert.equal(await agendaCacheRevisionIsDurable(memoryRevision),false);
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).pending,true);
    const cold=await import(${JSON.stringify(moduleUrl+'?commit-failed')});
    const coldRevision=await cold.agendaCacheRevision();assert.notEqual(coldRevision,original);assert.notEqual(coldRevision,memoryRevision);
    const retained=await cold.odp(endpoint,{}, {cachedOnly:true});
    const restartedViews=new InsightViewCache({directory:path.join(directory,'views'),clock:()=>time});
    const restored=await restartedViews.get(coldRevision,async()=>({title:retained.payload.data[0].identifier}),{freshMs:()=>Infinity,persist:()=>cold.agendaCacheRevisionIsDurable(coldRevision)});
    assert.equal(restored.title,'corrected','an interrupted transaction never reuses a pre-change view');
    fs.rename=rename;syncBuiltinESMExports();console.warn=warn;
    time++;await cold.odp(endpoint,{}, {force:true});
    const recovered=await cold.agendaCacheRevision();assert.equal(await cold.agendaCacheRevisionIsDurable(recovered),true);
    assert.notEqual(recovered,coldRevision);
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).revision,recovered);
    assert.equal(JSON.parse(await fs.readFile(revisionFile,'utf8')).pending,undefined);
  `);
});
