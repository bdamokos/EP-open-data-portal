import {dossierLinkClick,useDossierReaderState} from './dossierJourney';
import {createContext,useContext,type ReactNode} from 'react';
import {useInsightData} from './InsightData';
import {UiMessage} from './UiI18nReact';
import {topicsHref,titleParts,agendaTitle} from './topicPresentation.mjs';
import type {RecordTopic} from './TopicsTypes';
import './Topics.css';
const Batch=createContext<Map<string,RecordTopic>|null>(null);
const BatchProgress=createContext({waiting:false,ready:true});
export const TopicsShown=createContext(false);
function TopicChunk({ids,language,children}:{ids:string[];language:string;children:ReactNode}){
 const parent=useContext(Batch),previous=useContext(BatchProgress),enabled=previous.ready&&!previous.waiting;
 const {data,loading}=useInsightData<{ready:boolean;records:RecordTopic[]}>(enabled?'insights/record-topics?'+new URLSearchParams({ids:ids.join(','),lang:language}):null);
 const records=new Map(parent||[]);if(data?.ready)for(const r of data.records)records.set(r.id,r);
 const progress={waiting:previous.waiting||enabled&&loading,ready:enabled&&Boolean(data?.ready)};
 return <Batch.Provider value={records}><BatchProgress.Provider value={progress}><span hidden data-topics-pending={progress.waiting?'true':undefined}/>{children}</BatchProgress.Provider></Batch.Provider>;
}
export function TopicBatch({ids,language='en',children}:{ids:string[];language?:string;children:ReactNode}){
 const unique=[...new Set(ids)].filter(Boolean).sort(),chunks:string[][]=[];for(let at=0;at<unique.length;at+=50)chunks.push(unique.slice(at,at+50));
 let content=children;for(let i=chunks.length-1;i>=0;i--)content=<TopicChunk key={chunks[i].join(',')} ids={chunks[i]} language={language}>{content}</TopicChunk>;
 return <BatchProgress.Provider value={{waiting:false,ready:true}}>{chunks.length?content:<Batch.Provider value={new Map()}>{children}</Batch.Provider>}</BatchProgress.Provider>;
}
export function OfficialTitle({title,language,agenda=false}:{title:string;language?:string|null;agenda?:boolean}){const [prefix,rest]=titleParts(agenda?agendaTitle(title):title,language);return <>{prefix&&<span className="topic-title-prefix">{prefix}</span>}{rest}</>;}
export function RecordTopics({id,full=false,language='en'}:{id:string;full?:boolean;language?:string}){
 const batch=useContext(Batch),shown=useContext(TopicsShown);
 const {data,loading}=useInsightData<{ready:boolean;records:RecordTopic[]}>(!batch&&!shown&&full?'insights/record-topics?'+new URLSearchParams({ids:id,lang:language}):null);
 const record=batch?.get(id)||(data?.ready?data.records[0]:null);
 if(shown||!record)return full&&!batch&&loading?<span hidden data-topics-pending="true"/>:null;
 return <TopicLine record={record} full={full} language={language}/>;
}
function PlacePin(){return <svg className="topic-pin" viewBox="0 0 16 20" aria-hidden="true"><path d="M8 19S1 11 1 7a7 7 0 1 1 14 0c0 4-7 12-7 12Z"/><circle cx="8" cy="7" r="2.4"/></svg>;}
export function TopicLine({record,full=false,language='en'}:{record:RecordTopic;full?:boolean;language?:string}){
 const [expanded,setExpanded]=useDossierReaderState<boolean>('record-topics:'+record.id,false),[allKeywords,setAllKeywords]=useDossierReaderState<boolean>('record-keywords:'+record.id,false);
 const topics=full&&expanded?record.topics:record.topics.slice(0,1),places=full&&expanded?record.places:record.places.slice(0,1),canExpand=record.topics.length>1||record.places.length>1;
 const featured=record.keywords.filter(k=>k.featured).slice(0,3),keywords=allKeywords?[...featured,...record.keywords.filter(k=>!featured.some(f=>f.key===k.key))]:featured,moreKeywords=record.keywords.length>featured.length;
 return <>{(topics.length>0||places.length>0)&&<div className="record-topics">{topics.map((topic,i)=><span key={topic.key}>{i>0?' · ':''}<a onClick={dossierLinkClick} href={topicsHref(topic.key)} lang={topic.language||language}>{topic.label}</a></span>)}{(!full||!expanded)&&record.topics.length>1&&<span className="topic-muted"> +{record.topics.length-1}</span>}{places.map(place=><span key={place.key}> <a onClick={dossierLinkClick} href={topicsHref(place.key)} lang={place.language||language}><PlacePin/> {place.label}</a></span>)}{full&&canExpand&&<button className="topic-meta-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><UiMessage id={expanded?'topics.less':'topics.more'}/></button>}</div>}{full&&record.keywords.length>0&&<p className="topic-muted topic-keywords"><UiMessage id="topics.keywordLine" values={{keywords:keywords.map((k,i)=><span key={k.key}>{i>0?' · ':''}<a onClick={dossierLinkClick} href={topicsHref(k.key)} lang={k.language||language}>{k.label}</a></span>)}}/>{moreKeywords&&<button className="topic-meta-toggle" aria-expanded={allKeywords} onClick={()=>setAllKeywords(!allKeywords)}><UiMessage id={allKeywords?'topics.less':'topics.more'}/></button>}</p>}{full&&record.status==='pending'&&<p><UiMessage id="topics.pending"/></p>}</>;
}
export function QuestionOriginTag({id,place}:{id:string;place:string}){const records=useContext(Batch),record=records?.get(id);return record?.places.some(p=>p.id===place&&p.askers==='home')?<small className="topic-muted"><UiMessage id="topics.ownMepTag"/></small>:null;}
