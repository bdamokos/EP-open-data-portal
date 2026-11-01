import {dossierLinkClick} from './dossierJourney';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {topicsHref,point,riser,placeValue,agendaTitle} from './topicPresentation.mjs';
import type {TopicOverview} from './TopicsTypes';
import {recordHref} from './TopicsLinks';
// Keep the API-driven story independent of the map and chart layout.
export function TopicStory({data,index,mode,own}:{data:TopicOverview;index:number;mode:string;own:boolean}){
 const ui=useUiI18n();
 const period=data.periods[index],rising=riser(data,index,mode,own),leader=[...data.items].sort((a,b)=>placeValue(point(b,period),mode,own)-placeValue(point(a,period),mode,own))[0];
 if(!leader||!placeValue(point(leader,period),mode,own))return null;
 const leaders=data.items.filter(i=>placeValue(point(i,period),mode,own)===placeValue(point(leader,period),mode,own));
 const places=new Intl.ListFormat(ui.locale,{type:'conjunction'}).formatToParts(leaders.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{link(leaders[Number(part.value)])}</span>:part.value);
 function link(item:typeof leader){return <a onClick={dossierLinkClick} href={topicsHref(item.key,{'t-q':period,'t-kind':mode==='d'?'document':'question','t-own':own?'1':'0','t-mode':mode})}>{item.label}</a>;}
 const candidate=rising&&point(rising.item,period).top;
 const top=candidate&&candidate.key.startsWith('MTG-PL-')?candidate:null;
 return <p className="topic-story"><strong>{period.replace('-',' ')}: </strong>{rising?<UiMessage id="topics.rose" values={{place:link(rising.item),count:rising.count,ratio:rising.ratio.toFixed(1),unit:<UiMessage id={mode==='d'?'topics.documents':'topics.questions'}/>}}/>:<UiMessage id={leaders.length>1?'topics.mostTied':'topics.most'} values={{place:places,count:placeValue(point(leader,period),mode,own),unit:<UiMessage id={mode==='d'?'topics.documents':'topics.questions'}/>}}/>}{top&&<> <UiMessage id="topics.biggest" values={{title:<a onClick={dossierLinkClick} href={recordHref(top.key)}>{agendaTitle(top.title)}</a>}}/></>}{rising&&leader.key!==rising.item.key&&<> <UiMessage id={leaders.length>1?'topics.overallTied':'topics.overall'} values={{place:places,count:placeValue(point(leader,period),mode,own)}}/></>}</p>;
}
