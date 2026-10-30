import {useLayoutEffect,useRef,useState} from 'react';
import {DocumentContextReader} from './DocumentContextReader';
import {MemberVoteWording,type MemberVotesContext} from './MemberVotes';
import {VotePartDescriptions} from './MemberVoteSummary';
import {exactAmendmentTargets,topLevelVoteDocuments} from './memberVotesPresentation.mjs';
import type {MemberVote} from './MemberVotesTypes';

export default function DossierVoteText({vote,language}:{vote:MemberVote;language:string}) {
  const [context,setContext]=useState<MemberVotesContext|null>(null);
  const origin=useRef<HTMLElement|null>(null);
  const reader=useRef<HTMLDivElement|null>(null);
  const openContext=(next:MemberVotesContext)=>{origin.current=document.activeElement as HTMLElement;setContext(next);};
  const closeContext=()=>{setContext(null);window.requestAnimationFrame(()=>origin.current?.focus());};
  const targets=exactAmendmentTargets(vote),documents=topLevelVoteDocuments(vote);
  useLayoutEffect(()=>{if(context)reader.current?.querySelector<HTMLButtonElement>('.document-context-back')?.focus();},[context]);
  return <div className="dossier-vote-text">
    <div hidden={Boolean(context)}>
      <VotePartDescriptions vote={vote} language={language}/>
      {targets.map(target=><MemberVoteWording key={target.amendmentId+':'+language} {...target} language={language} openContext={openContext}/>)}
      {!targets.length&&Boolean(vote.context.amendmentIds.length)&&<p>Amendment wording unavailable.</p>}
      {!targets.length&&vote.scope.kind==='procedural'&&<p lang={vote.titleLanguage??''}>{vote.title}</p>}
      {documents.map(documentId=><button type="button" key={documentId} onClick={()=>openContext({documentId,view:'document'})}>Read {documentId.startsWith('A-')?'report':documentId.startsWith('RC-')?'joint motion':documentId.startsWith('TA-')?'adopted text':'motion'}{documents.length>1?' · '+documentId:''}</button>)}
      {!targets.length&&!documents.length&&!vote.parts.length&&vote.scope.kind!=='procedural'&&<p>Text unavailable.</p>}
    </div>
    {context&&<div ref={reader}><DocumentContextReader showOriginalLink={false} request={{...context,onBack:closeContext,backLabel:'Back to vote text'}} language={language}/></div>}
  </div>;
}
