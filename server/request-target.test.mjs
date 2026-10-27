import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Writable} from 'node:stream';
import {once} from 'node:events';
import {request} from 'node:http';
import {loopback} from './test-support/loopback.mjs';
import {coAuthorProfileUrl} from '../src/coAuthors.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'request-target-'));
after(()=>rm(directory,{recursive:true,force:true}));
await mkdir(path.join(directory,'assets'));
await writeFile(path.join(directory,'index.html'),'<script type="module" src="./assets/app.js"></script>');
await writeFile(path.join(directory,'assets/app.js'),'export const api="./api/healthz";');
const previousDirectory=process.env.EXPLORER_DIST_DIR;
process.env.EXPLORER_DIST_DIR=directory;
const {handleRequest,server}=await import('./index.mjs');
if(previousDirectory===undefined)delete process.env.EXPLORER_DIST_DIR;
else process.env.EXPLORER_DIST_DIR=previousDirectory;

async function inMemory(target,method='GET',headers={}) {
  const chunks=[],values={};
  const response=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
  response.setHeader=(name,value)=>{values[name.toLowerCase()]=value;};
  response.removeHeader=name=>{delete values[name.toLowerCase()];};
  const finished=once(response,'finish');
  await handleRequest({url:target,method,headers},response);
  await finished;
  return {status:response.statusCode,headers:values,body:Buffer.concat(chunks).toString()};
}

async function rejectedAliases(send) {
  for(const prefix of ['//attacker.example','///attacker.example','//%61ttacker.example','/\\attacker.example','/\\/attacker.example']) {
    for(const suffix of ['/','/index.html','/assets/app.js','/api/healthz','/healthz']) {
      for(const method of ['GET','HEAD']) {
        const result=await send(prefix+suffix,method,{'if-none-match':'*'});
        assert.equal(result.status,400,prefix+suffix);
        assert.equal(result.headers['cache-control'],'no-store');
        assert.equal(result.headers['cdn-cache-control'],'no-store');
        assert.equal(result.headers.location,undefined);
        assert.equal(result.headers['x-content-type-options'],'nosniff');
        if(method==='HEAD')assert.equal(result.body,'');
        else assert.equal(JSON.parse(result.body).error.code,'invalid_path');
      }
    }
  }
}

test('raw authority-like targets are rejected before static and API dispatch, without sockets',async()=>{
  await rejectedAliases(inMemory);
  for(const target of ['http://attacker.example/','\\\\attacker.example/','/assets\\app.js','/\t/attacker.example/'])assert.equal((await inMemory(target)).status,400,target);
});

test('ordinary document, relative asset/API and profile navigation keep their meaning',async()=>{
  for(const pathname of ['/','/index.html']) {
    const page=new URL('https://explorer.example'+pathname+'?member=1&module=activities');
    const document=await inMemory(page.pathname+page.search);
    assert.equal(document.status,200);assert.equal(document.headers['cache-control'],'no-cache');
    const asset=new URL(document.body.match(/src="([^"]+)"/)[1],page);
    assert.equal(asset.origin,page.origin);
    const script=await inMemory(asset.pathname);assert.equal(script.status,200);
    const api=new URL(script.body.match(/api="([^"]+)"/)[1],page);
    const health=await inMemory(api.pathname);assert.equal(health.status,200);
    assert.equal(JSON.parse(health.body).service,'parliament-explorer');
    const profile=new URL(coAuthorProfileUrl('hu',257043),page);
    assert.equal(profile.origin,page.origin);assert.equal(profile.pathname,page.pathname);
    assert.equal((await inMemory(profile.pathname+profile.search)).status,200);
  }
  // Percent-encoded path separators are not authorities; query values are not paths.
  for(const target of ['/%2fattacker.example/','/%2Fattacker.example/','/%5cattacker.example/','/%252fattacker.example/','/browser/','/assets/missing.js'])assert.equal((await inMemory(target)).status,404,target);
  assert.equal((await inMemory('/?url=https://example.test/a\\b&value=%2f%5c')).status,200);
  assert.equal((await inMemory('/assets/%')).status,400);
  assert.equal((await inMemory('/healthz')).status,200);
  assert.equal((await inMemory('/api/healthz','POST')).status,405);
  assert.equal((await inMemory('/api/healthz','OPTIONS')).status,204);
  assert.equal((await inMemory('/api/healthz','GET',{origin:'https://attacker.example',host:'explorer.example'})).status,403);
});

test('HTTP listener rejects raw aliases with the same response semantics',loopback,async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await rejectedAliases((target,method,headers)=>new Promise((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port:server.address().port,path:target,method,headers},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));
        res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
      });
      req.on('error',reject);req.end();
    }));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
