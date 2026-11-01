import {StarControl} from './StarControl';
import {dossierLinkClick} from './dossierJourney';
import {useState,useSyncExternalStore} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {topicsHref} from './topicPresentation.mjs';
import type {TopicConcept} from './TopicsTypes';
const key='ep.following.topics.v1',listeners=new Set<()=>void>();
let items:TopicConcept[]=[];
function reload(){try{const value=JSON.parse(localStorage.getItem(key)||'[]');items=Array.isArray(value)?value.filter(i=>typeof i.key==='string'&&typeof i.label==='string'&&/^(oeil:|eurovoc:|place:)/.test(i.key)):[];}catch{items=[];}listeners.forEach(f=>f());}
reload();window.addEventListener('storage',e=>{if(e.key===key||e.key===null)reload();});
export function useTopics(){return useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f);},()=>items);}
export function FollowTopic({concept}:{concept:TopicConcept}){const ui=useUiI18n(),[error,setError]=useState(false),saved=useTopics().some(i=>i.key===concept.key);return <><StarControl saved={saved} label={ui.t(saved?'topics.following':'topics.follow')} labelLanguage={ui.language} onClick={()=>{const next=saved?items.filter(i=>i.key!==concept.key):[...items,concept];try{localStorage.setItem(key,JSON.stringify(next));setError(false);reload();}catch{setError(true);}}}/>{error&&<p role="alert"><UiMessage id="topics.saveError"/></p>}</>;}
export function FollowedTopics(){const saved=useTopics();return <>{saved.map(c=><article className="explorer-saved-card" key={c.key}><small><UiMessage id={c.key.startsWith('place:')?'topics.place':'topics.topic'}/></small><h2><a onClick={dossierLinkClick} href={topicsHref(c.key)}>{c.label}</a></h2><FollowTopic concept={c}/></article>)}</>;}
