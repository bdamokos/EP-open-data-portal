import {voteMethodLabel} from './voteMethod.mjs';
import type {ReactNode} from 'react';
import {useData} from './data';
import type {MemberVotesResponse,MemberVote} from './MemberVotesTypes';
import {memberVotesRoute,validateMemberVotesResponse,votingRecordUrl} from './memberVotesPresentation.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import {Position,Result} from './MemberVoteSummary';
import {selectLanguageText} from './language.mjs';
import './ActivityVote.css';

type IndexedResult={outcome?:string|null;method?:string|null;totals?:{for?:number|null;against?:number|null;abstaining?:number|null}|null};

/** Only exact indexed decision identities connect activity results to named ballots. */
export function ActivityVote({decisionId,memberId,memberName,language,children,indexed}:{decisionId?:string|null;memberId?:string|number;memberName?:string;language:string;children?:ReactNode;indexed?:IndexedResult}) {
  const match=typeof decisionId==='string'?decisionId.match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?(?:eli\/dl\/event\/)?(MTG-PL-\d{4}-\d{2}-\d{2})-DEC-(\d+)$/):null;
  const id=match?match[1]+'-DEC-'+match[2]:null;
  const state={sittingId:match?.[1]??null,decisionId:id,positions:'all' as const,alignment:'all' as const,offset:0};
  let route:string|null=null;
  try {if(id&&memberId)route=memberVotesRoute(memberId,state,language);}catch {/* Invalid identities never start a read. */}
  const response=useData<MemberVotesResponse>(route);
  const data=route&&response.data&&validateMemberVotesResponse(response.data,{memberId:String(memberId),state})?response.data:null;
  // A failed revalidation cannot keep a previously observed named ballot authoritative.
  const observed=!response.error&&data?.selected.status==='found'?data.selected.item:null;
  const indexedBallot=indexed?.outcome&&['ADOPTED','REJECTED'].includes(indexed.outcome)?'conducted':indexed?.outcome&&['LAPSED','WITHDRAWN','CANCELLED'].includes(indexed.outcome)?'not-conducted':null;
  const ballotConflict=Boolean(observed&&indexedBallot&&(observed.ballotStatus!=='unknown'&&observed.ballotStatus!==indexedBallot||indexedBallot==='not-conducted'&&observed.actualPosition.status==='recorded'));
  const conflict=ballotConflict||Boolean(observed&&indexed&&(['outcome','method'] as const).some(key=>observed[key]&&indexed[key]&&observed[key]!==indexed[key])||observed&&indexed?.totals&&(['for','against','abstaining'] as const).some(key=>observed.totals[key]!=null&&indexed.totals?.[key]!=null&&observed.totals[key]!==indexed.totals[key]));
  const sourceConflict=Boolean(observed?.sourceConflicts);
  // Missing fields do not revoke a saved observation. Explicit contradictory
  // observations must stay separate and never fill a source-conflict shell.
  const retained=Boolean(observed&&indexed&&!sourceConflict&&!conflict&&((!observed.outcome&&indexed.outcome)||(!observed.method&&indexed.method)||(['for','against','abstaining'] as const).some(key=>observed.totals[key]==null&&indexed.totals?.[key]!=null)));
  const vote:MemberVote|null=observed&&retained?{...observed,outcome:observed.outcome||indexed!.outcome||null,method:observed.method||indexed!.method||null,
    ballotStatus:observed.ballotStatus==='unknown'?(indexedBallot??'unknown'):observed.ballotStatus,
    totals:Object.fromEntries((['for','against','abstaining'] as const).map(key=>[key,observed.totals[key]??indexed!.totals?.[key]??null])) as MemberVote['totals']}:observed;
  let href:string|null=null;
  if(route&&typeof window!=='undefined') {
    const url=new URL(window.location.href);
    for(const key of [...url.searchParams.keys()])if(key.startsWith('mv-'))url.searchParams.delete(key);
    url.searchParams.set('member',String(memberId));url.searchParams.set('module','votes');
    const journey={memberId:Number(memberId),state:{...state,week:'latest',snapshotId:null,expandedSubjectIds:[],context:null},adoptedId:null,invalid:false};
    for(const [key,value] of memberVotesJourneyParams(journey))url.searchParams.set(key,value);
    href=url.href;
  }
  if(!route)return <>{children}</>;
  const record=vote?votingRecordUrl(vote):null;
  const method=vote?voteMethodLabel(vote.method):null;
  const requesters=vote?.rollCallRequesters.map(requester=>selectLanguageText(requester.organizationLabels,language)).filter(label=>label.text)||[];
  return <div className="activity-vote" lang="en">
    {(conflict||sourceConflict)&&<div className="activity-vote__meta"><p>{sourceConflict?'Current vote sources disagree. The saved activity result is shown separately.':'The saved activity result differs from the current voting record. The current record is shown below.'}</p><div aria-label="Saved activity result">{children}</div></div>}
    {vote?<>
      {retained&&<p className="activity-vote__meta">Some result details are retained from the saved activity record.</p>}
      <p className="activity-vote__meta"><span lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(vote.date))}</span>{method?' · '+method:''}</p>
      <div className="member-votes-strip" aria-label="Member position and Parliament result"><Position vote={vote} memberName={memberName||'Selected MEP'}/><Result vote={vote} showPartialTotals/>
        {vote.intention.status==='reported'&&vote.intention.positions.length>0&&<p className="member-votes-intention">Declared intention: <strong>{vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}</strong>. Declared afterwards; the official result and totals are unchanged.</p>}
      </div>
      {vote.parts.map(part=>{
        const text=selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
        return text.text?<p className="activity-vote__part" key={part.componentId} lang={text.language}>{text.text}</p>:null;
      })}
      {requesters.length>0&&<p className="activity-vote__meta">Roll call requested by {requesters.map((label,index)=><span key={index} lang={label.language}>{index?', ':''}{label.text}</span>)}.</p>}
    </>:children}
    {response.loading&&!vote&&<p className="activity-vote__meta" role="status">Loading member’s vote…</p>}
    {!response.loading&&!vote&&<p className="activity-vote__meta">{response.error||response.data&&!data||data?.coverage.status!=='complete'||data?.selected.status==='unavailable'?'Additional vote details could not be loaded.':'No additional details were found for this decision.'} <button type="button" onClick={response.retry}>Retry vote details</button></p>}
    <div className="activity-vote__links">{href&&<a href={href}>View vote details</a>}{record&&<a href={record} target="_blank" rel="noreferrer">Parliament’s voting record ↗</a>}</div>
  </div>;
}
