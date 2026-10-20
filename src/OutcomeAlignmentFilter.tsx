import {useId} from 'react';
export type OutcomeAlignment='all'|'against'|'with'|'abstained';
export type AlignmentCounts={with:number;against:number;abstained:number;unclassified:number}|null;
export function OutcomeAlignmentFilter({value,counts,coverage,sitting,onChange}:{value:OutcomeAlignment;counts:AlignmentCounts;coverage:'complete'|'partial'|'unavailable';sitting:boolean;onChange:(value:OutcomeAlignment)=>void}){
  const id=useId(),scope=sitting?'on this sitting day':'in this week';
  const choices=[['all','All'],['against','Against the outcome'],['with','With the outcome'],['abstained','Abstained']] as const;
  return <div className="member-votes-alignment">
    <div className="member-votes-filter member-votes-alignment-controls" role="group" aria-label="Agreement with Parliament’s outcome" aria-describedby={id}>
      {choices.map(([key,label])=><button type="button" key={key} data-vote-alignment={key} aria-pressed={value===key} onClick={()=>onChange(key)}>{label}{key!=='all'&&` (${counts===null?'unavailable':counts[key]})`}</button>)}
    </div>
    <p id={id} className="member-votes-muted">{counts===null?'Counts unavailable':`Counts ${coverage==='partial'?'among available records ':''}${scope}, before filters and pagination.`}</p>
    <details><summary>How agreement with Parliament’s outcome is classified</summary><p>With the outcome: recorded For on an adopted decision, or Against on a rejected decision. Against the outcome: recorded For on a rejected decision, or Against on an adopted decision. Abstained: recorded abstention on an adopted or rejected decision.</p><p>Classification requires a conducted ballot and uses Parliament’s official outcome, which may require a special majority. Declared intentions never count. Missing, unavailable or conflicting positions, unheld ballots and other outcomes remain unclassified. This comparison covers the selected week or sitting day; historical political group membership is not collected.</p></details>
  </div>;
}
