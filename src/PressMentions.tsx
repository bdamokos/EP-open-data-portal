import {UiMessage, useUiI18n} from './UiI18nReact';
import {useId} from 'react';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';

type PressItem={id:string;url:string;title:string|null;titleLanguage:string;publishedAt:string|null;links:{kind:'procedure'|'summary'|'document';value:string;label:string|null}[]};
type Press={reference:string;items:PressItem[];total:number};
const brusselsDay=(instant:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));

// Press releases whose own “Further information” list links this dossier.
// Following began recently and the feeds hold only recent releases.
export function PressMentions({reference,language,limit}:{reference:string;language:string;limit:number}) {
  const ui = useUiI18n();
  const headingId=useId(),state=useInsightData<Press>('insights/press-releases?'+new URLSearchParams({reference,lang:language}));
  const data=(state.data?.reference===reference) ? state.data : null;
  // A failed read is reported; an empty result shows nothing, which claims no absence.
  if(!data&&state.error)return <p className="press-mentions-scope" role="status" lang={ui.language}><UiMessage id="batch4.pressmentions.tsx.15.1"/> <button type="button" className="insight-text-button" onClick={state.retry}><UiMessage id="commissionfollowups.try_again"/></button></p>;
  if(!data?.items.length)return null;
  const shown=data.items.slice(0,limit);
  return <section className="press-mentions" aria-labelledby={headingId} lang={ui.language}>
    <h4 id={headingId}>{(data.total>shown.length) ? <UiMessage id="batch4.pressmentions.tsx.19.2" values={{shown:shown.length,total:data.total}}/> : <UiMessage id="batch4.pressmentions.tsx.19.1"/>}</h4>
    <ul>{shown.map(item=><li key={item.id}>
      <a href={item.url} target="_blank" rel="noreferrer"><span lang={item.titleLanguage}>{item.title||item.id}</span><span aria-hidden="true">↗</span></a>
      {item.publishedAt&&<small><time dateTime={item.publishedAt} lang={language}>{humanDate(brusselsDay(item.publishedAt),language)}</time></small>}
    </li>)}</ul>
  </section>;
}
