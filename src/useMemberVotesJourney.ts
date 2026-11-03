import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import type {MemberVotesProps} from './MemberVotes';
import {captureMemberJourneyScroll,memberVotesHistoryMode,memberVotesJourneyParams,memberVotesScrollKey,readMemberVotesJourney,restoreMemberJourneyScroll,type MemberVotesJourney} from './memberVotesJourney.mjs';

// Where the whole page scrolls, the kept page offset can leave a new destination's
// start (and its Back control) above the sticky profile tabs.
function revealDestination() {
  const page=document.querySelector<HTMLElement>('main.explorer'),start=document.querySelector<HTMLElement>('.member-votes-pane:not([hidden]),.document-context-reader');
  if(!page||!start)return;
  const tabs=page.querySelector<HTMLElement>('.explorer-tabs'),edge=tabs ? tabs.getBoundingClientRect().bottom : page.getBoundingClientRect().top,top=start.getBoundingClientRect().top;
  if(top<edge)page.scrollTop=Math.max(0,page.scrollTop+top-edge-12);
}

export function useMemberVotesJourney(member:number|null,active:boolean,initial:URLSearchParams) {
  const [stored,setStored]=useState(()=>readMemberVotesJourney(initial,member));
  // Scope during render, before the module can issue a request for another MEP.
  const journey=stored.memberId===member?stored:readMemberVotesJourney(new URLSearchParams(),member);
  const current=useRef({journey,active});current.current={journey,active};
  const positions=useRef(new Map<string,number[]>()),pending=useRef<number[]|null>(null),reveal=useRef(false),wasActive=useRef(active);
  const remember=useCallback(()=>{
    const value=current.current;
    if(!value.active||pending.current)return;
    positions.current.set(memberVotesScrollKey(value.journey),captureMemberJourneyScroll(document));
    if(positions.current.size>40)positions.current.delete(positions.current.keys().next().value!);
  },[]);
  const commit=useCallback((updated:MemberVotesJourney,mode:'push'|'replace')=>{
    const value=current.current;
    if(!value.active||!value.journey.memberId||new URLSearchParams(location.search).get('member')!==String(value.journey.memberId))return;
    const url=new URL(location.href);
    for(const key of [...url.searchParams.keys()])if(key.startsWith('mv-'))url.searchParams.delete(key);
    for(const [key,val] of memberVotesJourneyParams(updated))url.searchParams.set(key,val);
    if(mode==='push'&&url.href!==location.href){
      remember();
      // Expanding a subject does not change the pane or its position. New
      // destinations reset only the inner pane and keep the page offset unless
      // that hides their start.
      if(memberVotesScrollKey(updated)!==memberVotesScrollKey(value.journey)){
        const scroll=captureMemberJourneyScroll(document),saved=positions.current.get(memberVotesScrollKey(updated));scroll[3]=0;
        pending.current=saved||scroll;reveal.current=!saved;
      }
    }
    if(url.href!==location.href)mode==='replace'?history.replaceState(history.state,'',url):history.pushState(history.state,'',url);
    setStored(updated);
    window.dispatchEvent(new Event('explorer-query-change'));
  },[]);
  const onStateChange=useCallback<MemberVotesProps['onStateChange']>((next,options)=>{
    const previous=current.current.journey;
    commit({...previous,state:next,invalid:false,adoptedId:JSON.stringify(previous.state.context)===JSON.stringify(next.context)?previous.adoptedId:null},memberVotesHistoryMode(previous.state,next,options?.replace));
  },[commit]);
  const onSelectedDocumentIdChange=useCallback((adoptedId:string|null)=>{
    const previous=current.current.journey;
    if(previous.state.context?.view!=='adopted')return;
    const updated={...previous,adoptedId},query=memberVotesJourneyParams(updated);
    query.set('member',String(previous.memberId));
    if(adoptedId!==null)query.set('mv-adopted',adoptedId);
    if(!readMemberVotesJourney(query,previous.memberId).invalid)commit(updated,'push');
  },[commit]);
  const restore=(query:URLSearchParams,nextMember:number|null)=>{
    remember();
    const restored=readMemberVotesJourney(query,nextMember);
    pending.current=positions.current.get(memberVotesScrollKey(restored))||null;reveal.current=false;
    setStored(restored);
  };
  useLayoutEffect(()=>{
    if(!active){pending.current=null;reveal.current=false;wasActive.current=false;return;}
    if(!wasActive.current){pending.current??=positions.current.get(memberVotesScrollKey(journey))||null;wasActive.current=true;}
    // Loading can temporarily remove the panes. Retry restoration when the exact
    // response mounts them, including after browser Back on a different page.
    const apply=()=>{
      if(!pending.current||!document.querySelector('.member-votes-pane:not([hidden]),.member-votes-empty,.document-context-reader'))return;
      // A loading reader shell cannot hold the source document's saved position.
      // Keep it until the body or a settled unavailable/error state is rendered.
      const context=document.querySelector('.document-context-reader');
      if(context&&(context.matches('[data-context-pending="true"]')||context.querySelector('[data-context-pending="true"]')))return;
      restoreMemberJourneyScroll(document,pending.current);pending.current=null;
      if(reveal.current){reveal.current=false;revealDestination();}
    };
    apply();
    const target=document.querySelector('.explorer-profile-body');
    if(!target)return;
    const observer=new window.MutationObserver(apply);observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['data-context-pending']});
    return()=>observer.disconnect();
  },[active,journey]);
  return {journey,onStateChange,onSelectedDocumentIdChange,restore,remember,hasSavedScroll:positions.current.has(memberVotesScrollKey(journey))};
}
