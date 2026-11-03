import {defaultUi} from './uiDefault.mjs';
import {useEffect} from 'react';
import {storyLinkClick,focusStoryLink} from './storyLinkNavigation';
import {dossierLinkClick} from './dossierJourney';
import {UiI18nProvider,UiMessage,useUiI18n} from './UiI18nReact';
import {topicsHref,point,risers,placeValue,agendaTitle,monthRangeLabel} from './topicPresentation.mjs';
import type {TopicOverview} from './TopicsTypes';
import {storySetKey} from './storyLinkModel.mjs';
import {recordHref,storyInterfaceHref} from './TopicsLinks';
// Keep the API-driven story independent of the map and chart layout.
export function TopicStory({data,index,mode,own,zoom='world'}:{data:TopicOverview;index:number;mode:string;own:boolean;zoom?:string}){
 const requestedUi=useUiI18n();
 const period=data.periods[index];
 useEffect(()=>focusStoryLink(),[period,mode,own,zoom]);
 const risings=risers(data,index,mode,own),leader=[...data.items].sort((a,b)=>placeValue(point(b,period),mode,own)-placeValue(point(a,period),mode,own))[0];
 if(!leader||!placeValue(point(leader,period),mode,own))return null;
 const leaders=data.items.filter(i=>placeValue(point(i,period),mode,own)===placeValue(point(leader,period),mode,own));
 const rising=risings[0],candidate=mode==='d'&&risings.length===1&&rising&&point(rising.item,period).top;
 const top=candidate&&candidate.key.startsWith('MTG-PL-')&&candidate.kind!=='record'&&candidate.title?candidate:null;
 const parentId=rising?rising.average<0.5?(mode==='d'?(risings.length>1?'topics.rareTextsTiedCount':'topics.rareTextsCount'):risings.length>1?'topics.rareTiedCount':'topics.rareCount'):risings.length>1?'topics.roseTiedCount':'topics.roseCount':leaders.length>1?'topics.mostTiedCount':'topics.mostCount';
 const overallId=leaders.length>1?'topics.overallTied':'topics.overall',hasOverall=rising&&!risings.some(r=>r.item.key===leader.key);
 const ids=[parentId,mode==='d'?'topics.mapDocuments':'topics.story.count.questions',...(top?['topics.biggest']:[]),...(hasOverall?[overallId]:[])];
 const ui=ids.every(id=>requestedUi.messageLocale(id)===requestedUi.locale)?requestedUi:defaultUi,proseI18n={sourceLocale:'en',forLocale:()=>ui};
 const places=new Intl.ListFormat(ui.language==='en'?'en-GB':ui.locale,{type:'conjunction'}).formatToParts(leaders.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{leaders[Number(part.value)].label}</span>:part.value);
 const risingPlaces=new Intl.ListFormat(ui.language==='en'?'en-GB':ui.locale,{type:'conjunction'}).formatToParts(risings.map((_,i)=>String(i))).map((part,i)=>part.type==='element'?<span key={i}>{risings[Number(part.value)].item.label}</span>:part.value);
 const quantity=(count:number,claimPlaces:typeof leaders)=>{if(mode==='d')return <UiMessage id="topics.mapDocuments" values={{count}} counts={{count}}/>;const scope=claimPlaces.map(i=>i.key.replace(/^place:/,'')).sort().join(',');const key=storySetKey({text:'',records:[],browse:{list:'questions',places:scope}},{period,excludeOwn:own,mode,zoom});const pageName=ui.t(claimPlaces.length>1?'topics.story.links.tieHeading':'topics.story.links.heading',{count,kind:ui.t('topics.story.links.kind.questions',{count},{count}),place:claimPlaces[0].label,places:new Intl.ListFormat(ui.locale,{type:'conjunction'}).format(claimPlaces.map(p=>p.label))}),visible=ui.t('topics.story.count.questions',{count},{count}),accessible=(pageName.toLocaleLowerCase().includes(visible.toLocaleLowerCase())?pageName:visible+', '+pageName)+', '+monthRangeLabel(period,ui.language);return <a id={'story-link-'+encodeURIComponent(key)} onClick={e=>storyLinkClick(e,'story-link-'+encodeURIComponent(key))} aria-label={accessible} href={storyInterfaceHref('?'+new URLSearchParams({view:'geopolitics','t-q':period,'t-own':own?'1':'0','t-mode':mode,'t-zoom':zoom,'t-records':key}),requestedUi.locale)}><UiMessage id={mode==='d'?'topics.mapDocuments':'topics.story.count.questions'} values={{count}} counts={{count}}/></a>;};
 // Only a real debate is named as the biggest debate; excluded voting-time groups are kind 'record'.
 return <p className="topic-story" lang={ui.language}><UiI18nProvider i18n={proseI18n}><strong>{monthRangeLabel(period,ui.language)}: </strong>{rising?<UiMessage id={rising.average<0.5?(mode==='d'?(risings.length>1?'topics.rareTextsTiedCount':'topics.rareTextsCount'):risings.length>1?'topics.rareTiedCount':'topics.rareCount'):risings.length>1?'topics.roseTiedCount':'topics.roseCount'} values={{place:risingPlaces,quantity:quantity(rising.count,risings.map(r=>r.item)),ratio:new Intl.NumberFormat(ui.locale,{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:false}).format(rising.ratio)}}/>:<UiMessage id={leaders.length>1?'topics.mostTiedCount':'topics.mostCount'} values={{place:places,quantity:quantity(placeValue(point(leader,period),mode,own),leaders)}}/>}{top&&<> <UiMessage id="topics.biggest" values={{title:<a onClick={dossierLinkClick} href={storyInterfaceHref(recordHref(top.key),requestedUi.locale)}>{agendaTitle(top.title||'')}</a>}}/></>}{rising&&!risings.some(r=>r.item.key===leader.key)&&<> <UiMessage id={leaders.length>1?'topics.overallTied':'topics.overall'} values={{place:places,count:quantity(placeValue(point(leader,period),mode,own),leaders)}}/></>}</UiI18nProvider></p>;
}
