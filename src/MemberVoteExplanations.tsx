import {useId,useState} from 'react';
import {useData,useSpeechData} from './data';
import {transcriptParagraphs,TranscriptText} from './Transcript';
import {TextLanguagePicker,TextLanguageFallback} from './TextLanguagePicker';
import {useSpeechVideo} from './SpeechPlayer';
import type {Speech} from './explorerTypes';
import type {MemberVote,MemberVotesResponse} from './MemberVotesTypes';
import './MemberVoteExplanations.css';

type Source={url:string;fetchedAt:string;contentHash:string};
type Explanation={id:string;kind:'oral';matchScope:'subject';subjectId:string;presentationAnchorDecisionId:string|null;
  speech:Speech;parentId:string;documentIds:string[];agendaItemId:string;sources:Source[];
  classification:{basis:string;sources:{url:string}[]}};
type Explanations={version:2;memberId:string;decisionId:string;sittingId:string;snapshotId:string;subjectId:string|null;
  matchScope:'subject';presentationAnchorDecisionId:string|null;written:{status:'unsupported';count:null};items:Explanation[];
  coverage:{status:'searched'|'partial'|'unavailable';searchComplete:boolean;gaps:{code:string}[]}};

function ExplanationReader({item,language}:{item:Explanation;language:string}) {
  const [selected,setSelected]=useState(language),state=useSpeechData(item.id,selected),body=state.transcript;
  const paragraphs=transcriptParagraphs(body?.xml||null).paragraphs;
  const video=useSpeechVideo(state.data?.id===item.id?state.data:item.speech,language);
  return <div className="vote-explanation-reader">
    <div className="vote-explanation-tools"><TextLanguagePicker available={state.availableTextLanguages} requested={language} value={body?.textLanguage||null} onChange={setSelected} visibleLabel={false}
      note={<TextLanguageFallback requested={selected} actual={body?.textLanguage||null} interfaceLanguage={language}/>}/>{body?.translationType==='machine'&&<small>Machine translation</small>}{video.toggle}</div>
    {video.panel}
    {state.loading&&!body&&<p role="status">Loading explanation…</p>}
    {state.error&&<p role="alert">Transcript unavailable. <button type="button" disabled={state.loading} onClick={state.retry}>Retry transcript</button></p>}
    {paragraphs.length>0?<div lang={body?.textLanguage||''}>{paragraphs.map((paragraph,index)=><p key={index}><TranscriptText paragraph={paragraph}/></p>)}</div>:body&&!state.loading&&<p>Transcript unavailable.</p>}
  </div>;
}

export function MemberVoteExplanations({vote,data,memberId,language,onDecision}:{vote:MemberVote;data:MemberVotesResponse;memberId:string;language:string;onDecision:(id:string)=>void}) {
  const [reading,setReading]=useState<string|null>(null),contentId=useId();
  const params=new URLSearchParams({lang:language,decision:vote.id,snapshot:data.snapshotId,
    ...(data.period.kind==='sitting'?{sitting:vote.sittingId}:{week:data.period.week!})});
  const request=useData<Explanations>('member-vote-explanations/'+memberId+'?'+params);
  const response=request.data;
  const valid=response?.version===2&&response.memberId===memberId&&response.decisionId===vote.id&&response.sittingId===vote.sittingId&&response.snapshotId===data.snapshotId&&
    response.subjectId===vote.subjectId&&response.matchScope==='subject'&&Array.isArray(response.items)&&
    ['searched','partial','unavailable'].includes(response.coverage?.status)&&response.items.every(item=>item&&item.kind==='oral'&&item.matchScope==='subject'&&item.subjectId===vote.subjectId&&Array.isArray(item.sources)&&Array.isArray(item.classification?.sources)&&
      item.presentationAnchorDecisionId===response.presentationAnchorDecisionId&&new RegExp('^'+vote.sittingId+'-[A-Z0-9-]+$').test(item.id)&&item.speech?.id===item.id);
  const result=valid?response:null,items=result?.items||[],anchor=result?.presentationAnchorDecisionId;
  const final=anchor===vote.id;
  return <section className="member-vote-explanations" aria-label="Vote explanations">
    <h3>{items.length&&!final?'Explanation about this text':'Explanation of vote'}</h3>
    {request.loading&&!result&&<p role="status">Finding explanations…</p>}
    {(request.error||response&&!valid)&&<p role="alert">Explanations unavailable. <button type="button" disabled={request.loading} onClick={request.retry}>Retry explanations</button></p>}
    {items.length>0&&!final&&<p className="member-votes-muted">About the text as a whole.{anchor&&<> <button type="button" onClick={()=>onDecision(anchor)}>View final vote</button></>}</p>}
    {items.map(item=><div className="vote-explanation" key={item.id}>
      <div className="vote-explanation-heading"><span>Oral explanation</span><button type="button" aria-expanded={reading===item.id} aria-controls={contentId} onClick={()=>setReading(reading===item.id?null:item.id)}>{reading===item.id?'Close explanation':'Read explanation'}</button>
        <a href={item.speech.websiteUrl||item.classification.sources[0]?.url||item.sources[0]?.url} target="_blank" rel="noreferrer">Source ↗</a></div>
      {reading===item.id&&<div id={contentId}><ExplanationReader key={item.id+':'+language} item={item} language={language}/></div>}
    </div>)}
    {result&&!items.length&&<p>{result.coverage.searchComplete?'No matching oral explanation found.':'Oral explanations could not be fully checked.'}</p>}
    {items.length>0&&result?.coverage.status==='partial'&&<p className="member-votes-muted">Some explanation records are unavailable.</p>}
    {result&&!result.coverage.searchComplete&&<button type="button" disabled={request.loading} onClick={request.retry}>Retry explanations</button>}
    {result&&<p className="member-votes-muted">Written explanations are not available here. <a href={`https://www.europarl.europa.eu/meps/en/${memberId}/NAME/other-activities/written-explanations`} target="_blank" rel="noreferrer">Member’s page ↗</a></p>}
  </section>;
}
