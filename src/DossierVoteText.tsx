import {UiMessage, useUiI18n} from './UiI18nReact';
import {useLayoutEffect,useRef,useState} from 'react';
import {DocumentContextReader} from './DocumentContextReader';
import {MemberVoteWording,type MemberVotesContext} from './MemberVotes';
import {VotePartDescriptions} from './MemberVoteSummary';
import {exactAmendmentTargets,topLevelVoteDocuments} from './memberVotesPresentation.mjs';
import type {MemberVote} from './MemberVotesTypes';

export default function DossierVoteText({vote,language}:{vote:MemberVote;language:string}) {
  const ui = useUiI18n();
  const [context,setContext]=useState<MemberVotesContext|null>(null);
  const origin=useRef<HTMLElement|null>(null);
  const reader=useRef<HTMLDivElement|null>(null);
  const openContext=(next:MemberVotesContext)=>{origin.current=document.activeElement as HTMLElement;setContext(next);};
  const closeContext=()=>{setContext(null);window.requestAnimationFrame(()=>origin.current?.focus());};
  const targets=exactAmendmentTargets(vote),documents=topLevelVoteDocuments(vote);
  useLayoutEffect(()=>{if(context)reader.current?.querySelector<HTMLButtonElement>('.document-context-back')?.focus();},[context]);
  if(!targets.length&&!vote.context.amendmentIds.length&&vote.scope.kind!=='procedural'&&!vote.parts.length&&documents.length===1)return <DocumentContextReader showBackButton={false} showOriginalLink={false} request={{documentId:documents[0],view:'document',onBack:()=>{}}} language={language}/>;
  return <div className="dossier-vote-text">
    <div hidden={Boolean(context)}>
      <VotePartDescriptions vote={vote} language={language}/>
      {targets.map(target=><MemberVoteWording key={target.amendmentId+':'+language} {...target} language={language} openContext={openContext}/>)}
      {!targets.length&&Boolean(vote.context.amendmentIds.length)&&<p><UiMessage id="batch5.dossiervotetext.tsx.21.49"/></p>}
      {!targets.length&&vote.scope.kind==='procedural'&&<p lang={vote.titleLanguage??''}>{vote.title}</p>}
      {documents.map(documentId=><button type="button" key={documentId} onClick={()=>openContext({documentId,view:'document'})}>{ui.t(documentId.startsWith('TA-') ? ((documents.length>1) ? 'dossiervotetext.read_adopted_text_documentid.f1ac78' : 'dossiervotetext.read_adopted_text.4fa328') : (documentId.startsWith('A-') ? ((documents.length>1) ? 'membervotes.tsx.read.report.documentid' : 'dossiervotetext.read_report.024cda') : (documentId.startsWith('RC-') ? ((documents.length>1) ? 'membervotes.tsx.read.joint.motion.documentid' : 'dossiervotetext.read_joint_motion.14177c') : ((documents.length>1) ? 'membervotes.tsx.read.motion.documentid' : 'dossiervotetext.read_motion.cedd60'))),{documentId})}</button>)}
      {!targets.length&&!documents.length&&!vote.parts.length&&vote.scope.kind!=='procedural'&&<p><UiMessage id="batch5.dossiervotetext.tsx.24.50"/></p>}
    </div>
    {context&&<div ref={reader}><DocumentContextReader showOriginalLink={false} request={{...context,onBack:closeContext,backLabel:ui.t("dossiervotetext.back_to_vote_text.071205")}} language={language}/></div>}
  </div>;
}
