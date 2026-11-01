import {useEffect,useId,useState} from 'react';
import {useInsightData} from './InsightData';
import {useUiI18n,UiMessage} from './UiI18nReact';
import type {TopicItem} from './TopicsTypes';
import './Topics.css';
export function TopicFinder({onSelect,language='en'}:{onSelect:(item:TopicItem)=>void;language?:string}){
 const ui=useUiI18n(),id=useId(),[text,setText]=useState(''),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(text.trim()),250);return()=>clearTimeout(timer);},[text]);
 const {data}=useInsightData<{ready:boolean;results:TopicItem[]}>(open?'topics/search?'+new URLSearchParams({q:query,lang:language}):null);
 const rows=['topic','keyword','place'].flatMap(role=>(data?.results||[]).filter(r=>r.role===role));
 const select=(item:TopicItem)=>{onSelect(item);setOpen(false);setText('');setActive(-1);};
 return <div className="topic-finder"><input role="combobox" aria-label={ui.t('topics.find')} placeholder={ui.t('topics.find')} aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open&&active>=0?id+'-'+active:undefined} value={text} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onChange={e=>{setText(e.target.value);setOpen(true);setActive(-1);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setActive(-1);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>rows.length?i<0?(e.key==='ArrowDown'?0:rows.length-1):(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length:-1);}if(e.key==='Enter'&&open&&rows[active]){e.preventDefault();select(rows[active]);}}}/>{open&&<div id={id} role="listbox">{['topic','keyword','place'].map(role=><div role="group" aria-label={ui.t('topics.'+role+'s')} key={role}>{rows.some(r=>r.role===role)&&<small><UiMessage id={'topics.'+role+'s'}/></small>}{rows.filter(r=>r.role===role).map(item=>{const i=rows.indexOf(item);return <div role="option" id={id+'-'+i} aria-selected={i===active} key={item.key} onMouseDown={e=>e.preventDefault()} onClick={()=>select(item)}><span lang={item.language||language}>{item.label}</span><small><UiMessage id="topics.findCounts" values={{debates:item.counts.debate||0,questions:item.counts.question||0}}/></small></div>;})}</div>)}{data&&!data.ready&&<UiMessage id="topics.unavailable"/>}</div>}</div>;
}
