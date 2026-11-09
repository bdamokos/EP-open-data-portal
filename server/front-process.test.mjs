import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {loopback} from './test-support/loopback.mjs';

const processTable=() => {
  const result=spawnSync('ps',['-A','-o','pid=,ppid=']);
  if(result.status!==0)return null;
  return String(result.stdout).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
};
const childrenOf=pid => (processTable()||[]).filter(([,parent])=>parent===pid).map(([id])=>id);
const psSkip=processTable()===null?{skip:'ps is not available in this environment; CI runs this test'}:{};
const freePort=async()=>{const server=net.createServer().listen(0,'127.0.0.1');await once(server,'listening');const {port}=server.address();server.close();await once(server,'close');return port;};
const call=(port,path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port,path,method,headers,agent:false},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>resolve({response,body:Buffer.concat(chunks).toString()}));
  });
  request.on('error',reject);request.end(body);
});
async function until(check,what,ms=20_000) {
  const deadline=Date.now()+ms;
  for(;;){const value=await check();if(value)return value;if(Date.now()>deadline)throw new Error(`Timed out waiting for ${what}`);await delay(100);}
}

test('the split deployment starts its API process on demand, forwards logs, recovers from a crash and stops with it',{...loopback,...psSkip,timeout:90_000},async t=>{
  const root=mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'front-process-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'dist'));writeFileSync(path.join(root,'dist','index.html'),'<!doctype html><title>Explorer</title>');
  const port=await freePort(),logs=path.join(root,'diagnostics'),guard=fileURLToPath(new URL('../scripts/test-network-guard.mjs',import.meta.url));
  const front=spawn(process.execPath,['server/main.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:['ignore','pipe','pipe'],env:{
    ...process.env,EXPLORER_PROCESS_MODE:'split',PORT:String(port),HOST:'127.0.0.1',EXPLORER_DIST_DIR:path.join(root,'dist'),
    ODP_CACHE_DIR:path.join(root,'cache'),ERROR_LOG_DIR:logs,ACTIVITY_INDEX_ENABLED:'false',CORPUS_ENABLED:'false',
    NODE_OPTIONS:`--import ${guard}`,
  }});
  let output='';front.stdout.on('data',chunk=>{output+=chunk;});front.stderr.on('data',chunk=>{output+=chunk;});
  t.after(async()=>{if(front.exitCode===null){front.kill('SIGKILL');await once(front,'exit');}});
  try {
    const health=await until(async()=>call(port,'/healthz').catch(()=>null),'the front to listen');
    assert.equal(health.response.statusCode,200);
    const {apiVersion}=JSON.parse(health.body);
    await delay(300);
    assert.deepEqual(childrenOf(front.pid),[],'no API process before the first API request');
    assert.equal((await call(port,'/',{headers:{Accept:'*/*'}})).response.statusCode,200);
    assert.deepEqual(childrenOf(front.pid),[],'a request without a browser Accept header leaves the API asleep');

    // The first API request waits for the start and is answered by the new process.
    const first=await call(port,`/api/healthz?v=${apiVersion}`);
    assert.equal(first.response.statusCode,200,output);
    assert.equal(JSON.parse(first.body).service,'parliament-explorer');
    const [apiPid]=childrenOf(front.pid);
    assert.ok(apiPid,'an API process now runs');
    assert.equal((await call(port,'/healthz')).response.statusCode,200);

    // A browser report written by the API process reaches the front's error log.
    const report=await call(port,'/api/client-errors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'ui',name:'TypeError',code:'probe'})});
    assert.equal(report.response.statusCode,204,report.body);
    await until(()=>existsSync(path.join(logs,'errors.jsonl'))&&readFileSync(path.join(logs,'errors.jsonl'),'utf8').includes('"probe"'),'the error log line');
    assert.deepEqual(childrenOf(front.pid),[apiPid]);

    // A crash answers 503 with Retry-After while backing off, then the next request starts a new process.
    process.kill(apiPid,'SIGKILL');
    await until(()=>childrenOf(front.pid).length===0,'the crashed process to disappear');
    const refused=await call(port,`/api/healthz?v=${apiVersion}`);
    assert.equal(refused.response.statusCode,503);assert.ok(Number(refused.response.headers['retry-after'])>=1);
    await delay(1200);
    const recovered=await call(port,`/api/healthz?v=${apiVersion}`);
    assert.equal(recovered.response.statusCode,200,output);
    const [replacement]=childrenOf(front.pid);
    assert.ok(replacement&&replacement!==apiPid);

    front.kill('SIGTERM');
    const [code]=await once(front,'exit');
    assert.equal(code,0,output);
    await until(()=>!(processTable()||[]).some(([pid])=>pid===replacement),'the API process to stop with the front');
  } catch(error) {
    error.message+=`\n--- front output ---\n${output}`;
    throw error;
  }
});
