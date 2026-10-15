import {useEffect,useState} from 'react';
import {API_ROOT} from './api';

export function PocInsightPortrait({id,name,onUnavailable}:{id:string;name:string|null;onUnavailable:(missing:boolean)=>void}) {
  const [attempt,setAttempt]=useState(0),[status,setStatus]=useState<'loading'|'loaded'|'error'>('loading');
  useEffect(()=>{
    if(status!=='error'||attempt>=2)return;
    const timer=setTimeout(()=>{setStatus('loading');setAttempt(n=>n+1);},attempt===0?2000:6000);
    return ()=>clearTimeout(timer);
  },[status,attempt]);
  const words=(name||'').trim().split(/\s+/),initials=[words[0],words.length>1?words.at(-1):''].map(word=>word?.[0]||'').join('');
  return <span className="insight-portrait"><span className="insight-portrait-fallback" aria-hidden="true">{initials||'·'}</span><img key={attempt} loading="lazy" src={`${API_ROOT}/poc/portrait/${id}`} alt="" style={{opacity:status==='loaded'?1:0}} onLoad={()=>{setStatus('loaded');onUnavailable(false);}} onError={()=>{setStatus('error');onUnavailable(true);}}/></span>;
}
