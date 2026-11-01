import {dossierLinkClick} from './dossierJourney';
import {worldMap} from './worldMap';
import {mapCode,point,placeValue,topicsHref} from './topicPresentation.mjs';
import {useUiI18n,UiMessage} from './UiI18nReact';
import type {TopicOverview} from './TopicsTypes';
export default function PlacesMap({data,period,mode,own,zoom,pause}:{data:TopicOverview;period:string;mode:string;own:boolean;zoom:string;pause:()=>void}){
 const ui=useUiI18n(),byIso=new Map(data.items.map(i=>[mapCode(i.iso3),i])),max=Math.max(1,...data.items.map(i=>placeValue(point(i,period),mode,own)));
 return <div className="places-map"><svg viewBox={zoom==='eu'?'428 12 236 140':'0 0 1000 487'} aria-label={ui.t('topics.places')} role="img">{worldMap.countries.map(c=>{const item=['CYN','SOL'].includes(c.code)?null:byIso.get(c.code),s=point(item,period),n=placeValue(s,mode,own),fill=n?`color-mix(in srgb, var(--accent) ${20+80*Math.sqrt(n/max)}%, var(--surface))`:'var(--surface-3)',shape=c.path?<path d={c.path}/>:<circle cx={'x' in c?c.x:0} cy={'y' in c?c.y:0} r={2}/>;return item?<a id={'map-country-'+c.code} key={c.code} href={topicsHref(item.key,{'t-q':period,'t-kind':mode==='d'?'document':'question','t-own':own?'1':'0','t-mode':mode})} onClick={e=>{pause();dossierLinkClick(e);}} style={{fill}}><title>{ui.t('topics.mapValue',{place:item.label,period:period.replace('-',' '),count:n,documents:s.document||0,unit:ui.t(mode==='d'?'topics.documents':'topics.questions')})}</title>{shape}</a>:<g key={c.code} style={{fill}}>{shape}</g>;})}</svg><div className="topic-legend"><span>1</span><span className="topic-gradient"/><span>{max}</span><UiMessage id={mode==='d'?'topics.documentsQuarter':'topics.questionsQuarter'}/></div><small className="topic-muted">Natural Earth</small></div>;
}
