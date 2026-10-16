import {AsyncLocalStorage} from 'node:async_hooks';
import {HttpError} from './http-utils.mjs';

const requests=new AsyncLocalStorage();
export const requestSignal=()=>requests.getStore();
export const runWithRequestSignal=(signal,operation)=>requests.run(signal,operation);
export const cancelledRequest=()=>new HttpError(499,'request_cancelled','The reader closed this request.');
export const requestTimeout=()=>Object.assign(new HttpError(503,'request_timeout','This data request took too long. Please try again.'),{retryAfter:1});

export function createRequestBudget(timeoutMs=30_000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(requestTimeout()),timeoutMs);timer.unref?.();
  return {signal:controller.signal,abort:reason=>controller.abort(reason),dispose:()=>clearTimeout(timer)};
}

// Cancels only this wait. The supplied shared promise retains its own owner.
export function waitForRequest(promise,signal=requestSignal()) {
  if(!signal)return promise;
  if(signal.aborted){void Promise.resolve(promise).catch(()=>{});return Promise.reject(signal.reason);}
  return new Promise((resolve,reject)=>{
    const finish=(settle,value)=>{signal.removeEventListener('abort',abort);settle(value);};
    const abort=()=>finish(reject,signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
