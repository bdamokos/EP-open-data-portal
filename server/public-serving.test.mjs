import {loopback} from './test-support/loopback.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readJson} from '../src/client.mjs';
import {execFileAsync} from './test-support/subprocess.mjs';

test('public serving does not swallow reserved paths, source files or missing assets',loopback,async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'public-serving-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  mkdirSync(path.join(directory,'assets'));
  writeFileSync(path.join(directory,'index.html'),'<h1>Public explorer</h1>');
  writeFileSync(path.join(directory,'assets','app.js'),'export const publicAsset=true;');
  process.env.EXPLORER_DIST_DIR=directory;
  process.env.APP_REVISION='a'.repeat(40);
  const {server}=await import('./index.mjs');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const url of ['/','/index.html','/?view=questions']){
      const response=await fetch(base+url);assert.equal(response.status,200,url);
      assert.match(await response.text(),/Public explorer/);
      assert.equal(response.headers.get('X-Parliament-Explorer-Revision'),'a'.repeat(40));
      assert.match(response.headers.get('Content-Security-Policy'),/frame-src https:\/\/webstreaming\.europarl\.europa\.eu/);
      assert.equal(response.headers.get('Set-Cookie'),null);
    }
    assert.equal((await fetch(base+'/assets/app.js')).status,200);
    for(const url of ['/browser/','/browser/other/','/portal/api/session','/admin/','/other-service/','/assets/missing.js','/src/main.tsx','/package.json','/.env','/%62rowser/','/assets/%2e%2e/package.json']){
      const response=await fetch(base+url,{headers:{Accept:'text/html'}});assert.equal(response.status,404,url);assert.doesNotMatch(await response.text(),/Public explorer/);
    }
    const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.equal((await health.json()).service,'parliament-explorer');
    for(const url of ['/api/source-record?url=https://example.com', '/api/source-record?url=x&url=y', '/api/source-record?url=x&other=1', '/api/healthz?other=1','/api/directory?url=https://elsewhere.example','/api/profile/125065?lang=en&lang=hu','/api/portrait/125065?other=1','/api/activities/125065?other=1','/api/document/E-10-2026-003031?member=1&member=2','/api/speeches/125065?offset=1e2','/api/speech/MTG-PL-2026-10-08-OTH-2017098235205?other=1','/api/motion-comparison/B-10-2026-0441?joint=RC-10-2026-0441&stage=other','/api/motion-comparison/B-10-2026-0441?joint=RC-10-2026-0441&joint=RC-10-2026-0438','/api/motion-comparison/invalid?joint=RC-10-2026-0441'])
      assert.equal((await fetch(base+url)).status,400,url);
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    rmSync(directory,{recursive:true,force:true});delete process.env.EXPLORER_DIST_DIR;delete process.env.APP_REVISION;
  }
});

test('production runtime staging excludes examples, tests and declarations',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'runtime-stage-'));
  const destination=path.join(directory,'server');
  try{
    await execFileAsync(t,process.execPath,[new URL('../scripts/stage-runtime.mjs',import.meta.url).pathname,destination],{});
    const files=readdirSync(destination);
    assert(files.includes('index.mjs'));assert(files.includes('insights-speech-stopwords.json'));assert(files.includes('insights-speech-stopwords.LICENSE.txt'));
    assert(!files.some(name=>/test|fixture|\.d\.mts/.test(name)));
    assert(!files.includes('codict.mjs'));assert(!files.includes('content-store.mjs'));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('public data reads omit credentials on initial, retry and terminal-error requests',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const schedule=setTimeout;let backoff;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
    const timer=schedule(callback,ms,...args);if(ms===250)backoff();return timer;
  });
  for(const statuses of [[200],[503,200],[503,503,503]]) {
    const requests=[];let nextBackoff=new Promise(resolve=>backoff=resolve);
    const request=readJson('/api/directory',{fetchImpl:async(url,options)=>{
      requests.push({url,credentials:options.credentials});
      const status=statuses[requests.length-1];assert(status,'unexpected additional retry');
      return Response.json(status===200?{members:[]}:{error:{code:'upstream_busy',message:'Busy',retryAfter:0}},{status});
    }});
    const result=statuses.at(-1)===200?request.then(data=>assert.deepEqual(data,{members:[]})):assert.rejects(request,{status:503,code:'upstream_busy'});
    for(let i=1;i<statuses.length;i++) {
      await nextBackoff;nextBackoff=new Promise(resolve=>backoff=resolve);t.mock.timers.tick(250);
    }
    await result;assert.equal(requests.length,statuses.length);
    for(const request of requests)assert.equal(request.credentials,'omit');
  }
  const source=readFileSync(new URL('../src/client.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Work Tools|session has expired|sign in/i);
});
