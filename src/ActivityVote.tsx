import type {ReactNode} from 'react';
import {useData} from './data';
import type {MemberVotesResponse} from './MemberVotesTypes';
import {memberVotesRoute,validateMemberVotesResponse,votingRecordUrl} from './memberVotesPresentation.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import {Position,Result} from './MemberVoteSummary';
import {selectLanguageText} from './language.mjs';
import './ActivityVote.css';

/** Only exact indexed decision identities connect activity results to named ballots. */
export function ActivityVote({decisionId,memberId,memberName,language,children}:{decisionId?:string|null;memberId?:string|number;memberName?:string;language:string;children?:ReactNode}) {
  const match=typeof decisionId==='string'?decisionId.match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?(?:eli\/dl\/event\/)?(MTG-PL-\d{4}-\d{2}-\d{2})-DEC-(\d+)$/):null;
  const id=match?match[1]+'-DEC-'+match[2]:null;
  const state={sittingId:match?.[1]??null,decisionId:id,positions:'all' as const,alignment:'all' as const,offset:0};
  let route:string|null=null;
  try {if(id&&memberId)route=memberVotesRoute(memberId,state,language);}catch {/* Invalid identities never start a read. */}
  const response=useData<MemberVotesResponse>(route);
  const data=route&&response.data&&validateMemberVotesResponse(response.data,{memberId:String(memberId),state})?response.data:null;
  // A failed revalidation cannot keep a previously observed named ballot authoritative.
  const vote=!response.error&&data?.selected.status==='found'?data.selected.item:null;
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
  const method=vote?({VOTE_HAND:'Show of hands',VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',VOTE_ELECTRONIC:'Electronic vote',VOTE_SECRET:'Secret ballot',VOTE_SECRET_BALLOT:'Secret ballot'}[vote.method||'']):null;
  const noIndividualPositions=vote?.ballotStatus==='conducted'&&['VOTE_HAND','VOTE_SECRET','VOTE_SECRET_BALLOT'].includes(vote.method||'');
  const requesters=vote?.rollCallRequesters.map(requester=>selectLanguageText(requester.organizationLabels,language)).filter(label=>label.text)||[];
  return <div className="activity-vote" lang="en">
    {vote?<>
      <p className="activity-vote__meta"><span lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(vote.date))}</span>{method?' · '+method:''}</p>
      <div className="member-votes-strip" aria-label="Member position and Parliament result">{noIndividualPositions?<span className="member-votes-position"><span className="member-votes-position-label">{memberName||'Selected MEP'}</span><strong>No individual ballot</strong></span>:<Position vote={vote} memberName={memberName||'Selected MEP'}/>}<Result vote={vote} showMissingTotals={vote.method!=='VOTE_HAND'}/>
        {vote.intention.status==='reported'&&vote.intention.positions.length>0&&<p className="member-votes-intention">Declared intention: <strong>{vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}</strong>. Declared afterwards; the official result and totals are unchanged.</p>}
      </div>
      {noIndividualPositions&&<p className="activity-vote__meta">Individual positions are not recorded for this voting method.</p>}
      {vote.parts.map(part=>{
        const text=selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
        return text.text?<p className="activity-vote__part" key={part.componentId} lang={text.language}>{text.text}</p>:null;
      })}
      {requesters.length>0&&<p className="activity-vote__meta">Roll call requested by {requesters.map((label,index)=><span key={index} lang={label.language}>{index?', ':''}{label.text}</span>)}.</p>}
    </>:children}
    {response.loading&&!vote&&<p className="activity-vote__meta" role="status">Loading member’s vote…</p>}
    {!response.loading&&!vote&&<p className="activity-vote__meta">{response.error||response.data&&!data?'Additional vote details could not be loaded.':'No additional details were found for this decision.'} <button type="button" onClick={response.retry}>Retry vote details</button></p>}
    <div className="activity-vote__links">{href&&<a href={href}>View vote details</a>}{record&&<a href={record} target="_blank" rel="noreferrer">Parliament’s voting record ↗</a>}</div>
  </div>;
}
