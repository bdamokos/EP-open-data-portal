import {loopback} from './test-support/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {API_VERSION} from './api-version.mjs';

test('HTTP progress works without an activity index and preserves transport/query/cache boundaries',loopback,async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'cellar-http-'));
  const previous={ODP_CACHE_DIR:process.env.ODP_CACHE_DIR,ACTIVITY_INDEX_ENABLED:process.env.ACTIVITY_INDEX_ENABLED};
  process.env.ODP_CACHE_DIR=directory;process.env.ACTIVITY_INDEX_ENABLED='false';
  const {server}=await import('./index.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const base=`http://127.0.0.1:${server.address().port}`,calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const source=new URL(url);assert.equal(source.origin,'https://publications.europa.eu');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);calls.push(source);
    const u=value=>({type:'uri',value}),l=value=>({type:'literal',value}),dossier='http://publications.europa.eu/resource/cellar/9d07a799-630b-11f0-bf4e-01aa75ed71a1';
    const mapping={kind:l('0'),reference:l('2025/0223/COD'),dossier:u(dossier)};
    const row={...mapping,kind:l('1'),event:u(dossier+'.0001'),date:l('2026-10-01'),type:u('http://publications.europa.eu/resource/authority/event/ADP_REP_byEP_CMT'),label:{...l('Committee report adopted'),'xml:lang':'en'}};
    if(source.searchParams.get('query').includes('OPTIONAL { ?work cdm:resource_legal_id_celex'))Object.assign(row,{work:u('http://publications.europa.eu/resource/cellar/e0649735-a372-11eb-9585-01aa75ed71a1'),celex:l('52021PC0206')});
    return Response.json({results:{bindings:[mapping,row]}});
  });
  const read=(route,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{
    const request=http.request(base+route,{method,headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text:Buffer.concat(chunks).toString()}));});request.on('error',reject);request.end();
  });
  const route='/api/insights/procedure-progress?reference=2025%2F0223(COD)&lang=en&v='+API_VERSION;
  const good=await read(route);assert.equal(good.status,200);assert.equal(JSON.parse(good.text).events.length,1);assert.match(good.headers['cache-control'],/max-age=0/);assert.match(good.headers['cdn-cache-control'],/max-age=300/);
  const head=await read(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.text,'');assert.equal(calls.length,1,'HEAD and repeated views reuse the same source');
  const documents=await read(route+'&detail=documents');assert.equal(documents.status,200);assert.match(JSON.parse(documents.text).documents[0].url,/eur-lex\.europa\.eu\/legal-content/);assert.equal(calls.length,2);
  const privateRead=await read(route,{headers:{Authorization:'test-only'}});assert.equal(privateRead.status,200);assert.equal(privateRead.headers['cache-control'],'no-store');
  for(const suffix of ['&reference=2025%2F0223(COD)','&lang=fr','&detail=','&detail=all','&url=https://example.test'])assert.equal((await read(route+suffix)).status,400,suffix);
  assert.equal((await read(route.replace('v='+API_VERSION,'v='+(API_VERSION+1)))).status,409);
  assert.equal((await read(route+'&v='+API_VERSION)).status,400);
  assert.equal((await read(route,{method:'POST'})).status,405);
  assert.equal((await read(route,{headers:{Origin:'https://elsewhere.example'}})).status,403);
  const options=await read(route,{method:'OPTIONS'});assert.equal(options.status,204);assert.equal(options.headers['cache-control'],'no-store');
  assert.equal(calls.length,2,'rejected requests and credentialed cache hits never start another source request');
});
