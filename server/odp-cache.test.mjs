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
