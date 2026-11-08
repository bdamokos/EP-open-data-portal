import http from 'node:http';
import {HttpError,sendError} from './http-utils.mjs';

// Hop-by-hop headers belong to one connection and are never forwarded.
// Expect is answered by the front's own server, so the API process never sees it.
const hopByHop=new Set(['connection','keep-alive','proxy-connection','proxy-authenticate','proxy-authorization','te','trailer','upgrade','expect']);

export function createProxyAgent({maxSockets=64}={}) {
  return new http.Agent({keepAlive:true,maxSockets,maxFreeSockets:8,scheduling:'fifo'});
}

function requestHeaders(headers) {
  const forwarded={};
  for(const [name,value] of Object.entries(headers))if(!hopByHop.has(name))forwarded[name]=value;
  return forwarded;
}
function responseHeaders(raw) {
  const forwarded=[];
  for(let i=0;i<raw.length;i+=2)if(!hopByHop.has(raw[i].toLowerCase())){forwarded.push(raw[i],raw[i+1]);}
  return forwarded;
}

// Streams one request to the API process and its response back. The request body
// and the response body are never buffered. Resolves when the exchange is over.
//  - A client that goes away destroys the upstream request, which the API
//    process sees as a closed socket and aborts the work.
//  - An API process that fails before the response starts yields 503; after the
//    response starts the client connection is destroyed, as a direct failure would.
export function proxyRequest(request,response,{port,agent,host='127.0.0.1',requestId}) {
  return new Promise(resolve=>{
    let upstream,reply,done=false,retried=false;
    const bodyless=!request.headers['transfer-encoding']&&!Number(request.headers['content-length']);
    const finish=()=>{if(done)return;done=true;resolve();};
    const unavailable=()=>{
      if(done)return;
      if(response.headersSent||response.destroyed){response.destroy();finish();return;}
      if(requestId)response.setHeader('X-Request-Id',requestId);
      sendError(request,response,Object.assign(new HttpError(503,'api_unavailable','The service is temporarily unavailable. Please try again shortly.'),{retryAfter:1}));
      finish();
    };
    const send=()=>{
      upstream=http.request({host,port,agent,method:request.method,path:request.url,headers:requestHeaders(request.headers)});
      const attempt=upstream;
      attempt.once('response',value=>{
        reply=value;
        response.writeHead(reply.statusCode,reply.statusMessage,responseHeaders(reply.rawHeaders));
        reply.once('error',()=>{response.destroy();finish();});
        // An API process that dies mid-body ends the stream without 'end'.
        reply.once('aborted',()=>{response.destroy();finish();});
        reply.pipe(response);
        reply.once('end',finish);
      });
      attempt.once('error',error=>{
        if(attempt!==upstream||reply&&reply.complete)return;
        // A pooled socket the API process closed a moment ago fails before any response byte.
        if(!retried&&!reply&&attempt.reusedSocket&&['GET','HEAD'].includes(request.method)&&bodyless&&['ECONNRESET','EPIPE'].includes(error.code)){retried=true;send().end();return;}
        unavailable();
      });
      return attempt;
    };
    send();
    // The body streams straight through; a GET has none.
    request.pipe(upstream);
    const gone=()=>{
      if(done)return;
      upstream.destroy();reply?.destroy();finish();
    };
    request.once('error',gone);
    response.once('close',()=>{if(!response.writableEnded)gone();else finish();});
  });
}
