import {useEffect,useRef,useState} from 'react';
import {retryable,retryDelay,RETRY_DELAYS} from './automaticRetry.mjs';

/** Retain error metadata until the next result so status and Retry-After survive translation. */
export function useAutomaticRetry(key:string|null,error:unknown,loading:boolean,retry:()=>void,gap=false,retryAt=0) {
  const episode=useRef({key,attempt:0,due:0,waiting:false});
  const callback=useRef(retry);callback.current=retry;
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>{
    if(episode.current.key!==key)episode.current={key,attempt:0,due:0,waiting:false};
    const current=episode.current;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const failed=error ? retryable(error) : gap;
    const clear=()=>{clearTimeout(timer);timer=undefined;};
    const run=()=>{
      clear();
      if(!current.waiting)return;
      if(document.visibilityState==='hidden')return;
      const remaining=current.due-Date.now();
      if(remaining>0){timer=setTimeout(run,remaining);return;}
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
      if(!exhausted&&document.visibilityState!=='hidden')timer=setTimeout(run,Math.max(0,current.due-Date.now()));
      const resume=()=>{
        clear();if(document.visibilityState==='hidden')return;
        if(exhausted)current.due=Math.max(Date.now(),at);
        if(exhausted||current.due<=Date.now())run();
        else timer=setTimeout(run,current.due-Date.now());
      };
      document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
      return()=>{clear();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
    }
    return clear;
  },[key,error,loading,gap,retryAt]);
  return retrying;
}
