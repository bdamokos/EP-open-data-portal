import {useCallback,useEffect,useRef,useState} from 'react';
import {readExplorerParam} from './explorerQuery.mjs';
export {explorerParams} from './explorerQuery.mjs';

const changed='explorer-query-change';
let pending:Map<string,string|null>|null=null;

// A single gesture can change several facets. Keep it as one Back/Forward step.
function writeParam(key:string,value:string|null) {
  if(!pending){
    pending=new Map();
    queueMicrotask(()=>{
      const changes=pending!;pending=null;
      const url=new URL(location.href);
      for(const [name,value] of changes)value===null?url.searchParams.delete(name):url.searchParams.set(name,value);
      if(url.href!==location.href)history.pushState(null,'',url);
      window.dispatchEvent(new Event(changed));
    });
  }
  pending.set(key,value);
}

export function useExplorerParam<T extends string|number|null>(key:string,fallback:T,allowed?:readonly T[]) {
  const read=useCallback(()=>readExplorerParam(new URLSearchParams(location.search),key,fallback,allowed),[key,fallback]);
  const [value,setValue]=useState<T>(read),current=useRef(value);current.current=value;
  useEffect(()=>{const update=()=>setValue(read());update();window.addEventListener('popstate',update);window.addEventListener(changed,update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener(changed,update);};},[read]);
  const set=useCallback((next:T|((previous:T)=>T))=>{
    const value=typeof next==='function'?next(current.current):next;
    current.current=value;setValue(value);
    writeParam(key,value===null||value===fallback||value===''?null:String(value));
  },[key,fallback]);
  return [value,set] as const;
}
