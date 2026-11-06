import {lazy,Suspense,useState} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {CountryFilter} from './CountryFilter';
import {Result,VotePartDescriptions} from './MemberVoteSummary';
import {VoteView} from './VoteResult';
import {humanDate} from './InsightShared';
import {useDirectoryMembers,usePersonName} from './PersonName';
import {useData} from './data';
import {dossierBackHref,dossierLinkClick,useDossierReaderState} from './dossierJourney';
import {decisionVotesRoute,validateDecisionVotes} from './decisionVotesPresentation.mjs';
import {displayVoteTitle,memberVoteOutcome,memberVoteTotals} from './memberVotesPresentation.mjs';
import {dossierHref} from './followDossiers.mjs';
import {agendaItemHref,namedVoteFromDecision,voteHref,voteRowLabel,voteRowResult,voteSentence} from './votePagePresentation.mjs';
import type {DecisionVotesResponse,DecisionVoteSibling} from './DecisionVotesTypes';
import type {InsightProps} from './InsightTypes';
import './VotePage.css';

const DossierVoteText=lazy(()=>import('./DossierVoteText'));
const SIBLING_PREVIEW=10;

function OtherVotes({rows,current,language}:{rows:DecisionVoteSibling[];current:string;language:string}) {
  const ui=useUiI18n();
  const [all,setAll]=useState(false);
  const shown=all||rows.length<=SIBLING_PREVIEW ? rows : rows.slice(0,SIBLING_PREVIEW);
  return <section className="vote-page-others"><h2><UiMessage id="votepage.other_votes" values={{count:rows.length}}/></h2>
    <ul>{shown.map(row=>{
      const label=voteRowLabel(row,language,ui),result=voteRowResult(row,ui);
      const body=<><span className="vote-page-row-label" lang="">{label}</span><span className="vote-page-row-result"><span>{memberVoteOutcome(row,ui)}</span>{result&&<> · <span aria-label={result.label??undefined}>{result.text}</span></>}</span></>;
      return <li key={row.id}>{row.id===current ? <div className="vote-page-row" aria-current="page">{body}<small><UiMessage id="votepage.this_vote"/></small></div> : <a className="vote-page-row" href={voteHref(row.id,language)} onClick={dossierLinkClick}>{body}</a>}</li>;
    })}</ul>
    {shown.length<rows.length&&<button type="button" className="insight-text-button" onClick={()=>setAll(true)}><UiMessage id="votepage.show_all"/></button>}
  </section>;
}

export function VotePage({decisionId,language,onMember,country,onCountry}:{decisionId:string;language:string;onMember:InsightProps['onMember'];country:string|null;onCountry:(country:string|null)=>void}) {
  const ui=useUiI18n();
  const directory=useDirectoryMembers(),displayName=usePersonName();
  const route=decisionVotesRoute(decisionId,language);
  const request=useData<DecisionVotesResponse>(route,{unavailable:'votepage.unavailable'});
  const [textOpen,setTextOpen]=useDossierReaderState('vote-page-text:'+decisionId,false);
  const data=request.data&&validateDecisionVotes(request.data,decisionId) ? request.data : null;
  const loading=Boolean(route&&request.loading&&!data);
  const page=(children:React.ReactNode)=><article className="vote-page" lang={ui.language} data-vote-page={decisionId} data-vote-pending={loading ? 'true' : undefined}>{children}</article>;
  if(loading)return page(<h1 className="vote-page-placeholder" role="status" tabIndex={-1}><UiMessage id="votepage.loading"/></h1>);
  const vote=data?.decision;
  if(!data||data.status!=='found'||!vote)return page(<h1 tabIndex={-1}>{!route||data?.coverage==='complete' ? <UiMessage id="votepage.not_found"/> : <UiMessage id="votepage.unavailable"/>}</h1>);
  const subject=data.subject,agendaItem=subject?.agendaItemIds[0]??null;
  const itemTitle=subject?.title ? displayVoteTitle(subject.title) : null,itemLanguage=subject?.titleLanguage??'';
  const sentence=voteSentence(vote,{mainVoteId:data.mainVoteId,procedureReferral:data.procedureReferral,itemTitle,language},ui);
  const back=dossierBackHref();
  const named=vote.namedVoters?.available&&data.integrity!=='conflicting';
  const noList=!sentence.noNames&&!named&&vote.ballotStatus==='conducted';
  return page(<>
    {back ? <a className="vote-page-back" href={back} onClick={dossierLinkClick}><UiMessage id="dossieractivity.back_to_where_you_were"/></a> : (agendaItem&&<a className="vote-page-back" href={agendaItemHref(agendaItem,language)} onClick={dossierLinkClick}><UiMessage id="legislation.back_to_agenda.266ceb"/></a>)}
    <p className="vote-page-eyebrow"><time dateTime={vote.date} lang={language}>{humanDate(vote.date,language)}</time></p>
    {(itemTitle||subject?.procedures.length) ? <p className="vote-page-item">{itemTitle&&(agendaItem ? <a lang={itemLanguage} href={agendaItemHref(agendaItem,language)} onClick={dossierLinkClick}>{itemTitle}</a> : <span lang={itemLanguage}>{itemTitle}</span>)}{subject?.procedures.map(procedure=><a key={procedure.id} className="vote-page-reference" href={dossierHref(procedure.reference,language)} onClick={dossierLinkClick}>{procedure.reference}</a>)}</p> : null}
    <h1 tabIndex={-1}><UiMessage id={sentence.id} values={{...sentence.values,...(sentence.item ? {item:<span lang={itemLanguage}>{itemTitle}</span>} : {}),...(sentence.values.label ? {label:<span lang="">{sentence.values.label}</span>} : {})}}/>{sentence.noNames&&<> <UiMessage id="votepage.no_names"/></>}</h1>
    <VotePartDescriptions vote={vote} language={language} grouped/>
    {memberVoteTotals(vote)&&<Result vote={vote} showMissingTotals={false}/>}
    {named&&<section className="vote-page-groups"><h2><UiMessage id="legislation.how_meps_voted.789bfc"/></h2><div className="insight-controls insight-detail-country"><CountryFilter country={country} onChange={onCountry} language={language}/></div><VoteView standalone country={country} vote={namedVoteFromDecision(data,directory,id=>displayName(id))} language={language} onMember={onMember}/></section>}
    {(data.integrity==='conflicting'||noList)&&<p><UiMessage id="legislation.individual_votes_unavailable.ca5dc2"/></p>}
    {data.siblings.length>1&&<OtherVotes key={decisionId} rows={data.siblings} current={decisionId} language={language}/>}
    <details className="vote-page-text" open={textOpen} onToggle={event=>setTextOpen(event.currentTarget.open)}><summary><UiMessage id="votepage.read_text"/></summary>{textOpen&&<Suspense fallback={<p role="status"><UiMessage id="dossieractivity.loading_text"/></p>}><DossierVoteText key={decisionId+':'+language} vote={vote} language={language} showParts={false}/></Suspense>}</details>
  </>);
}
