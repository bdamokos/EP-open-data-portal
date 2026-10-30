import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {knownVoteMethodLabel} from './voteMethod.mjs';
import {ActivityVote} from './ActivityVote';
import type { MotionOutcome, RelatedJointMotion } from './explorerTypes';
import {useState} from 'react';
import {MotionComparison} from './MotionComparison';
import './MotionOutcome.css';

const labels = { adopted:'Adopted', rejected:'Rejected', lapsed:'Lapsed', withdrawn:'Withdrawn', unavailable:'Outcome unavailable' };
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({ adopted:ui.t("membervotespresentation.adopted"), rejected:ui.t("membervotespresentation.rejected"), lapsed:ui.t("membervotespresentation.lapsed"), withdrawn:ui.t("membervotespresentation.withdrawn"), unavailable:ui.t("membervotespresentation.outcome_unavailable") });

const icons = { adopted:'✓', rejected:'×', lapsed:'↷', withdrawn:'−', unavailable:'?' };
const voteDate = (value:string,language:string) => new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));

export function MotionStatus({outcome,subject,label,kind,reference}:{outcome:MotionOutcome;subject?:string;label?:string;kind?:'motion'|'original.motion'|'joint.motion';reference?:string}) {
  const ui = useUiI18n();
  return <span className="explorer-motion-status" lang={ui.language} data-outcome={outcome.status}>
    <span aria-hidden="true">{icons[outcome.status]}</span>{label || (kind ? ui.t(`motionoutcome.status.${kind}${reference ? '.reference' : ''}.${(outcome.status==='unavailable') ? 'outcome.unavailable' : outcome.status}`,{reference:reference||''}) : (subject ? (`${subject}: ${labelsUi(ui)[outcome.status].toLocaleLowerCase(ui.locale)}`) : labelsUi(ui)[outcome.status]))}
  </span>;
}
export function MotionStatuses({outcome,related=[],sourceId}:{outcome:MotionOutcome;related?:RelatedJointMotion[];sourceId:string}) {
  const ui = useUiI18n();
  return <span className="explorer-motion-statuses">
    <MotionStatus outcome={outcome} kind={related.length ? 'original.motion' : (sourceId.startsWith('RC-') ? 'joint.motion' : 'motion')} label={((outcome.status==='lapsed') && related.length) ? ui.t("motionoutcome.replaced.by.joint.motion") : undefined} subject={related.length ? ui.t("MotionComparison.original_motion") : (sourceId.startsWith('RC-') ? ui.t("batch6.documentcontextreader.joint.motion.40") : ui.t("batch6.documentcontextreader.motion.40"))}/>
    {related.map(motion=><MotionStatus key={motion.sourceId} outcome={motion.outcome} kind="joint.motion" reference={(related.length===1) ? undefined : motion.reference} subject={(related.length===1) ? ui.t("batch6.documentcontextreader.joint.motion.40") : ui.t("motionoutcome.joint.motion.reference", {reference: String(motion.reference)})}/>)}
  </span>;
}
function VoteDetails({outcome,language}:{outcome:MotionOutcome;language:string}) {
  const ui = useUiI18n();
  const voted=outcome.status==='adopted' || outcome.status==='rejected';
  return <>
    {outcome.status!=='unavailable' && outcome.date && <p className="explorer-motion-vote-meta"><span lang={language}>{voteDate(outcome.date,language)}</span>{(voted && knownVoteMethodLabel(outcome.method, ui)) ? (` · ${knownVoteMethodLabel(outcome.method, ui)}`) : ''}</p>}
    {voted && outcome.totals && <dl className="explorer-motion-totals">
      {([['for',ui.t("membervotespresentation.for")],['against',ui.t("membervotespresentation.against")],['abstaining',ui.t("motionoutcome.abstentions")]] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd lang={language}>{outcome.totals![key]?.toLocaleString(language) ?? '—'}</dd></div>)}
    </dl>}
    {voted&&outcome.method==='VOTE_HAND'&&<p className="explorer-motion-explanation"><UiMessage id="motionamendments.individual_positions_are_not_recorded_for_this_voting_method.c320aa"/></p>}
    {outcome.status==='unavailable' && <p className="explorer-motion-explanation"><UiMessage id="motionoutcome.final.outcome.unavailable"/></p>}
  </>;
}
function readableDocumentUrl(value:string|null) {
  if(!value)return null;
  try {
    const url=new URL(value);
    return (((url.protocol==='https:') && (url.hostname==='data.europarl.europa.eu')) && /^\/distribution\/.+\.(pdf|docx)$/i.test(url.pathname)) ? url.href : null;
  } catch { return null; }
}
function CompareWording({originalId,jointId,language}:{originalId:string;jointId:string;language:string}) {
  const [open,setOpen]=useState(false);
  return <details className="explorer-motion-compare" onToggle={event=>setOpen(event.currentTarget.open)}><summary><UiMessage id="motionoutcome.compare.wording.with.original.motion"/></summary>{open&&<MotionComparison key={`${originalId}:${jointId}:${language}`} originalId={originalId} jointId={jointId} language={language}/>}</details>;
}
export function MotionOutcome({outcome,related=[],reference,sourceId,language,memberId,memberName}:{outcome?:MotionOutcome;related?:RelatedJointMotion[];reference:string;sourceId:string;language:string;memberId?:number;memberName?:string}) {
  const ui = useUiI18n();
  if(!outcome && !related.length)return null;
  return <section className="explorer-motion-outcome" lang={ui.language} aria-label={related.length ? ui.t("motionoutcome.original.and.joint.motion.outcomes") : ui.t("motionoutcome.motion.outcome")}>
    {outcome && <div className="explorer-motion-text-outcome">
      <h3>{related.length ? ui.t("MotionComparison.original_motion") : (sourceId.startsWith('RC-') ? ui.t("batch6.documentcontextreader.joint.motion.40") : ui.t("batch6.documentcontextreader.motion.40"))} <span className="explorer-motion-reference">{reference}</span></h3>
      <ActivityVote indexed={{outcome:(outcome.status==='unavailable') ? null : outcome.status.toUpperCase(),method:outcome.method,totals:outcome.totals}} decisionId={outcome.decisionId} memberId={memberId} memberName={memberName} language={language}>
        <MotionStatus outcome={outcome}/><VoteDetails outcome={outcome} language={language}/>
        {outcome.status==='lapsed' && <p className="explorer-motion-explanation">{related.length ? <UiMessage id="motionoutcome.replaced.by.the.joint.text.below.not.adopted.separately"/> : <UiMessage id="motionoutcome.this.text.lapsed.and.was.not.adopted.as.a.separate.resolution"/>}</p>}
      </ActivityVote>
    </div>}
    {related.map(motion=>{
      const url=readableDocumentUrl(motion.url);
      return <section className="explorer-motion-joint-outcome" key={motion.sourceId} aria-label={ui.t("motionoutcome.joint.motion.reference", {reference: String(motion.reference)})}>
        <h3><UiMessage id="motionoutcome.joint.motion.reference" values={{reference: <span className="explorer-motion-reference">{motion.reference}</span>}}/></h3>
        <ActivityVote indexed={{outcome:(motion.outcome.status==='unavailable') ? null : motion.outcome.status.toUpperCase(),method:motion.outcome.method,totals:motion.outcome.totals}} decisionId={motion.outcome.decisionId} memberId={memberId} memberName={memberName} language={language}><MotionStatus outcome={motion.outcome}/><VoteDetails outcome={motion.outcome} language={language}/></ActivityVote>
        {motion.memberAuthorship==='recorded' && <p className="explorer-motion-explanation"><UiMessage id="motionoutcome.this.mep.is.also.an.author.of.this.joint.motion"/></p>}
        {url && <a className="explorer-motion-document-link" href={url} target="_blank" rel="noreferrer" title={motion.title} lang=""><span lang={ui.language}>{motion.documentFormat ? (motion.documentLanguage ? ui.t('motionoutcome.read.joint.motion.format.language',{format:motion.documentFormat,language:motion.documentLanguage.toUpperCase()}) : ui.t('motionoutcome.read.joint.motion.format',{format:motion.documentFormat})) : ui.t('motionoutcome.read.joint.motion')}</span></a>}
        {sourceId.startsWith('B-')&&<CompareWording originalId={sourceId} jointId={motion.sourceId} language={language}/>}
      </section>;
    })}
  </section>;
}
