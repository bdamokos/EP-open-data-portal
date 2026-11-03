import {useEffect,useRef,useState} from 'react';
import {retryable,retryDelay,RETRY_DELAYS} from './automaticRetry.mjs';

// Readers for the same route share a deadline and wake in one synchronous batch.
// Their effects then join the data client's existing pending request. Waiting for
// the latest deadline honours every subscriber's Retry-After and jitter.
type RetryGroup={entries:Map<object,{due:number;run:()=>void}>;timer?:ReturnType<typeof setTimeout>};
const groups=new Map<string,RetryGroup>();
function scheduleRetry(key:string,due:number,run:()=>void) {
  let group=groups.get(key);
  if(!group){group={entries:new Map()};groups.set(key,group);}
  const current=group,token={};current.entries.set(token,{due,run});
  const arm=()=>{
    clearTimeout(current.timer);current.timer=undefined;
    if(!current.entries.size){if(groups.get(key)===current)groups.delete(key);return;}
    if(document.visibilityState==='hidden')return;
    current.timer=setTimeout(()=>{
      current.timer=undefined;
      const callbacks=[...current.entries.values()];current.entries.clear();
      if(groups.get(key)===current)groups.delete(key);
      for(const callback of callbacks)callback.run();
    },Math.max(0,Math.ceil(Math.max(...[...current.entries.values()].map(entry=>entry.due))-Date.now())));
  };
  arm();
  return ()=>{current.entries.delete(token);arm();};
}

/** Retain error metadata until the next result so status and Retry-After survive translation. */
export function useAutomaticRetry(key:string|null,error:unknown,loading:boolean,retry:()=>void,gap=false,retryAt=0) {
  const episode=useRef({key,attempt:0,due:0,waiting:false});
  const callback=useRef(retry);callback.current=retry;
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>{
    if(episode.current.key!==key)episode.current={key,attempt:0,due:0,waiting:false};
    const current=episode.current;
    let cancelTimer:(()=>void)|undefined;
    const failed=error ? retryable(error) : gap;
    const clear=()=>{cancelTimer?.();cancelTimer=undefined;};
    const run=()=>{
      clear();
      if(!current.waiting)return;
      if(document.visibilityState==='hidden')return;
      const remaining=current.due-Date.now();
      if(remaining>0){cancelTimer=scheduleRetry(key!,current.due,run);return;}
      current.waiting=false;current.attempt++;setRetrying(true);callback.current();
    };
    if(!key){setRetrying(false);return;}
    if(!loading){
      if(!failed){current.attempt=0;current.waiting=false;setRetrying(false);return;}
      const at=Math.max(retryAt,Number((error as {retryAt?:number})?.retryAt)||0);
      if(!current.waiting){current.due=Date.now()+retryDelay(current.attempt,at);current.waiting=true;}
      current.due=Math.max(current.due,at);
      const exhausted=current.attempt>=RETRY_DELAYS.length;
      setRetrying(!exhausted);
      if(!exhausted&&document.visibilityState!=='hidden')cancelTimer=scheduleRetry(key,current.due,run);
      // Foreground/network events can repair failed reads. A successful partial
      // response has already exhausted its bounded observation window.
      if(exhausted&&!error){current.waiting=false;return clear;}
      const resume=()=>{
        clear();if(document.visibilityState==='hidden')return;
        if(exhausted)current.due=Math.max(Date.now(),at);
        if(exhausted||current.due<=Date.now())run();
        else cancelTimer=scheduleRetry(key,current.due,run);
      };
      document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
      return()=>{clear();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
    }
    return clear;
  },[key,error,loading,gap,retryAt]);
  return retrying;
}
