import {parentPort,workerData} from 'node:worker_threads';
import {UpstreamRpcClient} from '../upstream-rpc.mjs';
import {observePublications} from '../source-publications.mjs';

const client=new UpstreamRpcClient(workerData.upstreamPort),controllers=new Map(),bodies=new Map();
let store,unobserve;
parentPort.on('message',async message=>{
  const {id,type}=message;
  try {
    if(type==='shutdown'){
      for(const controller of controllers.values())controller.abort();
      unobserve?.();store?.close();client.close();parentPort.close();return;
    }
    if(type==='crash')process.exit(1);
    if(type==='body-release')bodies.get(message.target)?.();
    if(type==='busy'){
      parentPort.postMessage({type:'busy-start',id});
      const until=performance.now()+2000;while(performance.now()<until){};
    } else if(type==='acquire') {
      const controller=new AbortController();controllers.set(id,controller);
      const grant=await client.acquire('background','/speeches',{signal:controller.signal,source:message.source||'odp',backgroundRank:message.backgroundRank||0});
      parentPort.postMessage({type:'grant',id,grant});return;
    } else if(type==='cancel')controllers.get(message.target)?.abort();
    else if(type==='release')client.release(message.grant,message.result);
    else if(type==='fetch') {
      globalThis.fetch=async()=>{
        if(message.networkError)throw Object.assign(new Error('EXCLUDED private transport message'),{code:'ECONNRESET'});
        const body=message.holdBody?new ReadableStream({start(controller){bodies.set(id,()=>{bodies.delete(id);controller.enqueue(new TextEncoder().encode('body stays in worker'));controller.close();});}}):'body stays in worker';
        return new Response(body,{status:message.status,headers:{'retry-after':String(message.retryAfter||0)}});
      };
      await client.queue('odp').run(async()=>{
        const response=await client.fetch('https://data.europarl.europa.eu/api/v2/speeches/EXACT-ID?secret=excluded');
        if(message.holdBody)parentPort.postMessage({type:'headers',id});
        if(await response.text()!=='body stays in worker')throw new Error('Body changed.');
      });
    } else if(type==='publish') {
      const {ActivityStore}=await import('../activity-index-store.mjs');
      store??=new ActivityStore(workerData.directory);store.acquire();
      unobserve??=observePublications(store,'activity',value=>parentPort.postMessage(value));
      const {generation}=store.beginCycle();store.setMembers([{id:'42'}]);
      store.publish(generation);
      store.transaction(()=>{store.set('availabilityRevision',17);store.set('amendmentMutationRevision',23);});
    }
    parentPort.postMessage({type:'done',id});
  }catch(error){parentPort.postMessage({type:'failed',id,error:error.message});}
});
parentPort.postMessage({type:'ready',heapUsed:process.memoryUsage().heapUsed});
