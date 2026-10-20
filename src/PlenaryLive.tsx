import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api} from './data';
import {selectLanguageText} from './language.mjs';
import './PlenaryLive.css';

export type LiveState={status:'live'|'off-air'|'unavailable';checkedAt:string;validUntil:string;current:{id:string;title:string;language:string;updatedAt:string;sourceUrl:string}|null;broadcast:{id:string;channel:string;title:string;embedUrl:string;websiteUrl:string;languages:string[]}|null;agenda:{state:'presumed'|'ambiguous'|'none'|'unavailable';sittingId?:string;items:{id:string;titles:Record<string,string>;kind:string}[]};sources:{url:string;fetchedAt:string;available:boolean}[]};
type LiveContextValue={data:LiveState|null;fresh:boolean;open:()=>void;opened:boolean};
const LiveContext=createContext<LiveContextValue>({data:null,fresh:false,open:()=>{},opened:false});
export const usePlenaryLive=()=>useContext(LiveContext);
const clockText=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
export function liveAgendaHref(data:LiveState,id?:string) {
  const url=new URL(location.href),language=url.searchParams.get('lang')||'en';
  url.search='';url.searchParams.set('lang',language);url.searchParams.set('view','legislation');
  if(data.agenda.sittingId)url.searchParams.set('agenda-period','sitting:'+data.agenda.sittingId);
  if(id)url.searchParams.set('agenda-topic',id);
  return url.pathname+url.search;
}
function AgendaLink({data,id,children}:{data:LiveState;id?:string;children:ReactNode}) {
  return <a href={liveAgendaHref(data,id)} onClick={event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    event.preventDefault();history.pushState(null,'',liveAgendaHref(data,id));window.dispatchEvent(new PopStateEvent('popstate'));
  }}>{children}</a>;
}

export function PlenaryLiveProvider({children}:{children:ReactNode}) {
  const [data,setData]=useState<LiveState|null>(null),[now,setNow]=useState(Date.now),[opened,setOpened]=useState(false),[minimised,setMinimised]=useState(false);
  const opener=useRef<HTMLElement|null>(null),panel=useRef<HTMLElement>(null);
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    async function refresh(){
      clearTimeout(timer);if(!active||document.hidden)return;
      controller?.abort();controller=new AbortController();
      try{const value=await api<LiveState>('plenary-live',controller.signal);if(active){setData(value);setNow(Date.now());}}
      catch{/* A failed read never renews the last successful snapshot. */}
      finally{if(active)timer=setTimeout(refresh,30_000);}
    }
    const visible=()=>{if(document.hidden){clearTimeout(timer);controller?.abort();}else void refresh();};
    void refresh();document.addEventListener('visibilitychange',visible);
    const tick=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;clearTimeout(timer);clearInterval(tick);controller?.abort();document.removeEventListener('visibilitychange',visible);};
  },[]);
  const fresh=Boolean(data&&Date.parse(data.validUntil)>now&&Date.parse(data.checkedAt)<=now+60_000);
  const broadcast=fresh&&data?.status==='live'?data.broadcast:null;
  // URL allowlist belongs here too: no API string becomes an arbitrary iframe.
  const playable=broadcast?.embedUrl==='https://audiovisual.ec.europa.eu/embed/ebsplus?language=EN';
  function open(){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpened(true);setMinimised(false);requestAnimationFrame(()=>panel.current?.focus());}
  function close(){setOpened(false);setMinimised(false);requestAnimationFrame(()=>{if(opener.current?.isConnected)opener.current.focus();});}
  return <LiveContext.Provider value={{data,fresh,open,opened}}>{children}
    {!opened&&broadcast&&<button className="plenary-live-launcher" lang="en" onClick={open}><span className="plenary-live-dot"/>Watch plenary live <span aria-hidden="true">↗</span></button>}
    {opened&&<section ref={panel} tabIndex={-1} className={'plenary-live-player'+(minimised?' is-minimised':'')} aria-label="Plenary live player" lang="en">
      <div className="plenary-live-player-heading"><strong><span className="plenary-live-dot"/>{broadcast?'Plenary live':'Plenary player'}</strong><div><button onClick={()=>setMinimised(!minimised)} aria-label={minimised?'Expand player':'Minimise player'} aria-expanded={!minimised}>{minimised?'Expand':'Minimise'}</button><button onClick={close} aria-label="Close live player">Close</button></div></div>
      <div className="plenary-live-video" hidden={minimised}>{playable?<iframe title="European Parliament live on EbS+" src={broadcast!.embedUrl} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen/>:<p role="status">{fresh?'A plenary broadcast is not available right now.':'Live status could not be refreshed.'} <a href="https://audiovisual.ec.europa.eu/en/ebs/grid?ebs=no&ebsplus=yes" target="_blank" rel="noreferrer">Check EbS+ ↗</a></p>}</div>
      {!minimised&&<div className="plenary-live-player-caption"><p>{fresh&&data?.current?data.current.title:broadcast?.title||'Live status unavailable'}</p>{data&&fresh&&<AgendaLink data={data} id={data.agenda.state==='presumed'?data.agenda.items[0]?.id:undefined}>Browse today’s agenda →</AgendaLink>}<span>{data&&fresh?'Checked '+clockText(data.checkedAt)+' Brussels':'Status expired'} · © European Union, {new Date().getFullYear()}</span><small>Playback may be delayed. Use the player’s Live control to return to the live edge.</small></div>}
    </section>}
  </LiveContext.Provider>;
}

export function PlenaryLiveBanner({language='en'}:{language?:string}) {
  const {data,fresh,open,opened}=usePlenaryLive();
  if(!data||!fresh||!data.current&&!data.broadcast)return null;
  const item=data.agenda.state==='presumed'?data.agenda.items[0]:null;
  const label=item?selectLanguageText(item.titles,language,item.id):null;
  return <section className="plenary-live-banner" aria-label="Plenary now" lang="en">
    <div><div className="plenary-live-eyebrow"><span className="plenary-live-dot"/>{data.broadcast?'Plenary live':'Plenary now'}<span>Updated {clockText(data.current?.updatedAt||data.checkedAt)} Brussels</span></div><p title={data.current?.title||data.broadcast?.title}>{data.current?.title||data.broadcast?.title}</p>{item&&label&&<small><AgendaLink data={data} id={item.id}>Open scheduled agenda item</AgendaLink> · timings may change</small>}{data.agenda.state==='ambiguous'&&<small>Several agenda items or conflicting times are published for this block.</small>}</div>
    {data.broadcast&&<button onClick={open}>{opened?'Show player':'Watch live'} <span aria-hidden="true">↗</span></button>}
  </section>;
}

export function ScheduledNow({id}:{id:string}) {
  const {data,fresh}=usePlenaryLive();
  return fresh&&data?.agenda.state==='presumed'&&data.agenda.items[0]?.id===id?<span className="plenary-scheduled-now" title="Based on Parliament’s published timetable; the debate may run earlier or later.">Scheduled now</span>:null;
}
