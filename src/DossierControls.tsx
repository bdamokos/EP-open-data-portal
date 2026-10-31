import {uiErrorText} from './uiErrors.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
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
async function runDossierChecks({force=false,signal,only}:{force?:boolean;signal?:AbortSignal;only?:string}={}, ui: import('./uiI18n.mjs').UiFormatter = defaultUi) {
  const items=dossierStore.snapshot().items.filter(item=>!only||item.id===only);if(!items.length)return;
  setChecking(true);
  try {
    const indexKey=items.map(item=>item.id+':'+item.savedAt).join(',');
    if(force||indexKey!==lastIndexKey||Date.now()-lastIndexAt>=60_000)try {
      const status=await api<{epoch:string;generation:number;marksReady:boolean}>('insights/following-status',signal, undefined, ui);
      if(!status.marksReady)throw Error('Updates unavailable.');
      const params=new URLSearchParams({epoch:status.epoch,generation:String(status.generation),procedures:items.map(item=>item.id).join(',')});
      const data=await api<any>('insights/following-dossiers?'+params,signal, undefined, ui);
      if(data.epoch!==status.epoch||data.generation!==status.generation)throw Error(ui.t('savedcontrols.data.was.updated.try.again'));
      if(!publicAmendmentsEnabled)for(const row of data.items||[])row.entries=row.entries?.filter((entry:{eventKind:string})=>entry.eventKind!=='amendment-list');
      if(!signal?.aborted&&dossierStore.observeIndex(data,items)){lastIndexKey=indexKey;lastIndexAt=Date.now();}
    }catch{if(!signal?.aborted)items.forEach(item=>dossierStore.unavailable(item.id,item,'index'));}
    for(const item of items.filter(item=>force||due(item)).sort((a,b)=>(a.lastAttempt||0)-(b.lastAttempt||0)).slice(0,5)) {
      if(signal?.aborted)break;
      const params=new URLSearchParams({reference:item.id,lang:'en'});
      await Promise.all([
        api<any>('insights/procedure-progress?'+params,signal, undefined, ui).then(data=>{if(!signal?.aborted)dossierStore.observeProgress(item.id,data,item);},()=>{if(!signal?.aborted)dossierStore.unavailable(item.id,item,'progress');}),
        api<any>('insights/press-releases?'+params+'&following=1',signal, undefined, ui).then(data=>{if(!signal?.aborted)dossierStore.observePress(item.id,data,item);},()=>{if(!signal?.aborted){dossierStore.unavailable(item.id,item,'press');dossierStore.unavailable(item.id,item,'oeil');}}),
      ]);
      if(!signal?.aborted)dossierStore.finishCheck(item.id,item);
    }
  }finally{setChecking(false);}
}
let pending:Promise<void>|null=null,pendingSignal:AbortSignal|undefined,pendingKey='',lastIndexKey='',lastIndexAt=0;
export function checkDossiers(options:{force?:boolean;signal?:AbortSignal;only?:string}={}, ui: import('./uiI18n.mjs').UiFormatter = defaultUi):Promise<void> {
  if(options.signal?.aborted)return Promise.resolve();
  const key=JSON.stringify([options.only,options.force,dossierStore.snapshot().items.map(item=>[item.id,item.savedAt])]);
  if(pending)return ((key===pendingKey) && (!pendingSignal?.aborted)) ? pending : pending.catch(()=>{}).then(()=>checkDossiers(options, ui));
  pendingKey=key;pendingSignal=options.signal;
  pending=runDossierChecks(options, ui).finally(()=>{pending=null;});return pending;
}
export function useDossierChecks() {
  const ui = useUiI18n();
  const {items}=useDossiers(),key=items.map(item=>item.id+':'+item.savedAt).join(','),controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=new AbortController();controller.current=current;
    void checkDossiers({signal:current.signal});
    const check=()=>{if(document.visibilityState==='visible')void checkDossiers({signal:current.signal}, ui);};
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    return()=>{current.abort();window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  },[key]);
  return ()=>checkDossiers({force:true,signal:controller.current?.signal});
}
export function FollowDossierButton({reference,title,titleLanguage=null,compact=false}:{reference:string;title?:string;titleLanguage?:string|null;compact?:boolean}) {
  const ui = useUiI18n();
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const {items}=useDossiers(),saved=items.some(item=>item.id===reference),[error,setError]=useState('');
  return <><button type="button" className={'explorer-save-button'+(saved ? ' is-saved' : '')} lang={ui.language} aria-pressed={saved} aria-label={ui.t("batch4.dossiercontrols.tsx.64.4", {reference: String(reference)})} title={ui.t("batch4.dossiercontrols.tsx.64.1")} onClick={()=>{try{dossierStore.toggle({id:reference,title,titleLanguage});setError('');if(!saved){controller.current?.abort();controller.current=new AbortController();void checkDossiers({only:reference,force:true,signal:controller.current.signal}, ui);}}catch(error){setError(uiErrorText(error,ui));}}}><span aria-hidden="true">{saved ? '★' : '☆'}</span>{!compact&&<span>{saved ? <UiMessage id="batch4.dossiercontrols.tsx.64.2"/> : <UiMessage id="followsuggestions.follow"/>}</span>}</button>{error&&<small role="alert" lang={ui.language}>{error}</small>}</>;
}
