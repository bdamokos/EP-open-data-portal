import {useId,useState} from 'react';
import {useData} from './data';
import {PersonName} from './PersonName';
import {insightMemberHref} from './InsightShared';
import {groupLabel} from './InsightCharts';
import type {Amendment,AmendmentDecision} from './AmendmentTypes';
import type {DecisionVoter,DecisionVotesResponse} from './DecisionVotesTypes';
import {amendmentVoteBinding,authorVotePosition,decisionVotesRoute,validateDecisionVotes} from './decisionVotesPresentation.mjs';
import './AmendmentNamedVotes.css';

const choices=['for','against','abstaining'] as const;
const labels={for:'For',against:'Against',abstaining:'Abstain'};
const keyOf=(voter:DecisionVoter)=>voter.group?.groupId??'unavailable';
function NamedVoteRead({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const route=decisionVotesRoute(decision.id,language),request=useData<DecisionVotesResponse>(route),listId=useId();
  const [selection,setSelection]=useState<{group:string;position:typeof choices[number]}|null>(null),[showAll,setShowAll]=useState(false);
  const data=!request.error&&!request.loading&&validateDecisionVotes(request.data,decision.id)?request.data:null;
  const bound=data?.status==='found'&&amendmentVoteBinding(item,decision,data);
  if(request.loading)return <p role="status">Loading named votes…</p>;
  if(!data||data.status!=='found')return <p>Named votes unavailable. <button type="button" onClick={request.retry}>Retry</button></p>;
  if(!bound)return <p>Vote records differ.</p>;
  if(data.decision!.ballotStatus==='not-conducted')return <p>Not put to a vote.</p>;
  if(data.decision!.method&&data.decision!.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p>Not individually recorded.</p>;
  if(data.integrity==='unavailable'||data.integrity==='conflicting')return <p>Named votes unavailable. <button type="button" onClick={request.retry}>Retry</button></p>;
  const groups=[...new Map(data.voters.map(voter=>[keyOf(voter),voter.group?.code??null])).entries()].sort(([a,ac],[b,bc])=>a==='unavailable'?1:b==='unavailable'?-1:(ac??'').localeCompare(bc??'')||a.localeCompare(b));
  const authors=item.conflicted?[]:[...new Map((item.authors||[]).map((author,index)=>[author.personId?String(author.personId):'unresolved:'+index,author])).values()];
  const selected=data.integrity==='complete'&&selection?data.voters.filter(voter=>keyOf(voter)===selection.group&&voter.position===selection.position):[];
  const selectedCode=groups.find(([id])=>id===selection?.group)?.[1];
  return <div className="amendment-named-votes__body">
    {data.integrity==='partial'&&<p>Named list incomplete; group totals unavailable.</p>}
    {authors.length>0&&<section aria-label="Authors’ votes"><h6>Authors’ votes</h6><ul className="amendment-named-votes__authors">{authors.map((author,index)=>{const group=data.voters.find(voter=>voter.personId===String(author.personId))?.group;return <li key={index}><span><PersonName id={author.personId} label={author.name}/>{group&&<small lang=""> · {groupLabel(group.code)}</small>}</span><strong data-position={authorVotePosition(author.personId,data)}>{authorVotePosition(author.personId,data)}</strong></li>;})}</ul></section>}
    {data.integrity==='complete'&&<table><caption>Groups on <time dateTime={data.decision!.date} lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(data.decision!.date))}</time></caption><thead><tr><th scope="col">Group</th>{choices.map(position=><th scope="col" key={position}>{labels[position]}</th>)}</tr></thead><tbody>{groups.map(([group,code])=><tr key={group}><th scope="row" lang={code?'':'en'}>{code?groupLabel(code):'Group unavailable'}</th>{choices.map(position=>{
      const count=data.voters.filter(voter=>keyOf(voter)===group&&voter.position===position).length;
      return <td key={position}>{count?<button type="button" aria-label={`${code?groupLabel(code):'Group unavailable'}: ${labels[position]} · ${count}`} aria-controls={listId} aria-expanded={selection?.group===group&&selection.position===position} onClick={()=>{setSelection(selection?.group===group&&selection.position===position?null:{group,position});setShowAll(false);}}>{count.toLocaleString(language)}</button>:<span>0</span>}</td>;
    })}</tr>)}</tbody></table>}
    {selection&&selected.length>0&&<section id={listId} aria-label="Named voters" className="amendment-named-votes__people"><h6>{labels[selection.position]} · {selectedCode?groupLabel(selectedCode):'Group unavailable'} · {selected.length}</h6><ul>{(showAll?selected:selected.slice(0,12)).map(voter=><li key={voter.personId}><a href={insightMemberHref(voter.personId,language)}><PersonName id={voter.personId} fallback={'MEP '+voter.personId}/></a></li>)}</ul>{selected.length>12&&<button type="button" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer':`All ${selected.length} voters`}</button>}</section>}
    <details className="amendment-named-votes__sources"><summary>Vote sources</summary><a href={'https://data.europarl.europa.eu/eli/dl/event/'+decision.id} target="_blank" rel="noreferrer">Official decision ↗</a><ul>{data.decision!.sources.decisions.map((source,index)=><li key={index}><a href={source.url} target="_blank" rel="noreferrer">Decision source ↗</a> · <time>{source.fetchedAt}</time>{source.stale?' · saved source':''}<small lang="">{source.contentHash}</small></li>)}</ul></details>
  </div>;
}

export function AmendmentNamedVotes({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const [open,setOpen]=useState(false);
  if(['LAPSED','WITHDRAWN','CANCELLED','CANCELED','NOT_HELD'].includes(decision.outcome??''))return <p className="explorer-amendment-secondary">Not put to a vote.</p>;
  if(decision.method&&decision.method!=='VOTE_ELECTRONIC_ROLLCALL')return <p className="explorer-amendment-secondary">Not individually recorded.</p>;
  if(['unverified','unresolved-collective'].includes(decision.componentBinding??'')||decision.partNumber!=null&&!decision.partId||decision.partId&&decision.componentBinding!=='single-amendment')return null;
  if(!decisionVotesRoute(decision.id,language))return null;
  return <details className="amendment-named-votes" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Named votes</summary>{open&&<NamedVoteRead key={decision.id+':'+language} item={item} decision={decision} language={language}/>}</details>;
}
