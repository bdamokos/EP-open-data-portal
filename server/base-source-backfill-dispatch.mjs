// One whole step; busy scheduling belongs to collector-dispatch's shared slot.
export async function dispatchBaseBackfill(worker){
  if(!worker.baseBackfill?.due()||worker.stopped||worker.controller.signal.aborted||worker.requests>=worker.budget||worker.monotonic()>=worker.runDeadline)return false;
  return worker.baseBackfill.step(worker.controller.signal);
}
