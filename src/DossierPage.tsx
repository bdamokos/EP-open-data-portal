import {useEffect,useRef,useState} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import {useExplorerParam} from './explorerUrl';
import {dossierBackHref,dossierLinkClick} from './dossierJourney';
import {topicsHref} from './topicPresentation.mjs';
import {summaryStage,compoundLanguage} from './terms.mjs';
import {weekHref} from './weekAddress.mjs';
import type {DossierStatusResponse} from '../server/dossier-status-model.mjs';
import type {DossierReference} from './DossierActivityTypes';
import {FoldRow} from './FoldRow';
import {PageStrip,StripLink} from './PageStrip';
import {PersonName} from './PersonName';
import {groupLabel} from './groupLabels';
import {FollowDossierButton} from './DossierControls';
import {FindInText} from './TextSearch';
import {RecordTopics} from './RecordTopics';
import {AmendmentTrailLink} from './AmendmentTrailLink';
import {SourceLink} from './SourceLink';
import {ProcedureProgress,useProcedureProgress} from './ProcedureProgress';
import {DossierStatus} from './DossierStatus';
import {DossierActivity} from './DossierActivity';
import {PressMentions,usePressMentions} from './PressMentions';
import type {OfficialTopic,ProcedureContextResponse} from './ProcedureContext';
import './TopicContext.css';
import './VoteSystem.css';
import './DossierPage.css';

// Families whose file starts from a Commission proposal: its purpose line is likely, so its space is kept.
const proposalFamily=(reference:string)=>/\((?:COD|CNS|NLE|APP)\)$/.test(reference);
const calendarMonday=(value:string)=>{const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
const journeyAgenda=(href:string)=>{const url=new URL(href,window.location.href);return url.searchParams.get('view')==='legislation'&&(url.searchParams.get('pl-mode')||'agenda')==='agenda';};

/** Back to the page the reader came from; the plenary agenda when they arrived directly. */
function DossierBack({language,plenaryDate}:{language:string;plenaryDate:string|null}) {
  const origin=dossierBackHref()||(history.state?.dossierOrigin as string|undefined)||null;
  if(origin&&!journeyAgenda(origin))return <StripLink className="dossier-back" href={origin} onClick={dossierLinkClick} wide={<UiMessage id="dossieractivity.back_to_where_you_were"/>} narrow={<UiMessage id="dossieractivity.back_to_where_you_were"/>}/>;
  // A direct visit lands on the week that votes on the file, else on the current agenda.
  const href=origin||(plenaryDate ? weekHref(calendarMonday(plenaryDate),language) : '?'+new URLSearchParams({view:'legislation',lang:language}));
  const body=<>← <UiMessage id="plenarymodes.plenary_agenda"/></>;
  return <StripLink className="dossier-back" href={href} onClick={dossierLinkClick} wide={body} narrow={body}/>;
}

function Rapporteurs({people,language}:{people:NonNullable<DossierStatusResponse['rapporteurs']>;language:string}) {
  const ui=useUiI18n();
  const names=people.flatMap((person,index)=>{
    const name=<PersonName id={person.id} label={person.name} fallback={person.name}/>;
    return [index?', ':null,<span key={person.id}>{person.currentMep ? <a href={'?'+new URLSearchParams({lang:language,member:person.id,module:'profile'})} onClick={dossierLinkClick}>{name}</a> : name}{person.group&&<> ({groupLabel(person.group,ui)})</>}</span>];
  });
  return <p className="dossier-rapporteurs meta"><UiMessage id={people.length===1 ? 'week.fold.rapporteur' : 'week.fold.rapporteurs'} values={{names:<>{names}</>}}/></p>;
}

/** The dossier page: what the law is, where it stands, what comes next. Everything
 * else folds into rows whose reads wait until a row is opened or the reader scrolls near it.
 */
export function DossierPage({reference,language,onTopic}:{reference:string;language:string;onTopic?:(topic:OfficialTopic)=>void}) {
  const ui=useUiI18n();
  const [summary,setSummary]=useState(''),[expanded,setExpanded]=useState(false),summaryText=useRef<HTMLDivElement>(null);
  const [metadata,setMetadata]=useState<DossierReference|null>(null),[people,setPeople]=useState<number|null>(null);
  const params=new URLSearchParams({reference,lang:language,start:'proposal'});if(summary)params.set('summary',summary);
  const {data,loading,status,code}=useInsightData<ProcedureContextResponse>('insights/procedure-context?'+params);
  const context=data?.reference===reference ? data : null;
  // The Legislative Observatory has no file under this reference: no link leads there.
  const officialMissing=!context&&!loading&&status===404&&code==='official_source_not_found';
  // Parliament's own procedure record is missing too, so nothing on the page can describe the file.
  const [recordMissing,setRecordMissing]=useState(false);
  const fallbackTitle=metadata?.reference===reference&&metadata.title ? {title:metadata.title,titleLanguage:metadata.titleLanguage??null} : null;
  const unknown=officialMissing&&recordMissing&&!fallbackTitle;
  // The heading comes with the status read the page needs anyway, so it never waits for the Legislative Observatory.
  const heldRead=useInsightData<DossierStatusResponse>('insights/dossier-status?'+new URLSearchParams({reference,lang:language})),held=heldRead.data;
  const heldStatus=held?.reference===reference ? held : null;
  const heldTitle=heldStatus?.title ? {title:heldStatus.title,titleLanguage:heldStatus.titleLanguage} : null;
  const read=heldTitle||(context ? {title:context.title,titleLanguage:context.language} : null);
  // Whichever title and purpose this language's reads give first stay, so a later source or summary
  // choice never swaps them. The activity's title may be the previous language's, so it never stays.
  const shown=useRef<{key:string;title:NonNullable<typeof read>|null;purpose:{text:string;language:string}|null}|null>(null),key=reference+'\n'+language;
  if(shown.current?.key!==key)shown.current={key,title:null,purpose:null};
  shown.current.title||=read;
  if(!shown.current.purpose&&context?.purpose)shown.current.purpose={text:context.purpose,language:context.language};
  const title=shown.current.title||fallbackTitle,purpose=shown.current.purpose;
  const progress=useProcedureProgress(reference,language);
  const events=progress.data?.state==='mapped' ? progress.data.events.length : 0;

  // Rows read their data when opened, or once the reader scrolls and the rows come near.
  const [person]=useExplorerParam<string|null>('dossier-person',null),[shownActivity]=useExplorerParam<string|null>('dossier-show',null);
  const [peopleOpen,setPeopleOpen]=useState(Boolean(person||shownActivity));
  // A link to one person's work on the file opens the people row.
  useEffect(()=>{if(person||shownActivity)setPeopleOpen(true);},[person,shownActivity]);
  const rows=useRef<HTMLDivElement>(null),[near,setNear]=useState(false);
  useEffect(()=>{
    if(near)return;
    const node=rows.current;if(!node)return;
    let observer:IntersectionObserver|null=null;
    const arm=()=>{
      window.removeEventListener('scroll',arm);
      if(typeof IntersectionObserver==='undefined'){setNear(true);return;}
      observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))setNear(true);},{rootMargin:'0px 0px 300px 0px'});
      observer.observe(node);
    };
    window.addEventListener('scroll',arm,{passive:true});
    return ()=>{window.removeEventListener('scroll',arm);observer?.disconnect();};
  },[near,Boolean(context)||!loading]);
  const press=usePressMentions(reference,language,near);

  const proposalDate=context?.summaries.find(item=>item.stage==='proposal'&&item.documentReference)?.date;
  const blocks=context?.summary?.blocks||[],displayed=expanded ? blocks : blocks.slice(0,2);
  const stage=context?.summary ? summaryStage(context.summary.stage,language,ui) : null;
  const summaryValue=context?.summary&&stage&&<><span lang={stage.language}>{stage.text}</span>{context.summary.date&&<> · <time lang={language}>{humanDate(context.summary.date,language)}</time></>}</>;
  const summaryBlock=context?.summary&&<div className="dossier-summary">
    <header><FindInText key={context.summary.id} label={ui.t("batch5.procedurecontext.tsx.33.72")} target={summaryText} onOpen={()=>setExpanded(true)}/>{context.summaries.length>1&&<label className="insight-summary-stage"><span className="explorer-sr-only"><UiMessage id="batch5.procedurecontext.tsx.33.73"/></span><select value={context.summary.id} onChange={event=>{setSummary(event.target.value);setExpanded(false);}}>{context.summaries.map(item=>{const option=summaryStage(item.stage,language,ui);return <option lang={compoundLanguage(option.language,item.date ? language : option.language)} value={item.id} key={item.id}>{option.text}{item.date ? (' · '+humanDate(item.date,language)) : ''}</option>;})}</select></label>}</header>
    <div className="insight-official-summary" ref={summaryText} lang={context.language??''}>{displayed.map((block,index)=>(block.kind==='heading') ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)}</div>
    <div className="insight-summary-footer">{blocks.length>2&&<button onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded ? <UiMessage id="procedurecontext.show_less.4c852b"/> : <UiMessage id="procedurecontext.continue_reading.4f4840"/>}</button>}<small><span lang={language}>{new Intl.DisplayNames([language],{type:'language'}).of(context.language)}</span>{context.summary.method ? (' · '+context.summary.method) : ''}</small></div>
  </div>;
  const topicCount=context ? (context.topics.length||context.subjects.length) : 0;
  const recordTopics=<RecordTopics id={reference.replace(/^(\d{4})\/(\d{4}[A-Z]?).*$/,'$1-$2')} full language={language}/>;
  const topics=context&&<>
    {recordTopics}
    {context.topics.length>0&&<div className="insight-official-topics"><div>{context.topics.map(topic=>onTopic ? <button key={topic.id} lang={topic.language??''} onClick={()=>onTopic(topic)}>{topic.label} <span aria-hidden="true">↗</span></button> : <SourceLink key={topic.id} url={topic.id} language={language} contentLanguage={topic.language??''}>{topic.label}</SourceLink>)}</div></div>}
    {context.subjects.length>0&&<section className="insight-subject-classification" aria-label={ui.t("procedurecontext.subject_classification.eaa65a")}><h4><UiMessage id="procedurecontext.subject_classification.eaa65a"/></h4><ul>{context.subjects.map(subject=><li key={subject.code} lang={context.language??''}><a onClick={dossierLinkClick} href={topicsHref('oeil:'+subject.code)}>{subject.label}</a></li>)}</ul></section>}
  </>;
  const reservePurpose=!purpose&&proposalFamily(reference)&&loading&&!context;
  const pending=!title&&!unknown&&(loading||heldRead.loading);
  return <article className="vs dossier-page" lang={ui.language} data-dossier-page={reference} data-procedure-context-pending={(!context&&loading&&!fallbackTitle) ? 'true' : undefined}>
    <PageStrip back={<DossierBack language={language} plenaryDate={heldStatus?.slots?.plenaryDate||null}/>}/>
    <div className="insight-dossier-title">
      {title ? <h1 tabIndex={-1} lang={title.titleLanguage??''}>{title.title}</h1> : pending&&<h1 tabIndex={-1} className="dossier-title-pending" role="status"><UiMessage id="insightshared.loading"/></h1>}
      {purpose ? <p className="say dossier-purpose" lang={purpose.language}>{purpose.text}</p> : reservePurpose&&<p className="say dossier-purpose" aria-hidden="true"/>}
      <div className="dossier-identity-row"><p lang="">{reference}</p>{(!loading||Boolean(heldTitle))&&!unknown&&<FollowDossierButton reference={reference} title={title?.title} titleLanguage={title?.titleLanguage}/>}{!unknown&&<AmendmentTrailLink procedure={reference} language={language}><UiMessage id="batch5.procedurecontext.tsx.27.68"/></AmendmentTrailLink>}</div>
      {!unknown&&heldStatus?.rapporteurs&&heldStatus.rapporteurs.length>0&&<Rapporteurs people={heldStatus.rapporteurs} language={language}/>}
    </div>
    <DossierStatus reference={reference} language={language} summaries={context?.summaries} votingList labelled officialMissing={officialMissing} onMissing={setRecordMissing}/>
    {!unknown&&<div className="frows dossier-rows" ref={rows}>
      {/* The summary row holds its place while the Observatory answers, so the rows below never move. */}
      {context?.summary ? <FoldRow title={<UiMessage id="batch5.procedurecontext.tsx.33.71"/>} value={summaryValue}>{summaryBlock}</FoldRow>
        : <div className="frow"><p className="flink dossier-row-gap"><span className="t"><UiMessage id="batch5.procedurecontext.tsx.33.71"/></span>{(context||!loading) ? <span className="val"><UiMessage id="procedurecontext.summary_unavailable.9f4198"/></span> : <span className="val" role="status"><UiMessage id="insightshared.loading"/></span>}</p></div>}
      <FoldRow id="people" title={<UiMessage id="dossierpage.people"/>} value={people??undefined} open={peopleOpen} onOpenChange={setPeopleOpen} preload={near}>
        <DossierActivity key={'activity:'+reference+':'+language} reference={reference} language={language} onProcedure={setMetadata} onPeople={setPeople}/>
      </FoldRow>
      {topicCount>0&&<FoldRow title={<UiMessage id="batch4.questiontopics.tsx.topics"/>} value={topicCount} preload={near}>{topics}</FoldRow>}
      {press>0&&<FoldRow title={<UiMessage id="dossierpage.press"/>} value={press}><PressMentions reference={reference} language={language} limit={5}/></FoldRow>}
      {events>0&&<FoldRow title={<UiMessage id="dossierpage.timeline"/>} value={<UiMessage id="dossierpage.events" values={{count:events}} counts={{count:events}}/>}><ProcedureProgress key={reference+':'+language} reference={reference} language={language} proposalDate={proposalDate} timeline inRow/></FoldRow>}
    </div>}
    {context&&!context.summary&&!context.topics.length&&!context.subjects.length&&<p className="dossier-source"><a href={context.source.url} target="_blank" rel="noreferrer"><UiMessage id="procedurecontext.open_procedure_file.41bcb5"/></a></p>}
  </article>;
}
