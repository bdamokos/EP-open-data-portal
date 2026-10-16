import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('public serving does not swallow reserved paths, source files or missing assets',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'public-serving-'));
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
    for(const url of ['/api/healthz?other=1','/api/poc/directory?url=https://elsewhere.example','/api/poc/profile/125065?lang=en&lang=hu','/api/poc/portrait/125065?other=1','/api/poc/activities/125065?other=1','/api/poc/document/E-10-2026-003031?member=1&member=2','/api/poc/speeches/125065?offset=1e2','/api/poc/speech/MTG-PL-2026-10-08-OTH-2017098235205?other=1','/api/poc/motion-comparison/B-10-2026-0441?joint=RC-10-2026-0441&stage=other','/api/poc/motion-comparison/B-10-2026-0441?joint=RC-10-2026-0441&joint=RC-10-2026-0438','/api/poc/motion-comparison/invalid?joint=RC-10-2026-0441'])
      assert.equal((await fetch(base+url)).status,400,url);
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    rmSync(directory,{recursive:true,force:true});delete process.env.EXPLORER_DIST_DIR;delete process.env.APP_REVISION;
  }
});

test('production runtime staging excludes examples, tests and declarations',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'runtime-stage-'));
  const destination=path.join(directory,'server');
  try{
    execFileSync(process.execPath,[new URL('../scripts/stage-runtime.mjs',import.meta.url).pathname,destination]);
    const files=readdirSync(destination);
    assert(files.includes('index.mjs'));assert(files.includes('insights-speech-stopwords.json'));assert(files.includes('insights-speech-stopwords.LICENSE.txt'));
    assert(!files.some(name=>/test|fixture|\.d\.mts/.test(name)));
    assert(!files.includes('codict.mjs'));assert(!files.includes('content-store.mjs'));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('public data reads omit credentials and have no private login dependency',()=>{
  const source=readFileSync(new URL('../src/pocData.ts',import.meta.url),'utf8');
  assert.match(source,/credentials: "omit"/);assert.doesNotMatch(source,/Work Tools|session has expired|sign in/i);
});
