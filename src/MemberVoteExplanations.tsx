import {useSpeechTranslation} from './SpeechTranslation';
import {useId,useState} from 'react';
import {useData} from './data';
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

const retryableGap=(code:string)=>/-source-(?:unavailable|stale)$/.test(code)||[
  'speech-collection-incomplete','speech-total-changed','speech-count-mismatch','speech-hit-unavailable',
  'request_timeout','upstream_busy','odp_rate_limited','odp_unavailable','odp_no_content',
].includes(code);

function ExplanationReader({item,language}:{item:Explanation;language:string}) {
  const [selected,setSelected]=useState(language),translation=useSpeechTranslation(item.id,selected,language),state=translation.state,body=state.transcript;
  const paragraphs=transcriptParagraphs(body?.xml||null).paragraphs;
  const video=useSpeechVideo(state.data?.id===item.id?state.data:item.speech,language,translation.originalAudio);
  return <div className="vote-explanation-reader">
    <div className="vote-explanation-tools"><TextLanguagePicker available={state.availableTextLanguages} requested={language} value={body?.textLanguage||null} onChange={setSelected} visibleLabel={false}
      note={<TextLanguageFallback requested={translation.selected} actual={body?.textLanguage||null} interfaceLanguage={language}/>}/>{translation.control}{video.toggle}</div>
    {video.panel}{translation.originalGap&&<p>Original text unavailable.</p>}
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
    ['searched','partial','unavailable'].includes(response.coverage?.status)&&typeof response.coverage.searchComplete==='boolean'&&
    Array.isArray(response.coverage.gaps)&&response.coverage.gaps.every(gap=>gap&&typeof gap.code==='string')&&response.items.every(item=>item&&item.kind==='oral'&&item.matchScope==='subject'&&item.subjectId===vote.subjectId&&Array.isArray(item.sources)&&Array.isArray(item.classification?.sources)&&
      item.presentationAnchorDecisionId===response.presentationAnchorDecisionId&&new RegExp('^'+vote.sittingId+'-[A-Z0-9-]+$').test(item.id)&&item.speech?.id===item.id);
  const result=valid?response:null,items=result?.items||[],anchor=result?.presentationAnchorDecisionId;
  const final=anchor===vote.id,canRetry=result?.coverage.gaps?.some(gap=>retryableGap(gap.code));
  const retry=<button className="vote-explanation-action" type="button" disabled={request.loading} onClick={request.retry}>Retry</button>;
  return <div className="member-vote-explanations">
    {request.loading&&!result&&<p className="vote-explanation-status" role="status">Checking this member’s oral explanation…</p>}
    {(request.error||response&&!valid)&&<p className="vote-explanation-status" role="status">This member’s oral explanation is unavailable. {retry}</p>}
    {items.map((item,index)=>{
      const open=reading===item.id,id=contentId+'-'+index;
      return <div className="vote-explanation" key={item.id}>
        <button className="vote-explanation-action vote-explanation-toggle" type="button" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setReading(open?null:item.id)}>
          <span aria-hidden="true">{open?'▾':'▸'}</span> {open?'Close oral explanation':final?'Read oral explanation of vote':'Read oral explanation on the whole text'}
        </button>
        {index===0&&result?.coverage.status==='partial'&&<span className="vote-explanation-status"> · Search incomplete{canRetry&&<> {retry}</>}</span>}
        {open&&<div id={id} className="vote-explanation-body">
          <ExplanationReader key={item.id+':'+language} item={item} language={language}/>
          {!final&&anchor&&<button className="vote-explanation-action" type="button" onClick={()=>onDecision(anchor)}>Final vote</button>}
        </div>}
      </div>;
    })}
    {result&&!items.length&&<p className="vote-explanation-status">{result.coverage.searchComplete?'No oral explanation found for this member.':'This member’s oral explanation is unavailable.'}{!result.coverage.searchComplete&&canRetry&&<> {retry}</>}</p>}
  </div>;
}
