import type { MotionOutcome, RelatedJointMotion } from './pocTypes';
import './PocMotionOutcome.css';

const labels = { adopted:'Adopted', rejected:'Rejected', lapsed:'Lapsed', withdrawn:'Withdrawn', unavailable:'Outcome unavailable' };
const icons = { adopted:'✓', rejected:'×', lapsed:'↷', withdrawn:'−', unavailable:'?' };
const methods:Record<string,string> = { VOTE_HAND:'Show of hands', VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote', VOTE_ELECTRONIC:'Electronic vote', VOTE_SECRET_BALLOT:'Secret ballot' };
const voteDate = (value:string,language:string) => new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));

export function MotionStatus({outcome}:{outcome:MotionOutcome}) {
  return <span className="poc-motion-status" data-outcome={outcome.status}>
    <span aria-hidden="true">{icons[outcome.status]}</span>{labels[outcome.status]}
  </span>;
}
export function PocMotionOutcome({outcome,related=[],language}:{outcome?:MotionOutcome;related?:RelatedJointMotion[];language:string}) {
  const available=outcome && outcome.status!=='unavailable';
  if(!available && !related.length)return null;
  const source=outcome?.sources?.find(source=>source.url.includes('/decisions?'));
  const voted=outcome?.status==='adopted' || outcome?.status==='rejected';
  return <section className="poc-motion-outcome" aria-label="Plenary outcome">
    {available && <>
      <h3>Plenary outcome</h3>
      <p className="poc-motion-vote-meta">{outcome.date && voteDate(outcome.date,language)}{voted && methods[outcome.method || ''] ? ` · ${methods[outcome.method!]}` : ''}</p>
      {voted && outcome.totals && <dl className="poc-motion-totals">
        {([['for','For'],['against','Against'],['abstaining','Abstentions']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{outcome.totals![key]?.toLocaleString(language) ?? '—'}</dd></div>)}
      </dl>}
      {source && <a className="poc-motion-result-link" href={source.url} target="_blank" rel="noreferrer">Official result ↗</a>}
    </>}
    {related.map(motion=><p className="poc-motion-related" key={motion.sourceId}><a href={motion.url} target="_blank" rel="noreferrer" title={motion.title}>Joint motion {motion.reference} ↗</a>{motion.outcome.status!=='unavailable' && <> · {labels[motion.outcome.status]}</>}</p>)}
  </section>;
}
