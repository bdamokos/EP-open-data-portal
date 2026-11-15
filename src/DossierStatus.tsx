import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import {dayDate} from './votePagePresentation.mjs';
import {useProcedureProgress} from './ProcedureProgress';
import {dossierAnswerLines,dossierStatusLines,mergeDossierStatus,votingListAnswerId,type DossierCommittee,type DossierStatusLine,type DossierStatusResponse,type DossierVotingList} from '../server/dossier-status-model.mjs';
import type {ProcedureSummary} from '../server/procedure-steps.mjs';
import './DossierStatus.css';

const brusselsToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fileUrl=(reference:string)=>'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference});

// A coming plenary day reads with its weekday.
const dayLine=(id:string)=>/^dossierstatus\.answer\.next_.*_on$/.test(id);
function Line({line,language}:{line:DossierStatusLine;language:string}) {
  const {date,tally,committees,label,labelLanguage}=line.values||{};
  const values:Record<string,ReactNode>={};
  if(date)values.date=<time dateTime={date} lang={language}>{dayLine(line.id) ? dayDate(date,language) : humanDate(date,language)}</time>;
  if(tally)values.tally=<UiMessage id="dossierstatus.tally" values={{for:tally.for,against:tally.against,abstaining:tally.abstaining}}/>;
  if(committees?.length)values.committee=<CommitteeNames committees={committees} language={language}/>;
  if(label)values.label=<span lang={labelLanguage||'en'}>{label}</span>;
  return <UiMessage id={line.id} values={values}/>;
}
function CommitteeNames({committees,language}:{committees:DossierCommittee[];language:string}) {
  const names=committees.map(row=>row.name===row.code ? row.code : row.name+' ('+row.code+')');
  return <span lang={committees[0].language||language}>{new Intl.ListFormat(language,{style:'long',type:'conjunction'}).format(names)}</span>;
}

/** The voting list in plain words, for the dossier page's "The vote" line. */
function VoteAnswer({counts}:{counts:DossierVotingList}) {
  const ui=useUiI18n(),id=votingListAnswerId(counts);
  if(!id)return null;
  const stem='dossierstatus.answer.vote.';
  // Plural messages pick their form from the count.
  const votes=ui.t(stem+'block_votes',{count:counts.blockVotes});
  const block=ui.t(stem+'block',{count:counts.blockAmendments,votes}),individual=ui.t(stem+'individual',{count:counts.individual}),duplicates=ui.t(stem+'duplicates',{count:counts.identical});
  return <UiMessage id={id} values={{block,individual,duplicates}}/>;
}

/** Where the current step sits on a phone: "Step 7 of 9", with the whole list a tap away. */
function StepCount({steps,listId,open,onToggle}:{steps:{key:string;state:string}[];listId:string;open:boolean;onToggle:()=>void}) {
  const at=steps.findIndex(step=>step.state==='current'),index=at>=0?at:steps.map(step=>step.state).lastIndexOf('done');
  if(index<0)return null;
  return <div className="dossier-step-count">
    <span className="dossier-step-bar" aria-hidden="true">{steps.map((step,position)=><i key={step.key} data-state={position===index&&at<0?'current':step.state}/>)}</span>
    <p><span><UiMessage id="dossierstatus.step_of" values={{step:index+1,total:steps.length,name:<b><UiMessage id={'dossierstatus.step_'+steps[index].key}/></b>}}/></span><button type="button" className="word" aria-expanded={open} aria-controls={listId} onClick={onToggle}><UiMessage id="dossierstatus.all_steps"/></button></p>
  </div>;
}

/** Parliament answered that it holds no procedure under this reference. */
export const procedureNotFound=(state:{status?:number;code?:string;loading:boolean})=>!state.loading&&state.status===404&&state.code==='procedure_not_found';

/** The first answer on a dossier: where the file stands and what comes next.
 * The strip's rows exist from the first render, so later reads only fill them in.
 * A reference neither Parliament nor the Legislative Observatory holds gets one
 * line and no strip; `officialMissing` says the Observatory has no file for it.
 */
export function DossierStatus({reference,language,summaries,votingList=false,labelled=false,officialMissing=false,onMissing}:{reference:string;language:string;summaries?:ProcedureSummary[];votingList?:boolean;labelled?:boolean;officialMissing?:boolean;onMissing?:(missing:boolean)=>void}) {
  const ui = useUiI18n();
  const [allSteps,setAllSteps]=useState(false),listId='dossier-steps-'+reference.replace(/\W/g,'');
  const state=useInsightData<DossierStatusResponse>('insights/dossier-status?'+new URLSearchParams({reference,lang:language}));
  const progress=useProcedureProgress(reference,language);
  const status=(state.data?.reference===reference) ? state.data : null;
  const cellarEvents=(progress.data?.state==='mapped') ? progress.data.events : [];
  const merged=mergeDossierStatus(status||{reference,indexEvents:[]},{cellarEvents,summaries,asOf:brusselsToday()});
  const today=brusselsToday(),input={...merged,indexEvents:status?.indexEvents,slots:status?.slots,cellarEvents,asOf:today};
  const lines={...dossierStatusLines(input),answer:dossierAnswerLines(input)};
  // Before the held status arrives nothing is known to be current.
  const steps=merged.steps.map(step=>(!status&&state.loading&&step.state==='current') ? {...step,state:'open' as const} : step);
  // Cellar events alone give a sentence only once the held status has failed.
  const known=Boolean(status||cellarEvents.length&&(!state.loading||state.retrying));
  // The sentence shown stays while the file's stage stays: Publications Office
  // events that arrive later fill the steps but rewrite the headline only when
  // they move the file on (a final vote or signature the index has not caught up with).
  const shown=useRef<{key:string;lines:typeof lines}|null>(null),key=reference+'\n'+language+'\n'+merged.stage;
  if(shown.current?.key!==key)shown.current=null;
  // Only a sentence the held status backs is kept; one from the Publications Office alone gives way when a retried status arrives.
  if(!shown.current&&status&&lines.sentence)shown.current={key,lines};
  const {sentence,next}=shown.current?.lines||lines;
  // The labelled Next line follows the latest reads: a vote day the Publications Office gives later fills it in.
  const answer={...(shown.current?.lines||lines).answer,next:lines.answer.next};
  const settled=!state.loading&&!progress.loading;
  const failed=settled&&(!sentence||!known);
  const missing=procedureNotFound(state);
  // Before paint, so a missing file never flashes the full page first.
  useLayoutEffect(()=>{onMissing?.(missing);},[missing,onMissing]);
  if(missing&&officialMissing&&!cellarEvents.length)return <section className="dossier-status" lang={ui.language} aria-label={ui.t('dossierstatus.heading')}>
    <div className="dossier-status-lines"><p className="dossier-status-sentence"><UiMessage id="dossierstatus.not_found"/></p></div>
  </section>;
  const stepList=steps.length>0&&<ol id={listId} className="dossier-steps" data-open={allSteps ? 'true' : undefined} aria-label={ui.t('dossierstatus.steps')} style={{'--dossier-step-count':steps.length} as React.CSSProperties}>{steps.map(step=><li key={step.key} data-state={step.state} aria-current={(step.state==='current') ? 'step' : undefined}>
      <span className="dossier-step-mark" aria-hidden="true">{(step.state==='done') ? '✓' : ''}</span>
      <span className="dossier-step-label"><UiMessage id={'dossierstatus.step_'+step.key}/></span>
      <span className="dossier-step-date">{step.date&&<time dateTime={step.date} lang={language}>{humanDate(step.date,language)}</time>}{step.partial&&<> · <UiMessage id="dossierstatus.partial"/></>}</span>
    </li>)}</ol>;
  const counts=votingList ? status?.slots?.votingList : null;
  if(labelled)return <section className="dossier-status dossier-answer" lang={ui.language} aria-label={ui.t('dossierstatus.heading')}>
    <dl className="dossier-status-lines">
      {known&&answer.now ? <><dt><UiMessage id="dossierstatus.answer.now"/></dt><dd className="dossier-status-sentence"><Line line={answer.now} language={language}/></dd>
        {answer.next&&<><dt><UiMessage id="dossierstatus.answer.next"/></dt><dd className="dossier-status-next"><Line line={answer.next} language={language}/></dd></>}
      </> : failed&&<><dt><UiMessage id="dossierstatus.answer.now"/></dt><dd className="dossier-status-sentence"><UiMessage id="dossierstatus.unavailable"/>{!officialMissing&&<> <a href={fileUrl(reference)} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.28.70"/></a></>}</dd></>}
      {counts&&votingListAnswerId(counts)&&<><dt><UiMessage id="dossierstatus.answer.the_vote"/></dt><dd className="dossier-status-voting-list"><VoteAnswer counts={counts}/></dd></>}
      {known&&answer.earlier&&<><dt><UiMessage id="dossierstatus.answer.earlier"/></dt><dd className="dossier-status-earlier"><Line line={answer.earlier} language={language}/></dd></>}
    </dl>
    {steps.length>0&&<StepCount steps={steps} listId={listId} open={allSteps} onToggle={()=>setAllSteps(value=>!value)}/>}
    {stepList}
  </section>;
  return <section className="dossier-status" lang={ui.language} aria-label={ui.t('dossierstatus.heading')}>
    <div className="dossier-status-lines">
      {known&&sentence ? <>
        <p className="dossier-status-sentence"><Line line={sentence} language={language}/></p>
        {next&&<p className="dossier-status-next"><Line line={next} language={language}/></p>}
      </> : failed&&<p className="dossier-status-sentence"><UiMessage id="dossierstatus.unavailable"/>{!officialMissing&&<> <a href={fileUrl(reference)} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.28.70"/></a></>}</p>}
    </div>
    {steps.length>0&&<ol className="dossier-steps" aria-label={ui.t('dossierstatus.steps')} style={{'--dossier-step-count':steps.length} as React.CSSProperties}>{steps.map(step=><li key={step.key} data-state={step.state} aria-current={(step.state==='current') ? 'step' : undefined}>
      <span className="dossier-step-mark" aria-hidden="true">{(step.state==='done') ? '✓' : ''}</span>
      <span className="dossier-step-label"><UiMessage id={'dossierstatus.step_'+step.key}/></span>
      <span className="dossier-step-date">{step.date&&<time dateTime={step.date} lang={language}>{humanDate(step.date,language)}</time>}{step.partial&&<> · <UiMessage id="dossierstatus.partial"/></>}</span>
    </li>)}</ol>}
  </section>;
}
