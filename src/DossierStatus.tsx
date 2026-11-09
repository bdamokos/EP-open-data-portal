import {useLayoutEffect,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import {useProcedureProgress} from './ProcedureProgress';
import {dossierStatusLines,mergeDossierStatus,votingListLineId,type DossierCommittee,type DossierStatusLine,type DossierStatusResponse,type DossierVotingList} from '../server/dossier-status-model.mjs';
import type {ProcedureSummary} from '../server/procedure-steps.mjs';
import './DossierStatus.css';

const brusselsToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fileUrl=(reference:string)=>'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference});

function Line({line,language}:{line:DossierStatusLine;language:string}) {
  const {date,tally,committees,label,labelLanguage}=line.values||{};
  const values:Record<string,ReactNode>={};
  if(date)values.date=<time dateTime={date} lang={language}>{humanDate(date,language)}</time>;
  if(tally)values.tally=<UiMessage id="dossierstatus.tally" values={{for:tally.for,against:tally.against,abstaining:tally.abstaining}}/>;
  if(committees?.length)values.committee=<CommitteeNames committees={committees} language={language}/>;
  if(label)values.label=<span lang={labelLanguage||'en'}>{label}</span>;
  return <UiMessage id={line.id} values={values}/>;
}
function CommitteeNames({committees,language}:{committees:DossierCommittee[];language:string}) {
  const names=committees.map(row=>row.name===row.code ? row.code : row.name+' ('+row.code+')');
  return <span lang={committees[0].language||language}>{new Intl.ListFormat(language,{style:'long',type:'conjunction'}).format(names)}</span>;
}

function VotingListLine({counts}:{counts:DossierVotingList}) {
  const ui=useUiI18n(),id=votingListLineId(counts);
  if(!id)return null;
  const stem='dossierstatus.voting_list.';
  const block=ui.t(stem+(counts.blockVotes>1?'blocks':'block'),{count:counts.blockAmendments}),individual=ui.t(stem+'individual',{count:counts.individual}),identical=ui.t(stem+'identical',{count:counts.identical});
  return <p className="dossier-status-next dossier-status-voting-list"><UiMessage id={id} values={{block,individual,identical}}/></p>;
}

/** Parliament answered that it holds no procedure under this reference. */
export const procedureNotFound=(state:{status?:number;code?:string;loading:boolean})=>!state.loading&&state.status===404&&state.code==='procedure_not_found';

/** The first answer on a dossier: where the file stands and what comes next.
 * The strip's rows exist from the first render, so later reads only fill them in.
 * A reference neither Parliament nor the Legislative Observatory holds gets one
 * line and no strip; `officialMissing` says the Observatory has no file for it.
 */
export function DossierStatus({reference,language,summaries,votingList=false,officialMissing=false,onMissing}:{reference:string;language:string;summaries?:ProcedureSummary[];votingList?:boolean;officialMissing?:boolean;onMissing?:(missing:boolean)=>void}) {
  const ui = useUiI18n();
  const state=useInsightData<DossierStatusResponse>('insights/dossier-status?'+new URLSearchParams({reference,lang:language}));
  const progress=useProcedureProgress(reference,language);
  const status=(state.data?.reference===reference) ? state.data : null;
  const cellarEvents=(progress.data?.state==='mapped') ? progress.data.events : [];
  const merged=mergeDossierStatus(status||{reference,indexEvents:[]},{cellarEvents,summaries,asOf:brusselsToday()});
  const {sentence,next}=dossierStatusLines({...merged,indexEvents:status?.indexEvents,slots:status?.slots,cellarEvents});
  // Before the held status arrives nothing is known to be current.
  const steps=merged.steps.map(step=>(!status&&state.loading&&step.state==='current') ? {...step,state:'open' as const} : step);
  const known=Boolean(status||cellarEvents.length);
  const settled=!state.loading&&!progress.loading;
  const failed=settled&&(!sentence||!known);
  const missing=procedureNotFound(state);
  // Before paint, so a missing file never flashes the full page first.
  useLayoutEffect(()=>{onMissing?.(missing);},[missing,onMissing]);
  if(missing&&officialMissing&&!cellarEvents.length)return <section className="dossier-status" lang={ui.language} aria-label={ui.t('dossierstatus.heading')}>
    <div className="dossier-status-lines"><p className="dossier-status-sentence"><UiMessage id="dossierstatus.not_found"/></p></div>
  </section>;
  return <section className="dossier-status" lang={ui.language} aria-label={ui.t('dossierstatus.heading')}>
    <div className="dossier-status-lines">
      {known&&sentence ? <>
        <p className="dossier-status-sentence"><Line line={sentence} language={language}/></p>
        {next&&<p className="dossier-status-next"><Line line={next} language={language}/></p>}
      </> : failed&&<p className="dossier-status-sentence"><UiMessage id="dossierstatus.unavailable"/>{!officialMissing&&<> <a href={fileUrl(reference)} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.28.70"/></a></>}</p>}
      {votingList&&status?.slots?.votingList&&<VotingListLine counts={status.slots.votingList}/>}
    </div>
    {steps.length>0&&<ol className="dossier-steps" aria-label={ui.t('dossierstatus.steps')} style={{'--dossier-step-count':steps.length} as React.CSSProperties}>{steps.map(step=><li key={step.key} data-state={step.state} aria-current={(step.state==='current') ? 'step' : undefined}>
      <span className="dossier-step-mark" aria-hidden="true">{(step.state==='done') ? '✓' : ''}</span>
      <span className="dossier-step-label"><UiMessage id={'dossierstatus.step_'+step.key}/></span>
      <span className="dossier-step-date">{step.date&&<time dateTime={step.date} lang={language}>{humanDate(step.date,language)}</time>}{step.partial&&<> · <UiMessage id="dossierstatus.partial"/></>}</span>
    </li>)}</ol>}
  </section>;
}
