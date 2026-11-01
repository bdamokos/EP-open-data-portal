import {parentPort,workerData} from 'node:worker_threads';
import {ActivityStore} from '../activity-index-store.mjs';
import {CorpusStore} from '../corpus-store.mjs';
for(const [source,Store] of [['activity',ActivityStore],['corpus',CorpusStore]]){
  const store=new Store(workerData[source]);store.owner=workerData.leaseOwners[source];
  if(!store.acquire())throw new Error('Lease unavailable');
  parentPort.postMessage({type:'lease-owner',source,filename:store.filename});
}
parentPort.on('message',()=>{}); // Deliberately refuse graceful shutdown.
parentPort.postMessage({type:'ready'});
