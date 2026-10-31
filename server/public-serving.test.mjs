import {loopback} from './test-support/loopback.mjs';
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readJson} from '../src/client.mjs';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';
import {execProcessGroupAsync} from './test-support/subprocess-group.mjs';

beforeEach(registerSubprocesses);

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
    assert(files.includes('data-gap-audit-cli.mjs'));
    assert(files.includes('activity-generation-task.mjs'));assert(files.includes('activity-generation-worker.mjs'));
    assert(files.includes('document-context-index.mjs'));
    assert(files.includes('commission-followups-index.mjs'));assert(files.includes('commission-followups-model.mjs'));
    assert(files.includes('mutable-document-recovery.mjs'));
    assert(files.includes('document-detail-routing.mjs'));assert(files.includes('document-route-recovery.mjs'));
    assert(files.includes('declared-debate-recovery.mjs'));assert(files.includes('declared-speech-discovery.mjs'));
    assert(files.includes('declared-speech-evidence.mjs'));
    const audit=await execFileAsync(t,process.execPath,[path.join(destination,'data-gap-audit-cli.mjs')],{cwd:directory,env:{...process.env,ACTIVITY_INDEX_DIR:'',CORPUS_DIR:''}});
    const report=JSON.parse(audit.stdout);assert.equal(report.schemaVersion,1);assert.equal(report.index.state,'unavailable');
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


test('real node:test timeout and cancellation reap children before FIFO fixture cleanup',{skip:process.platform==='win32'?'POSIX process-group lifecycle probe':false},async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'subprocess-lifecycle-'));
  const groups=[];
  t.after(()=>{
    const observations=groups.map(({pid,ready})=>{
      assertProcessGone(-pid);
      const members=existsSync(ready)?Object.values(JSON.parse(readFileSync(ready,'utf8'))):[];
      for(const member of members)assertProcessGone(member);
      return {group:pid,members,allGone:true};
    });
    rmSync(directory,{recursive:true,force:true});
    if(process.env.TEST_LIFECYCLE_OUTER_PROOF)writeFileSync(process.env.TEST_LIFECYCLE_OUTER_PROOF,JSON.stringify({observations,fixtureRemoved:!existsSync(directory)}));
  });
  for(const mode of ['timeout','cancel']) {
    const fixture=path.join(directory,mode+'-fixture'),proof=path.join(directory,mode+'-proof.json'),ready=path.join(directory,mode+'-ready.json'),go=path.join(directory,mode+'-go');
    const script=`
      import {test,beforeEach} from 'node:test';
      import assert from 'node:assert/strict';
      import {mkdirSync,writeFileSync,rmSync,existsSync,renameSync} from 'node:fs';
      import {execFileAsync,registerSubprocesses} from ${JSON.stringify(new URL('./test-support/subprocess.mjs',import.meta.url).href)};
      beforeEach(registerSubprocesses);
      const directory=${JSON.stringify(fixture)},proof=${JSON.stringify(proof)},mode=${JSON.stringify(mode)},ready=${JSON.stringify(ready)},go=${JSON.stringify(go)};
      const controller=new AbortController();
      test('intentional '+mode,{timeout:mode==='timeout'?5000:110_000,signal:controller.signal},async t=>{
        const order=[];let child,closed=false;
        t.after(()=>{
          assert(child,'the hanging child was spawned');
          assert.equal(closed,true,'close must precede fixture cleanup even when the runner cancels the body');
          assert.equal(child.signalCode,'SIGKILL');
          assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
          order.push('reaped');rmSync(directory,{recursive:true,force:true});order.push('removed');
        });
        t.after(()=>{
          assert.equal(existsSync(directory),false,'fixture hooks keep FIFO ordering');
          order.push('last');writeFileSync(proof,JSON.stringify({order,closed}));
        });
        mkdirSync(directory);const pidFile=directory+'/child.pid';
        const running=execFileAsync(t,process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);",pidFile]);
        running.catch(()=>{});child=running.child;child.once('close',()=>closed=true);
        while(!existsSync(pidFile)){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
        writeFileSync(ready+'.tmp',JSON.stringify({runner:process.ppid,worker:process.pid,hanging:child.pid}));renameSync(ready+'.tmp',ready);
        while(!existsSync(go)){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
        if(mode==='cancel')controller.abort(new Error('Intentional runner cancellation'));
        await running;
      });
    `;
    const filename=path.join(directory,mode+'.test.mjs');writeFileSync(filename,script);
    // Start an independent runner while retaining NODE_OPTIONS/network guarding.
    let output;
    const running=execProcessGroupAsync(t,process.execPath,['--test','--test-reporter=tap',filename],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
    running.catch(()=>{});
    groups.push({pid:running.child.pid,ready});
    await waitForFile(t,ready);
    const members=Object.values(JSON.parse(readFileSync(ready,'utf8')));
    await assertSameGroup(t,running.child.pid,members);
    writeFileSync(go,'go');
    await assert.rejects(running,error=>{
      output=error.stdout;
      assert.equal(error.code,1,'the nested test intentionally times out or is cancelled');
      assert.match(error.stdout,/# cancelled 1/);
      assert.match(error.stdout,mode==='timeout'?/testTimeoutFailure/:/testAborted/);
      assert.doesNotMatch(error.stdout,/hookFailed/,'fixture cleanup must complete successfully');return true;
    });
    assert(existsSync(proof),'Missing lifecycle proof: '+output);
    assert.deepEqual(JSON.parse(readFileSync(proof,'utf8')),{order:['reaped','removed','last'],closed:true});
    assert.equal(existsSync(fixture),false);
  }
});


function assertProcessGone(pid) {
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'regression processes must terminate before fixture removal');
}
async function waitForFile(t,file) {
  while(!existsSync(file)){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
}
async function assertSameGroup(t,group,members) {
  assert(members.every(pid=>Number.isInteger(pid)&&pid>0));
  const {stdout}=await execFileAsync(t,'ps',['-o','pid=,pgid=','-p',members.join(',')],{encoding:'utf8'});
  const rows=stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  assert.equal(rows.length,members.length,'all regression descendants are running');
  for(const [pid,pgid] of rows){assert(members.includes(pid));assert.equal(pgid,group,'no regression descendant may escape its owned group');}
}

test('outer 3s timeout descendants stay contained until process-group teardown',{skip:process.platform==='win32'},async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'subprocess-outer-timeout-'));
  const helper=JSON.stringify(new URL('./test-support/subprocess.mjs',import.meta.url).href);
  const ready=path.join(directory,'inner-ready.json'),outerReady=path.join(directory,'outer-ready.json'),go=path.join(directory,'go'),negativeProof=path.join(directory,'negative-proof.json');
  let members=[];
  t.after(()=>{for(const pid of members)assertProcessGone(pid);rmSync(directory,{recursive:true,force:true});});
  const inner=path.join(directory,'inner.test.mjs'),outer=path.join(directory,'outer.test.mjs');
  writeFileSync(inner,`
    import {test,beforeEach} from 'node:test';
    import {writeFileSync,existsSync,renameSync} from 'node:fs';
    import {execFileAsync,registerSubprocesses} from ${helper};
    beforeEach(registerSubprocesses);
    test('hanging descendant',{timeout:Infinity},async t=>{
      const pidFile=${JSON.stringify(path.join(directory,'hang.pid'))};
      const running=execFileAsync(t,process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);",pidFile]);
      running.catch(()=>{});
      while(!existsSync(pidFile)){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
      writeFileSync(${JSON.stringify(ready+'.tmp')},JSON.stringify({runner:process.ppid,worker:process.pid,hanging:running.child.pid}));renameSync(${JSON.stringify(ready+'.tmp')},${JSON.stringify(ready)});
      await running;
    });
  `);
  // Negative control: this timed worker deliberately owns only the direct inner
  // runner. Its inner test never finishes on its own; the enclosing group owner
  // must reap the orphaned worker and child (the helper still has a hang guard).
  writeFileSync(outer,`
    import {test,beforeEach} from 'node:test';
    import {writeFileSync,readFileSync,existsSync,renameSync} from 'node:fs';
    import {execFileAsync,registerSubprocesses} from ${helper};
    beforeEach(registerSubprocesses);
    let running;
    beforeEach(async t=>{
      running=execFileAsync(t,process.execPath,['--test',${JSON.stringify(inner)}],{env:{...process.env,NODE_TEST_CONTEXT:undefined}});running.catch(()=>{});
      while(!existsSync(${JSON.stringify(ready)})){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
      const members={outerRunner:process.ppid,outerWorker:process.pid,...JSON.parse(readFileSync(${JSON.stringify(ready)},'utf8'))};
      writeFileSync(${JSON.stringify(outerReady+'.tmp')},JSON.stringify(members));renameSync(${JSON.stringify(outerReady+'.tmp')},${JSON.stringify(outerReady)});
      t.after(()=>{
        const alive=[members.worker,members.hanging].map(pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}});
        writeFileSync(${JSON.stringify(negativeProof)},JSON.stringify({alive}));
      });
      while(!existsSync(${JSON.stringify(go)})){t.signal.throwIfAborted();await new Promise(resolve=>setImmediate(resolve));}
    });
    test('intentional outer timeout',{timeout:3000},async()=>await running);
  `);
  const running=execProcessGroupAsync(t,process.execPath,['--test','--test-reporter=tap',outer],{env:{...process.env,NODE_TEST_CONTEXT:undefined}});
  running.catch(()=>{});
  await waitForFile(t,outerReady);members=Object.values(JSON.parse(readFileSync(outerReady,'utf8')));
  assert.equal(members.length,5);await assertSameGroup(t,running.child.pid,members);
  writeFileSync(go,'go');
  await assert.rejects(running,error=>{assert.equal(error.code,1,error.stack+'\n'+error.stderr);assert.match(error.stdout,/testTimeoutFailure/);return true;});
  assert(JSON.parse(readFileSync(negativeProof,'utf8')).alive.some(Boolean),'negative control must leave a descendant for the group owner');
  assertProcessGone(-running.child.pid);for(const pid of members)assertProcessGone(pid);
});
