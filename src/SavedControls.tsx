import {dossierStore,subscribeDossiers,useDossiers} from './DossierControls';
import {createGroupsStore,GROUPS_KEY,groupIsNew,type GroupsSnapshot} from './followGroups.mjs';
import {createCoverageStore,COVERAGE_KEY} from './followCoverage.mjs';
import {createMembershipStore,MEMBERSHIP_KEY,membershipIsNew,type MembershipSnapshot} from './followMembership.mjs';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {api,expireActivityReads} from './data';
import {postSavedQuestions} from './followingTransport';
import {createSavedStore,savedKey,type SavedItem,type SavedStates,type FollowingStatus,type FollowingManifest,type FollowingMember} from './bookmarks.mjs';
import {itemHasNew,nextExpiry} from './followUpdates.mjs';
import {interfaceTerm,compoundLanguage} from './terms.mjs';
const listeners=new Set<()=>void>();let storage:Storage|null=null;
try{storage=window.localStorage;}catch{}
const groupsListeners=new Set<()=>void>();
export const groupsStore=createGroupsStore(storage,()=>{groupsListeners.forEach(listener=>listener());queueMicrotask(refreshSavedClock);});
let groupsCheck:'unknown'|'available'|'unavailable'|'error'='unknown';
const groupsCheckListeners=new Set<()=>void>();
function setGroupsCheck(value:typeof groupsCheck){groupsCheck=value;groupsCheckListeners.forEach(listener=>listener());}
export function useGroupsCheck(){return useSyncExternalStore(callback=>{groupsCheckListeners.add(callback);return()=>groupsCheckListeners.delete(callback);},()=>groupsCheck);}
export function useGroups(){return useSyncExternalStore(callback=>{groupsListeners.add(callback);return()=>groupsListeners.delete(callback);},groupsStore.snapshot);}
const coverageListeners=new Set<()=>void>();
export const coverageStore=createCoverageStore(storage,()=>coverageListeners.forEach(listener=>listener()));
export function useCoverage(){return useSyncExternalStore(callback=>{coverageListeners.add(callback);return()=>coverageListeners.delete(callback);},coverageStore.snapshot);}
const membershipListeners=new Set<()=>void>();
export const membershipStore=createMembershipStore(storage,()=>{membershipListeners.forEach(listener=>listener());queueMicrotask(refreshSavedClock);});
type MembershipCheck='unknown'|'available'|'unavailable'|'error';
let membershipCheck:MembershipCheck='unknown';
const membershipCheckListeners=new Set<()=>void>();
function setMembershipCheck(value:MembershipCheck){membershipCheck=value;membershipCheckListeners.forEach(listener=>listener());}
export function useMembershipCheck(){return useSyncExternalStore(callback=>{membershipCheckListeners.add(callback);return()=>membershipCheckListeners.delete(callback);},()=>membershipCheck);}
export function useMembership(){return useSyncExternalStore(callback=>{membershipListeners.add(callback);return()=>membershipListeners.delete(callback);},membershipStore.snapshot);}
export const savedStore=createSavedStore(storage,()=>{listeners.forEach(listener=>listener());queueMicrotask(()=>{membershipStore.syncFollows(savedStore.snapshot().items);groupsStore.syncFollows(savedStore.snapshot().items);coverageStore.syncFollows(savedStore.snapshot().items);refreshSavedClock();});});
membershipStore.syncFollows(savedStore.snapshot().items);groupsStore.syncFollows(savedStore.snapshot().items);
window.addEventListener('storage',event=>{if(event.key===COVERAGE_KEY||event.key===null)coverageStore.reload();if(event.key===GROUPS_KEY||event.key===null)groupsStore.reload();if(event.key===MEMBERSHIP_KEY||event.key===null)membershipStore.reload();if(event.key==='ep.bookmarks.v1'||event.key==='ep.following.v2'||event.key===null)savedStore.reload(event.key);});
export function useSaved(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},savedStore.snapshot);}
let savedNow=Date.now(),expiryTimer:ReturnType<typeof setTimeout>|undefined;
const clockListeners=new Set<()=>void>();
function refreshSavedClock() {
  savedNow=Date.now();clearTimeout(expiryTimer);
  const membershipExpiry=membershipStore.snapshot().entries.filter(entry=>membershipIsNew(entry,savedNow)).map(entry=>entry.discoveredAt+24*60*60*1000);
  const deadlines=[nextExpiry([...savedStore.snapshot().items,...dossierStore.snapshot().items],savedNow),...membershipExpiry,...groupsStore.snapshot().entries.filter(entry=>groupIsNew(entry,savedNow)).map(entry=>entry.discoveredAt+24*60*60*1000)].filter((value):value is number=>value!==null);
  const expiry=deadlines.length?Math.min(...deadlines):null;
  if(clockListeners.size&&expiry!==null)expiryTimer=setTimeout(refreshSavedClock,Math.max(1,expiry-savedNow));
  clockListeners.forEach(listener=>listener());
}
subscribeDossiers(()=>queueMicrotask(refreshSavedClock));
window.addEventListener('focus',refreshSavedClock);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshSavedClock();});
const subscribeClock=(callback:()=>void)=>{
  clockListeners.add(callback);refreshSavedClock();
  return()=>{clockListeners.delete(callback);if(!clockListeners.size)clearTimeout(expiryTimer);};
};
export function useSavedNow() {return useSyncExternalStore(subscribeClock,()=>savedNow);}
type SavedCheck={data:SavedStates;requestedKey:string;language:string};
export const requestedKeys=new WeakMap<Promise<unknown>,string>();
let pending:Promise<SavedCheck|undefined>|null=null,lastStatus=0,status:FollowingStatus|null=null;
let statusError=false;
const checkListeners=new Set<()=>void>();
let manifestDone='',questionsDone='',pendingLanguage='';
const taskKey=(language:string,items:SavedItem[])=>JSON.stringify([status?.epoch,status?.generation,status?.marksReady,language,items.map(item=>[savedKey(item),item.savedAt])]);
const selectionKey=()=>savedStore.snapshot().items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',');
function verify(data:{epoch:string;generation:number},expected:FollowingStatus) {
  if(data.epoch!==expected.epoch||data.generation!==expected.generation)throw Object.assign(Error('Data was updated. Try again.'),{code:'generation_changed'});
}
let memberReads=0;
const memberQueue:(()=>void)[]=[];
async function memberSlot() {
  if(memberReads>=4)await new Promise<void>(resolve=>memberQueue.push(resolve));
  else memberReads++;
  return ()=>{const next=memberQueue.shift();if(next)next();else memberReads--;};
}
async function memberDetail(item:SavedItem,language:string,expected:FollowingStatus) {
  const release=await memberSlot();
  try {
    const params=new URLSearchParams({member:item.id,epoch:expected.epoch,generation:String(expected.generation),lang:language});
    const data=await api<FollowingMember>('insights/following-member?'+params);verify(data,expected);
    if(!savedStore.materialize(data,item))throw Object.assign(Error('Data was updated. Try again.'),{code:'generation_changed'});
    return data;
  }finally{release();}
}
function checkedStatus():FollowingStatus|null {return status;}
const opening=new Map<string,Promise<unknown>>();
export function openSavedMember(item:SavedItem,language:string):Promise<unknown> {
  const key=taskKey(language,[item]),existing=opening.get(key);if(existing)return existing;
  const run=(async()=>{
    try{await checkSaved(language);}catch(error){if(!status?.marksReady||!savedStore.snapshot().manifest)throw error;}
    if(!status?.marksReady)throw Error('Update checks are not available yet.');
    const expected=status;
    try{return await memberDetail(item,language,expected);}catch(error){
      if((error as {code?:string}).code==='generation_changed') {
        let refreshed=checkedStatus();const manifest=savedStore.snapshot().manifest;
        if(!refreshed?.marksReady||refreshed.epoch===expected.epoch&&refreshed.generation===expected.generation||manifest?.epoch!==refreshed.epoch||manifest?.generation!==refreshed.generation) {
          status=null;lastStatus=0;await checkSaved(language,true);refreshed=checkedStatus();
        }
        if(refreshed?.marksReady)return memberDetail(item,language,refreshed);
      }
      throw error;
    }
  })().finally(()=>opening.delete(key));opening.set(key,run);return run;
}
export function checkSaved(language:string,force=false):Promise<SavedCheck|undefined> {
  if(pending) {
    if(pendingLanguage===language)return pending;
    const queued=pending.catch(()=>undefined).then(()=>document.visibilityState==='visible'?checkSaved(language,force):undefined);requestedKeys.set(queued,selectionKey());return queued;
  }
  pendingLanguage=language;
  const requestedKey=selectionKey();
  if(!requestedKey)return Promise.resolve(undefined);
  const run=async()=>{
    const items=savedStore.snapshot().items,hasMembers=items.some(item=>item.kind==='mep');
    const failures:unknown[]=[];
    let expected:FollowingStatus|null=null;
    // A new selection can use a fresh status already held by this tab.
    try {
      if(force||!status||Date.now()-lastStatus>=60_000) {
        lastStatus=Date.now();status=await api<FollowingStatus>('insights/following-status');statusError=false;
      }
      expected=status;
    }catch(error){statusError=true;savedStore.setCheckState('error');if(hasMembers){setMembershipCheck('error');setGroupsCheck('error');failures.push(error);}}
    let data:SavedStates={questions:[],checkedAt:'',coverage:{indexComplete:expected?.indexComplete===true}};
    const questions=items.filter(item=>item.kind==='question'),questionKey=taskKey(language,questions);
    // Question sources do not depend on marker readiness or manifest processing.
    // Start both tasks independently so even a pending/failed MEP request cannot
    // prevent question answers from becoming available in the store.
    const checkQuestions=async()=>{
      if(questions.length&&questionsDone!==questionKey)try{
        data=await postSavedQuestions(language,questions.map(item=>item.id));savedStore.observe(data,questions);questionsDone=questionKey;
        savedStore.setCheckState('available','question');
      }catch(error){savedStore.setCheckState('error','question');failures.push(error);}
    };
    const checkMembers=async()=>{
      if(!hasMembers||!expected)return;
      if(!expected.marksReady){savedStore.setCheckState('unavailable');return;}
      try {
        const key=JSON.stringify([expected.epoch,expected.generation,expected.marksReady,language]);
        if(manifestDone!==key||savedStore.snapshot().epoch!==expected.epoch||items.some(item=>item.kind==='mep'&&!item.seen&&!item.legacy)) {
          const params=new URLSearchParams({epoch:expected.epoch,generation:String(expected.generation)});
          const manifest=await api<FollowingManifest>('insights/following-manifest?'+params);verify(manifest,expected);
          savedStore.applyManifest(manifest);manifestDone=key;
        }
        // Migration stays serial on constrained clients; successful members are
        // never requested again for migration.
        const migrationFailures:unknown[]=[];
        for(const item of savedStore.snapshot().items.filter(item=>item.kind==='mep'&&item.legacy))try{await memberDetail(item,language,expected);}catch(error){migrationFailures.push(error);}
        if(migrationFailures.length)throw migrationFailures[0];
        savedStore.setCheckState('available');
      }catch(error){savedStore.setCheckState((error as {code?:string}).code==='marks_unavailable'?'unavailable':'error');failures.push(error);}
    };
    const checkMembership=async()=>{
      if(!hasMembers||!expected)return;
      if(expected.membershipReady===false){membershipStore.unavailable();setMembershipCheck('unavailable');return;}
      if(expected.membershipReady!==true)return;
      try {
        const params=new URLSearchParams({epoch:expected.epoch,generation:String(expected.generation)});
        const snapshot=await api<MembershipSnapshot>('insights/following-membership?'+params);verify(snapshot,expected);
        if(!membershipStore.observe(snapshot,savedStore.snapshot().items))throw Error('Invalid membership snapshot.');
        coverageStore.observeMembership(snapshot);
        setMembershipCheck(Object.values(snapshot.lists).some(list=>list.status==='unavailable')?'unavailable':'available');
      }catch(error){setMembershipCheck('error');failures.push(error);}
    };
    const checkGroups=async()=>{
      if(!hasMembers||!expected)return;
      if(expected.groupsReady===false){groupsStore.unavailable();setGroupsCheck('unavailable');return;}
      if(expected.groupsReady!==true)return;
      try {
        const params=new URLSearchParams({epoch:expected.epoch,generation:String(expected.generation)});
        const snapshot=await api<GroupsSnapshot>('insights/following-groups?'+params);verify(snapshot,expected);
        if(!groupsStore.observe(snapshot,savedStore.snapshot().items))throw Error('Invalid group snapshot.');
        setGroupsCheck(items.some(item=>item.kind==='mep'&&snapshot.members[item.id]?.coverage!=='complete')?'unavailable':'available');
      }catch(error){setGroupsCheck('error');failures.push(error);}
    };
    await Promise.all([checkQuestions(),checkMembers(),checkMembership(),checkGroups()]);
    if(failures.length)throw failures[0];
    expireActivityReads();return {data,requestedKey,language};
  };
  pending=(async()=>{
    try{return await run();}catch(error){
      if((error as {code?:string}).code==='generation_changed') {
        status=null;lastStatus=0;manifestDone='';
        return run();
      }
      throw error;
    }
  })().finally(()=>{pending=null;checkListeners.forEach(listener=>listener());if(document.visibilityState==='visible'&&selectionKey()!==requestedKey)void checkSaved(language).catch(()=>{});});
  requestedKeys.set(pending,requestedKey);return pending;
}
export function useSavedChecks(language:string,following=false) {
  const {items}=useSaved(),key=items.map(item=>savedKey(item)+':'+(item.savedAt??'')).sort().join(',');
  useEffect(()=>{
    if(!key)return;
    let active=true,contextPending=true,timer:ReturnType<typeof setTimeout>|undefined;
    const delay=()=>{
      const saved=savedStore.snapshot(),hasMembers=saved.items.some(item=>item.kind==='mep'),hasQuestions=saved.items.some(item=>item.kind==='question');
      const waiting=statusError||!status||hasMembers&&(!status.marksReady||status.membershipReady===false||status.groupsReady===false||saved.checkState!=='available'||membershipCheck==='error'||groupsCheck==='error')||hasQuestions&&saved.questionCheckState!=='available';
      return waiting?60_000:4*60*60_000;
    };
    const schedule=()=>{
      clearTimeout(timer);
      if(active&&document.visibilityState==='visible')timer=setTimeout(()=>void check(),contextPending?1000:Math.max(1000,lastStatus+delay()-Date.now()));
    };
    const check=async()=>{
      clearTimeout(timer);
      if(document.visibilityState!=='visible')return;
      if(contextPending||Date.now()-lastStatus>=delay()){
        const checked=checkSaved(language),matches=requestedKeys.get(checked)===key;
        try{
          const result=await checked;
          if(result?.requestedKey===key&&result.language===language)contextPending=false;
        }catch{
          // Matching failures use the short retry deadline; a shared request
          // for another selection must leave this context pending.
          if(matches)contextPending=false;
        }
      }
      schedule();
    };
    const refresh=()=>{void check();};
    checkListeners.add(schedule);
    void check();
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearTimeout(timer);checkListeners.delete(schedule);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[following,key,language]);
}
type Resolution={pending?:boolean;error?:string};
const resolutionAttempts=new Map<string,{at:number;error?:string;done?:boolean}>();
export function useResolveSavedMembers(language:string) {
  const saved=useSaved(),[resolutions,setResolutions]=useState<Record<string,Resolution>>({}),[wake,setWake]=useState(0);
  const active=useRef(false),forced=useRef(new Set<string>()),retryEventAt=useRef(0);
  const resolveKey=(item:SavedItem)=>JSON.stringify([saved.epoch,saved.manifest?.generation,language,item.id,item.savedAt]);
  useEffect(()=>{
    active.current=true;
    const retry=()=>{if(document.visibilityState==='visible'){retryEventAt.current=Date.now();setWake(value=>value+1);}};
    window.addEventListener('focus',retry);document.addEventListener('visibilitychange',retry);
    return()=>{active.current=false;window.removeEventListener('focus',retry);document.removeEventListener('visibilitychange',retry);};
  },[]);
  useEffect(()=>{
    if(document.visibilityState==='hidden'||!saved.manifest)return;
    for(const item of saved.items) {
      if(item.kind!=='mep'||!(item.unresolved?.activity||item.unresolved?.answer))continue;
      const key=resolveKey(item),attempt=resolutionAttempts.get(key),force=forced.current.delete(key);
      if(opening.has(taskKey(language,[item]))||attempt?.done||attempt&&!attempt.error||!force&&attempt&&retryEventAt.current-attempt.at<60_000)continue;
      if(opening.size>=4)break;
      resolutionAttempts.set(key,{at:Date.now()});setResolutions(previous=>({...previous,[key]:{pending:true}}));
      void openSavedMember(item,language).then(()=>{
        resolutionAttempts.set(key,{at:Date.now(),done:true});
        if(active.current)setResolutions(previous=>({...previous,[key]:{}}));
      },error=>{
        const message=(error as Error).message;resolutionAttempts.set(key,{at:Date.now(),error:message});
        if(active.current)setResolutions(previous=>({...previous,[key]:{error:message}}));
      }).finally(()=>{if(active.current)setWake(value=>value+1);});
    }
  },[saved.items,saved.epoch,saved.manifest,language,wake]);
  return {resolution:(item:SavedItem)=>resolutions[resolveKey(item)]||resolutionAttempts.get(resolveKey(item))||{},retry:(item:SavedItem)=>{forced.current.add(resolveKey(item));setWake(value=>value+1);}};
}
export function SaveButton({item,compact=false,language='en'}:{item:SavedItem;compact?:boolean;language?:string}) {
  const {items}=useSaved(),saved=items.some(x=>savedKey(x)===savedKey(item)),[error,setError]=useState('');
  const label=item.kind==='mep'?{text:saved?'Following':'Follow',language:'en'}:interfaceTerm(saved?'saved-question':'save-question',language);
  const name=item.kind==='mep'?label.text+' MEP':label.text;
  const tooltip=item.kind==='mep'?(saved?'Saved in this browser':'Save in this browser'):interfaceTerm(saved?'saved-in-browser':'save-in-browser',language).text;
  return <><button className={'explorer-save-button'+(saved?' is-saved':'')} lang={item.title?compoundLanguage(label.language,item.titleLanguage):label.language} aria-label={`${name}${item.title?' · '+item.title:''}`} aria-pressed={saved} title={tooltip} onClick={()=>{try{savedStore.toggle(item);setError('');}catch(e){setError((e as Error).message);}}}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span lang={label.language}>{label.text}</span>}</button>{error&&<small role="alert" lang="en">{error}</small>}</>;
}
export function SavedNav({onClick,current=false}:{onClick:()=>void;current?:boolean}) {
  const dossiers=useDossiers(),groups=useGroups(),membership=useMembership(),saved=useSaved(),now=useSavedNow(),items=[...saved.items,...dossiers.items],updates=items.filter(item=>itemHasNew(item,now)||item.kind==='mep'&&membership.entries.some(entry=>entry.mep===item.id&&membershipIsNew(entry,now))||item.kind==='mep'&&groups.entries.some(entry=>entry.mep===item.id&&groupIsNew(entry,now))).length;
  return <button onClick={onClick} lang="en" aria-current={current?'page':undefined}>Following{updates>0&&<span className="explorer-saved-count" title={`${updates} followed ${updates===1?'item has':'items have'} new updates`}>{updates} new</span>}</button>;
}
