import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadSnapshot,loadIndexStatus,hash,sourceUrl,responseHash,semanticResponse} from './agenda-benchmark-model.mjs';

async function isolatedWorker(config) {
  const {snapshot,inputs}=await loadSnapshot(config.snapshotDirectory);
  let selectedClock=Date.parse(snapshot.sample.asOf);
  const clock=()=>selectedClock,queryParams=config.sessionCase?{lang:snapshot.sample.query.lang,...(snapshot.sample.query.sitting?{sitting:snapshot.sample.query.sitting}:{week:snapshot.sample.resolvedWeek})}:snapshot.sample.query;
  if(config.sessionCase)Date.now=clock;
  process.env.ODP_CACHE_DIR=path.join(config.directory,'odp');
  await mkdir(process.env.ODP_CACHE_DIR,{recursive:true});
  // Seed only records derived from this public snapshot, freshly validated for
  // the restart scenario. Original retrieval dates remain in the manifest.
  if(config.seedSources)for(const input of inputs.values())if(input.status===200)await writeFile(path.join(process.env.ODP_CACHE_DIR,hash(input.url)+'.json'),JSON.stringify({url:input.url,fetchedAt:Date.now(),payload:JSON.parse(input.body)}));
  const context=new AsyncLocalStorage();let spans=[],origin=performance.now(),fatal=null,gate=null,wireActive=0;
  const wireStarts=[],refreshes=new Set();
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
    const status=input.status,bytes=input.body;
    wireStarts.push({url,status,at:Date.now()});wireActive++;
    const parent=context.getStore();
    await span('transport-headers',url,async()=>{
      signal?.throwIfAborted();
      if(gate)await gate;
      if(config.latency==='recorded'&&input.headersMs)await sleep(input.headersMs,undefined,{signal});
    });
    if(status===204)wireActive--;
    const body=status===204?null:new ReadableStream({async start(controller){
      try{await context.run(parent,()=>span('transport-body',url,async()=>{if(config.latency==='recorded'&&input.bodyMs)await sleep(input.bodyMs,undefined,{signal});signal?.throwIfAborted();controller.enqueue(bytes);controller.close();}));}catch(error){controller.error(error);}finally{wireActive--;}
    }});
    return new Response(body,{status,headers:{'content-type':input.contentType}});
  };
  const importStart=performance.now();
  const runtimeRoot=config.runtimeRoot||fileURLToPath(new URL('../',import.meta.url));
  const [{createInsights},{LegislationInsights},{MeetingsReader},{InsightViewCache},{odp,upstreamStatus},{createRequestBudget,runWithRequestSignal,waitForRequest}]=await Promise.all(
    ['insights','insights-legislation','meetings-reader','insights-view-cache','odp','request-budget'].map(name=>import(pathToFileURL(path.join(runtimeRoot,'server',name+'.mjs')).href)));
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
  const refresh=InsightViewCache.prototype.refresh;
  InsightViewCache.prototype.refresh=function(...args){const promise=refresh.apply(this,args);refreshes.add(promise);promise.then(()=>refreshes.delete(promise),()=>refreshes.delete(promise));return promise;};
  const readinessStart=performance.now(),observation=await loadIndexStatus(config.indexStatus);
  const readinessLoadMs=performance.now()-readinessStart;
  // Agenda list assembly needs readiness/coverage metadata, not contribution
  // rows. Replay the public app's actual status; database work is excluded.
  const store={status:()=>span('index-status','observed app readiness',()=>observation.payload,true),get:key=>observation.payload[key]};
  const request=(endpoint,params,options)=>span('source-read',sourceUrl(endpoint,params),()=>odp(endpoint,params,options));
  const service=createInsights(store,{clock,request,meetings:new MeetingsReader({clock,request}),readSpeechMetadata:null,loadMetadata:()=>{throw Error('Agenda list unexpectedly requested member enrichment.');},viewCache:{directory:path.join(config.directory,'views')}});
  const results=[];let response;
    if(config.sessionCase) {
      const query=()=>service.query('legislation',new URLSearchParams(queryParams)),prime=await query(),topicsHash=value=>hash(JSON.stringify(semanticResponse(value.topics)));
      const originalTopicsHash=topicsHash(prime);
      const originalNow=Date.now,ageMs=config.sessionCase==='past-next-day'?24*60*60_000:config.sessionCase==='current-aged-view'?16*60_000:7*60*60_000;
      let wall=originalNow()+ageMs;selectedClock+=ageMs;Date.now=()=>wall;
      spans=[];origin=performance.now();wireStarts.length=0;
      let release;gate=new Promise(resolve=>release=resolve);
      try {
        let timer;
        const pending=query(),first=await Promise.race([pending.then(value=>({value})),new Promise(resolve=>timer=setTimeout(()=>resolve({blocked:true}),250))]);clearTimeout(timer);
        const returnedWhileHeld=!first.blocked,initial=first.value;
        let responseMs=initial?performance.now()-origin:null;
        const requestsBeforeReturn=wireStarts.length;
        await new Promise(resolve=>setImmediate(resolve));
        release();gate=null;
        const value=initial||await pending;
        responseMs??=performance.now()-origin;
        const initialResponse=structuredClone(value),initialTopicsHash=topicsHash(initialResponse),initialSemanticHash=responseHash(initialResponse);
        async function settle() {
          const deadline=performance.now()+60_000;
          for(;;) {
            if(fatal)throw Error(fatal);
            const queue=upstreamStatus();
            if(!wireActive&&!queue.active&&!queue.queued&&!queue.joining&&!refreshes.size) {
              let saved=true;
              for(const {url,at} of wireStarts.filter(row=>row.status===200)) {
                const parsed=new URL(url),params=Object.fromEntries(parsed.searchParams);delete params.format;
                const record=await odp(parsed.pathname.slice('/api/v2'.length),params,{cachedOnly:true});
                if(record.fetchedAt<at)saved=false;
              }
              if(saved)break;
            }
            if(performance.now()>deadline)throw Error('Background agenda recheck did not settle.');
            await sleep(5);
          }
        }
        await settle();
        const backgroundMs=performance.now()-origin-responseMs,requestsAfterRecheck=wireStarts.length,agendaRecheckRequests=wireStarts.filter(row=>row.url.includes('/foreseen-activities')).length,failedRechecks=wireStarts.filter(row=>row.status>=400).length;
        // Observe the next normal view refresh after sources finish, rather
        // than making a private cache publication look like reader acceptance.
        selectedClock+=6*60_000;wall+=6*60_000;await query();await settle();const next=await query();
        const refreshedTopicsHash=topicsHash(next);
        const retainedDataSame=originalTopicsHash===initialTopicsHash&&originalTopicsHash===refreshedTopicsHash;
        const policyGaps=[];
        if(!returnedWhileHeld)policyGaps.push('cached-load-waits-for-upstream');
        if(config.sessionCase.startsWith('past')&&requestsAfterRecheck)policyGaps.push('historical-agenda-rechecked');
        if(config.sessionCase.startsWith('current')&&!agendaRecheckRequests)policyGaps.push('current-agenda-not-rechecked-at-probe-age');
        const failed=!retainedDataSame||(config.sessionCase.startsWith('current')&&!returnedWhileHeld);
        return {importsMs,readinessLoadMs,session:{case:config.sessionCase,ageMs,responseMs,returnedWhileHeld,requestsBeforeReturn,recheckRequests:requestsAfterRecheck,agendaRecheckRequests,backgroundMs,failedRechecks,retainedDataSame,topicsHash:initialTopicsHash,refreshedTopicsHash,verificationRequests:wireStarts.length-requestsAfterRecheck,policyGaps,failed,initialSemanticHash,response:initialResponse,nextResponse:next,spans}};
      }finally{release();gate=null;Date.now=originalNow;}
    }
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
  return {importsMs,readinessLoadMs,response,results};
}

export async function runWorker(config) {
  const originalNow=Date.now;
  try{return await isolatedWorker(config);}finally{Date.now=originalNow;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runWorker(JSON.parse(await readFile(process.argv[2],'utf8'))).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
