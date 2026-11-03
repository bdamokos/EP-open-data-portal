import test from 'node:test';import assert from 'node:assert/strict';
import {dispatchCollector,ordinaryCollectorTurn} from './collector-dispatch.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {upstreamPortServices} from './odp.mjs';
test('busy dispatches reserve exactly one collector turn in 32 when configured and alternate durably',async()=>{
 const saved=new Map(),worker={store:{get:k=>saved.get(k),set:(k,v)=>saved.set(k,v)},requests:0,budget:1000,controller:new AbortController()},seen=[];
 const options={busy:true,every:32,topic:async()=>{worker.requests++;seen.push('topic');return true;},story:async()=>{worker.requests++;seen.push('story');return true;}};
 for(let i=0;i<96;i++)if(!await dispatchCollector(worker,options))ordinaryCollectorTurn(worker,32);
 assert.deepEqual(seen,['topic','story','topic']);const restarted={...worker};assert.equal(await dispatchCollector(restarted,options),false);assert.equal(saved.get('topicCollectorDispatch').next,'story');
});
test('the default share gives collectors one busy turn in six',async()=>{
 const {collectorTurnEvery}=await import('./collector-share.mjs');assert.equal(collectorTurnEvery,6);
 const saved=new Map(),worker={store:{get:k=>saved.get(k),set:(k,v)=>saved.set(k,v)},requests:0,budget:1000,controller:new AbortController()};let turns=0;
 const options={busy:true,topic:async()=>{turns++;return true;},story:async()=>{turns++;return true;}};
 for(let i=0;i<36;i++)if(!await dispatchCollector(worker,options))ordinaryCollectorTurn(worker);
 assert.equal(turns,6);
});
test('background admission grants a waiting collector its bounded share without overtaking visitors',async()=>{
 const q=new UpstreamQueue({maximum:1}),hold=await q.acquire('background'),order=[];
 q.collectorTurnEvery=32;q.backgroundTurns=31;const core=q.run(()=>order.push('core'),{priority:'background'}),collector=q.run(()=>order.push('collector'),{priority:'background',backgroundRank:1}),visitor=q.run(()=>order.push('visitor'));
 hold();await Promise.all([core,collector,visitor]);assert.deepEqual(order,['visitor','collector','core']);
});
test('collectors wait during foreground pressure on another origin, then wake without polling',async()=>{
 const {queueFor}=upstreamPortServices(),foreground=queueFor('website'),collector=queueFor('documents'),release=await foreground.acquire();let called=false;
 const pending=collector.run(()=>{called=true;},{priority:'background',backgroundRank:1});await new Promise(setImmediate);assert.equal(called,false);release();await pending;assert.equal(called,true);
});

test('cancelling a queued visitor wakes collectors on other origins without a timer',async()=>{
 const {queueFor}=upstreamPortServices(),q=queueFor('website'),other=queueFor('documents'),old=q.maximum;q.maximum=1;const held=await q.acquire('background'),controller=new AbortController();
 const visitor=q.acquire('interactive',{signal:controller.signal});const rejected=assert.rejects(visitor,/left/);let ran=false;const collector=other.run(()=>{ran=true;},{priority:'background',backgroundRank:1});await new Promise(setImmediate);assert.equal(ran,false);
 try{controller.abort(Error('left'));await rejected;await collector;assert(ran);}finally{q.maximum=old;held();}
});
test('voting lists share the same one-in-six optional counter without spending ODP budget',async()=>{
 const saved=new Map(),seen=[],worker={store:{get:k=>saved.get(k),set:(k,v)=>saved.set(k,v)},requests:0,budget:1000,controller:new AbortController(),votingLists:{step:async()=>{seen.push('voting-lists');return true;}}};
 const options={busy:true,topic:async()=>{seen.push('topic');return true;},story:async()=>{seen.push('story');return true;}};
 for(let i=0;i<36;i++)if(!await dispatchCollector(worker,options))ordinaryCollectorTurn(worker);
 assert.deepEqual(seen,['topic','story','voting-lists','topic','story','voting-lists']);assert.equal(worker.requests,0);
});
