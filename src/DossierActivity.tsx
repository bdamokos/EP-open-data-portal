import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import {Fragment,lazy,Suspense,useEffect,useRef,useState} from 'react';
import {amendmentStages,committeeAmendmentList,committeeAmendmentTarget,validCommitteeCode} from './amendmentModel.mjs';
import type {AmendmentStage} from './AmendmentTypes';
import {sourcePageUrl} from './SourceLink';
import {api} from './data';
const DossierVoteText=lazy(()=>import('./DossierVoteText'));
const AmendmentCard=lazy(()=>import('./Amendments').then(module=>({default:module.AmendmentCard})));
import {InsightSpeechReader} from './InsightReaders';
import {Position,Result} from './MemberVoteSummary';
import {PersonName,usePersonName} from './PersonName';
import {humanDate,insightMemberHref,roleName} from './InsightShared';
import {memberVoteLabel,memberVoteOutcome} from './memberVotesPresentation.mjs';
import {useExplorerParam} from './explorerUrl';
import {dossierCoverageNotices,dossierEmptyLabel,dossierUnrenderedDecisions,dossierVoteCards,dossierFilters,dossierHref,dossierTimeline,fullDossierReference,mergeDossierPage,retainDossierContributors,validDossierPerson} from './dossierActivityModel.mjs';
import {dossierBackHref,dossierLinkClick,navigateDossier,useDossierReaderState} from './dossierJourney';
import type {DossierActivityResponse,DossierAmendment,DossierCoverage,DossierCursor,DossierFilter,DossierItem,DossierReference,DossierReferencesResponse,DossierRole,DossierSection,DossierSource,DossierSpeech,DossierVote} from './DossierActivityTypes';
import {useInsightData} from './InsightData';
import './DossierActivity.css';

const voteAnchor=(id:string)=>'dossier-decision-'+encodeURIComponent(id);
const stageLabel=(value:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>({RDG1:ui.t("dossieractivity.first_reading"),RDG2:ui.t("dossieractivity.second_reading"),RDG3:ui.t("dossieractivity.third_reading")} as Record<string,string>)[value]||value;
const labels:Record<DossierFilter,string>={all:'All',roles:'Roles',speeches:'Speeches',amendments:'Amendments',votes:'Votes'};
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({all:ui.t("dossieractivity.all"),roles:ui.t("dossieractivity.roles"),speeches:ui.t("dossieractivity.speeches"),amendments:ui.t('legislation.amendments.900866'),votes:ui.t("dossieractivity.votes")});

type SectionState={data:DossierActivityResponse|null;loading:boolean;error:string|null};
const canRetryCoverage=(coverage:DossierCoverage|undefined)=>coverage?.retryable===true||coverage?.retryable!==false&&coverage?.status==='unavailable';
function useDossierSection(reference:string,person:string|null,section:DossierSection,language:string,active:boolean,stage:AmendmentStage='all',committee='') {
  const ui = useUiI18n();
  const [state,setState]=useState<SectionState>({data:null,loading:active,error:null});
  const [request,setRequest]=useState<{key?:string;cursor:DossierCursor;attempt:number}>({cursor:{offset:0,targetOffset:0},attempt:0});
  const key=JSON.stringify([reference,person,section,language,stage,committee]),scope=useRef(key),lastCursor=useRef<DossierCursor>({offset:0,targetOffset:0});
  const previous=useRef<DossierActivityResponse|null>(null);
  const pages=useRef(new Map<string,DossierActivityResponse>()),failedCursor=useRef<DossierCursor|null>(null);
  const earlierResultsRemoved=useRef(false);
  // Render fences prevent a new person from seeing the previous person's rows.
  const scoped=scope.current===key;
  useEffect(()=>{
    if(!active)return;
    const changed=scope.current!==key;scope.current=key;
    if(changed){previous.current=null;pages.current.clear();failedCursor.current=null;earlierResultsRemoved.current=false;lastCursor.current={offset:0,targetOffset:0};}
    const cursor=(changed||request.key!==key) ? ({offset:0,targetOffset:0}) : request.cursor;lastCursor.current=cursor;
    let live=true;const controller=new AbortController();
    setState({data:previous.current,loading:true,error:null});
    const query=new URLSearchParams({reference,lang:language,section,offset:String(cursor.offset),'target-offset':String(cursor.targetOffset),limit:'25'});if(person)query.set('member',person);
    if(section==='amendments'){query.set('stage',stage);if(committee)query.set('committee',committee);}
    api<DossierActivityResponse>('insights/dossier-activity?'+query,controller.signal).then(page=>{
      if(!live)return;
      if(!Number.isInteger(page.version)||page.version<12||page.procedure?.reference!==reference||page.memberId!==person||page.section!==section||!Array.isArray(page.items)||!page.coverage||!page.pagination||section==='amendments'&&(page.stage!==undefined&&page.stage!==stage||page.committee!==undefined&&(page.committee||'')!==committee))throw new Error(ui.t("dossieractivity.unexpected_dossier_response"));
      // A failed target read has no amendment snapshot. Keep its retry page,
      // and compare known generations even after an intervening failed read.
      const knownAmendmentGeneration=[...pages.current.values()].find(saved=>saved.amendmentGeneration!==undefined)?.amendmentGeneration;
      const amendmentSnapshotChanged=knownAmendmentGeneration!==undefined&&page.amendmentGeneration!==undefined&&knownAmendmentGeneration!==page.amendmentGeneration;
      if(previous.current&&(previous.current.generation!==page.generation||amendmentSnapshotChanged)){
        // An amendment publication invalidates rows, not an unresolved detail
        // read in the same activity snapshot. Keep only its row-free retry page.
        const failures=(previous.current.generation===page.generation) ? [...pages.current.entries()].filter(([,saved])=>saved.amendmentGeneration===undefined&&!saved.items.length&&canRetryCoverage(saved.coverage)) : ([]);
        pages.current.clear();
        for(const [key,failure]of failures)pages.current.set(key,failure);
        if(cursor.offset||cursor.targetOffset){earlierResultsRemoved.current=true;page={...page,coverage:{...page.coverage,status:(page.coverage.status==='complete') ? 'partial' : page.coverage.status,checkedComplete:false}};}
      }
      const pageKey=JSON.stringify(cursor);page=retainDossierContributors(pages.current.get(pageKey),page);
      pages.current.set(pageKey,page);failedCursor.current=null;
      const ordered=[...pages.current.values()].sort((a,b)=>a.pagination.targetOffset-b.pagination.targetOffset||a.pagination.offset-b.pagination.offset);
      const data=ordered.reduce<DossierActivityResponse|null>((all,page)=>mergeDossierPage(all,page),null)!;
      previous.current=data;setState({data,loading:false,error:null});
    }).catch(error=>{if(live){failedCursor.current=cursor;setState({data:previous.current,loading:false,error:error.message||'Section unavailable.'});}});
    return()=>{live=false;controller.abort();};
  },[key,active,request]);
  const unavailable=[...pages.current.values()].find(page=>canRetryCoverage(page.participantCoverage))||[...pages.current.values()].find(page=>canRetryCoverage(page.coverage));
  return {...(scoped ? state : ({data:null,loading:active,error:null})),pages:[...pages.current.values()],earlierResultsRemoved:scoped&&earlierResultsRemoved.current,retryableUnavailable:Boolean(unavailable),retry:()=>setRequest(value=>({key,cursor:failedCursor.current||(unavailable ? ({offset:unavailable.pagination.offset,targetOffset:unavailable.pagination.targetOffset}) : lastCursor.current),attempt:value.attempt+1})),restart:()=>{previous.current=null;pages.current.clear();failedCursor.current=null;earlierResultsRemoved.current=false;setState({data:null,loading:true,error:null});setRequest(value=>({key,cursor:{offset:0,targetOffset:0},attempt:value.attempt+1}));},more:()=>{if(state.data?.pagination.next&&!state.loading)setRequest(value=>({key,cursor:state.data!.pagination.next!,attempt:value.attempt+1}));}};
}

function Source({source,language,label: labelProp}:{source:DossierSource;id?:string;language:string;label?:string}) {
const ui = useUiI18n();
const label = labelProp ?? ui.t("dossieractivity.source");

  const href=sourcePageUrl(source.url,{language:source.language||language});
  return href ? <a className="dossier-source" href={href} target="_blank" rel="noreferrer"><>{label} ↗</></a> : null;
}
function Coverage({coverage,language,pages}:{coverage:DossierCoverage;section:DossierSection|'people';language:string;pages:DossierActivityResponse[]}) {
  const notices=dossierCoverageNotices(coverage,pages);
  if(!notices.length)return null;
  return <ul className="dossier-coverage">{notices.map(notice=>{
    if(notice.kind==='contributions')return <li key={'contributions:'+notice.id}><UiMessage id="dossieractivity.count_debate_contributions_from_date_not_loaded" values={{count:notice.count,date:<time dateTime={notice.date} lang={language}>{humanDate(notice.date!,language)}</time>}}/></li>;
    if(notice.kind==='debate')return <li key={'debate:'+notice.id}><UiMessage id="dossieractivity.debate_item_item_on_date_could_not_be_loaded" values={{item: notice.item, date: <time dateTime={notice.date} lang={language}>{humanDate(notice.date!,language)}</time>}}/></li>;
    const committee=committeeAmendmentList(notice.id)||committeeAmendmentTarget(notice.id);
    const href=sourcePageUrl('https://data.europarl.europa.eu/api/v2/'+(committee ? 'documents/' : 'plenary-documents/')+notice.id,{language});
    if(committee)return <li key={'target:'+notice.id}><UiMessage id="dossieractivity.committee_amendments_could_not_be_loaded" values={{committee:notice.id.split('-')[0]}}/>{href&&<> <a href={href} target="_blank" rel="noreferrer"><UiMessage id="dossieractivity.view_document_on_parliament"/></a></>}</li>;
    const reference=notice.id.replace(/^(A|B|RC)-10-(\d{4})-(\d{4,6})$/,(_match,family,year,number)=>((family==='RC') ? 'RC-B' : family)+'10-'+number+'/'+year);
    return <li key={'target:'+notice.id}><UiMessage id="dossieractivity.amendments_for_reference_could_not_be_loaded" values={{reference}}/>{href&&<> <a href={href} target="_blank" rel="noreferrer"><UiMessage id="dossieractivity.view_document_on_parliament"/></a></>}</li>;
  })}</ul>;
}
function Role({item,language}:{item:DossierRole;language:string}) {
  const ui = useUiI18n();
  return <article className="dossier-role"><h4>{roleName(item.role, ui)}</h4>{(item.committee||item.stage)&&<p>{[item.committee,item.stage ? stageLabel(item.stage, ui) : ''].filter(Boolean).join(' · ')}</p>}{(item.date||item.documentId)&&<p>{item.date&&<>{(item.dateBasis==='document') ? <UiMessage id="dossieractivity.document_date_date.f03e49" values={{date: <time lang={language}>{humanDate(item.date,language)}</time>}}/> : <UiMessage id="dossieractivity.date_date.8be752" values={{date: <time lang={language}>{humanDate(item.date,language)}</time>}}/>}</>}{item.documentId ? ((item.date ? ' · ' : '')+item.documentId) : ''}</p>}<Source source={item.source} id={item.participationId||item.id} language={language}/></article>;
}
function Ballot({item,language,memberName,inline=false,inlineLabel=false}:{item:DossierVote;language:string;memberName:string;inline?:boolean;inlineLabel?:boolean}) {
  const ui = useUiI18n();
  const [textOpen,setTextOpen]=useDossierReaderState('dossier-vote-text:'+item.id,false);
  return <article className={'dossier-vote'+(inline ? ' dossier-vote-inline' : '')} id={voteAnchor(item.id)} data-dossier-vote={item.id}>
    <p className="dossier-muted">{inline ? <strong><UiMessage id="dossieractivity.outcome_in_plenary" values={{outcome: memberVoteOutcome(item.vote, ui)}}/></strong> : ui.t("dossieractivity.plenary_vote")}{item.date&&<> · <time dateTime={item.date} lang={language}>{humanDate(item.date,language)}</time></>}{item.stage ? (' · '+stageLabel(item.stage, ui)) : ''}</p>
    {inline&&inlineLabel&&<h5>{memberVoteLabel(item.vote,language, ui)}</h5>}
    {!inline&&<><h4>{memberVoteLabel(item.vote,language, ui)}</h4>{item.vote.title&&<p lang={item.vote.titleLanguage??''}>{item.vote.title}</p>}</>}
    {inline ? <><Position vote={item.vote} memberName={memberName} compact/>{item.vote.ballotStatus!=='not-conducted'&&<details className="dossier-vote-totals"><summary><UiMessage id="dossieractivity.vote_totals"/></summary><Result vote={item.vote}/></details>}</> : <div className="dossier-ballot"><Position vote={item.vote} memberName={memberName}/><Result vote={item.vote}/></div>}
    {item.vote.intention?.status==='reported'&&<p className="dossier-muted"><UiMessage id="dossieractivity.declared_intention_positions" values={{positions: item.vote.intention.positions.map(position=>({for:ui.t('membervotespresentation.for'),against:ui.t('membervotespresentation.against'),abstaining:ui.t('activityvote.abstain')}[position])).join(', ')}}/></p>}
    {!inline&&<details open={textOpen} onToggle={event=>setTextOpen(event.currentTarget.open)}><summary>{(item.vote.scope.kind==='procedural') ? <UiMessage id="dossieractivity.read_vote_description"/> : <UiMessage id="dossieractivity.read_text"/>}</summary>{textOpen&&<Suspense fallback={<p role="status"><UiMessage id="dossieractivity.loading_text"/></p>}><DossierVoteText key={item.id+':'+language} vote={item.vote} language={language}/></Suspense>}</details>}
  </article>;
}
function Amendment({item,votes,shared,showOutcome,unloaded,votesPending,onMoreVotes,language,memberName,memberId}:{item:DossierAmendment;votes:DossierVote[];shared:DossierVote[];showOutcome:boolean;unloaded:boolean;votesPending:boolean;onMoreVotes?:()=>void;language:string;memberName:string;memberId:string}) {
  const ui = useUiI18n();
  return <div className="dossier-amendment">
    <AmendmentCard item={item.amendment} showOutcome={showOutcome} reader readerDecisions={dossierUnrenderedDecisions(item,[...votes,...shared])} memberId={memberId} language={language} onMember={id=>navigateDossier(insightMemberHref(String(id),language))}>
      {(item.tabling.status==='recorded'&&item.tabling.date||item.tabling.status==='conflicting')&&<p className="dossier-muted">{((item.tabling.status==='recorded') && item.tabling.date) ? <>{item.stage ? <UiMessage id="dossieractivity.tabled_date_stage.2d414e" values={{date: <time dateTime={item.tabling.date} lang={language}>{humanDate(item.tabling.date,language)}</time>, stage: stageLabel(item.stage, ui)}}/> : <UiMessage id="dossieractivity.tabled_date" values={{date: <time dateTime={item.tabling.date} lang={language}>{humanDate(item.tabling.date,language)}</time>}}/>}</> : ui.t("dossieractivity.conflicting_tabling_dates")}</p>}
      {votes.length>0&&<section aria-label={ui.t("dossieractivity.recorded_votes_on_this_amendment")}>{votes.map(vote=><Ballot key={vote.id} item={vote} language={language} memberName={memberName} inline inlineLabel={showOutcome}/>)}</section>}
      {unloaded&&votesPending&&<p className="dossier-muted"><UiMessage id="dossieractivity.vote_details_not_loaded"/>{onMoreVotes&&<> <button type="button" onClick={onMoreVotes}><UiMessage id="dossieractivity.check_more_votes"/></button></>}</p>}
      {shared.map(vote=><p key={vote.id} className="dossier-muted"><strong><UiMessage id="dossieractivity.outcome_in_plenary" values={{outcome: memberVoteOutcome(vote.vote, ui)}}/></strong>{vote.date&&<> · <time dateTime={vote.date} lang={language}>{humanDate(vote.date,language)}</time></>}<br/><Position vote={vote.vote} memberName={memberName} compact/>{' '}<a href={'#'+voteAnchor(vote.id)} onClick={event=>{event.preventDefault();const target=document.getElementById(voteAnchor(vote.id));if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}}}><UiMessage id="dossieractivity.view_the_vote"/></a></p>)}
    </AmendmentCard>
  </div>;
}

function Speech({item,language}:{item:DossierSpeech;language:string}) {
  const ui = useUiI18n();
  const [open,setOpen]=useDossierReaderState('dossier-speech:'+item.id,false);
  return <article className="dossier-speech"><h4 lang={item.titleLanguage??''}>{item.title||ui.t("dossieractivity.speech")}</h4>{item.jointDebate&&<p className="dossier-muted"><UiMessage id="dossieractivity.joint_debate"/></p>}<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><UiMessage id="dossieractivity.read_speech"/></summary>{open&&<InsightSpeechReader id={item.id} language={language}/>}</details></article>;
}

export function DossierActivity({reference,language='en',onProcedure}:{reference:string;language?:string;onProcedure?:(procedure:DossierReference)=>void}) {
  const ui = useUiI18n();
  const [rawPerson]=useExplorerParam<string|null>('dossier-person',null),[filter]=useExplorerParam<DossierFilter>('dossier-show','all',dossierFilters);
  const [stage]=useExplorerParam<AmendmentStage>('dossier-stage','all',amendmentStages),[rawCommittee]=useExplorerParam('dossier-committee','');
  const committee=((stage!=='plenary') && validCommitteeCode(rawCommittee)) ? rawCommittee : '';
  const person=validDossierPerson(rawPerson) ? rawPerson : null,displayName=usePersonName();
  const roles=useDossierSection(reference,person,'roles',language,true);
  useEffect(()=>{if(roles.data?.procedure)onProcedure?.(roles.data.procedure);},[roles.data?.procedure,onProcedure]);
  const speeches=useDossierSection(reference,person,'speeches',language,Boolean(person)&&(filter==='all'||filter==='speeches'));
  const amendments=useDossierSection(reference,person,'amendments',language,Boolean(person)&&(filter==='all'||filter==='amendments'),stage,committee);
  const votes=useDossierSection(reference,person,'votes',language,Boolean(person)&&['all','amendments','votes'].includes(filter));
  const states={roles,speeches,amendments,votes};
  const participants=roles.data?.participants||[],selected=participants.find(row=>row.id===person),memberName=person ? (displayName(person,selected?.name)||ui.t("dossieractivity.selected_person")) : '';
  const visibleSections=(person ? ((filter==='all') ? (['roles','speeches','amendments','votes']) : ((filter==='amendments') ? (['amendments','votes']) : ([filter]))) : (['roles'])) as DossierSection[];
  const nonVotes:DossierItem[]=person ? (['roles','speeches','amendments'] as const).filter(section=>filter==='all'||filter===section).flatMap(section=>states[section].data?.items||[]) : ([]);
  const documentRoles=nonVotes.filter((row):row is DossierRole=>row.kind==='role'&&row.dateBasis==='document');
  const voteRows=(votes.data?.items||[]).filter((row):row is DossierVote=>row.kind==='vote');
  const visibleAmendments=nonVotes.filter((row):row is DossierAmendment=>row.kind==='amendment');
  const committees=[...new Set([...(committee ? ([committee]) : ([])),...visibleAmendments.flatMap(row=>row.amendment.committees?.map(item=>item.code)||[])])].sort();
  const chooseAmendmentFilter=(name:string,value:string)=>{const url=new URL(location.href);(value && (value!=='all')) ? url.searchParams.set(name,value) : url.searchParams.delete(name);url.searchParams.delete('dossier-list');url.searchParams.delete('dossier-document');if(name==='dossier-stage'&&value==='plenary')url.searchParams.delete('dossier-committee');navigateDossier(url.href);};
  const inlineVotes=dossierVoteCards(visibleAmendments,voteRows);
  const renderedVotes=new Set([...inlineVotes.values()].flatMap(group=>group.votes.map(row=>row.id)));
  const remaining=(filter==='votes') ? voteRows : ((filter==='all') ? voteRows.filter(row=>!renderedVotes.has(row.id)) : ([]));
  const sittings=new Map<string,DossierVote[]>();for(const row of remaining){const key=row.vote.sittingId;const group=sittings.get(key)||[];group.push(row);sittings.set(key,group);}
  const back=dossierBackHref();
  return <section className="dossier-activity" lang={ui.language} data-dossier-reference={reference} data-dossier-person={person||''} data-dossier-stage={stage} data-dossier-committee={committee} data-dossier-pending={(roles.loading||visibleSections.some(section=>states[section].loading)) ? 'true' : undefined}>
    {back&&<a className="dossier-back" href={back} onClick={dossierLinkClick}><UiMessage id="dossieractivity.back_to_where_you_were"/></a>}
    {rawPerson&&!person&&<p role="alert"><UiMessage id="dossieractivity.person_not_found_choose_a_participant"/></p>}
    <div className="dossier-scope"><h3>{person ? <UiMessage id="dossieractivity.work_on_this_dossier"/> : <UiMessage id="dossieractivity.people_on_this_dossier"/>}</h3>{person&&<><span className="dossier-person-chip"><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}><PersonName id={person} label={selected?.name} fallback={ui.t("dossieractivity.person_id", {id: String(person)})}/></a><RecordMemberAffiliation id={person} language={language}/><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick} aria-label={ui.t("dossieractivity.clear_person_selection")}>×</a></span><div className="dossier-exits"><a href={dossierHref(reference,null,language)} onClick={dossierLinkClick}><UiMessage id="dossieractivity.full_dossier"/></a><a href={insightMemberHref(person,language)} onClick={dossierLinkClick}><UiMessage id="dossieractivity.member_profile"/></a></div></>}</div>
    {person&&<nav className="dossier-filters" aria-label={ui.t("dossieractivity.dossier_activity_type")}>{dossierFilters.map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{const url=new URL(location.href);(value==='all') ? url.searchParams.delete('dossier-show') : url.searchParams.set('dossier-show',value);navigateDossier(url.href);}}><span>{labelsUi(ui)[value]}</span>{' '}<small>{(value==='all') ? ui.t("dossieractivity.all_activity.18524b") : ((states[value].data?.items.length && (states[value].data!.coverage.status!=='unavailable')) ? ui.t("dossieractivity.count_shown", {count: String(states[value].data!.items.length)}) : '—')}</small></button>)}</nav>}

    {person&&(filter==='all'||filter==='amendments')&&<div className="dossier-amendment-controls"><label><UiMessage id="dossieractivity.stage"/><select value={stage} onChange={event=>chooseAmendmentFilter('dossier-stage',event.target.value)}><option value="all"><UiMessage id="dossieractivity.all_stages"/></option><option value="committee"><UiMessage id="dossieractivity.committee"/></option><option value="plenary"><UiMessage id="dossieractivity.plenary"/></option></select></label>{stage!=='plenary'&&(committees.length>1||committee)&&<label><UiMessage id="dossieractivity.committee"/><select value={committee} onChange={event=>chooseAmendmentFilter('dossier-committee',event.target.value)}><option value=""><UiMessage id="dossieractivity.all_committees"/></option>{committees.map(code=><option key={code} value={code}>{code}</option>)}</select></label>}</div>}
    {!visibleSections.includes('roles')&&roles.error&&<p role="alert"><UiMessage id="dossieractivity.participant_records_could_not_be_loaded"/> <button type="button" disabled={roles.loading} onClick={roles.retry}><UiMessage id="dossieractivity.retry_participants"/></button></p>}
    {!person&&roles.data?.participantCoverage&&<Coverage coverage={roles.data.participantCoverage} section="people" language={language} pages={[]}/>}
    {!person&&roles.data&&!roles.loading&&!participants.length&&dossierEmptyLabel(roles.data.participantCoverage||roles.data.coverage)&&<p>{dossierEmptyLabel(roles.data.participantCoverage||roles.data.coverage,ui)}</p>}
    {participants.length>0&&<details className="dossier-participants" open={!person}><summary><UiMessage id="dossieractivity.people_count_shown" values={{count: participants.length}}/></summary><ul>{participants.map(participant=><li key={participant.id}><a href={insightMemberHref(participant.id,language)} onClick={dossierLinkClick}><PersonName id={participant.id} label={participant.name} fallback={ui.t("dossieractivity.person_id", {id: String(participant.id)})}/></a><RecordMemberAffiliation id={participant.id} language={language}/><ul>{participant.roles.map(role=><li key={role.id}>{roleName(role.role, ui)}{role.committee ? (' · '+role.committee) : ''}{role.date ? (' · '+humanDate(role.date,language)) : ''}{(role.dateBasis==='document') ? (' · '+ui.t('dossieractivity.document_date')) : ''}{role.stage ? (' · '+stageLabel(role.stage, ui)) : ''}<Source source={role.source} id={role.id} language={language}/></li>)}</ul>{Boolean(participant.speeches?.length)&&<p className="dossier-muted"><UiMessage id="dossieractivity.speeches_count_shown" values={{count: participant.speeches!.length}}/></p>}{(['committee','plenary'] as const).map(stage=>{const count=participant.amendmentCounts?.[stage];return (((count!==null) && (count!==undefined)) && (count>0)) ? <p key={stage}><DossierAmendmentLinks references={[{id:roles.data!.procedure.id,reference}]} person={participant.id} language={language} stage={stage} count={count}/></p> : null;})}<a href={dossierHref(reference,participant.id,language)} onClick={dossierLinkClick}><UiMessage id="dossieractivity.work_on_this_dossier"/></a></li>)}</ul></details>}
    {person&&<>{documentRoles.length>0&&<section className="dossier-document-roles"><h4><UiMessage id="dossieractivity.roles_recorded_on_documents"/></h4>{documentRoles.map(item=><Role key={item.id} item={item} language={language}/>)}</section>}<ol className="dossier-timeline">{dossierTimeline(nonVotes).map(group=><li key={group.id}><p className="dossier-event-date">{group.date ? <time lang={language}>{humanDate(group.date,language)}</time> : ui.t("dossieractivity.date_unavailable")}</p>{group.items.map(item=>(item.kind==='role') ? <Role key={item.id} item={item} language={language}/> : ((item.kind==='speech') ? <Speech key={item.id} item={item} language={language}/> : ((item.kind==='amendment') ? <Amendment key={item.id} item={item} votes={inlineVotes.get(item.id)?.votes||[]} shared={inlineVotes.get(item.id)?.shared||[]} showOutcome={inlineVotes.get(item.id)?.showOutcome??true} unloaded={Boolean(inlineVotes.get(item.id)?.unloaded)} votesPending={Boolean(votes.loading||votes.error||votes.data?.pagination.next)} onMoreVotes={(votes.data?.pagination.next && (!votes.loading)) ? votes.more : undefined} language={language} memberName={memberName} memberId={person}/> : null)))}</li>)}</ol>
      {[...sittings.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,rows])=><section className="dossier-sitting" key={id}><h4>{(filter==='all') ? ui.t("dossieractivity.other_votes") : ui.t("dossieractivity.votes")} · <time lang={language}>{humanDate(rows[0].date||'',language)}</time></h4>{rows.map(row=><Ballot key={row.id} item={row} language={language} memberName={memberName}/>)}</section>)}
      {visibleSections.every(section=>states[section].data&&!states[section].loading&&!states[section].error&&dossierEmptyLabel(states[section].data!.coverage))&&!nonVotes.length&&!remaining.length&&filter!=='amendments'&&<p><UiMessage id="dossieractivity.no_linked_records"/></p>}
      {filter==='amendments'&&amendments.data&&!amendments.loading&&!visibleAmendments.length&&dossierEmptyLabel(amendments.data.coverage)&&<p><UiMessage id="dossieractivity.no_matching_amendments"/></p>}
    </>}
    <div className="dossier-section-status">{visibleSections.map(section=>{const state=states[section];return <section key={section} aria-label={ui.t("dossieractivity.section_coverage", {section: String(labelsUi(ui)[section])})}>{state.data&&<Coverage coverage={state.data.coverage} section={section} language={language} pages={state.pages}/>} {state.loading&&<p role="status"><UiMessage id="dossieractivity.loading_section" values={{section: labelsUi(ui)[section].toLowerCase()}}/></p>}{state.error&&<p role="alert">{(section==='amendments') ? ui.t("dossieractivity.could_not_load_amendments") : ui.t("dossieractivity.section_could_not_be_loaded", {section: String(labelsUi(ui)[section])})} <button type="button" disabled={state.loading} onClick={state.retry}>{(section==='amendments') ? ui.t("commissionfollowups.try_again") : ((!person) ? ui.t("dossieractivity.retry_people.879eb7") : ui.t("dossieractivity.retry_section", {section: String(labelsUi(ui)[section].toLowerCase())}))}</button></p>}{!state.error&&state.retryableUnavailable&&<button type="button" disabled={state.loading} onClick={state.retry}><UiMessage id={!person?"dossieractivity.retry_people.879eb7":"dossieractivity.retry_section"} values={{section:labelsUi(ui)[section].toLowerCase()}}/></button>}{state.earlierResultsRemoved&&<p className="dossier-muted"><UiMessage id="dossieractivity.earlier_results_need_reloading"/> <button type="button" disabled={state.loading} onClick={state.restart}><UiMessage id={!person?"dossieractivity.reload_people.aaa03a":"dossieractivity.reload_section"} values={{section:labelsUi(ui)[section].toLowerCase()}}/></button></p>}{state.data?.pagination.next&&<button type="button" disabled={state.loading} onClick={state.more}><UiMessage id={!person?"dossieractivity.load_more_people.ff35c3":"dossieractivity.load_more_section"} values={{section:labelsUi(ui)[section].toLowerCase()}}/></button>}</section>;})}</div>
  </section>;
}

export function DossierAmendmentLinks({references,person,language='en',stage,count}:{references:Pick<DossierReference,'id'|'reference'>[];person:string|number;language?:string;stage:'committee'|'plenary';count:number}) {
  const ui = useUiI18n();
  const exact=references.filter(row=>fullDossierReference(row.reference));
  const stageLabel=ui.t((stage==='committee') ? 'dossieractivity.committee' : 'dossieractivity.plenary').toLocaleLowerCase(ui.locale);
  const content=<UiMessage id="dossieractivity.count_stage_amendments" values={{count,stage:stageLabel}}/>;
  const accessible=ui.t('dossieractivity.at_least_count_stage_amendments',{count,stage:stageLabel});
  const link=(row:typeof exact[number])=><a key={row.reference} aria-label={(exact.length>1) ? ui.t("dossieractivity.stage_amendments_reference", {stage: String(((stage==='committee') ? ui.t("dossieractivity.committee") : ui.t("dossieractivity.plenary"))), reference: String(row.reference)}) : accessible} href={dossierHref(row.reference,person,language,location.href,{section:'amendments',stage})} onClick={dossierLinkClick}>{(exact.length>1) ? row.reference : content}</a>;
  return <span className="dossier-amendment-links">{(exact.length===1) ? link(exact[0]) : ((exact.length>1) ? <details><summary aria-label={accessible}><UiMessage id="dossieractivity.count_stage_amendments_choose_a_procedure" values={{count,stage:stageLabel}}/></summary>{exact.map(link)}</details> : <span aria-label={accessible}>{content}</span>)}</span>;
}
export function DossierWorkLinks({references,person,language='en'}:{references:Pick<DossierReference,'id'|'reference'>[];person:string|number;language?:string}) {
  const ui = useUiI18n();
  const exact=references.filter(row=>fullDossierReference(row.reference));
  if(!exact.length)return null;
  const link=(row:typeof exact[number])=><a key={row.reference} href={dossierHref(row.reference,person,language)} onClick={dossierLinkClick}>{(exact.length>1) ? <UiMessage id="dossieractivity.work_on_this_dossier_reference" values={{reference: String(row.reference ?? '')}}/> : <UiMessage id="dossieractivity.work_on_this_dossier"/>}</a>;
  return <div className="dossier-work-links">{(exact.length===1) ? link(exact[0]) : <details><summary><UiMessage id="dossieractivity.work_on_this_dossier_choose_a_procedure"/></summary>{exact.map(link)}</details>}</div>;
}
export function ActivityDossierLinks({procedureIds,person,language='en'}:{procedureIds?:string[];person:string|number;language?:string}) {
  const ids=[...new Set((procedureIds||[]).filter(id=>/^\d{4}-\d{4}[A-Z]?$/.test(id)))];
  // Resolver accepts at most three exact IDs; remaining IDs stay explicit.
  const query=new URLSearchParams({procedures:ids.slice(0,3).join(','),lang:language});
  const state=useInsightData<DossierReferencesResponse>(ids.length ? ('insights/dossier-references?'+query) : null);
  if(!ids.length)return null;
  return <div className="dossier-work-links">{state.data&&<DossierWorkLinks references={state.data.items.filter(row=>ids.includes(row.id))} person={person} language={language}/>} {state.loading&&<p role="status"><UiMessage id="dossieractivity.finding_dossier_references"/></p>}{state.error&&<p role="alert"><UiMessage id="dossieractivity.dossier_references_unavailable"/> <button type="button" onClick={state.retry}><UiMessage id="dossieractivity.retry_dossier_links"/></button></p>}{state.data?.coverage.status!=='complete'&&state.data&&<p className="dossier-muted"><UiMessage id="dossieractivity.some_dossier_references_unavailable"/></p>}{ids.length>3&&<p className="dossier-muted"><UiMessage id="dossieractivity.first_3_of_count_procedures_shown" values={{count: ids.length}} counts={{count: ids.length}}/></p>}</div>;
}
