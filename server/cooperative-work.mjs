import {performance} from 'node:perf_hooks';
import {setImmediate as yieldTurn} from 'node:timers/promises';

// Synchronous model callers and HTTP callers consume the same deterministic
// steps. HTTP work yields between bounded units so timers and other readers run.
export function finishWork(steps) {
  for(;;) {const step=steps.next();if(step.done)return step.value;}
}

export async function cooperativeWork(steps,{signal,sliceMs=8}={}) {
  let until=performance.now()+sliceMs;
  try {
    for(;;) {
      signal?.throwIfAborted();
      const step=steps.next();
      if(step.done)return step.value;
      if(performance.now()>=until) {
        await yieldTurn();
        until=performance.now()+sliceMs;
      }
    }
  } finally {steps.return();}
}
