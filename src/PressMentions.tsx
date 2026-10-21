import {useId} from 'react';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';

type PressItem={id:string;url:string;title:string|null;titleLanguage:string;publishedAt:string|null;links:{kind:'procedure'|'summary'|'document';value:string;label:string|null}[]};
type Press={reference:string;items:PressItem[];total:number;coverage:{complete:false;followingSince:string|null;procedureLinks:{status:'available'|'unavailable'}}};
const brusselsDay=(instant:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));

// Press releases whose own “Further information” list links this dossier.
// Following began recently and the feeds hold only recent releases.
export function PressMentions({reference,language,limit}:{reference:string;language:string;limit:number}) {
  const headingId=useId(),state=useInsightData<Press>('insights/press-releases?'+new URLSearchParams({reference,lang:language}));
  const data=state.data?.reference===reference?state.data:null;
  // A failed read is reported; an empty result shows nothing, which claims no absence.
  if(!data&&state.error)return <p className="press-mentions-scope" role="status" lang="en">Parliament press releases are temporarily unavailable. <button type="button" className="insight-text-button" onClick={state.retry}>Try again</button></p>;
  if(!data?.items.length)return null;
  const shown=data.items.slice(0,limit),since=data.coverage.followingSince;
  return <section className="press-mentions" aria-labelledby={headingId} lang="en">
    <h4 id={headingId}>Parliament press releases{data.total>shown.length&&<small> · latest {shown.length} of {data.total}</small>}</h4>
    <ul>{shown.map(item=><li key={item.id}>
      <a href={item.url} target="_blank" rel="noreferrer"><span lang={item.titleLanguage}>{item.title||item.id}</span><span aria-hidden="true">↗</span></a>
      {item.publishedAt&&<small><time dateTime={item.publishedAt} lang={language}>{humanDate(brusselsDay(item.publishedAt),language)}</time></small>}
    </li>)}</ul>
    <p className="press-mentions-scope">Releases that link this dossier in their “Further information” list, from Parliament’s English press feeds{since&&<> since <time dateTime={since} lang={language}>{humanDate(brusselsDay(since),language)}</time></>}. Not a complete list{data.coverage.procedureLinks.status==='unavailable'?'; links through Legislative Observatory summaries and documents could not be checked':''}.</p>
  </section>;
}
