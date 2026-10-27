import {useCallback,useEffect,useRef,useState} from 'react';
import {readGroupVoicesState,groupVoicesUrl,changeGroupVoicesState,type GroupVoiceState} from './groupVoicesState.mjs';
export function useGroupVoicesState(){
  const read=()=>readGroupVoicesState(new URLSearchParams(location.search));
  const [state,setState]=useState(read),current=useRef(state),typing=useRef(false);current.current=state;
  useEffect(()=>{
    const update=()=>{const next=read(),url=groupVoicesUrl(location.href,next);if(url.href!==location.href)history.replaceState(history.state,'',url);setState(next);},restore=()=>{typing.current=false;update();};
    // Retired time links retain their other filters, with no extra history step.
    const url=groupVoicesUrl(location.href,read());if(url.href!==location.href)history.replaceState(history.state,'',url);
    window.addEventListener('popstate',restore);window.addEventListener('explorer-query-change',update);
    return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('explorer-query-change',update);};
  },[]);
  const change=useCallback((patch:Partial<GroupVoiceState>,search=false)=>{
    const next=changeGroupVoicesState(current.current,patch),url=groupVoicesUrl(location.href,next);
    if(url.href!==location.href){if(search&&typing.current)history.replaceState(history.state,'',url);else history.pushState(history.state,'',url);}
    typing.current=search;current.current=next;setState(next);window.dispatchEvent(new Event('explorer-query-change'));
  },[]);
  return {state,change,endSearch:()=>{typing.current=false;}};
}
