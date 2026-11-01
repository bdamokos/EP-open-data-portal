import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import type {MouseEvent} from 'react';

type SavedNode={path:string;top:number;left:number;open?:boolean;value?:string};
type Snapshot={href:string;nodes:SavedNode[];focus:string|null};
const snapshots=new Map<string,Snapshot>();
let pending:Snapshot|null=null;
let destination:string|null=null;
let origin:string|null=null;
let navigating=false;
const change='dossier-journey-change';
const capture='dossier-journey-capture';
const readerStates=new Map<string,Map<string,unknown>>();

const routeKey=(href:string)=>{const url=new URL(href,window.location.href);if(!url.searchParams.has('role'))url.searchParams.set('role','both');if(!url.searchParams.has('lang'))url.searchParams.set('lang','en');if(url.searchParams.has('member')&&!url.searchParams.has('view')&&!url.searchParams.has('module'))url.searchParams.set('module','profile');url.searchParams.sort();return url.pathname+url.search+url.hash;};
function pathFor(node:Element|null):string|null {
  if(!node||node===document.body)return null;
  const parts:string[]=[];
  for(let item:Element|null=node;item&&item!==document.body;item=item.parentElement){
    if(item.hasAttribute('data-reader-source')){
      parts.unshift('[data-reader-source="'+window.CSS.escape(item.getAttribute('data-reader-source')!)+'"][data-reader-language="'+window.CSS.escape(item.getAttribute('data-reader-language')||'')+'"]');break;
    }
    if(item.id){parts.unshift('#'+window.CSS.escape(item.id));break;}
    const siblings=item.parentElement?[...item.parentElement.children].filter(other=>other.tagName===item!.tagName):[];
    parts.unshift(item.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(item)+1)+')');
  }
  return parts.join(' > ');
}
export function rememberDossierOrigin() {
  window.dispatchEvent(new Event(capture));
  const nodes:SavedNode[]=[];
  for(const node of document.querySelectorAll<HTMLElement>('main,.explorer-profile-body,.explorer-speeches,.explorer-activities,.insight-topic-detail,.insight-reader-text,.document-context-reader,.member-votes-pane,.motion-comparison-reader,.explorer-speech-transcript,details,select,[data-dossier-scroll]')){
    const path=pathFor(node);if(!path)continue;
    nodes.push({path,top:node.scrollTop,left:node.scrollLeft,...(node.tagName==='DETAILS'?{open:(node as HTMLDetailsElement).open}:{}),...(node.tagName==='SELECT'?{value:(node as HTMLSelectElement).value}:{})});
  }
  const snapshot={href:window.location.href,nodes,focus:pathFor(document.activeElement)};
  snapshots.set(routeKey(window.location.href),snapshot);if(snapshots.size>30){const key=snapshots.keys().next().value!;snapshots.delete(key);readerStates.delete(key);}
  return snapshot;
}
export const dossierJourneyRestoring=()=>Boolean(pending);
export const dossierBackHref=()=>origin;
export function dossierReaderValue<T>(name:string,fallback:T):T {if(typeof window==='undefined')return fallback;const values=readerStates.get(routeKey(window.location.href));return values?.has(name)?values.get(name) as T:fallback;}
export function navigateDossier(href:string) {
  const url=new URL(href,window.location.href);if(url.origin!==window.location.origin)return false;
  const leaving=rememberDossierOrigin();
  const wasDossier=new URL(leaving.href).searchParams.get('pl-mode')==='dossier';
  if(!wasDossier&&url.searchParams.get('pl-mode')==='dossier')origin=leaving.href;
  pending=snapshots.get(routeKey(url.href))||null;destination=url.href;navigating=true;
  history.pushState({...history.state,dossierOrigin:origin},'',url);
  window.dispatchEvent(new Event('popstate'));window.dispatchEvent(new Event('explorer-query-change'));window.dispatchEvent(new Event(change));
  navigating=false;return true;
}
export function dossierLinkClick(event:MouseEvent<HTMLAnchorElement>) {
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.currentTarget.target&&event.currentTarget.target!=='_self')return;
  const url=new URL(event.currentTarget.href,window.location.href);if(url.origin!==window.location.origin)return;
  event.preventDefault();navigateDossier(url.href);
}

// Capture reader choices with the complete origin URL. URL-owned activity,
// category, country and page fields remain App's responsibility.
export function useDossierReaderState<T>(name:string,initial:T):[T,Dispatch<SetStateAction<T>>] {
  const read=()=>{if(typeof window==='undefined')return initial;const values=readerStates.get(routeKey(window.location.href));return values?.has(name)?values.get(name) as T:initial;};
  const [stored,setStored]=useState(()=>({name,value:read()}));
  const value=stored.name===name?stored.value:read();
  const setValue:Dispatch<SetStateAction<T>>=next=>setStored({name,value:typeof next==='function'?(next as (previous:T)=>T)(value):next});
  const current=useRef(value);current.current=value;
  useEffect(()=>{
    setStored(previous=>previous.name===name?previous:{name,value:read()});
    const save=()=>{const key=routeKey(window.location.href),values=readerStates.get(key)||new Map<string,unknown>();values.set(name,current.current);readerStates.set(key,values);};
    const restore=()=>{const values=readerStates.get(routeKey(window.location.href));if(values?.has(name))setStored({name,value:values.get(name) as T});};
    window.addEventListener(capture,save);window.addEventListener('popstate',restore);
    return()=>{window.removeEventListener(capture,save);window.removeEventListener('popstate',restore);};
  },[name]);
  return [value,setValue];
}

function destinationMounted() {
  const query=new URLSearchParams(window.location.search);
  if(query.get('view')==='legislation'&&query.get('pl-mode')==='dossier'){
    const panel=document.querySelector<HTMLElement>('[data-dossier-reference]');
    if(panel?.dataset.dossierReference!==query.get('dossier-ref')||panel.dataset.dossierPerson!==(query.get('dossier-person')||''))return false;
    if((panel.dataset.dossierStage||'all')!==(query.get('dossier-stage')||'all')||(panel.dataset.dossierCommittee||'')!==(query.get('dossier-committee')||''))return false;
  }else if(query.get('view')==='legislation'&&(!query.get('pl-mode')||query.get('pl-mode')==='agenda')){
    const panel=document.querySelector<HTMLElement>('[data-agenda-topic]');if(!panel||query.get('agenda-topic')&&panel.dataset.agendaTopic!==query.get('agenda-topic'))return false;
  }else if(!query.has('view')&&query.get('module')==='activities'){
    const panel=document.querySelector('.explorer-activities');if(!panel)return false;
    if(query.get('activity')&&!panel.querySelector('.explorer-speech-toggle[aria-expanded="true"]'))return false;
  }else if(!document.querySelector('main h1'))return false;
  return !document.querySelector('[data-view-loading],[data-topics-pending="true"],[data-activities-pending="true"],[data-motion-pending="true"],[data-context-pending="true"],[data-reader-pending="true"],[data-dossier-pending="true"],[data-procedure-context-pending="true"],[data-agenda-pending="true"]');
}

export function useDossierJourney() {
  const scheduled=useRef<number|null>(null);
  useEffect(()=>{
    const apply=()=>{
      if(!destination||routeKey(window.location.href)!==routeKey(destination)||!destinationMounted())return;
      if(scheduled.current!==null)return;
      // Run after the destination's own responsive scroll effects.
      scheduled.current=window.requestAnimationFrame(()=>{
        scheduled.current=null;if(!destination||!destinationMounted())return;
        const saved=pending;
        if(saved){
          let reopened=false;
          for(const item of saved.nodes){const node=document.querySelector<HTMLElement>(item.path);if(item.open!==undefined&&node?.tagName==='DETAILS'&&(node as HTMLDetailsElement).open!==item.open){(node as HTMLDetailsElement).open=item.open;reopened=true;}}
          // Opening a reader can mount a new request on the next React turn.
          if(reopened){scheduled.current=window.requestAnimationFrame(()=>{scheduled.current=null;apply();});return;}
          for(const item of saved.nodes){const node=document.querySelector<HTMLElement>(item.path);if(!node)continue;
            node.scrollTop=item.top;node.scrollLeft=item.left;
          }
          const target=saved.focus?document.querySelector<HTMLElement>(saved.focus):null;target?.focus({preventScroll:true});
        }else{
          const person=new URLSearchParams(window.location.search).get('dossier-person');
          const heading=(person?document.querySelector<HTMLElement>('[data-dossier-reference] h3'):null)||document.querySelector<HTMLElement>('.insight-dossier-title h2')||document.querySelector<HTMLElement>('[data-dossier-reference] h3')||document.querySelector<HTMLElement>('main h1');
          if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
        }
        pending=null;destination=null;
      });
    };
    const restore=()=>{
      if(!navigating){pending=snapshots.get(routeKey(window.location.href))||null;destination=pending?window.location.href:null;origin=history.state?.dossierOrigin||null;}
      apply();
    };
    const cancel=(event:Event)=>{if(event.isTrusted){pending=null;destination=null;}};
    const observer=new window.MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','data-topics-pending','data-agenda-topic','data-agenda-pending','data-activities-pending','data-motion-pending','data-context-pending','data-reader-pending','data-dossier-pending','data-procedure-context-pending']});
    window.addEventListener('popstate',restore);window.addEventListener(change,apply);
    for(const event of ['pointerdown','keydown','wheel','focusin'])document.addEventListener(event,cancel,{capture:true});
    return()=>{observer.disconnect();window.removeEventListener('popstate',restore);window.removeEventListener(change,apply);for(const event of ['pointerdown','keydown','wheel','focusin'])document.removeEventListener(event,cancel,true);if(scheduled.current!==null)window.cancelAnimationFrame(scheduled.current);};
  },[]);
}
