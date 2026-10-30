import {UiMessage, useUiI18n} from './UiI18nReact';
import {useEffect,useId,useRef,useState} from 'react';
import {interfaceTerm} from './terms.mjs';
import './ReaderRetry.css';

/** A local retry keeps the reader mounted, including its text, language and source links. */
export function ReaderRetry({message,language,retry,retryAt}:{message:string;language:string;retry:()=>void;retryAt?:number}) {
  const ui = useUiI18n();
  const [now,setNow]=useState(Date.now),started=useRef(false),hintId=useId();
  const remaining=Number.isFinite(retryAt) ? Math.max(0,retryAt!-now) : 0;
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const update=()=>{
      clearTimeout(timer);
      const current=Date.now();setNow(current);
      if(Number.isFinite(retryAt)&&retryAt!>current)timer=setTimeout(update,Math.min(1000,retryAt!-current));
    };
    update();
    // Background tabs can delay timers. Reconcile the deadline on return.
    window.addEventListener('focus',update);
    document.addEventListener('visibilitychange',update);
    return ()=>{clearTimeout(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
  },[retryAt]);
  const seconds=Math.ceil(remaining/1000),minutes=Math.ceil(seconds/60);
  const wait=(seconds<60) ? ui.t("readerretry.seconds_seconds.3724db", {seconds: seconds}) : ui.t("readerretry.minutes_minutes.24f934", {minutes: minutes});
  const label=interfaceTerm('try-again',language);
  return <div className="reader-retry" lang={ui.language}><p>{message}</p><div className="reader-retry-actions"><button type="button" lang={label.language} disabled={remaining>0} aria-describedby={(remaining>0) ? hintId : undefined} onClick={event=>{
    if(started.current||Date.now()<(retryAt??0))return;
    started.current=true;
    if(document.activeElement===event.currentTarget){
      const heading=event.currentTarget.closest('section')?.querySelector<HTMLElement>('h3');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    }
    retry();
  }}>{label.text}</button>{remaining>0&&<span id={hintId} className="reader-retry-hint" aria-live="off"><UiMessage id="readerretry.retry_paused_after_a_failed_request_try_again_in_wait.c89efa" values={{wait: wait}}/></span>}</div></div>;
}
