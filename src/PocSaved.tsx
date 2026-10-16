import {useEffect,useState,useSyncExternalStore} from 'react';
import {api,expireActivityReads} from './pocData';
import {createSavedStore,savedKey,savedLinks,type SavedItem,type SavedStates} from './pocBookmarks.mjs';
import {humanDate} from './PocInsightCharts';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
const store=createSavedStore(storage,()=>listeners.forEach(listener=>listener()));
window.addEventListener('storage',event=>{if(event.key==='ep.bookmarks.v1'||event.key===null)store.reload();});
export function useSaved(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},store.snapshot);}
let pending:Promise<void>|null=null,lastCheck=0;
export function checkSaved(language:string,force=false) {
  if(pending)return pending;
  if(!force&&Date.now()-lastCheck<5*60_000)return Promise.resolve();
  const items=store.snapshot().items;if(!items.length)return Promise.resolve();
  const params=new URLSearchParams({lang:language});for(const [kind,key] of [['question','questions'],['mep','members']] as const){const ids=items.filter(item=>item.kind===kind).map(item=>item.id);if(ids.length)params.set(key,ids.join(','));}
  const requestedKey=items.map(savedKey).sort().join(',');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12_000);
  pending=api<SavedStates>('insights/saved?'+params,ctrl.signal).then(data=>{expireActivityReads();store.observe(data);lastCheck=Date.now();}).finally(()=>{clearTimeout(timer);pending=null;if(store.snapshot().items.map(savedKey).sort().join(',')!==requestedKey)void checkSaved(language,true).catch(()=>{});});return pending;
}
export function useSavedChecks(language:string) {
  const {items}=useSaved(),key=items.map(savedKey).sort().join(',');
  useEffect(()=>{void checkSaved(language,true).catch(()=>{});const check=()=>{if(document.visibilityState==='visible')void checkSaved(language).catch(()=>{});};window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};},[key,language]);
}
export function SaveButton({item,compact=false}:{item:SavedItem;compact?:boolean}) {
  const {items}=useSaved(),saved=items.some(x=>savedKey(x)===savedKey(item)),[error,setError]=useState('');
  const label=item.kind==='mep'?(saved?'Following':'Follow'):(saved?'Saved':'Save');
  return <><button className={'poc-save-button'+(saved?' is-saved':'')} aria-label={`${label} ${item.kind==='mep'?'MEP':'question'}${item.title?' · '+item.title:''}`} aria-pressed={saved} title={saved?'Saved in this browser':'Save in this browser'} onClick={()=>{try{store.toggle(item);setError('');}catch(e){setError((e as Error).message);}}}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span>{label}</span>}</button>{error&&<small role="alert">{error}</small>}</>;
}
export function SavedNav({onClick,current=false}:{onClick:()=>void;current?:boolean}) {
  const saved=useSaved(),items=saved.items,updates=items.filter(item=>item.updated).length;
  return <button onClick={onClick} aria-current={current?'page':undefined}>Following{updates>0?<span className="poc-saved-count">{updates} new</span>:items.length>0?<small> {items.length}</small>:null}</button>;
}
export function PocSaved({language,onBack,onMember}:{language:string;onBack:()=>void;onMember:(id:number,sourceId?:string)=>void}) {
  const saved=useSaved(),items=saved.items,[checking,setChecking]=useState(false),[error,setError]=useState('');
  const check=()=>{setChecking(true);setError('');checkSaved(language,true).catch(e=>setError((e as Error).message)).finally(()=>setChecking(false));};
  return <section className="poc-saved-view">
    <button onClick={onBack}>← Back</button>
    <div className="poc-saved-heading"><h1>Following</h1><button onClick={check} disabled={checking||!items.length}>{checking?'Checking…':'Check for updates'}</button></div>
    <p className="poc-saved-caption">MEPs and questions you follow on this device.</p>
    {!saved.persistent&&<p role="alert">Browser storage is unavailable. Your follows will last until this page closes.</p>}
    {error&&<p role="alert">{error}</p>}
    {!items.length&&<p>Follow a MEP or save a question to see new activity and answers here.</p>}
    <div className="poc-saved-items">{items.map(item=><article key={savedKey(item)}>
      <div className="poc-saved-heading"><h3>{item.title}</h3><SaveButton item={item} compact/></div>
      {item.updated&&<strong className="poc-update-label">{item.newAnswer?(item.newActivity?'New activity and new answer':'New answer'):item.newActivity?'New activity':'Updated'}</strong>}
      {item.availability==='outside-roster'&&<p>No longer on the current roster.</p>}
      {(item.kind==='mep'||item.memberId)&&<button onClick={()=>{item.kind==='mep'?store.markActivityRead(savedKey(item)):store.markRead(savedKey(item));onMember(Number(item.kind==='mep'?item.id:item.memberId),item.kind==='question'?item.id:undefined);}}>{item.kind==='mep'?'Profile':'Read question and answers'}</button>}
      {item.kind==='question'&&item.availability==='not-saved'&&<p>Question metadata is not available yet.</p>}
      {(item.kind==='mep'||item.memberId)&&savedLinks(item).map(activity=><a key={activity.id} href={'?poc=1&lang='+language+'&member='+(item.kind==='mep'?item.id:item.memberId)+'&module=activities&activity='+encodeURIComponent(activity.id)} onClick={event=>{activity.recordKind==='answer'?store.markAnswerRead(savedKey(item),activity.id):store.markActivityRead(savedKey(item));if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onMember(Number(item.kind==='mep'?item.id:item.memberId),activity.id);}}>{activity.recordKind==='answer'?'Answer: ':''}{activity.title}<small>{activity.date?humanDate(activity.date,language):'Date unavailable'}</small></a>)}
    </article>)}</div>
  </section>;
}
