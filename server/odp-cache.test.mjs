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
    import {writeFile,rm,stat,truncate} from 'node:fs/promises';
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
    const {mkdir,readdir,utimes}=await import('node:fs/promises');
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
