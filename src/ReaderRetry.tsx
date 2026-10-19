import {useEffect,useRef,useState} from 'react';
import {interfaceTerm} from './terms.mjs';

/** A local retry keeps the reader mounted, including its text, language and source links. */
export function ReaderRetry({message,language,retry,retryAt,loading=false}:{message:string;language:string;retry:()=>void;retryAt?:number;loading?:boolean}) {
  const [now,setNow]=useState(Date.now),started=useRef(false);
  const remaining=Number.isFinite(retryAt)?Math.max(0,retryAt!-now):0;
  useEffect(()=>{
    if(!remaining)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.min(remaining,2_147_483_647));
    return ()=>clearTimeout(timer);
  },[remaining]);
  const label=interfaceTerm('try-again',language);
  return <p className="reader-retry" lang="en">{message}{' '}<button type="button" lang={label.language} disabled={loading||remaining>0} onClick={event=>{
    if(started.current||loading||Date.now()<(retryAt??0))return;
    started.current=true;
    if(document.activeElement===event.currentTarget){
      const heading=event.currentTarget.closest('section')?.querySelector<HTMLElement>('h3');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    }
    retry();
  }}>{label.text}</button>{remaining>0&&<> Please wait before trying again.</>}</p>;
}
