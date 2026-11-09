import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fork,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiPrefixes,config,integerFromEnvironment} from './config.mjs';
import {HttpError,sendError,sendJson} from './http-utils.mjs';
import {parseRequestTarget,apiPrefixOf,requestBudgetMs} from './request-target.mjs';
import {requestTimeout} from './request-budget.mjs';
import {serveStatic} from './static-files.mjs';
import {stampedDigest} from './api-version-stamp.mjs';
import {errorLog,serverErrorEvent} from './error-log.mjs';
import {ipcPort} from './ipc-port.mjs';
import {ApiSupervisor} from './api-supervisor.mjs';
import {createProxyAgent,proxyRequest} from './reverse-proxy.mjs';
import {FrontSnapshots,sendSnapshot} from './front-snapshots.mjs';
import {serveUpstreamPort} from './upstream-rpc.mjs';
import {defaultUpstreamServices} from './upstream-services.mjs';
import {serveRetention,sendRetention} from './base-source-rpc.mjs';
import {acceptOfficialHints} from './official-context-hints.mjs';
import {acceptDocumentBodyHints} from './document-body-hints-rpc.mjs';
import {acceptSittingSnapshotHints} from './sitting-snapshot-hints-rpc.mjs';
import {startSourceWriters} from './source-writers.mjs';

// The always-on process of a split deployment (EXPLORER_PROCESS_MODE=split). It
// stays small: static files, health checks, the upstream request queue and rate
// budget, the source writer thread and the error log. Everything else is a
// reverse proxy to the API process, which this file starts on demand. It must not
// import the API module graph (see front.test.mjs).
// Production images carry the stamp; elsewhere the version is derived once, on the first health check.
let apiVersionPromise;
const apiVersion=()=>apiVersionPromise??=Promise.resolve(stampedDigest()?.slice(0,12)??import('./api-version.mjs').then(module=>module.API_VERSION));
const apiEntry=fileURLToPath(new URL('./api-child.mjs',import.meta.url));

function forkApi() {
  return fork(apiEntry,[],{
    env:{...process.env,EXPLORER_PROCESS_ROLE:'api'},
    // 'advanced' keeps retained source bodies as bytes across the link.
    serialization:'advanced',
    stdio:['ignore','inherit','inherit','ipc'],
  });
}

// What the API process asks of the front: admission to the shared upstream queue,
// retention of fetched sources, writer hints and error log entries.
function serveApiLink(child) {
  const upstream=serveUpstreamPort(ipcPort(child,'upstream'),defaultUpstreamServices().upstreamPortServices(),{foreground:true});
  child.once('exit',upstream);
  serveRetention(ipcPort(child,'retention'),(observation,body,{directory})=>sendRetention({observation,body,directory}));
  const hints=ipcPort(child,'hints');
  hints.on('message',message=>{
    // The front's own hint queues feed the writer thread through startSourceWriters.
    if(acceptOfficialHints(message))hints.postMessage({type:'official-context-hints-received'});
    else if(acceptDocumentBodyHints(message))hints.postMessage({type:'document-body-hints-received'});
    else if(acceptSittingSnapshotHints(message))hints.postMessage({type:'sitting-hints-received'});
  });
}

function wantsHtmlPage(request,url) {
  return request.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')&&String(request.headers.accept||'').includes('text/html');
}

export function createFront({supervisor,agent=createProxyAgent(),snapshots=null,log=console.warn}={}) {
  const handler=async(request,response)=>{
    const started=performance.now(),requestId=randomUUID();
    response.explorerStartedAt=started;
    const controller=new AbortController();
    let proxied=false;
    try {
      const url=parseRequestTarget(request);
      let apiPrefix=apiPrefixOf(url);
      // Probes never wake the API process: the front answers them. A request with
      // an Origin header or a query takes the API's own checks instead.
      const health=['GET','HEAD'].includes(request.method)&&!request.headers.origin&&!url.search&&(url.pathname==='/healthz'||url.pathname==='/api/healthz');
      if(health){
        response.setHeader('X-Request-Id',requestId);
        sendJson(request,response,200,{ok:true,service:'parliament-explorer',apiVersion:await apiVersion(),time:new Date().toISOString()});
        return;
      }
      // As in single mode, /healthz is an alias of the API's own health check.
      if(url.pathname==='/healthz'){
        url.pathname=`${apiPrefixes.at(-1)}/healthz`;
        request.url=url.pathname+url.search;
        apiPrefix=apiPrefixes.at(-1);
      }
      if(apiPrefix){
        proxied=true;
        // A few anonymous reads may be answered from the last good copy while the API process starts.
        const candidate=snapshots?await snapshots.candidate(request,url,apiPrefix):null;
        if(candidate&&!supervisor.ready){
          const hit=await snapshots.lookup(candidate);
          if(hit){
            supervisor.wake();
            sendSnapshot(request,response,hit,{requestId});
            return;
          }
        }
        const closed=()=>{if(!response.writableEnded)controller.abort(new HttpError(499,'request_cancelled','The request was cancelled.'));};
        response.once('close',closed);
        // One budget covers the wait for the API process and the wait for its answer, as in single mode.
        const budgetMs=requestBudgetMs(url,apiPrefix),deadline=setTimeout(()=>controller.abort(requestTimeout()),Math.max(0,started+budgetMs-performance.now()));
        let lease;
        try {
          try {lease=await supervisor.acquire({budgetMs:Math.max(1,started+budgetMs-performance.now()),signal:controller.signal});}
          catch(error){
            if(response.destroyed||controller.signal.reason?.code==='request_cancelled')return;
            // As in single mode, a request that ran out of time is logged.
            if(error?.code==='request_timeout')errorLog.write(serverErrorEvent(request,error,{requestId,elapsedMs:Math.round(performance.now()-started)}));
            response.setHeader('X-Request-Id',requestId);
            sendError(request,response,error);
            return;
          }
          try {
            const expired=await proxyRequest(request,response,{port:lease.port,agent,requestId,signal:controller.signal,capture:candidate&&{maxBytes:snapshots.maxEntryBytes,done:reply=>snapshots.record(candidate,reply)}});
            if(expired&&controller.signal.reason?.code==='request_timeout')errorLog.write(serverErrorEvent(request,controller.signal.reason,{requestId,elapsedMs:Math.round(performance.now()-started)}));
          }
          finally {lease.release();}
        } finally {clearTimeout(deadline);response.removeListener('close',closed);}
        return;
      }
      response.setHeader('X-Request-Id',requestId);
      // A page load is a visitor: start the API process while the browser fetches the bundle.
      if(wantsHtmlPage(request,url))supervisor.wake();
      if(await serveStatic(request,response,url))return;
      throw new HttpError(404,'not_found','The requested resource does not exist');
    } catch(error) {
      if(!proxied||error.code!=='request_cancelled')errorLog.write(serverErrorEvent(request,error,{requestId,elapsedMs:Math.round(performance.now()-started)}));
      if(response.destroyed||response.writableEnded)return;
      if(!response.headersSent)sendError(request,response,error);
      else response.destroy();
    }
  };
  const server=http.createServer(handler);
  server.requestTimeout=30_000;
  server.headersTimeout=10_000;
  server.keepAliveTimeout=5_000;
  server.maxRequestsPerSocket=1000;
  return {server,handler,agent};
}

// Prepares the SQLite indexes in a short-lived process, so the schema code
// never loads here and its memory returns to the system when it exits.
function prepareIndexes() {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./migrate-indexes.mjs',import.meta.url)),'--startup'],{stdio:'inherit',env:process.env});
  if(result.status!==0)throw new Error('Index preparation failed.');
}

export function startFront() {
  try {prepareIndexes();}
  catch(error){console.error('[index-prepare]',error.message);process.exit(1);}
  const idleMinutes=integerFromEnvironment('EXPLORER_API_IDLE_MINUTES',20,0,1440);
  const supervisor=new ApiSupervisor({spawn:forkApi,idleMs:idleMinutes*60_000});
  supervisor.on('spawn',serveApiLink);
  supervisor.on('message',message=>{
    if(message?.type==='error-event'&&message.event&&typeof message.event==='object')errorLog.write(message.event);
  });
  // Last good copies of the home page's API answers, kept under ODP_CACHE_DIR (off without it, or with EXPLORER_FRONT_SNAPSHOT_MB=0).
  const cacheDir=process.env.ODP_CACHE_DIR;
  const snapshots=new FrontSnapshots({directory:cacheDir&&path.join(cacheDir,'front-snapshots-v1'),currentVersion:apiVersion,
    maxBytes:cacheDir?integerFromEnvironment('EXPLORER_FRONT_SNAPSHOT_MB',16,0,256)*1024*1024:0});
  snapshots.load(stampedDigest()?.slice(0,12)??null);
  supervisor.on('stopped',()=>{void snapshots.flush();});
  const {server,agent}=createFront({supervisor,snapshots});
  let stopWriters=()=>Promise.resolve(),stopMonitoring=()=>{},shuttingDown=false;
  server.on('error',error=>{console.error(`[parliament-explorer] server error: ${error.message}`);process.exitCode=1;});
  const shutDown=signal=>{
    if(shuttingDown)return;
    shuttingDown=true;
    console.log(`[parliament-explorer] received ${signal}; shutting down`);
    const force=setTimeout(()=>{process.exitCode=1;server.closeAllConnections();},8000);force.unref();
    stopMonitoring();
    server.close(()=>clearTimeout(force));
    server.closeIdleConnections();
    void (async()=>{
      await supervisor.close();agent.destroy();
      await snapshots.close();
      await stopWriters();
      await errorLog.flush();
    })().catch(error=>console.error('[shutdown]',error.message));
  };
  process.on('SIGINT',()=>shutDown('SIGINT'));
  process.on('SIGTERM',()=>shutDown('SIGTERM'));
  server.once('listening',()=>{
    stopMonitoring=defaultUpstreamServices().startOdpMonitoring();
    stopWriters=startSourceWriters({onPublication:message=>supervisor.publish(message)});
  });
  server.listen(config.port,config.host,()=>{
    console.log(`[parliament-explorer] front listening on http://${config.host}:${config.port} (API process on demand, idle exit after ${idleMinutes} min)`);
  });
  return {server,supervisor};
}
