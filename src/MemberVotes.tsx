import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import type {WordingFormat} from './components/WordingFormatting';
import {VoteSubjectTitle} from './VoteSubjectTitle';
import {AttendanceLine} from './MemberAttendance';
import type {MemberAttendanceResponse} from './MemberAttendanceTypes';
import {memberAttendanceRoute,validateMemberAttendanceResponse} from './memberAttendancePresentation.mjs';
import {voteMethodLabel} from './voteMethod.mjs';
import {PersonName} from './PersonName';
import {Result,Position,VotePartDescriptions} from './MemberVoteSummary';
import {OutcomeAlignmentFilter} from './OutcomeAlignmentFilter';
import {VotePeriodNavigation} from './VotePeriodNavigation';
import {validateVotePeriods,votePeriodTransition,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useData} from './data';
import {selectLanguageText} from './language.mjs';
import {selectVoteTitle} from './voteTitles.mjs';
import type {MemberVote,MemberVotesResponse,MemberVoteWholeTextDecision} from './MemberVotesTypes';
import {MEMBER_VOTES_PAGE_SIZE,memberVotesCoverageNotice,displayVoteTitle,exactAmendmentTargets,groupMemberVotes,memberVoteLabel,memberVoteParentLabel,memberVoteOutcome,memberVotePositionSummary,memberVotesRoute as memberVotesRequestRoute,topLevelVoteDocuments,validateMemberVotesResponse} from './memberVotesPresentation.mjs';
import './MemberVotes.css';
import {WordingDiff} from './components/WordingDiff';
import {AmendmentJustification} from './components/AmendmentJustification';
import {MemberVoteExplanations} from './MemberVoteExplanations';

export type MemberVotesContext={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;view:'document'|'adopted'};
export type MemberVotesState={
  week:string;sittingId:string|null;positions:'recorded'|'all';alignment:'all'|'with'|'against'|'abstained';offset:number;
  decisionId:string|null;snapshotId:string|null;expandedSubjectIds:string[];context:MemberVotesContext|null;
};
export type MemberVotesContextRequest=MemberVotesContext&{onBack:()=>void;backLabel:string;summary:ReactNode};
export type MemberVotesProps={
  memberId:number;memberName:string;language:string;state:MemberVotesState;
  onStateChange:(next:MemberVotesState,options?:{replace?:boolean})=>void;
  renderContext:(request:MemberVotesContextRequest)=>ReactNode;
};
export const defaultMemberVotesState:MemberVotesState={week:'latest',sittingId:null,positions:'all',alignment:'all',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null};

type WordingVariant={
  listId:string;language:string|null;targetLabel:string|null;targetLabelLanguage?:string|null;
  targetLabelSource?:Record<string,unknown>|null;fieldSources?:Record<string,unknown>|null;
  wordingStatus:'available'|'unavailable';originalText:string|null;proposedText:string|null;originalFormatting?:WordingFormat[];proposedFormatting?:WordingFormat[];authors:{name:string;personId?:string|null}[];
  justification?:string|null;metadataSource?:{url?:string;language?:string|null}|null;
  source?:Record<string,unknown>|null;sourceFreshness?:{status:string}|null;
  wordingRetained?:boolean|null;proposerRetained?:boolean|null;recordRetained?:boolean|null;
};
type WordingResponse={documentId:string;requestedLanguage:string;amendment:null|{id:string;status:'available'|'unavailable';variants:WordingVariant[]}};

const memberVotesRoute=(memberId:number,state:MemberVotesState,language:string)=>memberVotesRequestRoute(memberId,state,language,{view:'period'});

export function votePageSummary(data:MemberVotesResponse, positions:string, ui:import('./uiI18n.mjs').UiFormatter) {
  const page=data.pagination;
  const prefix=(page.mode==='period') ? 'count' : (page.returned ? 'start.end.of.total' : '0');
  const unit=(positions==='recorded') ? 'recorded.positions' : 'decisions';
  const recorded=(page.recordedTotal!==null) ? '.recordedcount.with.a.recorded.position' : '';
  const partial='';
  const reviewedRecorded=(ui.language==='ro'||ui.language==='lt')&&positions==='recorded'&&page.recordedTotal!==null;
  const id=reviewedRecorded ? `membervotes.summary.recorded.${page.mode==='period'?'period':page.returned?'page':'emptyPage'}` : (((prefix==='count') && (!recorded)) && (!partial)) ? (`membervotes.tsx.count.${unit}`) : (`batch2.membervotes.tsx.${prefix}.${unit}${recorded}${partial}`);
  return ui.t(id, {
    count:page.filteredTotal, start:page.offset+1, end:page.offset+page.returned,
    total:page.filteredTotal, ...(page.recordedTotal===null?{}:{recordedCount:page.recordedTotal}),
  });
}
function voteCount(count:number, positions:string, ui:import('./uiI18n.mjs').UiFormatter) {
  return ui.t((positions==='recorded') ? 'membervotes.tsx.count.recorded.positions' : 'membervotes.tsx.count.decisions',{count});
}
const dateLabel=(value:string|null,locale:string)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date) : value;
};
const languageLabel=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const chosenTitle=(record:{titles:Record<string,string>;title:string|null;titleLanguage:string|null},language:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>{
  const selected=selectVoteTitle(record.titles,language,record.title||'',record.titleLanguage||'en');
  return {raw:selected.sourceLiteral,text:displayVoteTitle(selected.text)||ui.t("membervotes.tsx.untitled.vote"),language:selected.language};
};
const periodLabel=(data:MemberVotesResponse|null,state:MemberVotesState, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>state.sittingId ? ui.t("membervotes.tsx.sitting.date",{date:dateLabel(state.sittingId.slice(7),ui.locale)}) : (data?.period.from ? ui.t("membervotes.tsx.week.of.date",{date:dateLabel(data.period.from,ui.locale)}) : ((state.week==='latest') ? ui.t("membervotes.tsx.latest.sitting.week") : ui.t("membervotes.tsx.week.of.date",{date:dateLabel(state.week,ui.locale)})));

function WholeText({vote,memberName,onDecision}:{vote:MemberVoteWholeTextDecision;memberName:string;onDecision:(id:string)=>void}) {
  const ui = useUiI18n();
  return <button type="button" className="member-votes-whole" onClick={()=>onDecision(vote.id)}><UiMessage id="membervotes.tsx.final.vote.outcome.position" values={{outcome: <strong>{memberVoteOutcome(vote, ui)}</strong>, position: <Position vote={vote} memberName={memberName} compact/>}}/></button>;
}

export function MemberVoteWording({documentId,amendmentId,language,openContext,showHeading=true}:{documentId:string;amendmentId:string;language:string;showHeading?:boolean;openContext:(context:MemberVotesContext)=>void}) {
  const ui = useUiI18n();
  const [selectedVersion,setSelectedVersion]=useState<string|null>(null);
  const query=new URLSearchParams({amendment:amendmentId,lang:language,body:'0'});
  const response=useData<WordingResponse>('document-context/'+encodeURIComponent(documentId)+'?'+query);
  const data=(((response.data?.documentId===documentId) && (response.data.requestedLanguage===language)) && (response.data.amendment?.id===amendmentId)) ? response.data : null;
  const variants=Array.isArray(data?.amendment?.variants) ? data.amendment.variants.filter(variant=>variant&&typeof variant.listId==='string'&&variant.listId.trim()&&['available','unavailable'].includes(variant.wordingStatus)) : ([]);
  const options=variants.map((variant,index)=>({variant,key:JSON.stringify(variant),value:(variants.filter(other=>other.listId===variant.listId).length===1) ? variant.listId : ('version:'+index)}));
  const initialVersion=((selectedVersion===null) && (options.length===1)) ? options[0].key : null;
  useEffect(()=>{if(initialVersion!==null)setSelectedVersion(initialVersion);},[initialVersion]);
  const selectedOption=(selectedVersion!==null) ? (options.find(option=>option.key===selectedVersion)||null) : ((options.length===1) ? options[0] : null);
  const selected=selectedOption?.variant||null;
  const textLanguage=((typeof selected?.language==='string') && selected.language.trim()) ? selected.language : null;
  const targetLanguage=((typeof selected?.targetLabelLanguage==='string') && selected.targetLabelLanguage.trim()) ? selected.targetLabelLanguage : null;
  const readable=selected?.wordingStatus==='available'&&typeof selected.originalText==='string'&&typeof selected.proposedText==='string';
  const authors=Array.isArray(selected?.authors) ? selected.authors.filter(author=>author&&typeof author.name==='string'&&author.name) : ([]);
  const number=/-AM-(\d+(?:-\d+)?)$/.exec(amendmentId)?.[1];
  return <section className="member-votes-wording">
    {showHeading&&<h3>{number ? ui.t("membervotes.tsx.amendment.number", {number: String(number)}) : ui.t("membervotes.tsx.amendment.wording")}</h3>}
    <>
      {response.loading&&!data&&<p role="status"><UiMessage id="membervotes.tsx.loading.amendment.wording"/></p>}
      {response.error&&<p role="alert"><UiMessage id="membervotes.tsx.amendment.wording.could.not.be.loaded"/> <button type="button" disabled={response.loading} onClick={response.retry}><UiMessage id="membervotes.tsx.retry.wording"/></button></p>}
      {!response.loading&&!response.error&&!variants.length&&<p><UiMessage id="membervotes.tsx.amendment.wording.unavailable.here"/></p>}
      {(options.length>1||selectedVersion!==null&&!selected)&&<label className="member-votes-variant"><UiMessage id="membervotes.tsx.published.version"/><select aria-label={ui.t("membervotes.tsx.amendment.published.version")} value={selectedOption?.value||''} onChange={event=>setSelectedVersion(options.find(option=>option.value===event.target.value)?.key??'')}>
        <option value=""><UiMessage id="membervotes.tsx.choose.a.published.version"/></option>{options.map(({variant,value},index)=><option key={value} value={value}>{(((typeof variant.language==='string') && variant.language.trim()) && (variant.wordingStatus==='unavailable')) ? <UiMessage id="membervotes.tsx.version.number.language.wording.unavailable" values={{number: (index+1), language: languageLabel(variant.language,ui.locale)}}/> : ((((typeof variant.language==='string') && variant.language.trim()) && (!(variant.wordingStatus==='unavailable'))) ? <UiMessage id="membervotes.tsx.version.number.language" values={{number: (index+1), language: languageLabel(variant.language,ui.locale)}}/> : (((!((typeof variant.language==='string') && variant.language.trim())) && (variant.wordingStatus==='unavailable')) ? <UiMessage id="membervotes.tsx.version.number.wording.unavailable" values={{number: (index+1)}}/> : <UiMessage id="membervotes.tsx.version.number" values={{number: (index+1)}}/>))}</option>)}
      </select></label>}
      {selected&&<>
        {typeof selected.targetLabel==='string'&&selected.targetLabel&&<><p className="member-votes-target-label" lang={targetLanguage||''}>{selected.targetLabel}</p></>}
        {(readable&&textLanguage||authors.length>0)&&<p className="member-votes-muted">{readable&&textLanguage&&ui.t("membervotes.tsx.text.language.language", {language: String(languageLabel(textLanguage,ui.locale))})}{authors.length>0&&<>{(readable && textLanguage) ? ' · ' : ''}<UiMessage id="membervotes.tsx.proposed.by.authors" values={{authors:<>{authors.map((author,index)=><span key={index}>{index ? ', ' : ''}<PersonName id={author.personId} label={author.name}/><RecordMemberAffiliation id={author.personId} language={language}/></span>)}</>}}/></>}</p>}
        {readable ? <div className="member-votes-comparison" lang={textLanguage||''}><WordingDiff originalFormatting={selected.originalFormatting} proposedFormatting={selected.proposedFormatting} key={selectedOption!.key} original={selected.originalText} proposed={selected.proposedText} language={textLanguage} emptySemantics="insertion-deletion" labels={{original:ui.t("membervotes.tsx.original.wording"),proposed:ui.t("membervotes.tsx.proposed.wording"),emptyOriginal:'',emptyProposed:''}}/></div> : <p><UiMessage id="membervotes.tsx.amendment.wording.unavailable.here"/></p>}
        {readable&&selected.wordingRetained&&<p className="member-votes-muted"><UiMessage id="membervotes.tsx.showing.saved.wording"/></p>}
        <AmendmentJustification record={selected}/>
        <button type="button" onClick={()=>openContext({documentId,amendmentId,listId:selected.listId,wordingLanguage:textLanguage,view:'document'})}><UiMessage id="membervotes.tsx.read.in.context"/></button>
      </>}
    </>
  </section>;
}

// The reader replaces the vote detail, so it keeps the position and result in view.
function ContextVote({vote,memberName,language}:{vote:MemberVote;memberName:string;language:string}) {
  const ui = useUiI18n();
  return <section className="member-votes-context-vote" aria-label={ui.t("membervotes.tsx.vote.on.this.text")}><p className="member-votes-eyebrow">{dateLabel(vote.date,ui.locale)}</p><p className="member-votes-context-label">{memberVoteLabel(vote,language, ui)}</p>
    <VotePartDescriptions vote={vote} language={language}/><div className="member-votes-strip"><Position vote={vote} memberName={memberName}/><Result vote={vote}/></div></section>;
}

function Detail({vote,data,memberName,language,onDecision,openContext,explanationsActive}:{vote:MemberVote;data:MemberVotesResponse;memberName:string;language:string;onDecision:(id:string)=>void;openContext:(context:MemberVotesContext)=>void;explanationsActive:boolean}) {
  const ui = useUiI18n();
  const subject=data.subjects.find(subject=>subject.id===vote.subjectId);
  const targets=exactAmendmentTargets(vote),documents=topLevelVoteDocuments(vote);
  const requesterLabels=vote.rollCallRequesters.filter(requester=>requester.binding==='exact-decision-was_motivated_by').map(requester=>selectLanguageText(requester.organizationLabels,language)).filter(label=>label.text);
  const requestIds=new Set(vote.parts.map(part=>part.requestId));
  const siblingVotes=data.items.filter(item=>item.id!==vote.id&&item.parts.some(part=>requestIds.has(part.requestId)));
  const contexts=vote.parts.flatMap(part=>[...part.contextComponents,part].sort((a,b)=>(/^\d+$/.test(String(a.number)) && /^\d+$/.test(String(b.number))) ? (Number(a.number)-Number(b.number)) : 0)).filter((component,index,all)=>all.findIndex(other=>other.componentId===component.componentId)===index);
  return <article className="member-votes-detail">
    <header><p className="member-votes-eyebrow">{dateLabel(vote.date,ui.locale)}</p>{subject&&<VoteSubjectTitle subject={subject} vote={vote} language={language}/>}<h2 tabIndex={-1}>{memberVoteLabel(vote,language, ui)}</h2></header>
    <section className="member-votes-strip" aria-label={ui.t("activityvote.member_position_and_parliament_result")}><Position vote={vote} memberName={memberName}/><Result vote={vote}/>
      {vote.intention.status==='reported'&&vote.intention.positions.length>0&&<p className="member-votes-intention"><UiMessage id="activityvote.declared_intention_positions_declared_afterwards_result_unchanged" values={{positions: <strong>{vote.intention.positions.map(position=>({for:ui.t("membervotespresentation.for"),against:ui.t("membervotespresentation.against"),abstaining:ui.t("activityvote.abstain")}[position])).join(', ')}</strong>}}/></p>}
    </section>
    <VotePartDescriptions vote={vote} language={language}/>
    {targets.map(target=><MemberVoteWording key={vote.id+':'+target.amendmentId+':'+language} {...target} language={language} openContext={openContext} showHeading={targets.length!==1||memberVoteLabel(vote,language, ui)!==ui.t("membervotes.tsx.amendment.number", {number: String(/-AM-(\d+(?:-\d+)?)$/.exec(target.amendmentId)?.[1]||'')})}/>)}
    {!targets.length&&vote.context.amendmentIds.length>0&&<p><UiMessage id="membervotes.tsx.amendment.wording.unavailable.here"/></p>}
    {explanationsActive&&<MemberVoteExplanations key={[data.member.id,vote.id,data.snapshotId,language].join(':')} vote={vote} data={data} memberId={data.member.id} language={language} onDecision={onDecision}/>}
    {contexts.length>0&&<details className="member-votes-related"><summary>{memberVoteParentLabel(vote,language,ui) ? <UiMessage id="membervotes.tsx.split.vote.parent" values={{parent: memberVoteParentLabel(vote,language,ui)}}/> : <UiMessage id="membervotes.tsx.split.vote"/>}</summary>{contexts.map(component=>{
      const text=selectLanguageText(Object.fromEntries(Object.entries(component.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
      return <div key={component.componentId}><h4>{(component.number!==null) ? ui.t("membervotes.tsx.part.number", {number: String(component.number)}) : ui.t("membervotes.tsx.another.part")}</h4>{text.text ? <p lang={text.language}>{text.text}</p> : <p><UiMessage id="membervotes.tsx.part.wording.unavailable.here"/></p>}</div>;
    })}</details>}
    {subject?.wholeTextDecisions.some(whole=>whole.id!==vote.id)&&<details className="member-votes-related"><summary><UiMessage id="membervotes.tsx.final.vote.on.the.whole.text"/></summary>{subject.wholeTextDecisions.filter(whole=>whole.id!==vote.id).map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={onDecision}/>)}</details>}
    {siblingVotes.length>0&&<section className="member-votes-siblings"><h3><UiMessage id="membervotes.tsx.other.decisions.shown.for.this.split.vote"/></h3>{siblingVotes.map(item=><button type="button" key={item.id} onClick={()=>onDecision(item.id)}><>{memberVoteLabel(item,language, ui)} · {memberVoteOutcome(item, ui)}</></button>)}</section>}
    {(vote.ballotStatus==='not-conducted'||voteMethodLabel(vote.method, ui))&&<p className="member-votes-muted">{(vote.ballotStatus==='not-conducted') ? ui.t("activityvote.not_put_to_a_vote") : voteMethodLabel(vote.method, ui)}</p>}
    {requesterLabels.length>0&&<p className="member-votes-requester"><UiMessage id="activityvote.roll_call_requested_by_requesters" values={{requesters: requesterLabels.map((label,index)=><span key={index} lang={label.language}>{(index>0) ? ', ' : ''}{label.text}</span>)}}/></p>}
    {documents.length>0&&<section className="member-votes-documents"><h3><UiMessage id="membervotes.tsx.about.the.text"/></h3>{documents.map(documentId=><div key={documentId}><button type="button" onClick={()=>openContext({documentId,view:'document'})}>{documentId.startsWith('A-') ? <UiMessage id="membervotes.tsx.read.report.documentid" values={{documentId: String(documentId ?? '')}}/> : (documentId.startsWith('RC-') ? <UiMessage id="membervotes.tsx.read.joint.motion.documentid" values={{documentId: String(documentId ?? '')}}/> : <UiMessage id="membervotes.tsx.read.motion.documentid" values={{documentId: String(documentId ?? '')}}/>)}</button><button type="button" onClick={()=>openContext({documentId,view:'adopted'})}><UiMessage id="membervotes.tsx.find.adopted.text"/></button></div>)}</section>}
  </article>;
}

export function MemberVotes({memberId,memberName,language,state,onStateChange,renderContext}:MemberVotesProps) {
  const ui = useUiI18n();
  const listRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null);
  const alignmentFocus=useRef<MemberVotesState['alignment']|null>(null);
  const listScroll=useRef(0),detailScroll=useRef(0),headingRef=useRef<HTMLDivElement>(null);
  const restoredPane=useRef<HTMLDivElement|null>(null);
  const focusedSelection=useRef<string|null>(null);
  const listHeadingRef=useRef<HTMLHeadingElement>(null);
  const lastSelection=useRef<{decisionId:string;groupId:string|null}|null>(null),returnFocus=useRef(false);
  const snapshotRefresh=useRef<{route:string;started:boolean;baseline:MemberVotesResponse|null}|null>(null);
  const chooseLatest=state.week==='latest'&&!state.sittingId&&!state.snapshotId&&!state.decisionId&&!state.context&&state.offset===0&&state.alignment==='all';
  const searchScope=JSON.stringify([memberId,language]);
  const [latestSearch,setLatestSearch]=useState<{scope:string;week:string;complete:boolean}|null>(null);
  const search=(latestSearch?.scope===searchScope) ? latestSearch : ({scope:searchScope,week:'latest',complete:false});
  const calendarRequest=useData<VotePeriodsResponse>(chooseLatest ? 'vote-periods' : null);
  const requestedWeek=chooseLatest ? search.week : state.week;
  const requestedState={...state,week:requestedWeek};
  const route=useMemo(()=>{try{return memberVotesRoute(memberId,{...state,week:requestedWeek},language);}catch{return null;}},[memberId,requestedWeek,state.sittingId,state.positions,state.alignment,state.offset,state.decisionId,state.snapshotId,language]);
  const request=useData<MemberVotesResponse>(route) as ReturnType<typeof useData<MemberVotesResponse>>&{status?:number};
  const valid=Boolean(request.data&&validateMemberVotesResponse(request.data,{memberId,state:requestedState}));
  const scope=JSON.stringify([memberId,language,requestedWeek,state.sittingId,state.positions,state.alignment,state.offset,state.snapshotId]);
  const retained=useRef<{scope:string;data:MemberVotesResponse}|null>(null);
  useLayoutEffect(()=>{
    if(request.error||request.data&&!valid)retained.current=null;
    else if(valid&&request.data)retained.current={scope,data:request.data};
  },[valid,request.data,request.error,scope]);
  // A decision read changes only selection. Keep this exact page mounted while
  // it resolves; never carry records across member, language, filter or snapshot.
  const previous=(request.loading && (retained.current?.scope===scope)) ? retained.current.data : null;
  const previousSelection=previous?.items.find(item=>item.id===state.decisionId)??((previous?.selected.item?.id===state.decisionId) ? previous.selected.item : null);
  const pendingCandidate=previous ? ({...previous,selected:state.decisionId ? (previousSelection ? ({status:'found' as const,item:previousSelection}) : ({status:'unavailable' as const,item:null})) : ({status:'not-requested' as const,item:null})}) : null;
  const candidateData=valid ? request.data : ((pendingCandidate && validateMemberVotesResponse(pendingCandidate,{memberId,state:requestedState})) ? pendingCandidate : null);
  const unavailableEarlier=chooseLatest&&!search.complete&&requestedWeek!=='latest'&&candidateData?.coverage.status==='unavailable';
  const findingLatest=chooseLatest&&!search.complete&&(!candidateData||candidateData.pagination.recordedTotal===0||unavailableEarlier);
  const data=findingLatest ? null : candidateData,groups=useMemo(()=>data ? groupMemberVotes(data) : ([]),[data]);
  const attendanceScope=JSON.stringify([memberId,language,state.sittingId ? (['sitting',state.sittingId]) : (['week',state.week])]);
  const [lastAttendance,setLastAttendance]=useState<{scope:string;route:string;sittingIds:string[]}|null>(null);
  const attendanceReady=Boolean(data&&!request.loading&&!request.error&&state.snapshotId===data.snapshotId);
  const resolvedAttendance=useMemo(()=>{
    // Start only after valid votes and canonical snapshot pinning settle.
    if(data&&attendanceReady)try{
      const sittingIds=data.coverage.scannedSittingIds;
      return {scope:attendanceScope,route:memberAttendanceRoute(memberId,sittingIds,language),sittingIds};
    }catch{/* Invalid or empty sitting selections never start a read. */}
    return null;
  },[data,attendanceReady,attendanceScope,memberId,language]);
  useEffect(()=>{
    setLastAttendance(previous=>attendanceReady ? resolvedAttendance : ((previous?.scope===attendanceScope) ? previous : null));
  },[resolvedAttendance,attendanceScope,attendanceReady]);
  // Filters, pages and selected decisions do not change the register identity.
  const attendanceSelection=attendanceReady ? resolvedAttendance : ((lastAttendance?.scope===attendanceScope) ? lastAttendance : null);
  const attendanceRoute=attendanceSelection?.route??null,attendanceIds=attendanceSelection?.sittingIds??[];
  const attendanceRequest=useData<MemberAttendanceResponse>(attendanceRoute);
  const attendance=((attendanceRoute && (!attendanceRequest.error)) && validateMemberAttendanceResponse(attendanceRequest.data,{memberId,sittingIds:attendanceIds})) ? attendanceRequest.data : null;
  const selected=((state.decisionId && (data?.selected.status==='found')) && (data.selected.item?.id===state.decisionId)) ? data.selected.item : null;
  const stateRef=useRef(state);stateRef.current=state;
  useEffect(()=>{
    const refresh=snapshotRefresh.current;
    if(!refresh)return;
    if(refresh.route!==route){snapshotRefresh.current=null;return;}
    if(!refresh.started){refresh.started=true;refresh.baseline=request.data;request.retry();}
  },[route,request.retry]);
  useEffect(()=>{
    if(!candidateData||request.loading)return;
    if(chooseLatest&&!search.complete&&(candidateData.pagination.recordedTotal===0||unavailableEarlier)){
      if(!unavailableEarlier&&calendarRequest.loading)return;
      const calendar=((!calendarRequest.error) && validateVotePeriods(calendarRequest.data)) ? calendarRequest.data : null;
      const previous=((!unavailableEarlier) && (calendar?.coverage.status!=='unavailable')) ? calendar?.weeks.find(week=>candidateData.period.week&&week.week<candidateData.period.week) : null;
      if(previous){setLatestSearch({scope:searchScope,week:previous.week,complete:false});return;}
      // With no match, keep the latest plenary available for manual browsing.
      // Earlier snapshots may have expired or been evicted during the search.
      if(requestedWeek!=='latest')snapshotRefresh.current={route:memberVotesRoute(memberId,stateRef.current,language),started:false,baseline:null};
      setLatestSearch({scope:searchScope,week:'latest',complete:true});return;
    }
    const refresh=snapshotRefresh.current;
    if(refresh){if(!refresh.started||request.data===refresh.baseline)return;snapshotRefresh.current=null;}
    const current=stateRef.current,week=((!current.sittingId) && candidateData.period.week) ? candidateData.period.week : current.week;
    if(current.snapshotId!==candidateData.snapshotId||current.week!==week||candidateData.pagination.mode==='period'&&current.offset!==0)onStateChange({...current,week,offset:(candidateData.pagination.mode==='period') ? 0 : current.offset,snapshotId:candidateData.snapshotId},{replace:true});
  },[candidateData,request.data,request.loading,onStateChange,chooseLatest,search.complete,searchScope,requestedWeek,memberId,language,unavailableEarlier,calendarRequest.data,calendarRequest.loading,calendarRequest.error]);
  useLayoutEffect(()=>{
    const pane=state.context ? null : (state.decisionId ? detailRef.current : listRef.current);
    // The journey owner may restore this node after a tab remount. A refreshed
    // response must not overwrite that position while the same pane stays open.
    if(pane&&pane!==restoredPane.current)pane.scrollTop=state.decisionId ? detailScroll.current : listScroll.current;
    restoredPane.current=pane;
  },[data,state.decisionId,state.context]);
  useLayoutEffect(()=>{
    if(state.decisionId){
      const group=groups.find(item=>item.items.some(vote=>vote.id===state.decisionId));
      const groupId=group?.id||((selected && ['consistent','single-direction'].includes(selected.resultRelationship.binding)) ? selected.subjectId : null);
      lastSelection.current={decisionId:state.decisionId,groupId:groupId??((lastSelection.current?.decisionId===state.decisionId) ? lastSelection.current.groupId : null)};
      returnFocus.current=true;
      return;
    }
    if(!returnFocus.current||state.context||!data||request.loading||request.error||!listRef.current)return;
    const previous=lastSelection.current;
    const row=[...listRef.current.querySelectorAll<HTMLButtonElement>('[data-vote-id]')].find(item=>item.dataset.voteId===previous?.decisionId&&!item.closest('[hidden]'));
    const group=[...listRef.current.querySelectorAll<HTMLButtonElement>('[data-vote-group]')].find(item=>item.dataset.voteGroup===previous?.groupId);
    (row||group||listHeadingRef.current)?.focus({preventScroll:true});
    returnFocus.current=false;
  },[data,groups,selected,state.decisionId,state.context,request.loading,request.error]);
  useEffect(()=>{
    if(!state.decisionId||state.context){focusedSelection.current=null;return;}
    const key=JSON.stringify([memberId,state.decisionId]);
    if(focusedSelection.current===key)return;
    const heading=headingRef.current?.querySelector<HTMLElement>('h2');
    if(heading){heading.focus({preventScroll:true});focusedSelection.current=key;}
  },[data,memberId,state.decisionId,state.context]);
  useLayoutEffect(()=>{
    if(alignmentFocus.current===null||request.loading||!data)return;
    // A filter request briefly removes the list; restore its initiating control.
    const target=listRef.current?.querySelector<HTMLButtonElement>(`[data-vote-alignment="${alignmentFocus.current}"]`);
    if(document.activeElement===document.body)target?.focus({preventScroll:true});
    alignmentFocus.current=null;
  },[data,request.loading]);
  const change=(patch:Partial<MemberVotesState>,replace=false)=>onStateChange({...state,...patch},{replace});
  const selectDecision=(decisionId:string)=>{detailScroll.current=0;change({decisionId,context:null});};
  const periodChange=(week:string,sittingId:string|null=null)=>{listScroll.current=0;onStateChange(votePeriodTransition(state,week,sittingId));};
  const expired=request.status===409;
  const rejected=Boolean(!route||request.data&&!valid);
  const coverageNotice=data ? memberVotesCoverageNotice(data,state, ui) : null;
  const noRecordedPositions=data?.pagination.recordedTotal===0&&data.pagination.observedTotal>0;
  const contextAllowed=Boolean(state.context&&selected&&['document','adopted'].includes(state.context.view)&&(state.context.amendmentId ? exactAmendmentTargets(selected).some(target=>target.documentId===state.context?.documentId&&target.amendmentId===state.context?.amendmentId) : topLevelVoteDocuments(selected).includes(state.context.documentId)));
  return <section className="member-votes" lang={ui.language} aria-label={ui.t("membervotes.tsx.membername.votes", {memberName: String(memberName)})}>
    <div className="member-votes-period"><div><p className="member-votes-eyebrow">{memberName}</p><h2 ref={listHeadingRef} tabIndex={-1}><UiMessage id="membervotes.tsx.voting.records"/></h2><p>{periodLabel(data,state, ui)}</p></div><VotePeriodNavigation state={state} resolvedWeek={data?.period.week} language={language} sittingCoverage={data?.coverage.sittings} onPeriod={periodChange}/></div>
    {data&&!request.error&&!state.decisionId&&!state.context&&<AttendanceLine data={attendance} loading={attendanceRequest.loading} attempted={attendanceRoute!==null} onRetry={attendanceRequest.retry}/>}
    {(request.loading||findingLatest&&!rejected)&&!data&&!request.error&&<p role="status">{findingLatest ? <UiMessage id="membervotes.tsx.finding.latest.recorded.votes"/> : <UiMessage id="membervotes.tsx.loading.voting.records"/>}</p>}
    {expired ? <div className="member-votes-notice" role="alert"><p><UiMessage id="membervotes.tsx.this.page.is.out.of.date.refresh.to.load.the.votes"/></p><button type="button" onClick={()=>{snapshotRefresh.current={route:memberVotesRoute(memberId,{...state,snapshotId:null},language),started:false,baseline:null};change({snapshotId:null});}}><UiMessage id="membervotes.tsx.refresh.votes"/></button></div> : (request.error ? <div className="member-votes-notice" role="alert"><p><UiMessage id="membervotes.tsx.voting.records.could.not.be.loaded.try.again"/></p><button type="button" disabled={request.loading} onClick={request.retry}><UiMessage id="membervotes.tsx.retry.votes"/></button></div> : (rejected ? <div className="member-votes-notice" role="alert"><p><UiMessage id="membervotes.tsx.these.voting.records.are.unavailable"/></p><button type="button" onClick={request.retry}><UiMessage id="membervotes.tsx.retry.votes"/></button></div> : null))}
    {data&&!expired&&!request.error&&<>
      {coverageNotice&&<p className="member-votes-notice">{coverageNotice}</p>}
      <div ref={listRef} className="member-votes-pane" hidden={Boolean(state.decisionId||state.context)} onScroll={event=>{listScroll.current=event.currentTarget.scrollTop;}}>
        {noRecordedPositions ? <p className="member-votes-empty">{state.sittingId ? <UiMessage id="membervotes.tsx.no.recorded.positions.at.this.sitting"/> : <UiMessage id="membervotes.tsx.no.recorded.positions.this.week"/>}</p> : <>
        <div className="member-votes-tools">{data.coverage.status!=='unavailable'&&<p>{votePageSummary(data,state.positions,ui)}</p>}<div className="member-votes-filter" role="group" aria-label={ui.t("membervotes.tsx.votes.shown")}><button type="button" aria-pressed={state.positions==='all'} onClick={()=>{listScroll.current=0;change({positions:'all',offset:0});}}><UiMessage id="membervotes.tsx.all.decisions"/></button><button type="button" aria-pressed={state.positions==='recorded'} onClick={()=>{listScroll.current=0;change({positions:'recorded',offset:0});}}><UiMessage id="membervotes.tsx.recorded.positions"/></button></div></div>
        <OutcomeAlignmentFilter value={state.alignment} counts={data.alignmentCounts} coverage={data.coverage.status} sitting={Boolean(state.sittingId)} onChange={alignment=>{alignmentFocus.current=alignment;listScroll.current=0;change({alignment,offset:0});}}/>
        {groups.map(group=>{
          const title=group.subject ? chosenTitle(group.subject,language, ui) : null;
          return <section className="member-votes-subject" key={group.id}><h3><button type="button" data-vote-group={group.id} aria-expanded={state.expandedSubjectIds.includes(group.id)} onClick={()=>change({expandedSubjectIds:state.expandedSubjectIds.includes(group.id) ? state.expandedSubjectIds.filter(item=>item!==group.id) : ([...state.expandedSubjectIds,group.id])},true)}><span className="member-votes-disclosure" aria-hidden="true">{state.expandedSubjectIds.includes(group.id) ? '−' : '+'}</span><span><span lang={title?.language} title={title?.raw}>{title?.text||ui.t("membervotes.tsx.vote.without.a.linked.subject")}</span><span className="member-votes-subject-count">{group.subject ? voteCount(group.subject.counts.filtered,state.positions,ui) : dateLabel(group.items[0]?.date||null,ui.locale)}</span><span className="member-votes-subject-count">{memberVotePositionSummary(group.items, ui)}</span></span></button></h3>
            {group.subject?.wholeTextDecisions.map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={selectDecision}/>)}
            <div hidden={!state.expandedSubjectIds.includes(group.id)}>{state.expandedSubjectIds.includes(group.id)&&group.items.map(vote=><button type="button" className="member-votes-row" key={vote.id} data-vote-id={vote.id} onClick={()=>selectDecision(vote.id)}><span className="member-votes-row-copy"><span>{memberVoteLabel(vote,language, ui)}</span>{vote.ballotStatus!=='not-conducted'&&<span className="member-votes-muted">{voteMethodLabel(vote.method, ui)}</span>}{vote.alignment==='against'&&<span className="member-votes-against-outcome"><UiMessage id="membervotes.tsx.against.outcome"/></span>}{vote.intention.status==='reported'&&<span className="member-votes-muted"><UiMessage id="membervotes.tsx.intention.declared"/></span>}</span><Position vote={vote} memberName={memberName}/><Result vote={vote}/><span aria-hidden="true">›</span></button>)}</div>
          </section>;
        })}
        {!groups.length&&data.coverage.status!=='unavailable'&&<p className="member-votes-empty">{((((data.coverage.status==='complete') && (data.pagination.observedTotal===0)) && Array.isArray(data.coverage.sittings)) && data.coverage.sittings.some(day=>day?.state==='complete'&&day.observedDecisionCount===0&&(!state.sittingId||day.sittingId===state.sittingId))) ? (state.sittingId ? ui.t("membervotes.tsx.no.votes.were.recorded.at.this.sitting") : ui.t("membervotes.tsx.no.votes.were.recorded.in.this.week")) : ((data.pagination.filteredTotal>0) ? ui.t("membervotes.tsx.no.matching.voting.records.on.this.page") : ((state.alignment!=='all') ? ((data.coverage.status==='partial') ? (state.sittingId ? ui.t("membervotes.tsx.no.matching.recorded.votes.among.the.available.records.for.this.s") : ui.t("membervotes.tsx.no.matching.recorded.votes.among.the.available.records.for.this.w")) : (ui.t(state.alignment==='abstained' ? (state.sittingId?'membervotes.tsx.no.recorded.abstentions.on.this.sitting.day':'membervotes.tsx.no.recorded.abstentions.in.this.week') : state.alignment==='with' ? (state.sittingId?'membervotes.tsx.no.recorded.votes.with.parliament.s.outcome.on.this.sitting.day':'membervotes.tsx.no.recorded.votes.with.parliament.s.outcome.in.this.week') : (state.sittingId?'membervotes.tsx.no.recorded.votes.against.parliament.s.outcome.on.this.sitting.da':'membervotes.tsx.no.recorded.votes.against.parliament.s.outcome.in.this.week')))) : ((state.positions==='recorded') ? ui.t("membervotes.tsx.no.recorded.positions.in.this.period.choose.all.decisions.to.see.") : ui.t("membervotes.tsx.no.decisions.are.available.for.this.period"))))}</p>}
        {(state.offset>0||data.pagination.nextOffset!==null)&&<nav className="member-votes-pages" aria-label={ui.t("membervotes.tsx.voting.records.pages")}><button type="button" disabled={state.offset===0} onClick={()=>{listScroll.current=0;change({offset:Math.max(0,state.offset-MEMBER_VOTES_PAGE_SIZE)});}}><UiMessage id="membervotes.tsx.previous.page"/></button><button type="button" disabled={data.pagination.nextOffset===null} onClick={()=>{listScroll.current=0;change({offset:data.pagination.nextOffset??state.offset});}}><UiMessage id="membervotes.tsx.next.page"/></button></nav>}
        </>}
      </div>
      <div ref={detailRef} className="member-votes-pane" hidden={!state.decisionId||Boolean(state.context)} onScroll={event=>{detailScroll.current=event.currentTarget.scrollTop;}}>
        <button className="member-votes-back" type="button" onClick={()=>change({decisionId:null,context:null})}><UiMessage id="membervotes.tsx.back.to.votes"/></button>
        <div ref={headingRef}>{selected ? <Detail vote={selected} data={data} memberName={memberName} language={language} onDecision={selectDecision} openContext={context=>change({context})} explanationsActive={!state.context}/> : (state.decisionId ? <div className="member-votes-empty">{request.loading ? <p role="status"><UiMessage id="membervotes.tsx.loading.selected.vote"/></p> : <><h2 tabIndex={-1}><UiMessage id="membervotes.tsx.vote.unavailable"/></h2><p><UiMessage id="membervotes.tsx.the.requested.decision.is.unavailable.in.this.period"/></p></>}</div> : null)}</div>
      </div>
      {state.context&&(contextAllowed ? renderContext({...state.context,onBack:()=>change({context:null}),backLabel:ui.t("membervotes.tsx.back.to.vote"),summary:<ContextVote vote={selected!} memberName={memberName} language={language}/>}) : <div className="member-votes-empty"><button type="button" onClick={()=>change({context:null})}><UiMessage id="batch2.membervotes.tsx.back.to.vote"/></button><p><UiMessage id="membervotes.tsx.the.requested.document.is.unavailable.for.this.vote"/></p></div>)}
    </>}
  </section>;
}
