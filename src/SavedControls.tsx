import {useEffect,useState,useSyncExternalStore} from 'react';
import {api,expireActivityReads} from './data';
import {postSavedQuestions} from './followingTransport';
import {createSavedStore,savedKey,type SavedItem,type SavedStates,type FollowingStatus,type FollowingManifest,type FollowingMember} from './bookmarks.mjs';
import {interfaceTerm,compoundLanguage} from './terms.mjs';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
export const savedStore=createSavedStore(storage,()=>listeners.forEach(listener=>listener()));
window.addEventListener('storage',event=>{if(event.key==='ep.bookmarks.v1'||event.key==='ep.following.v2'||event.key===null)savedStore.reload(event.key);});
export function useSaved(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},savedStore.snapshot);}
type SavedCheck={data:SavedStates;requestedKey:string};
export const requestedKeys=new WeakMap<Promise<unknown>,string>();
let pending:Promise<SavedCheck|undefined>|null=null,lastStatus=0,status:FollowingStatus|null=null;
let manifestDone='',questionsDone='',pendingLanguage='';
const taskKey=(language:string,items:SavedItem[])=>JSON.stringify([status?.epoch,status?.generation,status?.marksReady,language,items.map(item=>[savedKey(item),item.savedAt])]);
const selectionKey=()=>savedStore.snapshot().items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',');
function verify(data:{epoch:string;generation:number},expected:FollowingStatus) {
  if(data.epoch!==expected.epoch||data.generation!==expected.generation)throw Object.assign(Error('The index generation has changed. Try again.'),{code:'generation_changed'});
}
async function memberDetail(item:SavedItem,language:string,expected:FollowingStatus) {
  const params=new URLSearchParams({member:item.id,epoch:expected.epoch,generation:String(expected.generation),lang:language});
  const data=await api<FollowingMember>('insights/following-member?'+params);verify(data,expected);
  savedStore.materialize(data,item);return data;
}
const opening=new Map<string,Promise<unknown>>();
export function openSavedMember(item:SavedItem,language:string):Promise<unknown> {
  const key=taskKey(language,[item]),existing=opening.get(key);if(existing)return existing;
  const run=(async()=>{
    try{await checkSaved(language);}catch(error){if(!status?.marksReady||!savedStore.snapshot().manifest)throw error;}
    if(!status?.marksReady)throw Error('Update checks are not available yet.');
    try{return await memberDetail(item,language,status);}catch(error){
      if((error as {code?:string}).code==='generation_changed'){status=null;lastStatus=0;await checkSaved(language,true);if(status?.marksReady)return memberDetail(item,language,status);}
      throw error;
    }
  })().finally(()=>opening.delete(key));opening.set(key,run);return run;
}
export function checkSaved(language:string,force=false):Promise<SavedCheck|undefined> {
  if(pending) {
    if(pendingLanguage===language)return pending;
    const queued=pending.catch(()=>undefined).then(()=>checkSaved(language,force));requestedKeys.set(queued,selectionKey());return queued;
  }
  pendingLanguage=language;
  const requestedKey=selectionKey();
  if(!requestedKey)return Promise.resolve(undefined);
  const run=async()=>{
    // A new selection can use a fresh status already held by this tab.
    if(force||!status||Date.now()-lastStatus>=60_000) {
      lastStatus=Date.now();status=await api<FollowingStatus>('insights/following-status');
    }
    const expected=status!;
    if(!expected.marksReady){savedStore.setCheckState('unavailable');return {data:{questions:[],checkedAt:'',coverage:{indexComplete:false}},requestedKey};}
    const items=savedStore.snapshot().items,key=JSON.stringify([expected.epoch,expected.generation,expected.marksReady,language]);
    if(manifestDone!==key||savedStore.snapshot().epoch!==expected.epoch||items.some(item=>item.kind==='mep'&&!item.seen&&!item.legacy)) {
      const params=new URLSearchParams({epoch:expected.epoch,generation:String(expected.generation)});
      const manifest=await api<FollowingManifest>('insights/following-manifest?'+params);verify(manifest,expected);
      savedStore.applyManifest(manifest);manifestDone=key;
    }
    const failures:unknown[]=[];
    // Migration is deliberately serial on constrained clients, and retries only
    // pending members; a successful member is never requested again for migration.
    for(const item of savedStore.snapshot().items.filter(item=>item.kind==='mep'&&item.legacy))try{await memberDetail(item,language,expected);}catch(error){failures.push(error);}
    let data:SavedStates={questions:[],checkedAt:'',coverage:{indexComplete:expected.indexComplete}};
    const questions=items.filter(item=>item.kind==='question'),questionKey=taskKey(language,questions);
    if(questions.length&&questionsDone!==questionKey)try{
      data=await postSavedQuestions(language,questions.map(item=>item.id));savedStore.observe(data,questions);questionsDone=questionKey;
    }catch(error){failures.push(error);}
    if(failures.length)throw failures[0];
    expireActivityReads();savedStore.setCheckState('available');return {data,requestedKey};
  };
  pending=(async()=>{
    try{return await run();}catch(error){
      if((error as {code?:string}).code==='generation_changed') {
        status=null;lastStatus=0;manifestDone='';
        try{return await run();}catch(next){savedStore.setCheckState('error');throw next;}
      }
      savedStore.setCheckState((error as {code?:string}).code==='marks_unavailable'?'unavailable':'error');throw error;
    }
  })().finally(()=>{pending=null;if(selectionKey()!==requestedKey)void checkSaved(language).catch(()=>{});});
  requestedKeys.set(pending,requestedKey);return pending;
}
export function useSavedChecks(language:string,following=false) {
  const {items}=useSaved(),key=items.map(item=>savedKey(item)+':'+item.savedAt).sort().join(',');
  useEffect(()=>{void checkSaved(language).catch(()=>{});},[following,key,language]);
  useEffect(()=>{
    const check=()=>{if(document.visibilityState==='visible'&&Date.now()-lastStatus>=60_000)void checkSaved(language).catch(()=>{});};
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  },[language]);
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
