import {lazy,Suspense} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useData} from './data';
import {exactAmendmentTargets} from './memberVotesPresentation.mjs';
import {voteAmendmentWording} from './votePagePresentation.mjs';
import type {DecisionVotesResponse} from './DecisionVotesTypes';

const DossierVoteText=lazy(()=>import('./DossierVoteText'));
type Wording={documentId:string;requestedLanguage:string;amendment:null|{id:string;variants:unknown[]}};
type Vote=NonNullable<DecisionVotesResponse['decision']>;

// The amendment's wording, plain. Published versions that differ keep the version chooser.
function Wording({vote,documentId,amendmentId,language}:{vote:Vote;documentId:string;amendmentId:string;language:string}) {
  const ui=useUiI18n();
  const query=new URLSearchParams({amendment:amendmentId,lang:language,body:'0'});
  const response=useData<Wording>('document-context/'+encodeURIComponent(documentId)+'?'+query,{unavailable:'error.wording'});
  const data=response.data?.documentId===documentId&&response.data.requestedLanguage===language&&response.data.amendment?.id===amendmentId?response.data:null;
  const loading=<p role="status"><UiMessage id="dossieractivity.loading_text"/></p>;
  if(!data)return response.loading?loading:null;
  const wording=voteAmendmentWording(data.amendment!.variants,vote,ui);
  if(wording.state==='none')return null;
  if(wording.state==='versions')return <Suspense fallback={loading}><DossierVoteText vote={vote} language={language} showParts={false}/></Suspense>;
  return <section className="clause">
    <h3>{wording.heading}</h3>
    <p className="clause-text plain" lang={wording.language}>{wording.text}</p>
  </section>;
}
export function VoteAmendmentText({vote,language}:{vote:Vote;language:string}) {
  const targets=exactAmendmentTargets(vote);
  return targets.length===1?<Wording vote={vote} documentId={targets[0].documentId} amendmentId={targets[0].amendmentId} language={language}/>:null;
}
