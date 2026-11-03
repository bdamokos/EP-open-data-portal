import assert from 'node:assert/strict';
import {act} from 'react';

const clocks=new WeakMap();
/** Fake only automatic-retry timers. Vite, fetch deadlines and UI debounce keep
 * their ordinary clocks, so integration harnesses can settle deferred fixtures. */
export function installRetryClock(t) {
 if(clocks.has(t))return clocks.get(t);
 const timers=new Map(),realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout,realNow=Date.now;
 let elapsed=0;
 t.mock.method(Date,'now',()=>realNow()+elapsed);
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
  if(!new Error().stack?.includes('useAutomaticRetry.ts'))return realSetTimeout(callback,delay,...args);
  const timer={};timers.set(timer,{callback,args,due:Date.now()+delay});return timer;
 });
 t.mock.method(globalThis,'clearTimeout',timer=>{if(timers.has(timer))timers.delete(timer);else realClearTimeout(timer);});
 const clock={timers,async advance(ms){
  const until=Date.now()+ms;let steps=0;
  for(;;){
   const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];
   if(!next||next[1].due>until)break;
   assert(++steps<1000,'Retry timers did not settle: '+JSON.stringify({until,now:Date.now(),due:next[1].due}));
   elapsed+=Math.max(0,next[1].due-Date.now());timers.delete(next[0]);
   await act(async()=>next[1].callback(...next[1].args));
  }
  elapsed+=Math.max(0,until-Date.now());
  await act(async()=>{});
 }};
 clocks.set(t,clock);return clock;
}
/** Run the next timer actually scheduled by the production backoff policy. */
export async function automaticRecovery(t) {
 const clock=clocks.get(t);assert(clock,'Install the retry clock before mounting the reader');
 const next=Math.min(...[...clock.timers.values()].map(timer=>timer.due));
 assert(Number.isFinite(next),'The read has no automatic retry scheduled');
 await clock.advance(Math.max(0,next-Date.now())+1);
}
export async function exhaustAutomaticRetries(t) {
 const clock=clocks.get(t);assert(clock,'Install the retry clock before mounting the reader');
 for(let i=0;i<6;i++){
  const deadlines=[...clock.timers.values()].map(timer=>timer.due);assert(deadlines.length,'The read has no automatic retry scheduled');
  await clock.advance(Math.max(0,Math.max(...deadlines)-Date.now())+1);
 }
}
