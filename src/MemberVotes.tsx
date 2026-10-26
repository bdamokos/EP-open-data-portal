import {VoteSubjectTitle} from './VoteSubjectTitle';
import {AttendanceLine,AttendanceDetail} from './MemberAttendance';
import type {MemberAttendanceResponse} from './MemberAttendanceTypes';
import {memberAttendanceRoute,validateMemberAttendanceResponse} from './memberAttendancePresentation.mjs';
import {voteMethodLabel} from './voteMethod.mjs';
import {PersonName} from './PersonName';
import {Result,Position} from './MemberVoteSummary';
import {OutcomeAlignmentFilter} from './OutcomeAlignmentFilter';
import {VotePeriodNavigation} from './VotePeriodNavigation';
import {votePeriodTransition} from './plenaryPeriods.mjs';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useData} from './data';
import {selectLanguageText} from './language.mjs';
import {selectVoteTitle} from './voteTitles.mjs';
import type {MemberVote,MemberVotesResponse,MemberVoteWholeTextDecision} from './MemberVotesTypes';
import {MEMBER_VOTES_PAGE_SIZE,memberVotesCoverageNotice,displayVoteTitle,exactAmendmentTargets,groupMemberVotes,memberVoteLabel,memberVoteOutcome,memberVotePositionSummary,memberVotesRoute,topLevelVoteDocuments,validateMemberVotesResponse,votingRecordUrl} from './memberVotesPresentation.mjs';
import './MemberVotes.css';
import {WordingDiff} from './components/WordingDiff';
import {MemberVoteExplanations} from './MemberVoteExplanations';

export type MemberVotesContext={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;view:'document'|'adopted'};
export type MemberVotesState={
  week:string;sittingId:string|null;positions:'recorded'|'all';alignment:'all'|'with'|'against'|'abstained';offset:number;
  decisionId:string|null;snapshotId:string|null;expandedSubjectIds:string[];context:MemberVotesContext|null;
};
export type MemberVotesContextRequest=MemberVotesContext&{onBack:()=>void};
export type MemberVotesProps={
  memberId:number;memberName:string;language:string;state:MemberVotesState;
  onStateChange:(next:MemberVotesState,options?:{replace?:boolean})=>void;
  renderContext:(request:MemberVotesContextRequest)=>ReactNode;
};
export const defaultMemberVotesState:MemberVotesState={week:'latest',sittingId:null,positions:'all',alignment:'all',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null};

type WordingVariant={
  listId:string;language:string|null;targetLabel:string|null;targetLabelLanguage?:string|null;
  targetLabelSource?:Record<string,unknown>|null;fieldSources?:Record<string,unknown>|null;
  wordingStatus:'available'|'unavailable';originalText:string|null;proposedText:string|null;authors:{name:string;personId?:string|null}[];
  source?:Record<string,unknown>|null;sourceFreshness?:{status:string}|null;
  wordingRetained?:boolean|null;proposerRetained?:boolean|null;recordRetained?:boolean|null;
};
type WordingResponse={documentId:string;requestedLanguage:string;amendment:null|{id:string;status:'available'|'unavailable';variants:WordingVariant[]}};

const countLabel=(count:number,singular:string)=>singular+(count===1?'':'s');
const dateLabel=(value:string|null)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date):value;
};
const languageLabel=(code:string)=>{try{return new Intl.DisplayNames(['en'],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const chosenTitle=(record:{titles:Record<string,string>;title:string|null;titleLanguage:string|null},language:string)=>{
  const selected=selectVoteTitle(record.titles,language,record.title||'',record.titleLanguage||'en');
  return {raw:selected.sourceLiteral,text:displayVoteTitle(selected.text)||'Untitled vote',language:selected.language};
};
const periodLabel=(data:MemberVotesResponse|null,state:MemberVotesState)=>state.sittingId?'Sitting · '+dateLabel(state.sittingId.slice(7)):data?.period.from?'Week of '+dateLabel(data.period.from):state.week==='latest'?'Latest sitting week':'Week of '+dateLabel(state.week);

function WholeText({vote,memberName,onDecision}:{vote:MemberVoteWholeTextDecision;memberName:string;onDecision:(id:string)=>void}) {
  return <button type="button" className="member-votes-whole" onClick={()=>onDecision(vote.id)}>Final vote · <strong>{memberVoteOutcome(vote)}</strong> · <Position vote={vote} memberName={memberName} compact/></button>;
}

function Wording({documentId,amendmentId,language,openContext,showHeading=true}:{documentId:string;amendmentId:string;language:string;showHeading?:boolean;openContext:(context:MemberVotesContext)=>void}) {
  const [selectedVersion,setSelectedVersion]=useState<string|null>(null);
  const query=new URLSearchParams({amendment:amendmentId,lang:language,body:'0'});
  const response=useData<WordingResponse>('document-context/'+encodeURIComponent(documentId)+'?'+query);
  const data=response.data?.documentId===documentId&&response.data.requestedLanguage===language&&response.data.amendment?.id===amendmentId?response.data:null;
  const variants=Array.isArray(data?.amendment?.variants)?data.amendment.variants.filter(variant=>variant&&typeof variant.listId==='string'&&variant.listId.trim()&&['available','unavailable'].includes(variant.wordingStatus)):[];
  const options=variants.map((variant,index)=>({variant,key:JSON.stringify(variant),value:variants.filter(other=>other.listId===variant.listId).length===1?variant.listId:'version:'+index}));
  const initialVersion=selectedVersion===null&&options.length===1?options[0].key:null;
  useEffect(()=>{if(initialVersion!==null)setSelectedVersion(initialVersion);},[initialVersion]);
  const selectedOption=selectedVersion!==null?options.find(option=>option.key===selectedVersion)||null:options.length===1?options[0]:null;
  const selected=selectedOption?.variant||null;
  const textLanguage=typeof selected?.language==='string'&&selected.language.trim()?selected.language:null;
  const targetLanguage=typeof selected?.targetLabelLanguage==='string'&&selected.targetLabelLanguage.trim()?selected.targetLabelLanguage:null;
  const readable=selected?.wordingStatus==='available'&&typeof selected.originalText==='string'&&typeof selected.proposedText==='string';
  const authors=Array.isArray(selected?.authors)?selected.authors.filter(author=>author&&typeof author.name==='string'&&author.name):[];
  const number=/-AM-(\d+(?:-\d+)?)$/.exec(amendmentId)?.[1];
  return <section className="member-votes-wording">
    {showHeading&&<h3>{number?'Amendment '+number:'Amendment wording'}</h3>}
    <>
      {response.loading&&!data&&<p role="status">Loading amendment wording…</p>}
      {response.error&&<p role="alert">Amendment wording could not be loaded. <button type="button" disabled={response.loading} onClick={response.retry}>Retry wording</button></p>}
      {!response.loading&&!response.error&&!variants.length&&<p>Amendment wording unavailable here.</p>}
      {(options.length>1||selectedVersion!==null&&!selected)&&<label className="member-votes-variant">Published version<select aria-label="Amendment published version" value={selectedOption?.value||''} onChange={event=>setSelectedVersion(options.find(option=>option.value===event.target.value)?.key??'')}>
        <option value="">Choose a published version</option>{options.map(({variant,value},index)=><option key={value} value={value}>Version {index+1}{typeof variant.language==='string'&&variant.language.trim()?' · '+languageLabel(variant.language):''}{variant.wordingStatus==='unavailable'?' · Wording unavailable':''}</option>)}
      </select></label>}
      {selected&&<>
        {typeof selected.targetLabel==='string'&&selected.targetLabel&&<><p className="member-votes-target-label" lang={targetLanguage||''}>{selected.targetLabel}</p></>}
        {(readable&&textLanguage||authors.length>0)&&<p className="member-votes-muted">{readable&&textLanguage&&'Text language: '+languageLabel(textLanguage)}{authors.length>0&&<>{readable&&textLanguage?' · ':''}Proposed by {authors.map((author,index)=><span key={index}>{index?', ':''}<PersonName id={author.personId} label={author.name}/></span>)}</>}</p>}
        {readable?<div className="member-votes-comparison" lang={textLanguage||''}><WordingDiff key={selectedOption!.key} original={selected.originalText} proposed={selected.proposedText} language={textLanguage} emptySemantics="insertion-deletion" labels={{original:'Original wording',proposed:'Proposed wording',emptyOriginal:'',emptyProposed:''}}/></div>:<p>Amendment wording unavailable here.</p>}
        {readable&&selected.wordingRetained&&<p className="member-votes-muted">Showing saved wording.</p>}
        <button type="button" onClick={()=>openContext({documentId,amendmentId,listId:selected.listId,wordingLanguage:textLanguage,view:'document'})}>Read in context</button>
      </>}
    </>
  </section>;
}

function Detail({vote,data,memberName,language,onDecision,openContext,attendance,attendanceLoading,attendanceAttempted,retryAttendance,explanationsActive}:{vote:MemberVote;data:MemberVotesResponse;memberName:string;language:string;onDecision:(id:string)=>void;openContext:(context:MemberVotesContext)=>void;attendance:MemberAttendanceResponse|null;attendanceLoading:boolean;attendanceAttempted:boolean;retryAttendance:()=>void;explanationsActive:boolean}) {
  const subject=data.subjects.find(subject=>subject.id===vote.subjectId);
  const targets=exactAmendmentTargets(vote),documents=topLevelVoteDocuments(vote),recordUrl=votingRecordUrl(vote);
  const requesterLabels=vote.rollCallRequesters.filter(requester=>requester.binding==='exact-decision-was_motivated_by').map(requester=>selectLanguageText(requester.organizationLabels,language)).filter(label=>label.text);
  const requestIds=new Set(vote.parts.map(part=>part.requestId));
  const siblingVotes=data.items.filter(item=>item.id!==vote.id&&item.parts.some(part=>requestIds.has(part.requestId)));
  const contexts=vote.parts.flatMap(part=>part.contextComponents).filter((component,index,all)=>all.findIndex(other=>other.componentId===component.componentId)===index&&!vote.parts.some(part=>part.componentId===component.componentId));
  return <article className="member-votes-detail">
    <header><p className="member-votes-eyebrow">{dateLabel(vote.date)}</p>{subject&&<VoteSubjectTitle subject={subject} vote={vote} language={language}/>}<h2 tabIndex={-1}>{memberVoteLabel(vote,language)}</h2></header>
    {subject?.wholeTextDecisions.length?subject.wholeTextDecisions.map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={onDecision}/>):null}
    <section className="member-votes-strip" aria-label="Member position and Parliament result"><Position vote={vote} memberName={memberName}/><Result vote={vote}/>
      {vote.intention.status==='reported'&&vote.intention.positions.length>0&&<p className="member-votes-intention">Declared intention: <strong>{vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}</strong>. Declared afterwards; result unchanged.</p>}
      {attendanceAttempted&&<AttendanceDetail day={attendance?.sittings.find(day=>day.sittingId===vote.sittingId)} loading={attendanceLoading} onRetry={retryAttendance}/>}
    </section>
    {explanationsActive&&<MemberVoteExplanations key={[data.member.id,vote.id,data.snapshotId,language].join(':')} vote={vote} data={data} memberId={data.member.id} language={language} onDecision={onDecision}/>}
    {vote.parts.map(part=>{
      const text=selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
      return text.text?<section className="member-votes-part" key={part.componentId}><h3>Published description{part.number!==null?' of part '+part.number:''}</h3><p lang={text.language}>{text.text}</p></section>:null;
    })}
    {targets.map(target=><Wording key={vote.id+':'+target.amendmentId+':'+language} {...target} language={language} openContext={openContext} showHeading={targets.length!==1||memberVoteLabel(vote,language)!=='Amendment '+(/-AM-(\d+(?:-\d+)?)$/.exec(target.amendmentId)?.[1]||'')}/>)}
    {!targets.length&&vote.context.amendmentIds.length>0&&<p>Amendment wording unavailable here.</p>}
    {contexts.length>0&&<details className="member-votes-related"><summary>Other parts of this split vote</summary>{contexts.map(component=>{
      const text=selectLanguageText(Object.fromEntries(Object.entries(component.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
      return <div key={component.componentId}><h4>{component.number!==null?'Part '+component.number:'Another part'}</h4>{text.text?<p lang={text.language}>{text.text}</p>:<p>Part wording unavailable here.</p>}</div>;
    })}</details>}
    {siblingVotes.length>0&&<section className="member-votes-siblings"><h3>Other decisions shown for this split vote</h3>{siblingVotes.map(item=><button type="button" key={item.id} onClick={()=>onDecision(item.id)}>{memberVoteLabel(item,language)} · {memberVoteOutcome(item)}</button>)}</section>}
    {(vote.ballotStatus==='not-conducted'||voteMethodLabel(vote.method))&&<p className="member-votes-muted">{vote.ballotStatus==='not-conducted'?'Not put to a vote':voteMethodLabel(vote.method)}</p>}
    {requesterLabels.length>0&&<p className="member-votes-requester">Roll call requested by {requesterLabels.map((label,index)=><span key={index} lang={label.language}>{index>0?', ':''}{label.text}</span>)}.</p>}
    {recordUrl&&<p className="member-votes-source"><a href={recordUrl} target="_blank" rel="noreferrer">Parliament’s voting record ↗</a></p>}
    {documents.length>0&&<section className="member-votes-documents"><h3>About the text</h3>{documents.map(documentId=><div key={documentId}><button type="button" onClick={()=>openContext({documentId,view:'document'})}>Read {documentId.startsWith('A-')?'report':documentId.startsWith('RC-')?'joint motion':'motion'} · {documentId}</button><button type="button" onClick={()=>openContext({documentId,view:'adopted'})}>Find adopted text</button></div>)}</section>}
  </article>;
}

export function MemberVotes({memberId,memberName,language,state,onStateChange,renderContext}:MemberVotesProps) {
  const listRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null);
  const alignmentFocus=useRef<MemberVotesState['alignment']|null>(null);
  const listScroll=useRef(0),detailScroll=useRef(0),headingRef=useRef<HTMLDivElement>(null);
  const restoredPane=useRef<HTMLDivElement|null>(null);
  const listHeadingRef=useRef<HTMLHeadingElement>(null);
  const lastSelection=useRef<{decisionId:string;groupId:string|null}|null>(null),returnFocus=useRef(false);
  const snapshotRefresh=useRef<{route:string;started:boolean;baseline:MemberVotesResponse|null}|null>(null);
  const route=useMemo(()=>{try{return memberVotesRoute(memberId,state,language);}catch{return null;}},[memberId,state.week,state.sittingId,state.positions,state.alignment,state.offset,state.decisionId,state.snapshotId,language]);
  const request=useData<MemberVotesResponse>(route) as ReturnType<typeof useData<MemberVotesResponse>>&{status?:number};
  const valid=Boolean(request.data&&validateMemberVotesResponse(request.data,{memberId,state}));
  const data=valid?request.data:null,groups=useMemo(()=>data?groupMemberVotes(data):[],[data]);
  const attendanceScope=JSON.stringify([memberId,language,state.sittingId?['sitting',state.sittingId]:['week',state.week]]);
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
    setLastAttendance(previous=>attendanceReady?resolvedAttendance:previous?.scope===attendanceScope?previous:null);
  },[resolvedAttendance,attendanceScope,attendanceReady]);
  // Filters, pages and selected decisions do not change the register identity.
  const attendanceSelection=attendanceReady?resolvedAttendance:lastAttendance?.scope===attendanceScope?lastAttendance:null;
  const attendanceRoute=attendanceSelection?.route??null,attendanceIds=attendanceSelection?.sittingIds??[];
  const attendanceRequest=useData<MemberAttendanceResponse>(attendanceRoute);
  const attendance=attendanceRoute&&!attendanceRequest.error&&validateMemberAttendanceResponse(attendanceRequest.data,{memberId,sittingIds:attendanceIds})?attendanceRequest.data:null;
  const selected=state.decisionId&&data?.selected.status==='found'&&data.selected.item?.id===state.decisionId?data.selected.item:null;
  const stateRef=useRef(state);stateRef.current=state;
  useEffect(()=>{
    const refresh=snapshotRefresh.current;
    if(!refresh)return;
    if(refresh.route!==route){snapshotRefresh.current=null;return;}
    if(!refresh.started){refresh.started=true;refresh.baseline=request.data;request.retry();}
  },[route,request.retry]);
  useEffect(()=>{
    if(!data||request.loading)return;
    const refresh=snapshotRefresh.current;
    if(refresh){if(!refresh.started||request.data===refresh.baseline)return;snapshotRefresh.current=null;}
    const current=stateRef.current,week=!current.sittingId&&data.period.week?data.period.week:current.week;
    if(current.snapshotId!==data.snapshotId||current.week!==week)onStateChange({...current,week,snapshotId:data.snapshotId},{replace:true});
  },[data,request.data,request.loading,onStateChange]);
  useLayoutEffect(()=>{
    const pane=state.context?null:state.decisionId?detailRef.current:listRef.current;
    // The journey owner may restore this node after a tab remount. A refreshed
    // response must not overwrite that position while the same pane stays open.
    if(pane&&pane!==restoredPane.current)pane.scrollTop=state.decisionId?detailScroll.current:listScroll.current;
    restoredPane.current=pane;
  },[data,state.decisionId,state.context]);
  useLayoutEffect(()=>{
    if(state.decisionId){
      const group=groups.find(item=>item.items.some(vote=>vote.id===state.decisionId));
      const groupId=group?.id||(selected&&['consistent','single-direction'].includes(selected.resultRelationship.binding)?selected.subjectId:null);
      lastSelection.current={decisionId:state.decisionId,groupId:groupId??(lastSelection.current?.decisionId===state.decisionId?lastSelection.current.groupId:null)};
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
  useEffect(()=>{if(state.decisionId&&!state.context)headingRef.current?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true});},[data,state.decisionId,state.context]);
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
  const coverageNotice=data?memberVotesCoverageNotice(data,state):null;
  const contextAllowed=Boolean(state.context&&selected&&['document','adopted'].includes(state.context.view)&&(state.context.amendmentId?exactAmendmentTargets(selected).some(target=>target.documentId===state.context?.documentId&&target.amendmentId===state.context?.amendmentId):topLevelVoteDocuments(selected).includes(state.context.documentId)));
  return <section className="member-votes" lang="en" aria-label={`${memberName} · Votes`}>
    <div className="member-votes-period"><div><p className="member-votes-eyebrow">{memberName}</p><h2 ref={listHeadingRef} tabIndex={-1}>Voting records</h2><p>{periodLabel(data,state)}</p></div><VotePeriodNavigation state={state} resolvedWeek={data?.period.week} language={language} sittingCoverage={data?.coverage.sittings} onPeriod={periodChange}/></div>
    {data&&!request.error&&!state.decisionId&&!state.context&&<AttendanceLine data={attendance} loading={attendanceRequest.loading} attempted={attendanceRoute!==null} onRetry={attendanceRequest.retry}/>}
    {request.loading&&!data&&<p role="status">Loading voting records…</p>}
    {expired?<div className="member-votes-notice" role="alert"><p>This page is out of date. Refresh to load the votes.</p><button type="button" onClick={()=>{snapshotRefresh.current={route:memberVotesRoute(memberId,{...state,snapshotId:null},language),started:false,baseline:null};change({snapshotId:null});}}>Refresh votes</button></div>:request.error?<div className="member-votes-notice" role="alert"><p>Voting records could not be loaded. Try again.</p><button type="button" disabled={request.loading} onClick={request.retry}>Retry votes</button></div>:rejected?<div className="member-votes-notice" role="alert"><p>These voting records are unavailable.</p><button type="button" onClick={request.retry}>Retry votes</button></div>:null}
    {data&&!expired&&!request.error&&<>
      {coverageNotice&&<p className="member-votes-notice">{coverageNotice}</p>}
      <div ref={listRef} className="member-votes-pane" hidden={Boolean(state.decisionId||state.context)} onScroll={event=>{listScroll.current=event.currentTarget.scrollTop;}}>
        <div className="member-votes-tools">{data.coverage.status!=='unavailable'&&<p>{data.pagination.returned?`${data.pagination.offset+1}–${data.pagination.offset+data.pagination.returned} of ${data.pagination.filteredTotal}`:'0'} {countLabel(data.pagination.filteredTotal,state.positions==='recorded'?'recorded position':'decision')}{data.pagination.recordedTotal!==null?` · ${data.pagination.recordedTotal} with a recorded position`:''}{data.coverage.status==='partial'?' · Partial coverage':''}</p>}<div className="member-votes-filter" role="group" aria-label="Votes shown"><button type="button" aria-pressed={state.positions==='all'} onClick={()=>{listScroll.current=0;change({positions:'all',offset:0});}}>All decisions</button><button type="button" aria-pressed={state.positions==='recorded'} onClick={()=>{listScroll.current=0;change({positions:'recorded',offset:0});}}>Recorded positions</button></div></div>
        <OutcomeAlignmentFilter value={state.alignment} counts={data.alignmentCounts} coverage={data.coverage.status} sitting={Boolean(state.sittingId)} onChange={alignment=>{alignmentFocus.current=alignment;listScroll.current=0;change({alignment,offset:0});}}/>
        {groups.map(group=>{
          const title=group.subject?chosenTitle(group.subject,language):null;
          return <section className="member-votes-subject" key={group.id}><h3><button type="button" data-vote-group={group.id} aria-expanded={state.expandedSubjectIds.includes(group.id)} onClick={()=>change({expandedSubjectIds:state.expandedSubjectIds.includes(group.id)?state.expandedSubjectIds.filter(item=>item!==group.id):[...state.expandedSubjectIds,group.id]},true)}><span className="member-votes-disclosure" aria-hidden="true">{state.expandedSubjectIds.includes(group.id)?'−':'+'}</span><span><span lang={title?.language} title={title?.raw}>{title?.text||'Vote without a linked subject'}</span><span className="member-votes-subject-count">{group.subject?`${group.subject.counts.filtered} ${countLabel(group.subject.counts.filtered,state.positions==='recorded'?'recorded position':'decision')} in this subject · ${group.subject.counts.page} on this page`:dateLabel(group.items[0]?.date||null)}</span><span className="member-votes-subject-count">{memberVotePositionSummary(group.items)}</span></span></button></h3>
            {group.subject?.wholeTextDecisions.map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={selectDecision}/>)}
            <div hidden={!state.expandedSubjectIds.includes(group.id)}>{group.items.map(vote=><button type="button" className="member-votes-row" key={vote.id} data-vote-id={vote.id} onClick={()=>selectDecision(vote.id)}><span className="member-votes-row-copy"><span>{memberVoteLabel(vote,language)}</span>{vote.ballotStatus!=='not-conducted'&&<span className="member-votes-muted">{voteMethodLabel(vote.method)}</span>}{vote.alignment==='against'&&<span className="member-votes-against-outcome">Against outcome</span>}{vote.intention.status==='reported'&&<span className="member-votes-muted">Intention declared</span>}</span><Position vote={vote} memberName={memberName}/><Result vote={vote}/><span aria-hidden="true">›</span></button>)}</div>
          </section>;
        })}
        {!groups.length&&data.coverage.status!=='unavailable'&&<p className="member-votes-empty">{data.coverage.status==='complete'&&data.pagination.observedTotal===0&&Array.isArray(data.coverage.sittings)&&data.coverage.sittings.some(day=>day?.state==='complete'&&day.observedDecisionCount===0&&(!state.sittingId||day.sittingId===state.sittingId))?(state.sittingId?'No votes were recorded at this sitting.':'No votes were recorded in this week.'):data.pagination.filteredTotal>0?'No matching voting records on this page.':state.alignment!=='all'?data.coverage.status==='partial'?`No matching recorded votes among the available records for this ${state.sittingId?'sitting day':'week'}.`:`No recorded ${state.alignment==='abstained'?'abstentions':`votes ${state.alignment} Parliament’s outcome`} ${state.sittingId?'on this sitting day':'in this week'}.`:state.positions==='recorded'?'No recorded positions in this period. Choose All decisions to see outcomes.':'No decisions are available for this period.'}</p>}
        {(state.offset>0||data.pagination.nextOffset!==null)&&<nav className="member-votes-pages" aria-label="Voting records pages"><button type="button" disabled={state.offset===0} onClick={()=>{listScroll.current=0;change({offset:Math.max(0,state.offset-MEMBER_VOTES_PAGE_SIZE)});}}>Previous page</button><button type="button" disabled={data.pagination.nextOffset===null} onClick={()=>{listScroll.current=0;change({offset:data.pagination.nextOffset??state.offset});}}>Next page</button></nav>}
      </div>
      <div ref={detailRef} className="member-votes-pane" hidden={!state.decisionId||Boolean(state.context)} onScroll={event=>{detailScroll.current=event.currentTarget.scrollTop;}}>
        <button className="member-votes-back" type="button" onClick={()=>change({decisionId:null,context:null})}>← Back to votes</button>
        <div ref={headingRef}>{selected?<Detail vote={selected} data={data} attendance={attendance} attendanceLoading={attendanceRequest.loading} attendanceAttempted={attendanceRoute!==null} retryAttendance={attendanceRequest.retry} memberName={memberName} language={language} onDecision={selectDecision} openContext={context=>change({context})} explanationsActive={!state.context}/>:state.decisionId?<div className="member-votes-empty"><h2 tabIndex={-1}>Vote unavailable</h2><p>The requested decision is unavailable in this period.</p></div>:null}</div>
      </div>
      {state.context&&(contextAllowed?renderContext({...state.context,onBack:()=>change({context:null})}):<div className="member-votes-empty"><button type="button" onClick={()=>change({context:null})}>← Back to vote</button><p>The requested document is unavailable for this vote.</p></div>)}
    </>}
  </section>;
}
