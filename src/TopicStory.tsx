import {dossierLinkClick} from './dossierJourney';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {topicsHref,point,risers,placeValue,agendaTitle,monthRangeLabel} from './topicPresentation.mjs';
import type {TopicOverview} from './TopicsTypes';
import {recordHref} from './TopicsLinks';
// Keep the API-driven story independent of the map and chart layout.
export function TopicStory({data,index,mode,own}:{data:TopicOverview;index:number;mode:string;own:boolean}){
 const ui=useUiI18n();
 const period=data.periods[index],risings=risers(data,index,mode,own),leader=[...data.items].sort((a,b)=>placeValue(point(b,period),mode,own)-placeValue(point(a,period),mode,own))[0];
 if(!leader||!placeValue(point(leader,period),mode,own))return null;
 const leaders=data.items.filter(i=>placeValue(point(i,period),mode,own)===placeValue(point(leader,period),mode,own));
 const places=new Intl.ListFormat(ui.language==='en'?'en-GB':ui.locale,{type:'conjunction'}).formatToParts(leaders.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{link(leaders[Number(part.value)])}</span>:part.value);
 function link(item:typeof leader){return <a onClick={dossierLinkClick} href={topicsHref(item.key,{'t-q':period,'t-kind':mode==='d'?'document':'question','t-own':own?'1':'0','t-mode':mode})}>{item.label}</a>;}
 const rising=risings[0],risingPlaces=new Intl.ListFormat(ui.language==='en'?'en-GB':ui.locale,{type:'conjunction'}).formatToParts(risings.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{link(risings[Number(part.value)].item)}</span>:part.value);
 const candidate=mode==='d'&&risings.length===1&&rising&&point(rising.item,period).top;
 const quantity=(count:number)=><UiMessage id={mode==='d'?'topics.mapDocuments':'topics.story.count.questions'} values={{count}} counts={{count}}/>;
 // Only a real debate is named as the biggest debate; excluded voting-time groups are kind 'record'.
 const top=candidate&&candidate.key.startsWith('MTG-PL-')&&candidate.kind!=='record'&&candidate.title?candidate:null;
 return <p className="topic-story"><strong>{monthRangeLabel(period,ui.language)}: </strong>{rising?<UiMessage id={rising.average<0.5?(mode==='d'?(risings.length>1?'topics.rareTextsTiedCount':'topics.rareTextsCount'):risings.length>1?'topics.rareTiedCount':'topics.rareCount'):risings.length>1?'topics.roseTiedCount':'topics.roseCount'} values={{place:risingPlaces,quantity:quantity(rising.count),ratio:rising.ratio.toFixed(1)}}/>:<UiMessage id={leaders.length>1?'topics.mostTiedCount':'topics.mostCount'} values={{place:places,quantity:quantity(placeValue(point(leader,period),mode,own))}}/>}{top&&<> <UiMessage id="topics.biggest" values={{title:<a onClick={dossierLinkClick} href={recordHref(top.key)}>{agendaTitle(top.title||'')}</a>}}/></>}{rising&&!risings.some(r=>r.item.key===leader.key)&&<> <UiMessage id={leaders.length>1?'topics.overallTied':'topics.overall'} values={{place:places,count:placeValue(point(leader,period),mode,own)}}/></>}</p>;
}
