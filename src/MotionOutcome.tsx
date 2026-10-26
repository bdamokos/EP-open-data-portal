import {knownVoteMethodLabel} from './voteMethod.mjs';
import {ActivityVote} from './ActivityVote';
import type { MotionOutcome, RelatedJointMotion } from './explorerTypes';
import {useState} from 'react';
import {MotionComparison} from './MotionComparison';
import './MotionOutcome.css';

const labels = { adopted:'Adopted', rejected:'Rejected', lapsed:'Lapsed', withdrawn:'Withdrawn', unavailable:'Outcome unavailable' };
const icons = { adopted:'✓', rejected:'×', lapsed:'↷', withdrawn:'−', unavailable:'?' };
const voteDate = (value:string,language:string) => new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));

export function MotionStatus({outcome,subject,label}:{outcome:MotionOutcome;subject?:string;label?:string}) {
  return <span className="explorer-motion-status" lang="en" data-outcome={outcome.status}>
    <span aria-hidden="true">{icons[outcome.status]}</span>{label || (subject ? `${subject}: ${labels[outcome.status].toLowerCase()}` : labels[outcome.status])}
  </span>;
}
export function MotionStatuses({outcome,related=[],sourceId}:{outcome:MotionOutcome;related?:RelatedJointMotion[];sourceId:string}) {
  return <span className="explorer-motion-statuses">
    <MotionStatus outcome={outcome} label={outcome.status==='lapsed' && related.length ? 'Replaced by joint motion' : undefined} subject={related.length ? 'Original motion' : sourceId.startsWith('RC-') ? 'Joint motion' : 'Motion'}/>
    {related.map(motion=><MotionStatus key={motion.sourceId} outcome={motion.outcome} subject={related.length===1 ? 'Joint motion' : `Joint motion ${motion.reference}`}/>)}
  </span>;
}
function VoteDetails({outcome,language}:{outcome:MotionOutcome;language:string}) {
  const voted=outcome.status==='adopted' || outcome.status==='rejected';
  return <>
    {outcome.status!=='unavailable' && outcome.date && <p className="explorer-motion-vote-meta"><span lang={language}>{voteDate(outcome.date,language)}</span>{voted && knownVoteMethodLabel(outcome.method) ? ` · ${knownVoteMethodLabel(outcome.method)}` : ''}</p>}
    {voted && outcome.totals && <dl className="explorer-motion-totals">
      {([['for','For'],['against','Against'],['abstaining','Abstentions']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd lang={language}>{outcome.totals![key]?.toLocaleString(language) ?? '—'}</dd></div>)}
    </dl>}
    {voted&&outcome.method==='VOTE_HAND'&&<p className="explorer-motion-explanation">Individual positions are not recorded for this voting method.</p>}
    {outcome.status==='unavailable' && <p className="explorer-motion-explanation">Final outcome unavailable.</p>}
  </>;
}
function readableDocumentUrl(value:string|null) {
  if(!value)return null;
  try {
    const url=new URL(value);
    return url.protocol==='https:' && url.hostname==='data.europarl.europa.eu' && /^\/distribution\/.+\.(pdf|docx)$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
function CompareWording({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const [open,setOpen]=useState(false);
  return <details className="explorer-motion-compare" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Compare wording with original motion</summary>{open&&<MotionComparison key={`${originalId}:${jointId}:${language}`} originalId={originalId} jointId={jointId} language={language}/>}</details>;
}
export function MotionOutcome({outcome,related=[],reference,sourceId,language,memberId,memberName}:{outcome?:MotionOutcome;related?:RelatedJointMotion[];reference:string;sourceId:string;language:string;memberId?:number;memberName?:string}) {
  if(!outcome && !related.length)return null;
  return <section className="explorer-motion-outcome" lang="en" aria-label={related.length ? 'Original and joint motion outcomes' : 'Motion outcome'}>
    {outcome && <div className="explorer-motion-text-outcome">
      <h3>{related.length ? 'Original motion' : sourceId.startsWith('RC-') ? 'Joint motion' : 'Motion'} <span className="explorer-motion-reference">{reference}</span></h3>
      <ActivityVote indexed={{outcome:outcome.status==='unavailable'?null:outcome.status.toUpperCase(),method:outcome.method,totals:outcome.totals}} decisionId={outcome.decisionId} memberId={memberId} memberName={memberName} language={language}>
        <MotionStatus outcome={outcome}/><VoteDetails outcome={outcome} language={language}/>
        {outcome.status==='lapsed' && <p className="explorer-motion-explanation">{related.length ? 'Replaced by the joint text below; not adopted separately.' : 'This text lapsed and was not adopted as a separate resolution.'}</p>}
      </ActivityVote>
    </div>}
    {related.map(motion=>{
      const url=readableDocumentUrl(motion.url);
      return <section className="explorer-motion-joint-outcome" key={motion.sourceId} aria-label={`Joint motion ${motion.reference}`}>
        <h3>Joint motion <span className="explorer-motion-reference">{motion.reference}</span></h3>
        <ActivityVote indexed={{outcome:motion.outcome.status==='unavailable'?null:motion.outcome.status.toUpperCase(),method:motion.outcome.method,totals:motion.outcome.totals}} decisionId={motion.outcome.decisionId} memberId={memberId} memberName={memberName} language={language}><MotionStatus outcome={motion.outcome}/><VoteDetails outcome={motion.outcome} language={language}/></ActivityVote>
        {motion.memberAuthorship==='recorded' && <p className="explorer-motion-explanation">This MEP is also an author of this joint motion.</p>}
        {url && <a className="explorer-motion-document-link" href={url} target="_blank" rel="noreferrer" title={motion.title} lang=""><span lang="en">Read joint motion{motion.documentFormat ? ` (${motion.documentFormat}${motion.documentLanguage ? ' · '+motion.documentLanguage.toUpperCase() : ''})` : ''} ↗</span></a>}
        {sourceId.startsWith('B-')&&<CompareWording originalId={sourceId} jointId={motion.sourceId} language={language}/>}
      </section>;
    })}
  </section>;
}
