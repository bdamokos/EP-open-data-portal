import {appUiI18n,uiForLocale} from './appUiI18n';
import {UiI18nProvider} from './UiI18nReact';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {createContext,useContext,useEffect,useRef,useState,type MouseEvent,type ReactNode} from 'react';
import {api} from './data';
import {selectLanguageText} from './language.mjs';
import './PlenaryLive.css';

export type LiveState={status:'live'|'off-air'|'unavailable';checkedAt:string;validUntil:string;current:{id:string;title:string;language:string;updatedAt:string;sourceUrl:string}|null;broadcast:{id:string;channel:string;title:string;embedUrl:string;websiteUrl:string;languages:string[]}|null;agenda:{state:'presumed'|'ambiguous'|'none'|'unavailable';sittingId?:string;items:{id:string;titles:Record<string,string>;kind:string}[]};sources:{url:string;fetchedAt:string;available:boolean}[]};
type LiveContextValue={data:LiveState|null;fresh:boolean;open:()=>void;opened:boolean;setUiLanguage?:(language:string)=>void};
const LiveContext=createContext<LiveContextValue>({data:null,fresh:false,open:()=>{},opened:false});
export const usePlenaryLive=()=>useContext(LiveContext);
export function usePlenaryUiLanguage(language:string){const {setUiLanguage}=usePlenaryLive();useEffect(()=>setUiLanguage?.(language),[setUiLanguage,language]);}
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
  const inherited=useUiI18n();
  const [uiLanguage,setUiLanguage]=useState<string|null>(null);
  const ui=uiLanguage?uiForLocale(uiLanguage):inherited;
  const [data,setData]=useState<LiveState|null>(null),[now,setNow]=useState(Date.now),[opened,setOpened]=useState(false),[minimised,setMinimised]=useState(false);
  const openedRef=useRef(false),opener=useRef<HTMLElement|null>(null),panel=useRef<HTMLElement>(null),launcher=useRef<HTMLButtonElement>(null),restoreFocus=useRef(false);
  useEffect(()=>{openedRef.current=opened;},[opened]);
  useEffect(()=>{if(!opened&&restoreFocus.current){restoreFocus.current=false;if(opener.current?.isConnected)opener.current.focus();else launcher.current?.focus();}},[opened]);
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    async function refresh(){
      clearTimeout(timer);if(!active||document.hidden&&!openedRef.current)return;
      controller?.abort();controller=new AbortController();
      try{const value=await api<LiveState>('plenary-live',controller.signal, undefined, ui);if(active){setData(value);setNow(Date.now());}}
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
  const broadcast=(fresh && (data?.status==='live')) ? data.broadcast : null;
  const playerFresh=fresh||Boolean(data&&Date.parse(data.validUntil)+PLAYER_GRACE>now&&Date.parse(data.checkedAt)<=now+60_000);
  const playerBroadcast=(playerFresh && (data?.status==='live')) ? data.broadcast : null;
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
  function open(){opener.current=(document.activeElement instanceof HTMLElement) ? document.activeElement : null;setOpened(true);setMinimised(false);requestAnimationFrame(()=>panel.current?.focus());}
  function close(){restoreFocus.current=true;setOpened(false);setMinimised(false);}
  return <UiI18nProvider i18n={appUiI18n} language={ui.locale}><LiveContext.Provider value={{data,fresh,open,opened,setUiLanguage}}>{children}
    {!opened&&broadcast&&<button ref={launcher} className="plenary-live-launcher" lang={ui.language} onClick={open}><span className="plenary-live-dot"/><UiMessage id="plenarylive.tsx.watch.plenary.live"/></button>}
    {opened&&<section ref={panel} tabIndex={-1} className={'plenary-live-player'+(minimised ? ' is-minimised' : '')} aria-label={ui.t("plenarylive.tsx.plenary.live.player")} lang={ui.language}>
      <div className="plenary-live-player-heading"><strong><span className="plenary-live-dot"/>{playerBroadcast ? ui.t("plenarylive.tsx.plenary.live") : ui.t("plenarylive.tsx.plenary.player")}</strong><div>{playable&&<a className="plenary-live-popout" href={EBS_PLUS_EMBED} target="_blank" rel="noreferrer" onClick={popOut} aria-label={ui.t("plenarylive.tsx.pop.out.player.to.its.own.window.ebs")}><UiMessage id="plenarylive.tsx.pop.out"/></a>}<button onClick={()=>setMinimised(!minimised)} aria-label={minimised ? ui.t("plenarylive.tsx.expand.player") : ui.t("plenarylive.tsx.minimise.player")} aria-expanded={!minimised}>{minimised ? <UiMessage id="plenarylive.tsx.expand"/> : <UiMessage id="plenarylive.tsx.minimise"/>}</button><button onClick={close} aria-label={ui.t("plenarylive.tsx.close.live.player")}><UiMessage id="plenarylive.tsx.close"/></button></div></div>
      <div className="plenary-live-video" hidden={minimised}>{playable ? <iframe title={ui.t("plenarylive.tsx.european.parliament.live.on.ebs")} src={EBS_PLUS_EMBED} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen/> : <p role="status">{fresh ? ui.t("plenarylive.tsx.a.plenary.broadcast.is.not.available.right.now") : ui.t("plenarylive.tsx.live.status.could.not.be.refreshed")} <a href="https://audiovisual.ec.europa.eu/en/ebs/grid?ebs=no&ebsplus=yes" target="_blank" rel="noreferrer"><UiMessage id="plenarylive.tsx.check.ebs"/></a> · <a href={EP_WEBSTREAMING} target="_blank" rel="noreferrer"><UiMessage id="plenarylive.tsx.ep.multimedia.centre"/></a></p>}</div>
      {!minimised&&<div className="plenary-live-player-caption"><p>{(playerFresh && data?.current) ? data.current.title : (playerBroadcast?.title||ui.t("plenarylive.tsx.live.status.unavailable"))}</p>{data&&fresh&&<AgendaLink data={data} id={(data.agenda.state==='presumed') ? data.agenda.items[0]?.id : undefined}><UiMessage id="plenarylive.tsx.browse.today.s.agenda"/></AgendaLink>}<span><UiMessage id="plenarylive.tsx.status.european.union.year" values={{status: ((data && playerFresh) ? ui.t("plenarylive.tsx.checked.time.brussels", {time: String(clockText(data.checkedAt))}) : ui.t("plenarylive.tsx.status.out.of.date")), year: new Date().getFullYear()}}/></span><small><UiMessage id="plenarylive.tsx.also.on.the.ep.multimedia.centre" values={{multimediaLink: <a href={EP_WEBSTREAMING} target="_blank" rel="noreferrer"><UiMessage id="plenarylive.tsx.ep.multimedia.centre"/></a>}}/></small></div>}
    </section>}
  </LiveContext.Provider></UiI18nProvider>;
}

export function PlenaryLiveBanner({language='en'}:{language?:string}) {
  const ui = useUiI18n();
  const {data,fresh,open,opened}=usePlenaryLive();
  if(!data||!fresh||!data.current&&!data.broadcast)return null;
  const item=(data.agenda.state==='presumed') ? data.agenda.items[0] : null;
  const label=item ? selectLanguageText(item.titles,language,item.id) : null;
  return <section className="plenary-live-banner" aria-label={ui.t("plenarylive.tsx.plenary.now")} lang={ui.language}>
    <div><div className="plenary-live-eyebrow"><span className="plenary-live-dot"/>{data.broadcast ? ui.t("plenarylive.tsx.plenary.live") : ui.t("plenarylive.tsx.plenary.now")}<span><UiMessage id="plenarylive.tsx.updated.time.brussels" values={{time: clockText(data.current?.updatedAt||data.checkedAt)}}/></span></div><p title={data.current?.title||data.broadcast?.title}>{data.current?.title||data.broadcast?.title}</p>{item&&label&&<small><AgendaLink data={data} id={item.id}><UiMessage id="plenarylive.tsx.open.scheduled.agenda.item"/></AgendaLink></small>}{data.agenda.state==='ambiguous'&&<small><UiMessage id="plenarylive.tsx.current.agenda.item.unclear"/></small>}</div>
    {data.broadcast&&<button onClick={open}>{ui.t(opened ? 'plenarylive.tsx.show.player' : 'plenarylive.tsx.watch.live')}</button>}
  </section>;
}

export function ScheduledNow({id}:{id:string}) {
  const ui = useUiI18n();
  const {data,fresh}=usePlenaryLive();
  return ((fresh && (data?.agenda.state==='presumed')) && (data.agenda.items[0]?.id===id)) ? <span className="plenary-scheduled-now" title={ui.t("plenarylive.tsx.per.the.published.timetable")}><UiMessage id="plenarylive.tsx.scheduled.now"/></span> : null;
}
