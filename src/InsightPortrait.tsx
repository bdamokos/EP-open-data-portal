import {useEffect,useRef} from 'react';
import {API_ROOT} from './api';
import {publicUrl} from './publicUrl';
import {usePortraitImage} from './usePortraitImage';

export function InsightPortrait({id,name,onUnavailable}:{id:string;name:string|null;onUnavailable:(missing:boolean)=>void}) {
  const portrait=usePortraitImage(`${API_ROOT}/poc/portrait/${id}`,publicUrl('assets/portrait-placeholder.svg'));
  const unavailableRef=useRef(onUnavailable);
  unavailableRef.current=onUnavailable;
  useEffect(()=>{
    unavailableRef.current(portrait.status==='error');
  },[portrait.status]);
  const words=(name||'').trim().split(/\s+/),initials=[words[0],words.length>1?words.at(-1):''].map(word=>word?.[0]||'').join('');
  return <span className="insight-portrait"><span className="insight-portrait-fallback" aria-hidden="true">{initials||'·'}</span><img ref={portrait.imageRef} loading="lazy" src={portrait.src} alt="" style={{opacity:portrait.status==='loaded'?1:0}} onLoad={portrait.onLoad} onError={portrait.onError}/></span>;
}
