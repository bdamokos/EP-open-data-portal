import {UiMessage} from './UiI18nReact';
import {topicsHref,point,riser,placeValue} from './topicPresentation.mjs';
import type {TopicOverview} from './TopicsTypes';
import {recordHref} from './TopicsLinks';
// Keep the API-driven story independent of the map and chart layout.
export function TopicStory({data,index,mode,own}:{data:TopicOverview;index:number;mode:string;own:boolean}){
 const period=data.periods[index],rising=riser(data,index,mode,own),leader=[...data.items].sort((a,b)=>placeValue(point(b,period),mode,own)-placeValue(point(a,period),mode,own))[0];
 if(!leader)return null;
 const link=(item:typeof leader)=><a href={topicsHref(item.key,{'t-q':period,'t-kind':mode==='d'?'document':'question','t-own':own?'1':'0','t-mode':mode})}>{item.label}</a>;
 const candidate=rising&&point(rising.item,period).top;
 const top=candidate&&candidate.key.startsWith('MTG-PL-')?candidate:null;
 return <p className="topic-story"><strong>{period.replace('-',' ')}: </strong>{rising?<UiMessage id="topics.rose" values={{place:link(rising.item),count:rising.count,ratio:rising.ratio.toFixed(1),unit:<UiMessage id={mode==='d'?'topics.documents':'topics.questions'}/>}}/>:<UiMessage id="topics.most" values={{place:link(leader),count:placeValue(point(leader,period),mode,own),unit:<UiMessage id={mode==='d'?'topics.documents':'topics.questions'}/>}}/>}{top&&<> <UiMessage id="topics.biggest" values={{title:<a href={recordHref(top.key)}>{top.title}</a>}}/></>}{rising&&leader.key!==rising.item.key&&<> <UiMessage id="topics.overall" values={{place:link(leader),count:placeValue(point(leader,period),mode,own)}}/></>}</p>;
}
