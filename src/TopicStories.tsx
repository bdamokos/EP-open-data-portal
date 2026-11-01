import {useId,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {useExplorerParam} from './explorerUrl';
import {buildTopicStories,type StoryFacts,type StoryReference,type StorySelection} from './topicStoryModel.mjs';
import {topicsHref} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
export function TopicStories({selection,fallback,facts:provided}:{selection:StorySelection;fallback?:ReactNode;facts?:StoryFacts}){
 const ui=useUiI18n(),panel=useId(),[selected,setSelected]=useExplorerParam<string>('t-story','');
 // The raw-reference adapter remains isolated until the bounded facts contract lands.
 const response=useInsightData<StoryFacts|{ready:boolean;facts?:StoryFacts}>(provided?null:'topics/story-facts');
 const payload=provided||response.data,facts=payload&&'questions' in payload?payload:payload&&'facts' in payload?payload.facts:null;
 const lines=buildTopicStories(facts,{...selection,language:ui.language});
 if(!lines.length)return <>{fallback}</>;
 const refs=new Map<string,StoryReference>();
 const renderRef=(value:StoryReference,key:string)=>{
  refs.set(key,value);
  const filters={'t-q':selection.period||'','t-mode':selection.mode||'q','t-own':selection.excludeOwn?'1':'0','t-zoom':selection.zoom||'world','t-story':key};
  const href=selection.place||selection.topic?topicsHref(selection.place?'place:'+selection.place:selection.topic!,filters):'?'+new URLSearchParams({view:'topics','t-tab':'places',...filters});
  return <a href={href+'#'+panel} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();setSelected(selected===key?'':key);}} aria-expanded={selected===key} aria-controls={selected===key?panel:undefined}>{value.italic?<i lang="en">{value.text}</i>:value.text}</a>;
 };
 const sentences=lines.map((line,i)=>{
  const values=Object.fromEntries(Object.entries(line.values).map(([name,value])=>[name,Array.isArray(value)?new Intl.ListFormat(ui.locale,{style:'long',type:'conjunction'}).formatToParts(value.map((_,j)=>String(j))).map((part,j)=>part.type==='element'?<span key={j}>{renderRef(value[Number(part.value)],i+'-'+name+'-'+part.value)}</span>:part.value):typeof value==='string'?value:renderRef(value,i+'-'+name)]));
  return <span key={line.id+'-'+i}><UiMessage id={line.id} values={values}/>{' '}</span>;
 });
 const active=refs.get(selected);
 return <div className="topic-stories"><p className="topic-story">{sentences}</p>{active&&<section id={panel} className="topic-story-records" aria-label={ui.t('topics.story.records')}><h3>{active.text}</h3>{active.records.map(r=><article key={r.kind+':'+r.id}><small>{r.date}</small><a href={r.kind==='document'?'https://www.europarl.europa.eu/doceo/document/'+encodeURIComponent(r.id)+'_EN.html':recordHref(r.id,r.kind)}>{r.title}</a></article>)}</section>}</div>;
}
