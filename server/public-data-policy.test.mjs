import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {server} from './index.mjs';
import {config,apiPrefixes} from './config.mjs';

test('the standalone adapter exposes only read-only explorer routes',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await fetch(base+'/api/healthz');assert.equal(health.status,200);assert.equal((await health.json()).service,'parliament-explorer');
  for(const route of ['/api/bootstrap','/api/members','/api/profile','/api/news','/api/wall/filter','/api/media/video/mep/1'])assert.equal((await fetch(base+route)).status,404,route);
  assert.equal((await fetch(base+'/api/poc/directory',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/healthz',{headers:{Origin:'https://elsewhere.example'}})).status,403);
  const head=await fetch(base+'/api/healthz',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(base+'/api/healthz',{method:'OPTIONS'})).headers.get('Allow'),'GET, HEAD, OPTIONS');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('configuration has no credential-dependent upstreams or alternate API mounts',()=>{
 assert.deepEqual(apiPrefixes,['/api']);
 assert.deepEqual(Object.keys(config).sort(),['appRevision','distDirectory','host','jsonResponseLimitBytes','port','serveStatic','trustProxy'].sort());
});
test('runtime source cannot reintroduce authenticated data adapters',()=>{
 const sourceFiles=readdirSync(new URL('.',import.meta.url)).filter(name=>name.endsWith('.mjs')&&!name.endsWith('.test.mjs'));
 for(const name of sourceFiles){
  const source=readFileSync(new URL(name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bAuthorization\s*:|\bCookie\s*:/i,name);
  assert.doesNotMatch(source,/secure\.europarl|epnewshub\.eu|node:dgram/i,name);
 }
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<title>Parliament explorer<\/title>/);
 assert.doesNotMatch(html,/\bUnity\b|\bterminal\b/i);
 const app=readFileSync(new URL('../src/PocApp.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(app,/loadI18n/);
});
