import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {api} from './data';
import {createDossiersStore,DOSSIERS_KEY,type FollowedDossier} from './followDossiers.mjs';
import {publicAmendmentsEnabled} from './publicFeatures';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
export const dossierStore=createDossiersStore(storage,()=>listeners.forEach(listener=>listener()));
export const subscribeDossiers=(callback:()=>void)=>{listeners.add(callback);return()=>{listeners.delete(callback);};};
export function useDossiers(){return useSyncExternalStore(subscribeDossiers,dossierStore.snapshot);}
window.addEventListener('storage',event=>{if(event.key===DOSSIERS_KEY||event.key===null)dossierStore.reload();});
let checking=false;
const checkListeners=new Set<()=>void>();
const setChecking=(value:boolean)=>{checking=value;checkListeners.forEach(listener=>listener());};
export function useDossierChecking(){return useSyncExternalStore(callback=>{checkListeners.add(callback);return()=>{checkListeners.delete(callback);};},()=>checking);}
const due=(item:FollowedDossier)=>!item.lastAttempt||item.lastAttempt+6*3600_000<Date.now();
async function runDossierChecks({force=false,signal,only}:{force?:boolean;signal?:AbortSignal;only?:string}={}) {
  const items=dossierStore.snapshot().items.filter(item=>!only||item.id===only);if(!items.length)return;
  setChecking(true);
  try {
    const indexKey=items.map(item=>item.id+':'+item.savedAt).join(',');
    if(force||indexKey!==lastIndexKey||Date.now()-lastIndexAt>=60_000)try {
      const status=await api<{epoch:string;generation:number;marksReady:boolean}>('insights/following-status',signal);
      if(!status.marksReady)throw Error('Updates unavailable.');
      const params=new URLSearchParams({epoch:status.epoch,generation:String(status.generation),procedures:items.map(item=>item.id).join(',')});
      const data=await api<any>('insights/following-dossiers?'+params,signal);
      if(data.epoch!==status.epoch||data.generation!==status.generation)throw Error('The index changed.');
      if(!publicAmendmentsEnabled)for(const row of data.items||[])row.entries=row.entries?.filter((entry:{eventKind:string})=>entry.eventKind!=='amendment-list');
      if(!signal?.aborted&&dossierStore.observeIndex(data,items)){lastIndexKey=indexKey;lastIndexAt=Date.now();}
    }catch{if(!signal?.aborted)items.forEach(item=>dossierStore.unavailable(item.id,item,'index'));}
    for(const item of items.filter(item=>force||due(item)).sort((a,b)=>(a.lastAttempt||0)-(b.lastAttempt||0)).slice(0,5)) {
      if(signal?.aborted)break;
      const params=new URLSearchParams({reference:item.id,lang:'en'});
      await Promise.all([
        api<any>('insights/procedure-progress?'+params,signal).then(data=>{if(!signal?.aborted)dossierStore.observeProgress(item.id,data,item);},()=>{if(!signal?.aborted)dossierStore.unavailable(item.id,item,'progress');}),
        api<any>('insights/press-releases?'+params+'&following=1',signal).then(data=>{if(!signal?.aborted)dossierStore.observePress(item.id,data,item);},()=>{if(!signal?.aborted){dossierStore.unavailable(item.id,item,'press');dossierStore.unavailable(item.id,item,'oeil');}}),
      ]);
      if(!signal?.aborted)dossierStore.finishCheck(item.id,item);
    }
  }finally{setChecking(false);}
}
let pending:Promise<void>|null=null,pendingSignal:AbortSignal|undefined,pendingKey='',lastIndexKey='',lastIndexAt=0;
export function checkDossiers(options:{force?:boolean;signal?:AbortSignal;only?:string}={}):Promise<void> {
  if(options.signal?.aborted)return Promise.resolve();
  const key=JSON.stringify([options.only,options.force,dossierStore.snapshot().items.map(item=>[item.id,item.savedAt])]);
  if(pending)return key===pendingKey&&!pendingSignal?.aborted?pending:pending.catch(()=>{}).then(()=>checkDossiers(options));
  pendingKey=key;pendingSignal=options.signal;
  pending=runDossierChecks(options).finally(()=>{pending=null;});return pending;
}
export function useDossierChecks() {
  const {items}=useDossiers(),key=items.map(item=>item.id+':'+item.savedAt).join(','),controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=new AbortController();controller.current=current;
    void checkDossiers({signal:current.signal});
    const check=()=>{if(document.visibilityState==='visible')void checkDossiers({signal:current.signal});};
    window.addEventListener('focus',check);
    return()=>{current.abort();window.removeEventListener('focus',check);};
  },[key]);
  return ()=>checkDossiers({force:true,signal:controller.current?.signal});
}
export function FollowDossierButton({reference,title,titleLanguage=null,compact=false}:{reference:string;title?:string;titleLanguage?:string|null;compact?:boolean}) {
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const {items}=useDossiers(),saved=items.some(item=>item.id===reference),[error,setError]=useState('');
  return <><button type="button" className={'explorer-save-button'+(saved?' is-saved':'')} lang="en" aria-pressed={saved} aria-label={(saved?'Following dossier ':'Follow dossier ')+reference} title="Saved in this browser" onClick={()=>{try{dossierStore.toggle({id:reference,title,titleLanguage});setError('');if(!saved){controller.current?.abort();controller.current=new AbortController();void checkDossiers({only:reference,force:true,signal:controller.current.signal});}}catch(error){setError((error as Error).message);}}}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span>{saved?'Following':'Follow'}</span>}</button>{error&&<small role="alert" lang="en">{error}</small>}</>;
}
