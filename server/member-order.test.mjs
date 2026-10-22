import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('directory emits displayed surname/first-name order from the upstream roster',async t=>{
  const cache=await mkdtemp(path.join(tmpdir(),'member-order-'));
  const previousCache=process.env.ODP_CACHE_DIR;
  process.env.ODP_CACHE_DIR=cache;
  t.after(async()=>{
    if(previousCache===undefined)delete process.env.ODP_CACHE_DIR;
    else process.env.ODP_CACHE_DIR=previousCache;
    await rm(cache,{recursive:true,force:true});
  });
  // Keep the background feed sync local as well as the roster/profile reads.
  await writeFile(path.join(cache,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400_000).toISOString()}));
  const roster=[
    {identifier:'1',givenName:'Stefan',familyName:'Berger',sortLabel:'BERGERS'},
    {identifier:'2',givenName:'Sibylle',familyName:'Berg',sortLabel:'BERGS'},
    {identifier:'3',givenName:'Asger',familyName:'Christensen',sortLabel:'CHRISTENSENA'},
    {identifier:'4',givenName:'Marie-Sophie',familyName:'Christ',sortLabel:'CHRISTMS'},
    {identifier:'5',givenName:'Nicolas',familyName:'Bay',sortLabel:'BAY'},
    {identifier:'6',givenName:'Christophe',familyName:'Bay',sortLabel:'BAYC'},
  ];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);
    assert.equal(url.origin,'https://data.europarl.europa.eu');
    if(url.pathname.endsWith('/meps/show-current'))return Response.json({data:roster});
    if(url.pathname.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
    const person=roster.find(p=>url.pathname.endsWith('/meps/'+p.identifier));
    assert(person,'Unexpected upstream request: '+url);
    return Response.json({data:[{...person,hasMembership:[]}]});
  });
  const {odpDirectory}=await import('./odp.mjs');
  const result=await odpDirectory();
  assert.deepEqual(result.members.map(m=>m.id),[6,5,2,1,4,3]);
  assert.equal(result.members.find(m=>m.id===2).sortName,'BERGS','retain original sort metadata');
  // Finish profile work while the fetch guard and temporary cache still exist.
  const deadline=Date.now()+3000;
  let complete=result.index.complete;
  while(!complete&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,10));
    complete=(await odpDirectory()).index.complete;
  }
  assert.equal(complete,true);
});
