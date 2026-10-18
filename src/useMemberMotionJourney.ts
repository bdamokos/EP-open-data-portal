import {useCallback,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {motionJourneyUrl,type MotionJourney,type MotionJourneyBinding} from './motionJourney.mjs';

export type MemberMotionEnvironment={language:string;activity:string|null;category:string;offset:number};
type SavedQuery={memberId:number|null;query:URLSearchParams};
type PendingPosition={key:string|null;position:number[]|null;fallback:number[]|null};
const MAX_POSITIONS=40;
const selectors=['main.explorer','.explorer-profile-body'];
const pendingSelector='[data-activities-pending="true"],[data-motion-pending="true"],[data-context-pending="true"]';

function scopedQuery(query:URLSearchParams,member:number|null) {
  const result=new URLSearchParams();
  if(member!==null)result.set('member',String(member));
  if(member!==null&&query.get('member')===String(member))for(const [key,value] of query)if(key.startsWith('ma-'))result.append(key,value);
  return result;
}

// Different field order is equivalent. Repeated values retain their exact order
// and multiplicity, so malformed links never borrow another link's position.
export function memberMotionScrollKey(member:number|null,query:URLSearchParams,environment:MemberMotionEnvironment) {
  const entries=new Map<string,string[]>();
  for(const [key,value] of query)if(key.startsWith('ma-')){
    const values=entries.get(key)||[];values.push(value);entries.set(key,values);
  }
  return JSON.stringify([member,environment.language,environment.activity,environment.category,environment.offset,[...entries].sort(([left],[right])=>left<right?-1:left>right?1:0)]);
}

const capture=()=>selectors.map(selector=>document.querySelector(selector)?.scrollTop||0);
const restorePosition=(position:number[])=>{
  if(position.length!==selectors.length||!position.every(value=>Number.isFinite(value)&&value>=0&&value<=10_000_000))return;
  selectors.forEach((selector,index)=>{const node=document.querySelector(selector);if(node)node.scrollTop=position[index];});
};
const ready=()=>{
  const activities=document.querySelector('.explorer-activities');
  return Boolean(activities&&!activities.matches(pendingSelector)&&!activities.querySelector(pendingSelector));
};
const startsNewSource=(previous:URLSearchParams,next:URLSearchParams,binding:MotionJourneyBinding)=>{
  const defaults:Record<string,string|null>={'ma-source':binding.sourceId,'ma-owner':binding.ownerId||null,'ma-text':binding.sourceId,'ma-offset':'0','ma-scope':'member','ma-ta':null};
  const values=(query:URLSearchParams,key:string)=>query.has(key)?query.getAll(key):defaults[key]===null?[]:[defaults[key]];
  return Object.keys(defaults).some(key=>JSON.stringify(values(previous,key))!==JSON.stringify(values(next,key)));
};

export function useMemberMotionJourney(member:number|null,active:boolean,initial:URLSearchParams,environment:MemberMotionEnvironment) {
  const [stored,setStored]=useState<SavedQuery>(()=>({memberId:member,query:scopedQuery(initial,member)}));
  const initialKey=initial.toString();
  const query=useMemo(()=>stored.memberId===member?stored.query:scopedQuery(initial,member),[stored,member,initialKey]);
  const key=memberMotionScrollKey(member,query,environment);
  const current=useRef({member,active,query,environment,key});current.current={member,active,query,environment,key};
  const positions=useRef(new Map<string,number[]>()),pending=useRef<PendingPosition|null>(null),wasActive=useRef(active),previousKey=useRef(key);
  const remember=useCallback(()=>{
    const value=current.current;
    if(!value.active||value.member===null||pending.current||!ready())return;
    const position=capture();
    if(!position.every(value=>Number.isFinite(value)&&value>=0&&value<=10_000_000))return;
    positions.current.delete(value.key);positions.current.set(value.key,position);
    while(positions.current.size>MAX_POSITIONS)positions.current.delete(positions.current.keys().next().value!);
  },[]);
  const onJourneyChange=useCallback((binding:MotionJourneyBinding,next:MotionJourney,_reason?:string)=>{
    const value=current.current;
    if(!value.active||value.member===null||binding.memberId!==value.member||new URLSearchParams(location.search).get('member')!==String(value.member))return;
    const url=motionJourneyUrl(location.href,binding,next);
    if(url.origin!==location.origin||url.searchParams.get('member')!==String(value.member))return;
    const nextQuery=scopedQuery(url.searchParams,value.member),nextKey=memberMotionScrollKey(value.member,nextQuery,value.environment);
    if(url.href===location.href)return;
    if(nextKey===value.key)history.replaceState(history.state,'',url);
    else {
      const surrounding=!pending.current&&ready()?capture():null;
      remember();
      pending.current={key:nextKey,position:positions.current.get(nextKey)||null,fallback:startsNewSource(value.query,nextQuery,binding)?[0,0]:surrounding||[0,0]};
      history.pushState(null,'',url);
    }
    setStored({memberId:value.member,query:nextQuery});
    window.dispatchEvent(new Event('explorer-query-change'));
  },[remember]);
  const restore=useCallback((nextQuery:URLSearchParams,nextMember:number|null)=>{
    remember();
    // App updates activity, category and page in the same navigation. Resolve
    // the destination key after those scalar values have reached the hook.
    pending.current={key:null,position:null,fallback:null};
    setStored({memberId:nextMember,query:scopedQuery(nextQuery,nextMember)});
  },[remember]);
  useLayoutEffect(()=>{
    const changed=previousKey.current!==key;previousKey.current=key;
    if(!active){pending.current=null;wasActive.current=false;return;}
    if(!wasActive.current){pending.current={key:null,position:null,fallback:null};wasActive.current=true;}
    else if(changed&&!pending.current&&positions.current.has(key))pending.current={key,position:positions.current.get(key)!,fallback:null};
    if(pending.current?.key!==key&&pending.current)pending.current={key,position:positions.current.get(key)||null,fallback:pending.current.key===null?null:pending.current.fallback};
    const apply=()=>{
      const target=pending.current;
      if(!target||target.key!==current.current.key||!ready())return;
      const position=target.position||target.fallback;
      if(position)restorePosition(position);
      pending.current=null;
    };
    apply();
    const target=document.querySelector('.explorer-profile-body')||document.body;
    const observer=new window.MutationObserver(apply);
    observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['data-activities-pending','data-motion-pending','data-context-pending']});
    document.addEventListener('scroll',remember,{capture:true,passive:true});
    return()=>{observer.disconnect();document.removeEventListener('scroll',remember,true);};
  },[active,key,stored,remember]);
  return {query,onJourneyChange,restore,remember,hasSavedScroll:positions.current.has(key)};
}
