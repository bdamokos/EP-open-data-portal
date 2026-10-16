import type { MotionOutcome, RelatedJointMotion } from './pocTypes';
import './PocMotionOutcome.css';

const labels = { adopted:'Adopted', rejected:'Rejected', lapsed:'Lapsed', withdrawn:'Withdrawn', unavailable:'Outcome unavailable' };
const icons = { adopted:'✓', rejected:'×', lapsed:'↷', withdrawn:'−', unavailable:'?' };
const methods:Record<string,string> = { VOTE_HAND:'Show of hands', VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote', VOTE_ELECTRONIC:'Electronic vote', VOTE_SECRET_BALLOT:'Secret ballot' };
const voteDate = (value:string,language:string) => new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));

export function MotionStatus({outcome,subject,label}:{outcome:MotionOutcome;subject?:string;label?:string}) {
  return <span className="poc-motion-status" data-outcome={outcome.status}>
    <span aria-hidden="true">{icons[outcome.status]}</span>{label || (subject ? `${subject}: ${labels[outcome.status].toLowerCase()}` : labels[outcome.status])}
  </span>;
}
export function MotionStatuses({outcome,related=[],sourceId}:{outcome:MotionOutcome;related?:RelatedJointMotion[];sourceId:string}) {
  return <span className="poc-motion-statuses">
    <MotionStatus outcome={outcome} label={outcome.status==='lapsed' && related.length ? 'Replaced by joint motion' : undefined} subject={related.length ? 'Original motion' : sourceId.startsWith('RC-') ? 'Joint motion' : 'Motion'}/>
    {related.map(motion=><MotionStatus key={motion.sourceId} outcome={motion.outcome} subject={related.length===1 ? 'Joint motion' : `Joint motion ${motion.reference}`}/>)}
  </span>;
}
function VoteDetails({outcome,language}:{outcome:MotionOutcome;language:string}) {
  const voted=outcome.status==='adopted' || outcome.status==='rejected';
  return <>
    {outcome.status!=='unavailable' && outcome.date && <p className="poc-motion-vote-meta">{voteDate(outcome.date,language)}{voted && methods[outcome.method || ''] ? ` · ${methods[outcome.method!]}` : ''}</p>}
    {voted && outcome.totals && <dl className="poc-motion-totals">
      {([['for','For'],['against','Against'],['abstaining','Abstentions']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{outcome.totals![key]?.toLocaleString(language) ?? '—'}</dd></div>)}
    </dl>}
    {outcome.status==='unavailable' && <p className="poc-motion-explanation">No verified final outcome is available for this text.</p>}
  </>;
}
function readableDocumentUrl(value:string|null) {
  if(!value)return null;
  try {
    const url=new URL(value);
    return url.protocol==='https:' && url.hostname==='data.europarl.europa.eu' && /^\/distribution\/.+\.(pdf|docx)$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function PocMotionOutcome({outcome,related=[],reference,sourceId,language}:{outcome?:MotionOutcome;related?:RelatedJointMotion[];reference:string;sourceId:string;language:string}) {
  if(!outcome && !related.length)return null;
  return <section className="poc-motion-outcome" aria-label={related.length ? 'Original and joint motion outcomes' : 'Motion outcome'}>
    {outcome && <div className="poc-motion-text-outcome">
      <h3>{related.length ? 'Original motion' : sourceId.startsWith('RC-') ? 'Joint motion' : 'Motion'} <span className="poc-motion-reference">{reference}</span></h3>
      <MotionStatus outcome={outcome}/>
      <VoteDetails outcome={outcome} language={language}/>
      {outcome.status==='lapsed' && <p className="poc-motion-explanation">{related.length ? 'This motion was replaced by the joint text below. Parliament records the original motion as lapsed; it was not adopted separately.' : 'This text lapsed and was not adopted as a separate resolution.'}</p>}
    </div>}
    {related.map(motion=>{
      const url=readableDocumentUrl(motion.url);
      return <section className="poc-motion-joint-outcome" key={motion.sourceId} aria-label={`Joint motion ${motion.reference}`}>
        <h3>Joint motion <span className="poc-motion-reference">{motion.reference}</span></h3>
        {outcome?.status!=='lapsed' && <p className="poc-motion-explanation">Related joint text combining this motion with others.</p>}
        <MotionStatus outcome={motion.outcome}/>
        <VoteDetails outcome={motion.outcome} language={language}/>
        {motion.memberAuthorship && <p className="poc-motion-explanation">{motion.memberAuthorship==='recorded' ? 'This MEP is also listed as an author of this joint motion.' : 'No authorship is recorded for this MEP on this joint motion.'}</p>}
        {url && <a className="poc-motion-document-link" href={url} target="_blank" rel="noreferrer" title={motion.title}>Read joint motion{motion.documentFormat ? ` (${motion.documentFormat}${motion.documentLanguage ? ' · '+motion.documentLanguage.toUpperCase() : ''})` : ''} ↗</a>}
      </section>;
    })}
  </section>;
}
