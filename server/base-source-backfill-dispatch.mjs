import {collectorTurnEvery} from './collector-share.mjs';

// Count actual core dispatches, so short iterations and restarts cannot reset
// the backfill share. A turn is one bounded discovery batch or acquisition job.
export function ordinaryBaseBackfillTurn(worker,every=collectorTurnEvery){
  if(worker.baseBackfill)worker.store.set('baseBackfillDispatch',Math.min(every,Number(worker.store.get('baseBackfillDispatch')||0)+1));
}
export async function dispatchBaseBackfill(worker,{busy=false,force=false,every=collectorTurnEvery}={}){
  if(!worker.baseBackfill?.due()||worker.stopped||worker.controller.signal.aborted||worker.requests>=worker.budget||worker.monotonic()>=worker.runDeadline)return false;
  if(busy&&!force&&Number(worker.store.get('baseBackfillDispatch')||0)<every)return false;
  const progressed=await worker.baseBackfill.step(worker.controller.signal);
  if(progressed)worker.store.set('baseBackfillDispatch',0);
  return progressed;
}
