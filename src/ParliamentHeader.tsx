import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {SavedNav} from './SavedControls';
import {TextSearch} from './TextSearch';
import './ParliamentHeader.css';
import {publicAmendmentsEnabled} from './publicFeatures';
import {ThemeToggle} from './ThemeToggle';
import {InterfaceLanguageControl} from './InterfaceLanguageControl';

// Three arcs of seats: the site's own mark, independent of Parliament branding.
const seats=[[5,4],[8,6],[11,8]].flatMap(([radius,count])=>Array.from({length:count},(_,i)=>{const angle=Math.PI*i/(count-1);return [13-Math.cos(angle)*radius,14-Math.sin(angle)*radius];}));
export function SiteMark() {
  return <svg className="parliament-mark" viewBox="0 0 26 16" aria-hidden="true">{seats.map(([x,y])=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.35"/>)}</svg>;
}

// Brand, destinations and tools share a row only when all of them fit at their natural width.
export function headerRowFits({available,brand,destinations,destinationGap,tools,gap}:{available:number;brand:number;destinations:number[];destinationGap:number;tools:number;gap:number}) {
  const nav=destinations.reduce((sum,width)=>sum+width,0)+destinationGap*Math.max(0,destinations.length-1);
  return brand+nav+tools+gap*2<=available;
}

// Labels differ by language, so the header measures them: when they do not fit, the
// destinations take their own row and the tools stay beside the brand.
function useStackedDestinations(language:string,items:string) {
  const header=useRef<HTMLElement>(null),[stacked,setStacked]=useState(false);
  useLayoutEffect(()=>{
    const node=header.current,brand=node?.querySelector<HTMLElement>('.parliament-brand'),nav=node?.querySelector('nav'),tools=node?.querySelector<HTMLElement>('.parliament-header-tools');
    const view=node?.ownerDocument.defaultView;
    if(!node||!brand||!nav||!tools||!view?.ResizeObserver)return;
    const measure=()=>{
      if(!node.clientWidth)return;
      const style=view.getComputedStyle(node),buttons=[...nav.children] as HTMLElement[];
      setStacked(!headerRowFits({
        available:node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
        brand:brand.getBoundingClientRect().width,destinations:buttons.map(button=>button.getBoundingClientRect().width),
        destinationGap:parseFloat(view.getComputedStyle(nav).columnGap)||0,tools:tools.getBoundingClientRect().width,gap:parseFloat(style.columnGap)||0,
      }));
    };
    measure();
    const observer=new view.ResizeObserver(measure);
    for(const target of [node,brand,tools,...nav.children])observer.observe(target);
    node.ownerDocument.fonts?.ready.then(measure,()=>{});
    return ()=>observer.disconnect();
  },[language,items]);
  return [header,stacked] as const;
}

type ExplorerView = 'legislation' | 'questions' | 'geopolitics' | 'outside' | 'amendments' | 'groups' | 'hemicycle';

// The site title returns to the bare URL, keeping the language and global search.
export function goHome() {
  const url=new URL(location.href);
  url.search=new URLSearchParams([...url.searchParams].filter(([key])=>key==='lang'||key.startsWith('global-fts-'))).toString();
  url.hash='';
  if(url.href!==location.href){history.pushState(history.state,'',url);window.dispatchEvent(new Event('popstate'));}
}

// Keyboard focus on a destination that is only partly visible in the sideways-scrolling phone row
// brings it fully in, clear of the edge fade. The browser alone leaves a partly visible item as it is.
const fadeWidth=28;
function revealDestination(nav:HTMLElement,target:HTMLElement) {
  if(nav.scrollWidth<=nav.clientWidth||target.parentElement!==nav)return;
  const left=target.offsetLeft,right=left+target.offsetWidth;
  if(left<nav.scrollLeft+fadeWidth)nav.scrollLeft=Math.max(0,left-fadeWidth);
  else if(right>nav.scrollLeft+nav.clientWidth-fadeWidth)nav.scrollLeft=right-nav.clientWidth+fadeWidth;
}

export function ParliamentHeader({view,onHome=goHome,onMembers,onNavigate,onSaved,onLanguageChange,language='en',search=true}: {
  view: 'home' | 'members' | ExplorerView | 'saved';
  onHome?: () => void;
  onMembers: () => void;
  onNavigate?: (view: ExplorerView) => void;
  onSaved?: () => void;
  onLanguageChange?: (language: string) => void;
  language?:string;
  search?:boolean;
}) {
  const ui = useUiI18n();
  const [header,stacked]=useStackedDestinations(ui.language,`${Boolean(onSaved)}${Boolean(onLanguageChange)}${search}`);
  // On phones the destinations scroll sideways: bring the current one into view.
  useEffect(()=>{
    const nav=header.current?.querySelector('nav'),current=nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if(nav&&current&&nav.scrollWidth>nav.clientWidth)nav.scrollLeft=current.offsetLeft-(nav.clientWidth-current.offsetWidth)/2;
  },[view,ui.language]);
  return <header ref={header} className="parliament-header" data-stacked={stacked ? "true" : undefined}>
    {onHome ? <a href="./" className="parliament-brand parliament-brand-link" lang={ui.language} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onHome();}}}><SiteMark/><UiMessage id="batch4.parliamentheader.tsx.23.1"/></a> : <span className="parliament-brand" lang={ui.language}><SiteMark/><UiMessage id="batch4.parliamentheader.tsx.23.1"/></span>}
    <nav aria-label={ui.t("batch4.parliamentheader.tsx.24.1")} lang={ui.language} onFocus={event=>revealDestination(event.currentTarget,event.target as HTMLElement)}>
      <button aria-current={(view==='members') ? 'page' : undefined} onClick={onMembers}><UiMessage id="batch4.parliamentheader.tsx.25.1"/></button>
      {(['legislation','questions','geopolitics','amendments','outside','groups','hemicycle'] as const).filter(destination=>destination!=='amendments'||publicAmendmentsEnabled).map(destination=><button
        key={destination}
        aria-current={(view===destination) ? 'page' : undefined}
        disabled={!onNavigate&&view!==destination}
        onClick={()=>onNavigate?.(destination)}
      >{destination==='hemicycle'?ui.t('hemicycle.title'):destination==='legislation'?ui.t("plenarymodes.plenary_agenda"):destination==='geopolitics'?ui.t('topics.geopolitics'):destination==='questions'?ui.t("textsearch.questions"):destination==='amendments'?ui.t("legislation.amendments.900866"):destination==='groups'?ui.t("groupvoices.group_voices.f21b8b"):ui.t("outsidevoices.outside_voices.a027e6")}</button>)}
      {onSaved&&<SavedNav onClick={onSaved} current={view==='saved'}/>}
    </nav>
    <div className="parliament-header-tools">
      <ThemeToggle/>
      {onLanguageChange&&<InterfaceLanguageControl language={language} onChange={onLanguageChange}/>}
      {search&&<TextSearch global prefix="global-fts" label={ui.t("batch4.parliamentheader.tsx.35.1")} language={language} className="explorer-text-search-global"/>}
    </div>
  </header>;
}
