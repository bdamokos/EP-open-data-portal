import {createContext,useContext,useEffect,useRef,useState,type MouseEvent,type ReactNode} from 'react';
import {api} from './data';
import {selectLanguageText} from './language.mjs';
import './PlenaryLive.css';

export type LiveState={status:'live'|'off-air'|'unavailable';checkedAt:string;validUntil:string;current:{id:string;title:string;language:string;updatedAt:string;sourceUrl:string}|null;broadcast:{id:string;channel:string;title:string;embedUrl:string;websiteUrl:string;languages:string[]}|null;agenda:{state:'presumed'|'ambiguous'|'none'|'unavailable';sittingId?:string;items:{id:string;titles:Record<string,string>;kind:string}[]};sources:{url:string;fetchedAt:string;available:boolean}[]};
type LiveContextValue={data:LiveState|null;fresh:boolean;open:()=>void;opened:boolean};
const LiveContext=createContext<LiveContextValue>({data:null,fresh:false,open:()=>{},opened:false});
export const usePlenaryLive=()=>useContext(LiveContext);
const EBS_PLUS_EMBED='https://audiovisual.ec.europa.eu/embed/ebsplus?language=EN',EP_WEBSTREAMING='https://multimedia.europarl.europa.eu/en/webstreaming';
// Background tabs throttle timers to about once a minute, so an open player
// tolerates a late check instead of unmounting mid-debate. A fresh off-air
// answer still stops it at once.
const PLAYER_GRACE=120_000;
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
    event.preventDefault();history.pushState(history.state,'',liveAgendaHref(data,id));window.dispatchEvent(new PopStateEvent('popstate'));
  }}>{children}</a>;
}

export function PlenaryLiveProvider({children}:{children:ReactNode}) {
  const [data,setData]=useState<LiveState|null>(null),[now,setNow]=useState(Date.now),[opened,setOpened]=useState(false),[minimised,setMinimised]=useState(false);
  const openedRef=useRef(false),opener=useRef<HTMLElement|null>(null),panel=useRef<HTMLElement>(null),launcher=useRef<HTMLButtonElement>(null),restoreFocus=useRef(false);
  useEffect(()=>{openedRef.current=opened;},[opened]);
  useEffect(()=>{if(!opened&&restoreFocus.current){restoreFocus.current=false;if(opener.current?.isConnected)opener.current.focus();else launcher.current?.focus();}},[opened]);
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    async function refresh(){
      clearTimeout(timer);if(!active||document.hidden&&!openedRef.current)return;
      controller?.abort();controller=new AbortController();
      try{const value=await api<LiveState>('plenary-live',controller.signal);if(active){setData(value);setNow(Date.now());}}
      catch{/* A failed read never renews the last successful snapshot. */}
      finally{if(active)timer=setTimeout(refresh,30_000);}
    }
    // An open player keeps checking in the background: audio continues there.
    const visible=()=>{if(!document.hidden)void refresh();else if(!openedRef.current){clearTimeout(timer);controller?.abort();}};
    void refresh();document.addEventListener('visibilitychange',visible);
    const tick=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;clearTimeout(timer);clearInterval(tick);controller?.abort();document.removeEventListener('visibilitychange',visible);};
  },[]);
  const fresh=Boolean(data&&Date.parse(data.validUntil)>now&&Date.parse(data.checkedAt)<=now+60_000);
  const broadcast=fresh&&data?.status==='live'?data.broadcast:null;
  const playerFresh=fresh||Boolean(data&&Date.parse(data.validUntil)+PLAYER_GRACE>now&&Date.parse(data.checkedAt)<=now+60_000);
  const playerBroadcast=playerFresh&&data?.status==='live'?data.broadcast:null;
  // URL allowlist belongs here too: no API string becomes an arbitrary iframe.
  const playable=playerBroadcast?.embedUrl===EBS_PLUS_EMBED;
  function popOut(event:MouseEvent<HTMLAnchorElement>){
    if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    // Two players would play twice: a blocked popup keeps the inline one.
    event.preventDefault();
    // Open a fresh blank window so the broadcaster's page gets no handle on
    // this tab. A reused named window may still be cross-origin.
    const popup=window.open('about:blank','_blank','popup,width=960,height=540');
    if(!popup)return;
    try{popup.opener=null;}catch{popup.close();return;}
    popup.location.replace(EBS_PLUS_EMBED);popup.focus();close();
  }
  function open(){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpened(true);setMinimised(false);requestAnimationFrame(()=>panel.current?.focus());}
  function close(){restoreFocus.current=true;setOpened(false);setMinimised(false);}
  return <LiveContext.Provider value={{data,fresh,open,opened}}>{children}
    {!opened&&broadcast&&<button ref={launcher} className="plenary-live-launcher" lang="en" onClick={open}><span className="plenary-live-dot"/>Watch plenary live <span aria-hidden="true">↗</span></button>}
    {opened&&<section ref={panel} tabIndex={-1} className={'plenary-live-player'+(minimised?' is-minimised':'')} aria-label="Plenary live player" lang="en">
      <div className="plenary-live-player-heading"><strong><span className="plenary-live-dot"/>{playerBroadcast?'Plenary live':'Plenary player'}</strong><div>{playable&&<a className="plenary-live-popout" href={EBS_PLUS_EMBED} target="_blank" rel="noreferrer" onClick={popOut} aria-label="Pop out player to its own window (EbS+)">Pop out <span aria-hidden="true">↗</span></a>}<button onClick={()=>setMinimised(!minimised)} aria-label={minimised?'Expand player':'Minimise player'} aria-expanded={!minimised}>{minimised?'Expand':'Minimise'}</button><button onClick={close} aria-label="Close live player">Close</button></div></div>
      <div className="plenary-live-video" hidden={minimised}>{playable?<iframe title="European Parliament live on EbS+" src={EBS_PLUS_EMBED} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen/>:<p role="status">{fresh?'A plenary broadcast is not available right now.':'Live status could not be refreshed.'} <a href="https://audiovisual.ec.europa.eu/en/ebs/grid?ebs=no&ebsplus=yes" target="_blank" rel="noreferrer">Check EbS+ ↗</a> · <a href={EP_WEBSTREAMING} target="_blank" rel="noreferrer">EP Multimedia Centre ↗</a></p>}</div>
      {!minimised&&<div className="plenary-live-player-caption"><p>{playerFresh&&data?.current?data.current.title:playerBroadcast?.title||'Live status unavailable'}</p>{data&&fresh&&<AgendaLink data={data} id={data.agenda.state==='presumed'?data.agenda.items[0]?.id:undefined}>Browse today’s agenda →</AgendaLink>}<span>{data&&playerFresh?'Checked '+clockText(data.checkedAt)+' Brussels':'Status out of date'} · © European Union, {new Date().getFullYear()}</span><small>Also on the <a href={EP_WEBSTREAMING} target="_blank" rel="noreferrer">EP Multimedia Centre ↗</a>.</small></div>}
    </section>}
  </LiveContext.Provider>;
}

export function PlenaryLiveBanner({language='en'}:{language?:string}) {
  const {data,fresh,open,opened}=usePlenaryLive();
  if(!data||!fresh||!data.current&&!data.broadcast)return null;
  const item=data.agenda.state==='presumed'?data.agenda.items[0]:null;
  const label=item?selectLanguageText(item.titles,language,item.id):null;
  return <section className="plenary-live-banner" aria-label="Plenary now" lang="en">
    <div><div className="plenary-live-eyebrow"><span className="plenary-live-dot"/>{data.broadcast?'Plenary live':'Plenary now'}<span>Updated {clockText(data.current?.updatedAt||data.checkedAt)} Brussels</span></div><p title={data.current?.title||data.broadcast?.title}>{data.current?.title||data.broadcast?.title}</p>{item&&label&&<small><AgendaLink data={data} id={item.id}>Open scheduled agenda item</AgendaLink></small>}{data.agenda.state==='ambiguous'&&<small>Current agenda item unclear.</small>}</div>
    {data.broadcast&&<button onClick={open}>{opened?'Show player':'Watch live'} <span aria-hidden="true">↗</span></button>}
  </section>;
}

export function ScheduledNow({id}:{id:string}) {
  const {data,fresh}=usePlenaryLive();
  return fresh&&data?.agenda.state==='presumed'&&data.agenda.items[0]?.id===id?<span className="plenary-scheduled-now" title="Per the published timetable.">Scheduled now</span>:null;
}
