import {useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {procedureReferences,resultLine,resultText,validWeekResults,weekResultsRoute} from './weekSummaryPresentation.mjs';
import type {AgendaTopic,WeekResultsResponse} from './LegislationTypes';
import './AgendaRowResult.css';

export type WeekResults={data:WeekResultsResponse|null;error:string|null};

export function useWeekResults(week:string|null,language:string):WeekResults {
  const {data,error}=useInsightData<WeekResultsResponse>(week?weekResultsRoute(week,language):null);
  return validWeekResults(data)?{data,error}:{data:null,error:error??(data?'invalid':null)};
}

/** The result under a vote's title in the agenda list. */
export function AgendaRowResult({topic,results,upcoming,language}:{topic:AgendaTopic;results:WeekResults;upcoming:boolean;language:string}) {
  const ui=useUiI18n();
  if(upcoming){
    const references=procedureReferences(topic);
    return references.length?<small className="week-row-result">{references.join(', ')}</small>:null;
  }
  const entry=results.data?.items.find(item=>item.agendaItemId===topic.id);
  if(topic.kind!=='PLENARY_VOTE'||!entry)return null;
  return <small className="week-row-result" lang={ui.language}>{resultText(resultLine(entry,ui))}</small>;
}
