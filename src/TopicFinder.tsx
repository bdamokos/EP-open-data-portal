import {useEffect,useId,useState,useRef} from 'react';
import {useInsightData} from './InsightData';
import {useUiI18n,UiMessage} from './UiI18nReact';
import type {TopicItem} from './TopicsTypes';
import './Topics.css';
export function TopicFinder({onSelect,language='en',scope='all'}:{onSelect:(item:TopicItem)=>void;language?:string;scope?:'all'|'places'|'topics'}){
 const input=useRef<HTMLInputElement>(null),ui=useUiI18n(),id=useId(),[text,setText]=useState(''),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(text.trim()),250);return()=>clearTimeout(timer);},[text]);
 const {data,error,retry}=useInsightData<{ready:boolean;results:TopicItem[]}>(open?'topics/search?'+new URLSearchParams({q:query,lang:language}):null);
 const roles=scope==='places'?['place']:scope==='topics'?['topic','keyword']:['topic','keyword','place'];
 const placeholder=ui.t(scope==='places'?'topics.findPlace':scope==='topics'?'topics.findTopic':'topics.find');
 const rows=roles.flatMap(role=>(data?.results||[]).filter(r=>r.role===role));
 const select=(item:TopicItem)=>{onSelect(item);setOpen(false);setText('');setActive(-1);};
 return <div className="topic-finder" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOpen(false);}}><input ref={input} role="combobox" aria-label={placeholder} placeholder={placeholder} aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open&&active>=0?id+'-'+active:undefined} value={text} onFocus={()=>setOpen(true)} onChange={e=>{setText(e.target.value);setOpen(true);setActive(-1);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setActive(-1);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>rows.length?i<0?(e.key==='ArrowDown'?0:rows.length-1):(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length:-1);}if(e.key==='Enter'&&open&&rows[active]){e.preventDefault();select(rows[active]);}}}/>{open&&<div id={id} role="listbox">{roles.map(role=><div role="group" aria-label={ui.t('topics.'+role+'s')} key={role}>{rows.some(r=>r.role===role)&&<small><UiMessage id={'topics.'+role+'s'}/></small>}{rows.filter(r=>r.role===role).map(item=>{const i=rows.indexOf(item);return <div role="option" id={id+'-'+i} aria-selected={i===active} key={item.key} onMouseDown={e=>e.preventDefault()} onClick={()=>select(item)}><span lang={item.labelLanguage||item.language||language}>{item.label}</span><small><UiMessage id="topics.findSummary" values={{debates:<UiMessage id="topics.story.count.debates" values={{count:item.counts.debate||0}} counts={{count:item.counts.debate||0}}/>,questions:<UiMessage id="topics.story.count.questions" values={{count:item.counts.question||0}} counts={{count:item.counts.question||0}}/>}}/></small></div>;})}</div>)}{(error||data&&!data.ready)&&<p role="status"><UiMessage id="topics.unavailable"/> </p>}</div>}</div>;
}
