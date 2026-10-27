import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSnapshot,hash,sourceUrl,responseHash,semanticResponse} from './agenda-benchmark-model.mjs';

export async function runWorker(config) {
  const {snapshot,inputs}=await loadSnapshot(config.snapshotDirectory),clock=()=>Date.parse(snapshot.sample.asOf);
  process.env.ODP_CACHE_DIR=path.join(config.directory,'odp');
  await mkdir(process.env.ODP_CACHE_DIR,{recursive:true});
  // Seed only records derived from this public snapshot, freshly validated for
  // the restart scenario. Original retrieval dates remain in the manifest.
  if(config.seedSources)for(const input of inputs.values())if(input.status===200)await writeFile(path.join(process.env.ODP_CACHE_DIR,hash(input.url)+'.json'),JSON.stringify({url:input.url,fetchedAt:Date.now(),payload:JSON.parse(input.body)}));
  const context=new AsyncLocalStorage();let spans=[],origin=performance.now(),fatal=null;
  const span=(stage,label,fn,synchronous=false)=>{
    const row={id:spans.length+1,parent:context.getStore()||null,stage,label,startMs:performance.now()-origin};spans.push(row);
    const end=()=>row.durationMs=performance.now()-origin-row.startMs;
    return context.run(row.id,()=>{
      if(synchronous){try{return fn();}finally{end();}}
      return Promise.resolve().then(fn).finally(end);
    });
  };
  globalThis.fetch=async(value,{signal}={})=>{
    const url=String(value),input=inputs.get(url);
    if(!input){fatal='Replay requested an input outside the frozen manifest: '+url;throw Error(fatal);}
    const parent=context.getStore();
    await span('transport-headers',url,async()=>{
      signal?.throwIfAborted();
      if(config.latency==='recorded'&&input.headersMs)await sleep(input.headersMs,undefined,{signal});
    });
    const body=input.status===204?null:new ReadableStream({async start(controller){
      try{await context.run(parent,()=>span('transport-body',url,async()=>{if(config.latency==='recorded'&&input.bodyMs)await sleep(input.bodyMs,undefined,{signal});signal?.throwIfAborted();controller.enqueue(input.body);controller.close();}));}catch(error){controller.error(error);}
    }});
    return new Response(body,{status:input.status,headers:{'content-type':input.contentType}});
  };
  const importStart=performance.now();
  const [{createInsights},{LegislationInsights},{MeetingsReader},{InsightViewCache},{odp,upstreamStatus},{ActivityStore},{createRequestBudget,runWithRequestSignal,waitForRequest}]=await Promise.all([
    import('../server/insights.mjs'),import('../server/insights-legislation.mjs'),import('../server/meetings-reader.mjs'),import('../server/insights-view-cache.mjs'),import('../server/odp.mjs'),import('../server/activity-index-store.mjs'),import('../server/request-budget.mjs')
  ]);
  const importsMs=performance.now()-importStart;
  // These wrappers observe the real methods without replacing their cache,
  // scheduling, pagination or response algorithms. Span durations are inclusive.
  for(const [prototype,method,stage,label] of [
    [LegislationInsights.prototype,'query','agenda',query=>query.week?'week:'+query.week:query.sitting||'default'],
    [LegislationInsights.prototype,'catalogue','catalogue',()=> 'current term'],
    [MeetingsReader.prototype,'year','catalogue-year',year=>String(year)],
    [InsightViewCache.prototype,'get','view-cache',()=> 'lookup or assemble'],
    [InsightViewCache.prototype,'stored','view-read',()=> 'memory or disk'],
    [InsightViewCache.prototype,'save','view-save',()=> 'publish and prune'],
  ]) {
    const original=prototype[method];prototype[method]=function(...args){return span(stage,label(args[0]),()=>original.apply(this,args));};
  }
  const indexStart=performance.now(),store=new ActivityStore(path.join(config.directory,'index'),{clock});
  if(!store.get('active')) {
    store.acquire();
    store.set('active',1);store.set('lastSuccess',snapshot.sample.asOf);store.set('rosterFetchedAt',snapshot.sample.asOf);
    store.setMembers(Array.from({length:720},(_,index)=>({id:String(index+1),name:'Benchmark member '+(index+1)})));
    const insert=store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES(1,?,'document',?,?)");
    store.transaction(()=>{for(let index=0;index<config.indexRows;index++)insert.run('benchmark:'+index,JSON.stringify({benchmark:true,padding:'x'.repeat(256)}),snapshot.sample.asOf);});
  }
  store.release();store.db.exec('PRAGMA query_only=ON');
  const indexOpenMs=performance.now()-indexStart;
  const originalStatus=store.status.bind(store);store.status=()=>span('index-status','ready synthetic index',originalStatus,true);
  const request=(endpoint,params,options)=>span('source-read',sourceUrl(endpoint,params),()=>odp(endpoint,params,options));
  const service=createInsights(store,{clock,request,meetings:new MeetingsReader({clock,request}),readSpeechMetadata:null,loadMetadata:()=>{throw Error('Agenda list unexpectedly requested member enrichment.');},viewCache:{directory:path.join(config.directory,'views')}});
  const results=[];let response;
  try {
    for(const scenario of config.scenarios) {
      spans=[];origin=performance.now();
      const cpuStart=process.cpuUsage(),memoryStart=process.memoryUsage(),loopStart=performance.eventLoopUtilization(),loop=monitorEventLoopDelay({resolution:10});loop.enable();
      let value,error=null,serialized='';const budget=createRequestBudget(30_000);
      try {
        value=await runWithRequestSignal(budget.signal,()=>waitForRequest(service.query('legislation',new URLSearchParams(snapshot.sample.query))));
        serialized=span('serialize','JSON response',()=>JSON.stringify(value),true);
      }catch(caught){error={code:caught.code||'benchmark_error',message:caught.message};}
      finally{budget.dispose();loop.disable();}
      const elapsedMs=performance.now()-origin,cpu=process.cpuUsage(cpuStart),memory=process.memoryUsage(),queue=upstreamStatus();
      if(fatal)throw Error(fatal);
      if(queue.active||queue.queued||queue.joining)throw Error('Request left source work running; measurement is incomplete.');
      const transport=spans.filter(row=>row.stage==='transport-headers');
      response ||= value&&semanticResponse(value);
      results.push({scenario,elapsedMs,cpuMs:(cpu.user+cpu.system)/1000,heapDeltaBytes:memory.heapUsed-memoryStart.heapUsed,rssBytes:memory.rss,eventLoop:{utilization:performance.eventLoopUtilization(loopStart).utilization,delayMaxMs:loop.max/1e6,delayMeanMs:Number.isFinite(loop.mean)?loop.mean/1e6:null},transportRequests:transport.length,transportBytes:transport.reduce((sum,row)=>sum+inputs.get(row.label).bytes,0),responseBytes:Buffer.byteLength(serialized),semanticHash:value?responseHash(value):null,error,coverage:value?.coverage,topics:value?.topics?.length??null,spans});
      if(error)break;
    }
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();}
  return {importsMs,indexOpenMs,response,results};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runWorker(JSON.parse(await readFile(process.argv[2],'utf8'))).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
