import {createContext,useContext,type ReactNode} from 'react';
import {useInsightData} from './InsightData';
import {UiMessage} from './UiI18nReact';
import {topicsHref,titleParts} from './topicPresentation.mjs';
import type {RecordTopic} from './TopicsTypes';
import './Topics.css';
const Batch=createContext<Map<string,RecordTopic>|null>(null);
export const TopicsShown=createContext(false);
export function TopicBatch({ids,language='en',children}:{ids:string[];language?:string;children:ReactNode}){
 const unique=[...new Set(ids)].filter(Boolean).slice(0,50).sort();
 const {data}=useInsightData<{ready:boolean;records:RecordTopic[]}>(unique.length?'insights/record-topics?'+new URLSearchParams({ids:unique.join(','),lang:language}):null);
 return <Batch.Provider value={new Map(data?.ready?data.records.map(r=>[r.id,r]):[])}>{children}</Batch.Provider>;
}
export function OfficialTitle({title,language}:{title:string;language?:string|null}){const [prefix,rest]=titleParts(title,language);return <>{prefix&&<span className="topic-title-prefix">{prefix}</span>}{rest}</>;}
export function RecordTopics({id,full=false,language='en'}:{id:string;full?:boolean;language?:string}){
 const batch=useContext(Batch),shown=useContext(TopicsShown);
 const {data}=useInsightData<{ready:boolean;records:RecordTopic[]}>(!batch&&!shown&&full?'insights/record-topics?'+new URLSearchParams({ids:id,lang:language}):null);
 const record=batch?.get(id)||(data?.ready?data.records[0]:null);
 if(shown||!record)return null;
 return <TopicLine record={record} full={full} language={language}/>;
}
export function TopicLine({record,full=false,language='en'}:{record:RecordTopic;full?:boolean;language?:string}){
 const topic=record.topics[0],place=record.places[0];
 return <>{(topic||place)&&<div className="record-topics">{topic&&<><a href={topicsHref(topic.key)} lang={topic.language||language}>{topic.label}</a>{record.topics.length>1&&<span className="topic-muted"> +{record.topics.length-1}</span>}</>}{place&&<> <a href={topicsHref(place.key)} lang={place.language||language}>⌖ {place.label}</a></>}</div>}{full&&record.keywords.some(k=>k.featured)&&<p className="topic-muted"><UiMessage id="topics.keywordLine" values={{keywords:record.keywords.filter(k=>k.featured).slice(0,3).map((k,i)=><span key={k.key}>{i>0?' · ':''}<a href={topicsHref(k.key)} lang={k.language||language}>{k.label}</a></span>)}}/></p>}{full&&record.status==='pending'&&<p><UiMessage id="topics.pending"/></p>}</>;
}
export function QuestionOriginTag({id,place}:{id:string;place:string}){const records=useContext(Batch),record=records?.get(id);return record?.places.some(p=>p.id===place&&p.askers==='home')?<small className="topic-muted"><UiMessage id="topics.ownMepTag"/></small>:null;}
