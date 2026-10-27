import {useEffect} from 'react';
import {updateExplorerQuery,useExplorerParam,type ExplorerParamStorage} from './explorerUrl';

const field='explorerClosedGlobalSearch',sessionKey='explorer:closed-global-search';
const globalKey=(key:string)=>/^global-fts-(search|text-lang|page|offset|read|kind|sort|closed)$/.test(key);
function remembered(state:Record<string,unknown>):string|null {
  if(Object.hasOwn(state,field))return typeof state[field]==='string'?state[field]:null;
  try{return window.sessionStorage.getItem(sessionKey);}catch{return null;}
}
function queryFor(url:URL,state:Record<string,unknown>) {
  const entries=[...url.searchParams].filter(([key])=>globalKey(key));
  if(entries.length)return new URLSearchParams(entries);
  const saved=remembered(state);
  return new URLSearchParams(saved&&saved.length<=16000?saved:'');
}
function store(url:URL,state:Record<string,unknown>,query:URLSearchParams) {
  for(const key of [...url.searchParams.keys()])if(globalKey(key))url.searchParams.delete(key);
  const closed=query.get('global-fts-closed')==='1';
  const saved=closed?query.toString():null;
  state[field]=saved;
  try{saved===null?window.sessionStorage.removeItem(sessionKey):window.sessionStorage.setItem(sessionKey,saved);}catch{/* History still remembers the query when storage is blocked. */}
  if(!closed)for(const [key,value] of query)if(globalKey(key)&&key!=='global-fts-closed')url.searchParams.set(key,value);
}
const storage:ExplorerParamStorage={
  read:()=>queryFor(new URL(location.href),history.state||{}),
  write:(key,value)=>updateExplorerQuery((url,state)=>{
    const query=queryFor(url,state);
    value===null?query.delete(key):query.set(key,value);
    store(url,state,query);
  }),
};

export function useTextSearchParam<T extends string|number|null>(key:string,fallback:T,allowed?:readonly T[]) {
  return useExplorerParam(key,fallback,allowed,globalKey(key)?storage:undefined);
}

export function useGlobalSearchMemory(prefix:string) {
  useEffect(()=>{
    if(prefix!=='global-fts')return;
    // Migrate old closed-search links and snapshot each visited history entry.
    const sync=()=>updateExplorerQuery((url,state)=>{
      if(!Object.hasOwn(state,field)||url.searchParams.get('global-fts-closed')==='1')store(url,state,queryFor(url,state));
    },true);
    sync();window.addEventListener('popstate',sync);window.addEventListener('explorer-query-change',sync);
    return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('explorer-query-change',sync);};
  },[prefix]);
}
