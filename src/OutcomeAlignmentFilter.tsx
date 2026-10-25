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
    <p id={id} className="member-votes-muted">{counts===null?'Counts unavailable':`Counts ${scope}${coverage==='partial'?' · Partial coverage':''}`}</p>
  </div>;
}
