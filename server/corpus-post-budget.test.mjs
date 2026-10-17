import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {getEventListeners} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('an expired chunked POST cannot enter corpus search when its remaining body arrives',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'corpus-post-budget-'));
  const fixture={CORPUS_ENABLED:'true',CORPUS_DIR:directory,EXPLORER_DIST_DIR:directory,ODP_CACHE_DIR:undefined,ACTIVITY_INDEX_DIR:undefined};
  for(const [key,value] of Object.entries(fixture)){
    const previous=process.env[key];
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const {server}=await import('./index.mjs');
  const {corpus}=await import('./corpus-worker.mjs');
  const {requestSignal}=await import('./request-budget.mjs');
  const service=corpus();t.after(()=>service.store.close());
  let searches=0;
  t.mock.method(service.reader,'query',async()=>{searches++;return {results:[]};});
  t.mock.method(globalThis,'fetch',()=>assert.fail('the HTTP regression must stay offline'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const agent=new http.Agent({keepAlive:true});t.after(()=>agent.destroy());
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  const signals=new Set(),addEventListener=AbortSignal.prototype.addEventListener;
  t.mock.method(AbortSignal.prototype,'addEventListener',function(type,...args){
    if(type==='abort'&&this===requestSignal())signals.add(this);
    return addEventListener.call(this,type,...args);
  });
  let incoming,endListeners,bodyStarted,bodyEnded;
  const started=new Promise(resolve=>bodyStarted=resolve),ended=new Promise(resolve=>bodyEnded=resolve);
  const capture=request=>{incoming=request;endListeners=request.listeners('end');request.once('data',bodyStarted);request.once('end',bodyEnded);};
  server.prependOnceListener('request',capture);t.after(()=>server.removeListener('request',capture));
  let client;
  const response=new Promise((resolve,reject)=>{
    client=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/corpus/search?lang=en',method:'POST',agent,
      headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
      response.on('error',reject);
    });
    client.on('error',reject);client.write('{"query":');
  });
  t.after(()=>client.destroy());
  await started;
  const bodyEndListeners=incoming.listeners('end').filter(listener=>listener!==bodyEnded&&!endListeners.includes(listener));
  assert.equal(bodyEndListeners.length,1);
  t.mock.timers.tick(30_000);
  const result=await response;
  assert.equal(result.status,503);assert.equal(result.body.error.code,'request_timeout');
  assert.equal(incoming.listenerCount('data'),0);assert.equal(incoming.listenerCount('error'),0);
  for(const listener of bodyEndListeners)assert(!incoming.listeners('end').includes(listener));
  client.end('"ocean"}');await ended;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(searches,0,'a late upload must never take the corpus reader slot');
  assert.equal(incoming.listenerCount('data'),0);assert.equal(incoming.listenerCount('error'),0);
  assert.equal(signals.size,1);for(const signal of signals){assert(signal.aborted);assert.equal(getEventListeners(signal,'abort').length,0);}

  await t.test('disconnecting during an upload also removes the body wait',async()=>{
    let upload,ready,closed,bodyListeners;
    const started=new Promise(resolve=>ready=resolve),ended=new Promise(resolve=>closed=resolve);
    server.prependOnceListener('request',request=>{
      upload=request;
      request.once('data',()=>{bodyListeners=request.listeners('end');ready();});
      request.once('close',closed);
    });
    const disconnected=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/corpus/search?lang=en',method:'POST',agent,
      headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}});
    disconnected.on('error',()=>{});disconnected.write('{"query":');
    await started;disconnected.destroy();await ended;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(searches,0);assert.equal(upload.listenerCount('data'),0);assert.equal(upload.listenerCount('error'),0);
    for(const listener of bodyListeners)assert(!upload.listeners('end').includes(listener));
    assert.equal(signals.size,2);for(const signal of signals){assert(signal.aborted);assert.equal(getEventListeners(signal,'abort').length,0);}
  });
});
