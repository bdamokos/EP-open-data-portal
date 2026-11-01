import {GROUP_VOICE_GROUPSUi} from './groupVoiceTerms.mjs';
import {useEffect,useRef,useState,useId,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {useExplorerParam} from './explorerUrl';
import {buildTopicStories,storyNumber,type StoryFacts,type StoryReference,type StorySelection,type StoryValue} from './topicStoryModel.mjs';
import {topicsHref} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
import {sourcePageUrl} from './SourceLink';
import {dossierLinkClick} from './dossierJourney';
import {InsightQuestionReader,InsightSpeechReader} from './InsightReaders';
export function TopicStories({selection,fallback,facts:provided}:{selection:StorySelection;fallback?:ReactNode;facts?:StoryFacts}){
 const ui=useUiI18n(),panel=useId(),[selected,setSelected]=useExplorerParam<string>('t-story',''),[reading,setReading]=useExplorerParam<string>('t-story-read',''),[,setQuarter]=useExplorerParam<string>('t-q','');
 // This adapter accepts the reviewed full-reference facts until the endpoint lands.
 const response=useInsightData<StoryFacts|{ready:boolean;facts?:StoryFacts}>(provided?null:'topics/story-facts');
 const payload=provided||response.data,available=payload&&(!('ready' in payload)||payload.ready),facts=available&&'questions' in payload?payload:available&&'facts' in payload?payload.facts:null;
 const [shown,setShown]=useState(20);
 const lines=buildTopicStories(facts,{...selection,language:ui.language,proseLanguage:ui.messageLocale('topics.story.ordinal.other')}),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLAnchorElement|null>(null);
 useEffect(()=>{setShown(20);if(selected&&heading.current){heading.current.focus({preventScroll:true});heading.current.scrollIntoView({block:'start'});}else if(!selected&&opener.current?.isConnected){opener.current.focus({preventScroll:true});opener.current=null;}},[selected,Boolean(lines.length)]);
 if(!lines.length)return <>{fallback}</>;
 const refs=new Map<string,StoryReference>();
 const hrefFor=(key:string,record='',period=selection.period)=>{const filters={'t-q':period||'','t-mode':selection.mode||'q','t-own':selection.excludeOwn?'1':'0','t-zoom':selection.zoom||'world','t-story':key,...(record?{'t-story-read':record}:{})};return selection.place||selection.topic?topicsHref(selection.place?'place:'+selection.place:selection.topic!,filters):'?'+new URLSearchParams({view:'topics','t-tab':'places',...filters});};
 const renderValues=(values:Record<string,StoryValue>,path:string):Record<string,ReactNode>=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,render(value,path+'-'+key)]));
 const render=(value:StoryValue,path:string):ReactNode=>{
  if(value===null||typeof value==='string')return value;
  if(Array.isArray(value))return new Intl.ListFormat(ui.locale,{style:'long',type:'conjunction'}).formatToParts(value.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{render(value[Number(part.value)],path+'-'+part.value)}</span>:part.value);
  if('message' in value)return <UiMessage id={value.message} values={renderValues(value.values,path)} counts={value.counts}/>;
  refs.set(path,value);
  const label=typeof value.text==='string'?value.text:render(value.text,path+'-label');
  return <a href={hrefFor(path,'',value.period||selection.period)+'#'+(value.pageRecords?'topic-records':panel)} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();opener.current=e.currentTarget;setReading('');if(value.pageRecords){setSelected('');const target=document.getElementById('topic-records')?.querySelector('h2');if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}}else if(value.period){setQuarter(value.period);setSelected('');}else setSelected(selected===path?'':path);}} aria-expanded={selected===path} aria-controls={selected===path?panel:undefined}>{value.italic?<i lang="en">{label}</i>:label}</a>;
 };
 const sentences=lines.map((line,i)=><span key={line.id+'-'+i}><UiMessage id={line.id} values={renderValues(line.values,String(i))} counts={line.counts}/>{' '}</span>),active=refs.get(selected);
 const num=(n:number)=>storyNumber(n,ui.language);
 return <div className="topic-stories"><p className="topic-story">{sentences}</p>{active&&!active.pageRecords&&<section id={panel} className="topic-story-records" aria-label={ui.t('topics.story.records')}><h3 ref={heading} tabIndex={-1}>{typeof active.text==='string'?active.text:render(active.text,'record-heading')}</h3>{active.records.slice(0,shown).map(r=>{
  const inline=['document','question','speech'].includes(r.kind),source=sourcePageUrl(r.url),href=inline?hrefFor(selected,r.id):source||recordHref(r.id,r.kind),o=r.outcome;
  return <article key={r.kind+':'+r.id}><small>{r.date}</small><a href={href} onClick={e=>{if(inline&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();setReading(reading===r.id?'':r.id);}else if(!source)dossierLinkClick(e);}}>{r.title}</a>{r.groups?.length? <p><UiMessage id="topics.story.records.groups" values={{groups:new Intl.ListFormat(ui.locale,{type:'conjunction'}).format(r.groups.map(g=>(GROUP_VOICE_GROUPSUi(ui) as Record<string,string>)[g.replace('S-D','S_D').replace('VERTS-ALE','VERTS_ALE').replace('THE-LEFT','THE_LEFT')]||g))}}/></p>:null}{o&&['ADOPTED','REJECTED'].includes(o.outcome)&&<p><UiMessage id={'topics.story.records.'+(o.outcome==='REJECTED'?(o.for!=null&&o.against!=null?'rejectedTally':'rejected'):o.for!=null&&o.against!=null?'passed':/VOTE_HAND/.test(o.method||o.decision_method||'')?'showOfHands':'adopted')} values={{for:o.for==null?'':num(o.for),against:o.against==null?'':num(o.against)}}/></p>}{reading===r.id&&(r.kind==='speech'?<InsightSpeechReader id={r.id} language={ui.language}/>:<InsightQuestionReader id={r.id} language={ui.language} heading={ui.t('topics.kind.'+r.kind)}/>)}</article>;
 })}{active.records.length>shown&&<button onClick={()=>setShown(n=>n+20)}><UiMessage id="topics.more"/></button>}{!active.records.length&&<p><UiMessage id="topics.empty"/></p>}</section>}</div>;
}
