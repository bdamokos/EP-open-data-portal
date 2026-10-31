import {UiMessage, useUiI18n} from './UiI18nReact';
import {useId} from 'react';
export type OutcomeAlignment='all'|'against'|'with'|'abstained';
export type AlignmentCounts={with:number;against:number;abstained:number;unclassified:number}|null;
export function OutcomeAlignmentFilter({value,counts,coverage,sitting,onChange}:{value:OutcomeAlignment;counts:AlignmentCounts;coverage:'complete'|'partial'|'unavailable';sitting:boolean;onChange:(value:OutcomeAlignment)=>void}){
  const ui = useUiI18n();
  const id=useId();
  const choices=[['all',ui.t("dossieractivity.all")],['against',ui.t("outcomealignmentfilter.against_the_outcome")],['with',ui.t("outcomealignmentfilter.with_the_outcome")],['abstained',ui.t("membervotespresentation.abstained")]] as const;
  return <div className="member-votes-alignment">
    <div className="member-votes-filter member-votes-alignment-controls" role="group" aria-label={ui.t("outcomealignmentfilter.agreement_with_parliament_s_outcome")} aria-describedby={id}>
      {choices.map(([key,label])=><button type="button" key={key} data-vote-alignment={key} aria-pressed={value===key} onClick={()=>onChange(key)}>{label}{key!=='all'&&` (${(counts===null) ? ui.t('grouplabels.ts.unavailable') : counts[key]})`}</button>)}
    </div>
    <p id={id} className="member-votes-muted">{(counts===null) ? ui.t("outcomealignmentfilter.counts_unavailable") : ui.t(sitting ? 'outcomealignmentfilter.counts_on_this_sitting_day' : 'outcomealignmentfilter.counts_in_this_week')}</p>
  </div>;
}
