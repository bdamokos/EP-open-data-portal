import type {ReactNode} from 'react';
import {UiMessage} from './UiI18nReact';
import {VoteMark} from './VoteMark';
import {votePositionKeys,type VotePosition} from './votePositions';

type Tally=Partial<Record<VotePosition,number|null>>;
const column={for:'f',against:'a',abstaining:'x'} as const;
const headId={for:'votepage.head.for',against:'votepage.head.against',abstaining:'votepage.head.abstain'} as const;

// Three numbers on three columns. Unknown is a dash, zero is zero. `cells` when they sit in an ARIA table row.
export function TallyNumbers({totals,bold=null,cells=false}:{totals:Tally;bold?:VotePosition|null;cells?:boolean}) {
  return <>{votePositionKeys.map(position=>{
    const value=totals[position];
    return <span key={position} role={cells?'cell':undefined} className={['n',column[position],value===null||value===undefined?'unk':'',value===0?'zero':'',bold===position?'maj':''].filter(Boolean).join(' ')}>{value===null||value===undefined?'–':value}</span>;
  })}</>;
}
export const headMessageId=(position:VotePosition)=>headId[position];
// The one row: title with sub-line, result word, three numbers. The only way a tally appears in a list.
// `across` takes the number columns where there is no count: "Show of hands", or the tally in words.
export function VoteRow({title,sub,word,rejected=false,totals,across,tight=false,className=''}:{title:ReactNode;sub?:ReactNode;word?:ReactNode;rejected?:boolean;totals?:Tally|null;across?:ReactNode;tight?:boolean;className?:string}) {
  return <div className={['row',tight?'tight':'',className].filter(Boolean).join(' ')}>
    <span className="main">{title}{sub&&<span className="sub">{sub}</span>}</span>
    {word&&<span className={rejected?'w no':'w'}>{word}</span>}
    {totals&&<TallyNumbers totals={totals}/>}
    {!totals&&across&&<span className={word?'span':'span wordy'}>{across}</span>}
  </div>;
}
// A mark and head word above the number columns: the chart's legend.
export function TallyHeads({heading}:{heading:ReactNode}) {
  return <div className="heads static"><span className="main">{heading}</span>{votePositionKeys.map(position=><span key={position} className={'n hd '+column[position]}><VoteMark position={position}/><UiMessage id={headId[position]}/></span>)}</div>;
}
// One large total on its column. Colour appears only here and on marks.
export function TotalFigure({position,value}:{position:VotePosition;value:number|null}) {
  return <><small className="hd"><VoteMark position={position}/><UiMessage id={headId[position]}/></small><b className={value===null?'unk':'c-'+position}>{value??'–'}</b></>;
}
// Large totals on the same three columns as every row.
export function TotalsFigures({totals,label}:{totals:Record<VotePosition,number>;label?:ReactNode}) {
  return <div className="row total bare"><span className="main two">{label&&<span className="meta">{label}</span>}</span>{votePositionKeys.map(position=><span key={position} className={'n fig '+column[position]}><TotalFigure position={position} value={totals[position]}/></span>)}</div>;
}
