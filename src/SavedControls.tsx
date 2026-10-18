import {useEffect,useState,useSyncExternalStore} from 'react';
import {api,expireActivityReads} from './data';
import {createSavedStore,savedKey,type SavedItem,type SavedStates} from './bookmarks.mjs';
import {interfaceTerm,compoundLanguage} from './terms.mjs';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
export const savedStore=createSavedStore(storage,()=>listeners.forEach(listener=>listener()));
window.addEventListener('storage',event=>{if(event.key==='ep.bookmarks.v1'||event.key===null)savedStore.reload();});
export function useSaved(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},savedStore.snapshot);}
type SavedCheck={data:SavedStates;requestedKey:string};
export const requestedKeys=new WeakMap<Promise<unknown>,string>();
let pending:Promise<SavedCheck>|null=null,lastCheck=0;
export function checkSaved(language:string,force=false) {
  if(pending)return pending;
  if(!force&&Date.now()-lastCheck<5*60_000)return Promise.resolve();
  const items=savedStore.snapshot().items;if(!items.length)return Promise.resolve();
  const params=new URLSearchParams({lang:language});for(const [kind,key] of [['question','questions'],['mep','members']] as const){const ids=items.filter(item=>item.kind===kind).map(item=>item.id);if(ids.length)params.set(key,ids.join(','));}
  const requestedKey=items.map(savedKey).sort().join(',');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12_000);
  pending=api<SavedStates>('insights/saved?'+params,ctrl.signal).then(data=>{expireActivityReads();savedStore.observe(data);lastCheck=Date.now();return {data,requestedKey};}).finally(()=>{clearTimeout(timer);pending=null;if(savedStore.snapshot().items.map(savedKey).sort().join(',')!==requestedKey)void checkSaved(language,true).catch(()=>{});});requestedKeys.set(pending,requestedKey);return pending;
}
export function useSavedChecks(language:string) {
  const {items}=useSaved(),key=items.map(savedKey).sort().join(',');
  useEffect(()=>{void checkSaved(language,true).catch(()=>{});const check=()=>{if(document.visibilityState==='visible')void checkSaved(language).catch(()=>{});};window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[key,language]);
}
export function SaveButton({item,compact=false,language='en'}:{item:SavedItem;compact?:boolean;language?:string}) {
  const {items}=useSaved(),saved=items.some(x=>savedKey(x)===savedKey(item)),[error,setError]=useState('');
  const label=item.kind==='mep'?{text:saved?'Following':'Follow',language:'en'}:interfaceTerm(saved?'saved-question':'save-question',language);
  const name=item.kind==='mep'?label.text+' MEP':label.text;
  const tooltip=item.kind==='mep'?(saved?'Saved in this browser':'Save in this browser'):interfaceTerm(saved?'saved-in-browser':'save-in-browser',language).text;
  return <><button className={'explorer-save-button'+(saved?' is-saved':'')} lang={item.title?compoundLanguage(label.language,item.titleLanguage):label.language} aria-label={`${name}${item.title?' · '+item.title:''}`} aria-pressed={saved} title={tooltip} onClick={()=>{try{savedStore.toggle(item);setError('');}catch(e){setError((e as Error).message);}}}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span lang={label.language}>{label.text}</span>}</button>{error&&<small role="alert" lang="en">{error}</small>}</>;
}
export function SavedNav({onClick,current=false}:{onClick:()=>void;current?:boolean}) {
  const saved=useSaved(),items=saved.items,updates=items.filter(item=>item.updated).length;
  return <button onClick={onClick} lang="en" aria-current={current?'page':undefined}>Following{updates>0?<span className="explorer-saved-count">{updates} new</span>:items.length>0?<small> {items.length}</small>:null}</button>;
}
