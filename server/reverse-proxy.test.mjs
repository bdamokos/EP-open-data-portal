import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {loopback} from './test-support/loopback.mjs';
import {createProxyAgent,proxyRequest} from './reverse-proxy.mjs';

async function listen(handler) {
  const server=http.createServer(handler);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return server;
}
// An upstream (the API process) behind a proxying front, both on loopback.
async function fixture(t,upstreamHandler) {
  const upstream=await listen(upstreamHandler),agent=createProxyAgent();
  const front=await listen((request,response)=>proxyRequest(request,response,{port:upstream.address().port,agent,requestId:'front-id'}));
  t.after(()=>{agent.destroy();front.closeAllConnections();upstream.closeAllConnections();front.close();upstream.close();});
  return {upstream,front,port:front.address().port};
}
const call=(port,options,body)=>new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port,agent:false,...options},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>resolve({response,body:Buffer.concat(chunks).toString()}));response.on('error',reject);
  });
  request.on('error',reject);request.end(body);
});

test('headers, status and body pass through, including request ids and cache headers',loopback,async t=>{
  const seen=[];
  const {port}=await fixture(t,(request,response)=>{
    seen.push(request.headers);
    response.setHeader('X-Request-Id','api-id');response.setHeader('CDN-Cache-Control','public, max-age=60');
    response.setHeader('ETag','"abc"');response.setHeader('Vary','Origin');
    response.setHeader('Cache-Control','public, max-age=30');
    response.end('{"ok":true}\n');
  });
  const {response,body}=await call(port,{path:'/api/directory?v=x',headers:{Origin:'http://example.test',Host:'explorer.test','X-Forwarded-Proto':'https','If-None-Match':'"zzz"'}});
  assert.equal(response.statusCode,200);assert.equal(body,'{"ok":true}\n');
  assert.equal(response.headers['x-request-id'],'api-id','the API process id wins over the front id');
  assert.equal(response.headers['cdn-cache-control'],'public, max-age=60');
  assert.equal(response.headers.etag,'"abc"');assert.equal(response.headers.vary,'Origin');
  assert.equal(seen[0].host,'explorer.test');assert.equal(seen[0].origin,'http://example.test');
  assert.equal(seen[0]['x-forwarded-proto'],'https');assert.equal(seen[0]['if-none-match'],'"zzz"');
  assert.equal(seen[0].connection,'keep-alive','the proxy hop speaks its own connection header');
});

test('HEAD and 304 responses keep their headers and have no body',loopback,async t=>{
  const {port}=await fixture(t,(request,response)=>{
    response.setHeader('ETag','"v1"');
    if(request.headers['if-none-match']==='"v1"'){response.statusCode=304;response.end();return;}
    response.setHeader('Content-Length','11');response.setHeader('Content-Type','application/json');
    response.end(request.method==='HEAD'?undefined:'hello world');
  });
  const head=await call(port,{method:'HEAD',path:'/api/x'});
  assert.equal(head.response.statusCode,200);assert.equal(head.response.headers['content-length'],'11');assert.equal(head.body,'');
  const notModified=await call(port,{path:'/api/x',headers:{'If-None-Match':'"v1"'}});
  assert.equal(notModified.response.statusCode,304);assert.equal(notModified.response.headers.etag,'"v1"');assert.equal(notModified.body,'');
});

test('POST bodies stream in both directions without buffering',loopback,async t=>{
  const {port}=await fixture(t,(request,response)=>{
    response.writeHead(200,{'Content-Type':'text/plain'});
    request.on('data',chunk=>response.write(`echo:${chunk}`));
    request.on('end',()=>response.end('|end'));
  });
  const request=http.request({host:'127.0.0.1',port,agent:false,method:'POST',path:'/api/corpus/search',headers:{'Content-Type':'application/json'}});
  const chunks=[];let firstChunk;
  const finished=new Promise((resolve,reject)=>{
    request.on('response',response=>{response.on('data',chunk=>{firstChunk??=Date.now();chunks.push(chunk.toString());});response.on('end',resolve);});
    request.on('error',reject);
  });
  request.write('one');
  await delay(100);
  assert.ok(chunks.join('').includes('echo:one'),'the first response bytes arrive while the request body is still open');
  request.write('two');request.end();
  await finished;
  assert.equal(chunks.join(''),'echo:oneecho:two|end');
});

test('a content-length body arrives intact and the upstream error status passes through',loopback,async t=>{
  const {port}=await fixture(t,(request,response)=>{
    const parts=[];request.on('data',chunk=>parts.push(chunk));
    request.on('end',()=>{response.statusCode=Buffer.concat(parts).length>10?413:201;response.end(String(Buffer.concat(parts).length));});
  });
  const small=await call(port,{method:'POST',path:'/api/client-errors',headers:{'Content-Type':'application/json'}},'{"a":1}');
  assert.equal(small.response.statusCode,201);assert.equal(small.body,'7');
  const big=await call(port,{method:'POST',path:'/api/client-errors',headers:{'Content-Type':'application/json'}},'x'.repeat(64));
  assert.equal(big.response.statusCode,413);
});

test('a client that disconnects aborts the upstream request',loopback,async t=>{
  let closed;const upstreamClosed=new Promise(resolve=>{closed=resolve;});
  const {port}=await fixture(t,(request,response)=>{
    response.write('partial');
    response.once('close',()=>closed(response.writableEnded));
  });
  const socket=net.connect(port,'127.0.0.1');
  socket.write('GET /api/slow HTTP/1.1\r\nHost: x\r\n\r\n');
  await once(socket,'data');
  socket.destroy();
  assert.equal(await Promise.race([upstreamClosed,delay(3000,'timeout')]),false,'the upstream saw a closed connection before it finished');
});

test('an upload abandoned by the client destroys the upstream request',loopback,async t=>{
  let aborted;const sawAbort=new Promise(resolve=>{aborted=resolve;});
  const {port}=await fixture(t,(request)=>{
    request.on('data',()=>{});request.on('error',()=>aborted('error'));request.on('close',()=>aborted('close'));
  });
  const socket=net.connect(port,'127.0.0.1');
  socket.write('POST /api/corpus/search HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial');
  await delay(50);socket.destroy();
  assert.ok(await Promise.race([sawAbort,delay(3000,'timeout')]));
});

test('an upstream that is down answers 503 with Retry-After instead of hanging',loopback,async t=>{
  const dead=http.createServer();dead.listen(0,'127.0.0.1');await once(dead,'listening');
  const port=dead.address().port;dead.close();await once(dead,'close');
  const agent=createProxyAgent();
  const front=await listen((request,response)=>proxyRequest(request,response,{port,agent,requestId:'front-id'}));
  t.after(()=>{agent.destroy();front.close();});
  const {response,body}=await call(front.address().port,{path:'/api/directory'});
  assert.equal(response.statusCode,503);assert.equal(response.headers['retry-after'],'1');
  assert.equal(response.headers['x-request-id'],'front-id');
  assert.equal(JSON.parse(body).error.code,'api_unavailable');
});

test('an upstream that dies mid-response ends the client connection without a clean finish',loopback,async t=>{
  const {port}=await fixture(t,(request,response)=>{
    response.writeHead(200,{'Content-Length':'100'});response.write('abc');
    setTimeout(()=>request.socket.destroy(),20);
  });
  await assert.rejects(call(port,{path:'/api/x'}),error=>['ECONNRESET','aborted'].includes(error.code)||/aborted|socket/.test(error.message));
});

test('a pooled connection the upstream closed is retried once for a bodyless GET',loopback,async t=>{
  let count=0;
  const {upstream,port}=await fixture(t,(request,response)=>{count++;response.end('ok');});
  assert.equal((await call(port,{path:'/api/a'})).body,'ok');
  // Close the upstream's idle sockets so the pooled one is dead on reuse.
  upstream.closeIdleConnections();
  const second=await call(port,{path:'/api/b'});
  assert.equal(second.body,'ok');assert.equal(count,2);
});

test('capture sees a complete 200 body and a 304, and nothing else, without changing the reply',loopback,async t=>{
  const upstream=await listen((request,response)=>{
    if(request.url==='/ok'){response.setHeader('ETag','"e"');response.end('{"a":1}\n');}
    else if(request.url==='/same'){response.setHeader('ETag','"e"');response.statusCode=304;response.end();}
    else if(request.url==='/big')response.end('x'.repeat(100));
    else if(request.url==='/chunked'){response.write('abc');response.end('def');}
    else if(request.url==='/broken'){response.writeHead(200,{'Content-Length':'100'});response.write('abc');setTimeout(()=>request.socket.destroy(),20);}
    else {response.statusCode=500;response.end('{"error":1}');}
  });
  const agent=createProxyAgent(),captured=[];
  const front=await listen((request,response)=>proxyRequest(request,response,{port:upstream.address().port,agent,requestId:'id',capture:{maxBytes:50,done:reply=>captured.push([request.url,reply])}}));
  t.after(()=>{agent.destroy();front.closeAllConnections();upstream.closeAllConnections();front.close();upstream.close();});
  const port=front.address().port;
  const ok=await call(port,{path:'/ok'});
  assert.equal(ok.body,'{"a":1}\n');assert.equal(ok.response.headers.etag,'"e"');
  assert.equal((await call(port,{path:'/same'})).response.statusCode,304);
  assert.equal((await call(port,{path:'/big'})).body.length,100);
  assert.equal((await call(port,{path:'/chunked'})).body,'abcdef');
  assert.equal((await call(port,{path:'/err'})).response.statusCode,500);
  await call(port,{path:'/broken'}).catch(()=>{});
  await delay(50);
  assert.deepEqual(captured.map(([url,reply])=>[url,reply.status,reply.body?.toString()??null]),[['/ok',200,'{"a":1}\n'],['/same',304,null]]);
  assert.ok(captured[0][1].rawHeaders.includes('ETag'));
});

test('a deadline answers a request still waiting for the upstream, and leaves a started reply alone',loopback,async t=>{
  const {requestTimeout}=await import('./request-budget.mjs');
  const upstream=await listen((request,response)=>{
    if(request.url==='/slow')return;// never answers
    response.writeHead(200,{'Content-Type':'text/plain'});response.write('part ');setTimeout(()=>response.end('rest'),80);
  });
  const agent=createProxyAgent(),results=[];
  const front=await listen(async(request,response)=>{
    const controller=new AbortController();setTimeout(()=>controller.abort(requestTimeout()),40);
    results.push(await proxyRequest(request,response,{port:upstream.address().port,agent,requestId:'front-id',signal:controller.signal}));
  });
  t.after(()=>{agent.destroy();front.closeAllConnections();upstream.closeAllConnections();front.close();upstream.close();});
  const slow=await call(front.address().port,{path:'/slow'});
  assert.equal(slow.response.statusCode,503);assert.equal(JSON.parse(slow.body).error.code,'request_timeout');
  assert.equal(slow.response.headers['x-request-id'],'front-id');
  const started=await call(front.address().port,{path:'/stream'});
  assert.equal(started.response.statusCode,200);assert.equal(started.body,'part rest');
  assert.deepEqual(results,[true,false]);
});

test('a deadline on a pooled connection ends the exchange without a second upstream request',loopback,async t=>{
  const {requestTimeout}=await import('./request-budget.mjs');
  const hits={slow:0};
  const upstream=await listen((request,response)=>{
    if(request.url==='/slow'){hits.slow++;return;}// never answers
    response.end('ok');
  });
  const agent=createProxyAgent({maxSockets:1}),results=[];
  const front=await listen(async(request,response)=>{
    const controller=new AbortController();setTimeout(()=>controller.abort(requestTimeout()),40);
    results.push(await proxyRequest(request,response,{port:upstream.address().port,agent,requestId:'front-id',signal:controller.signal}));
  });
  t.after(()=>{agent.destroy();front.closeAllConnections();upstream.closeAllConnections();front.close();upstream.close();});
  // The first exchange leaves a pooled socket; the slow one reuses it.
  assert.equal((await call(front.address().port,{path:'/warm'})).body,'ok');
  const slow=await call(front.address().port,{path:'/slow'});
  assert.equal(slow.response.statusCode,503);assert.equal(JSON.parse(slow.body).error.code,'request_timeout');
  await delay(100);
  assert.equal(hits.slow,1,'the destroyed request is not retried');
  assert.deepEqual(results,[false,true]);
});
