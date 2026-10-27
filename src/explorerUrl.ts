import {useCallback,useEffect,useRef,useState} from 'react';
import {readExplorerParam} from './explorerQuery.mjs';
export {explorerParams} from './explorerQuery.mjs';

const changed='explorer-query-change';
type HistoryState=Record<string,unknown>;
type QueryUpdate=(url:URL,state:HistoryState)=>void;
export type ExplorerParamStorage={read:()=>URLSearchParams;write:(key:string,value:string|null)=>void};
let pending:{updates:QueryUpdate[];replace:boolean}|null=null;

// A single gesture can change several facets. Keep it as one Back/Forward step.
export function updateExplorerQuery(update:QueryUpdate,replace=false) {
  if(!pending){
    pending={updates:[],replace:true};
    queueMicrotask(()=>{
      const changes=pending!;pending=null;
      const url=new URL(location.href),state={...history.state};
      for(const apply of changes.updates)apply(url,state);
      if(url.href===location.href&&JSON.stringify(state)===JSON.stringify(history.state||{}))return;
      changes.replace?history.replaceState(state,'',url):history.pushState(state,'',url);
      window.dispatchEvent(new Event(changed));
    });
  }
  pending.updates.push(update);pending.replace&&=replace;
}

function writeParam(key:string,value:string|null) {
  updateExplorerQuery(url=>{value===null?url.searchParams.delete(key):url.searchParams.set(key,value);});
}

export function useExplorerParam<T extends string|number|null>(key:string,fallback:T,allowed?:readonly T[],storage?:ExplorerParamStorage) {
  const read=useCallback(()=>readExplorerParam(storage?storage.read():new URLSearchParams(location.search),key,fallback,allowed),[key,fallback,storage]);
  const [value,setValue]=useState<T>(read),current=useRef(value);current.current=value;
  useEffect(()=>{const update=()=>setValue(read());update();window.addEventListener('popstate',update);window.addEventListener(changed,update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener(changed,update);};},[read]);
  const set=useCallback((next:T|((previous:T)=>T))=>{
    const value=typeof next==='function'?next(current.current):next;
    current.current=value;setValue(value);
    (storage?.write||writeParam)(key,value===null||value===fallback||value===''?null:String(value));
  },[key,fallback,storage]);
  return [value,set] as const;
}
