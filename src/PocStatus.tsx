import {useEffect,useRef,useState,type CSSProperties} from 'react';

const hidden:CSSProperties={position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clipPath:'inset(50%)',whiteSpace:'nowrap',border:0};

/** Keep announcements separate from results/readers. A scope identifies a user selection,
 * not a response object: polling must not restart a settled result announcement. */
export function PocStatus({scope,message,pending=false,delay=350,oncePerScope=false}:{scope:string;message:string|null;pending?:boolean;delay?:number;oncePerScope?:boolean}) {
  const [announcement,setAnnouncement]=useState({scope:'',message:''});
  const last=useRef<{scope:string;message:string}|null>(null);
  const currentScope=useRef(scope);
  useEffect(()=>{
    if(currentScope.current!==scope){
      currentScope.current=scope;last.current=null;setAnnouncement({scope,message:''});
    }
    if(pending){
      if(!oncePerScope){last.current=null;setAnnouncement(previous=>previous.message?{scope,message:''}:previous);}
      return;
    }
    if(!message){setAnnouncement(previous=>previous.message?{scope,message:''}:previous);return;}
    if(last.current?.scope===scope&&(oncePerScope||last.current.message===message)){
      // A background update can invalidate the old count without announcing every poll.
      if(oncePerScope&&last.current.message!==message)setAnnouncement(previous=>previous.message?{scope,message:''}:previous);
      return;
    }
    const timer=setTimeout(()=>{last.current={scope,message};setAnnouncement({scope,message});},delay);
    return()=>clearTimeout(timer);
  },[scope,message,pending,delay,oncePerScope]);
  return <span role="status" aria-live="polite" aria-atomic="true" lang="en" style={hidden}>{announcement.scope===scope?announcement.message:''}</span>;
}
