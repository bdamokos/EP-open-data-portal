import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useData} from './data';
import {selectLanguageText} from './language.mjs';
import {selectVoteTitle} from './voteTitles.mjs';
import type {MemberVote,MemberVotesResponse,MemberVoteWholeTextDecision} from './MemberVotesTypes';
import {MEMBER_VOTES_PAGE_SIZE,displayVoteTitle,exactAmendmentTargets,groupMemberVotes,memberVoteLabel,memberVoteOutcome,memberVotePosition,memberVotePositionSummary,memberVoteTotals,memberVotesRoute,topLevelVoteDocuments,validateMemberVotesResponse,votingRecordUrl} from './memberVotesPresentation.mjs';
import './MemberVotes.css';
import {WordingDiff} from './components/WordingDiff';

export type MemberVotesContext={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;view:'document'|'adopted'};
export type MemberVotesState={
  week:string;sittingId:string|null;positions:'recorded'|'all';offset:number;
  decisionId:string|null;snapshotId:string|null;expandedSubjectIds:string[];context:MemberVotesContext|null;
};
export type MemberVotesContextRequest=MemberVotesContext&{onBack:()=>void};
export type MemberVotesProps={
  memberId:number;memberName:string;language:string;state:MemberVotesState;
  onStateChange:(next:MemberVotesState,options?:{replace?:boolean})=>void;
  renderContext:(request:MemberVotesContextRequest)=>ReactNode;
};
export const defaultMemberVotesState:MemberVotesState={week:'latest',sittingId:null,positions:'recorded',offset:0,decisionId:null,snapshotId:null,expandedSubjectIds:[],context:null};

type ResultVote=Pick<MemberVote,'outcome'|'totals'|'ballotStatus'>;
type PositionVote=Pick<MemberVote,'actualPosition'|'ballotStatus'|'method'>;
type WordingVariant={
  listId:string;language:string|null;targetLabel:string|null;targetLabelLanguage?:string|null;
  targetLabelSource?:Record<string,unknown>|null;fieldSources?:Record<string,unknown>|null;
  wordingStatus:'available'|'unavailable';originalText:string|null;proposedText:string|null;authors:{name:string}[];
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
  return {raw:selected.sourceLiteral,text:displayVoteTitle(selected.text)||'Subject title unavailable',language:selected.language};
};
const periodLabel=(data:MemberVotesResponse|null,state:MemberVotesState)=>state.sittingId?'Sitting · '+dateLabel(state.sittingId.slice(7)):data?.period.from?'Week of '+dateLabel(data.period.from):state.week==='latest'?'Latest sitting week':'Week of '+dateLabel(state.week);
const methodLabel=(vote:MemberVote)=>vote.ballotStatus==='not-conducted'?'Not put to a vote':({VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',VOTE_HAND:'Show of hands',VOTE_ELECTRONIC:'Electronic vote',VOTE_SECRET:'Secret ballot'}[vote.method||'']||'Voting method unavailable');

function Result({vote}:{vote:ResultVote}) {
  const totals=memberVoteTotals(vote),outcome=memberVoteOutcome(vote);
  return <span className="member-votes-result">
    <span className="member-votes-result-heading"><span>Parliament</span><strong>{outcome}</strong></span>
    {totals?<>
      {totals.total>0&&<span className="member-votes-bar" role="img" aria-label={`For ${totals.for}, Against ${totals.against}, Abstaining ${totals.abstaining}`}>
        {(['for','against','abstaining'] as const).map(position=><span key={position} className={'member-votes-'+position} style={{width:(100*totals[position]/totals.total)+'%'}}/>)}</span>}
      <span className="member-votes-counts"><span>For <b>{totals.for}</b></span><span>Against <b>{totals.against}</b></span><span>Abstaining <b>{totals.abstaining}</b></span></span>
    </>:<span className="member-votes-muted">{vote.ballotStatus==='not-conducted'?'Not put to a vote':'Tallies unavailable'}</span>}
  </span>;
}

function Position({vote,memberName,compact=false}:{vote:PositionVote;memberName:string;compact?:boolean}) {
  const label=memberVotePosition(vote),position=label==='For'?'for':label==='Against'?'against':label==='Abstained'?'abstaining':'unknown';
  return <span className={'member-votes-position member-votes-position-'+position+(compact?' member-votes-position-compact':'')}><span className="member-votes-position-label">{memberName}{compact&&['For','Against','Abstained'].includes(label)?' voted':''}{compact?' ':''}</span><strong>{label}</strong></span>;
}

function WholeText({vote,memberName,onDecision}:{vote:MemberVoteWholeTextDecision;memberName:string;onDecision:(id:string)=>void}) {
  return <button type="button" className="member-votes-whole" onClick={()=>onDecision(vote.id)}>Final vote · <strong>{memberVoteOutcome(vote)}</strong> · <Position vote={vote} memberName={memberName} compact/></button>;
}

function Wording({documentId,amendmentId,language,openContext}:{documentId:string;amendmentId:string;language:string;openContext:(context:MemberVotesContext)=>void}) {
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
    <h3>{number?'Amendment '+number:'Amendment wording'}</h3>
    <>
      {response.loading&&!data&&<p role="status">Loading amendment wording…</p>}
      {response.error&&<p role="alert">Amendment wording could not be loaded. <button type="button" disabled={response.loading} onClick={response.retry}>Retry wording</button></p>}
      {!response.loading&&!response.error&&!variants.length&&<p>Amendment wording unavailable here.</p>}
      {(options.length>1||selectedVersion!==null&&!selected)&&<label className="member-votes-variant">Published version<select aria-label="Amendment published version" value={selectedOption?.value||''} onChange={event=>setSelectedVersion(options.find(option=>option.value===event.target.value)?.key??'')}>
        <option value="">Choose a published version</option>{options.map(({variant,value},index)=><option key={value} value={value}>Version {index+1} · {typeof variant.language==='string'&&variant.language.trim()?languageLabel(variant.language):'Language unknown'}{variant.wordingStatus==='unavailable'?' · Wording unavailable':''}</option>)}
      </select></label>}
      {selected&&<>
        {typeof selected.targetLabel==='string'&&selected.targetLabel&&<><p className="member-votes-target-label" lang={targetLanguage||''}>{selected.targetLabel}</p>{!targetLanguage&&<p className="member-votes-muted">Target language unknown.</p>}</>}
        <p className="member-votes-muted">{textLanguage?'Text language: '+languageLabel(textLanguage):'Text language unknown.'}{authors.length>0&&<> · Proposed by {authors.map(author=>author.name).join(', ')}</>}</p>
        {readable?<div className="member-votes-comparison" lang={textLanguage||''}><WordingDiff key={selectedOption!.key} original={selected.originalText} proposed={selected.proposedText} language={textLanguage} emptySemantics="insertion-deletion" labels={{original:'Original wording',proposed:'Proposed wording',emptyOriginal:'',emptyProposed:''}}/></div>:<p>Amendment wording unavailable here.</p>}
        {readable&&selected.wordingRetained&&<p className="member-votes-muted">Showing saved wording.</p>}
        {authors.length>0&&selected.proposerRetained&&<p className="member-votes-muted">Proposer details are from an earlier source version.</p>}
        {selected.recordRetained&&<p className="member-votes-muted">Version details are from an earlier source record.</p>}
        <button type="button" onClick={()=>openContext({documentId,amendmentId,listId:selected.listId,wordingLanguage:textLanguage,view:'document'})}>Read in context</button>
      </>}
    </>
  </section>;
}

function Detail({vote,data,memberName,language,onDecision,openContext}:{vote:MemberVote;data:MemberVotesResponse;memberName:string;language:string;onDecision:(id:string)=>void;openContext:(context:MemberVotesContext)=>void}) {
  const subject=data.subjects.find(subject=>subject.id===vote.subjectId),title=subject?chosenTitle(subject,language):null;
  const targets=exactAmendmentTargets(vote),documents=topLevelVoteDocuments(vote),recordUrl=votingRecordUrl(vote);
  const requesterLabels=vote.rollCallRequesters.filter(requester=>requester.binding==='exact-decision-was_motivated_by').map(requester=>selectLanguageText(requester.organizationLabels,language)).filter(label=>label.text);
  const requestIds=new Set(vote.parts.map(part=>part.requestId));
  const siblingVotes=data.items.filter(item=>item.id!==vote.id&&item.parts.some(part=>requestIds.has(part.requestId)));
  const contexts=vote.parts.flatMap(part=>part.contextComponents).filter((component,index,all)=>all.findIndex(other=>other.componentId===component.componentId)===index&&!vote.parts.some(part=>part.componentId===component.componentId));
  return <article className="member-votes-detail">
    <header><p className="member-votes-eyebrow">{dateLabel(vote.date)}</p>{title&&<p className="member-votes-detail-subject" lang={title.language} title={title.raw}>{title.text}</p>}<h2 tabIndex={-1}>{memberVoteLabel(vote,language)}</h2></header>
    {subject?.wholeTextDecisions.length?subject.wholeTextDecisions.map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={onDecision}/>):null}
    <section className="member-votes-strip" aria-label="Member position and Parliament result"><Position vote={vote} memberName={memberName}/><Result vote={vote}/>
      {vote.intention.status==='reported'&&vote.intention.positions.length>0&&<p className="member-votes-intention">Declared intention: <strong>{vote.intention.positions.map(position=>({for:'For',against:'Against',abstaining:'Abstain'}[position])).join(', ')}</strong>. Declared afterwards; the official result and totals are unchanged.</p>}
    </section>
    {vote.parts.map(part=>{
      const text=selectLanguageText(Object.fromEntries(Object.entries(part.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
      return text.text?<section className="member-votes-part" key={part.componentId}><h3>Published description{part.number!==null?' of part '+part.number:''}</h3><p lang={text.language}>{text.text}</p><p className="member-votes-muted">The result above applies to this individual decision.</p></section>:null;
    })}
    {targets.map(target=><Wording key={vote.id+':'+target.amendmentId+':'+language} {...target} language={language} openContext={openContext}/>)}
    {!targets.length&&vote.context.amendmentIds.length>0&&<p>Amendment wording unavailable here.</p>}
    {contexts.length>0&&<details className="member-votes-related"><summary>Other parts of this split vote</summary>{contexts.map(component=>{
      const text=selectLanguageText(Object.fromEntries(Object.entries(component.contentByLanguage).map(([code,value])=>[code,value.text??value.sourceLiteral])),language);
      return <div key={component.componentId}><h4>{component.number!==null?'Part '+component.number:'Another part'}</h4>{text.text?<p lang={text.language}>{text.text}</p>:<p>Part wording unavailable here.</p>}</div>;
    })}<p className="member-votes-muted">Each part has its own decision and outcome.</p></details>}
    {siblingVotes.length>0&&<section className="member-votes-siblings"><h3>Other decisions shown for this split vote</h3>{siblingVotes.map(item=><button type="button" key={item.id} onClick={()=>onDecision(item.id)}>{memberVoteLabel(item,language)} · {memberVoteOutcome(item)}</button>)}</section>}
    <p className="member-votes-muted">{methodLabel(vote)}</p>
    {requesterLabels.length>0&&<p className="member-votes-requester">Roll call requested by {requesterLabels.map((label,index)=><span key={index} lang={label.language}>{index>0?', ':''}{label.text}</span>)}.</p>}
    {recordUrl&&<p className="member-votes-source"><a href={recordUrl} target="_blank" rel="noreferrer">Parliament’s voting record ↗</a></p>}
    {documents.length>0&&<section className="member-votes-documents"><h3>About the text</h3>{documents.map(documentId=><div key={documentId}><button type="button" onClick={()=>openContext({documentId,view:'document'})}>Read {documentId.startsWith('A-')?'report':documentId.startsWith('RC-')?'joint motion':'motion'} · {documentId}</button><button type="button" onClick={()=>openContext({documentId,view:'adopted'})}>Find adopted text</button></div>)}</section>}
  </article>;
}

export function MemberVotes({memberId,memberName,language,state,onStateChange,renderContext}:MemberVotesProps) {
  const id=useId(),listRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null);
  const listScroll=useRef(0),detailScroll=useRef(0),headingRef=useRef<HTMLDivElement>(null);
  const restoredPane=useRef<HTMLDivElement|null>(null);
  const listHeadingRef=useRef<HTMLHeadingElement>(null);
  const lastSelection=useRef<{decisionId:string;groupId:string|null}|null>(null),returnFocus=useRef(false);
  const [weekError,setWeekError]=useState('');
  const snapshotRefresh=useRef<{route:string;started:boolean;baseline:MemberVotesResponse|null}|null>(null);
  const route=useMemo(()=>{try{return memberVotesRoute(memberId,state,language);}catch{return null;}},[memberId,state.week,state.sittingId,state.positions,state.offset,state.decisionId,state.snapshotId,language]);
  const request=useData<MemberVotesResponse>(route) as ReturnType<typeof useData<MemberVotesResponse>>&{status?:number};
  const valid=Boolean(request.data&&validateMemberVotesResponse(request.data,{memberId,state}));
  const data=valid?request.data:null,groups=useMemo(()=>data?groupMemberVotes(data):[],[data]);
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
  const change=(patch:Partial<MemberVotesState>,replace=false)=>onStateChange({...state,...patch},{replace});
  const selectDecision=(decisionId:string)=>{detailScroll.current=0;change({decisionId,context:null});};
  const periodChange=(week:string)=>{
    const date=new Date(week+'T12:00:00Z');
    if(week!=='latest'&&(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==week||date.getUTCDay()!==1)){setWeekError('Choose a Monday.');return;}
    setWeekError('');listScroll.current=0;change({week,sittingId:null,offset:0,snapshotId:null,decisionId:null,expandedSubjectIds:[],context:null});
  };
  const expired=request.status===409;
  const rejected=Boolean(!route||request.data&&!valid);
  const contextAllowed=Boolean(state.context&&selected&&['document','adopted'].includes(state.context.view)&&(state.context.amendmentId?exactAmendmentTargets(selected).some(target=>target.documentId===state.context?.documentId&&target.amendmentId===state.context?.amendmentId):topLevelVoteDocuments(selected).includes(state.context.documentId)));
  return <section className="member-votes" lang="en" aria-label={`${memberName} · Votes`}>
    <div className="member-votes-period"><div><p className="member-votes-eyebrow">{memberName}</p><h2 ref={listHeadingRef} tabIndex={-1}>Voting records</h2><p>{periodLabel(data,state)}</p></div><div className="member-votes-period-controls">
      <label htmlFor={id+'-week'}>Week beginning Monday<input id={id+'-week'} aria-describedby={weekError?id+'-week-error':undefined} type="date" value={state.sittingId?'':state.week==='latest'?'':state.week} onChange={event=>{if(event.target.value)periodChange(event.target.value);}}/></label>
      <button type="button" onClick={()=>periodChange('latest')}>Latest sitting week</button>{weekError&&<p id={id+'-week-error'} role="alert">{weekError}</p>}
    </div></div>
    {request.loading&&!data&&<p role="status">Loading voting records…</p>}
    {expired?<div className="member-votes-notice" role="alert"><p>This saved view of the period has expired. Refresh to load the available votes.</p><button type="button" onClick={()=>{snapshotRefresh.current={route:memberVotesRoute(memberId,{...state,snapshotId:null},language),started:false,baseline:null};change({snapshotId:null});}}>Refresh votes</button></div>:request.error?<div className="member-votes-notice" role="alert"><p>Voting records could not be loaded. Try again.</p><button type="button" disabled={request.loading} onClick={request.retry}>Retry votes</button></div>:rejected?<div className="member-votes-notice" role="alert"><p>The requested voting records are unavailable here.</p><button type="button" onClick={request.retry}>Retry votes</button></div>:null}
    {data&&!expired&&!request.error&&<>
      {data.coverage.status!=='complete'&&<p className="member-votes-notice">Some voting records for this period are unavailable. More decisions or recorded positions may exist.</p>}
      <div ref={listRef} className="member-votes-pane" hidden={Boolean(state.decisionId||state.context)} onScroll={event=>{listScroll.current=event.currentTarget.scrollTop;}}>
        <div className="member-votes-tools"><p>{data.pagination.returned?`${data.pagination.offset+1}–${data.pagination.offset+data.pagination.returned} of ${data.pagination.filteredTotal}`:'0'} {countLabel(data.pagination.filteredTotal,state.positions==='recorded'?'recorded position':'decision')} · {data.pagination.observedTotal} {countLabel(data.pagination.observedTotal,'decision')} available in this period</p><div className="member-votes-filter" role="group" aria-label="Votes shown"><button type="button" aria-pressed={state.positions==='recorded'} onClick={()=>{listScroll.current=0;change({positions:'recorded',offset:0});}}>Recorded positions</button><button type="button" aria-pressed={state.positions==='all'} onClick={()=>{listScroll.current=0;change({positions:'all',offset:0});}}>All decisions</button></div></div>
        {groups.map(group=>{
          const title=group.subject?chosenTitle(group.subject,language):null;
          return <section className="member-votes-subject" key={group.id}><h3><button type="button" data-vote-group={group.id} aria-expanded={state.expandedSubjectIds.includes(group.id)} onClick={()=>change({expandedSubjectIds:state.expandedSubjectIds.includes(group.id)?state.expandedSubjectIds.filter(item=>item!==group.id):[...state.expandedSubjectIds,group.id]},true)}><span className="member-votes-disclosure" aria-hidden="true">{state.expandedSubjectIds.includes(group.id)?'−':'+'}</span><span><span lang={title?.language} title={title?.raw}>{title?.text||'Vote without a linked subject'}</span><span className="member-votes-subject-count">{group.subject?`${group.subject.counts.filtered} ${countLabel(group.subject.counts.filtered,state.positions==='recorded'?'recorded position':'decision')} in this subject · ${group.subject.counts.page} on this page`:dateLabel(group.items[0]?.date||null)}</span><span className="member-votes-subject-count">{memberVotePositionSummary(group.items)}</span></span></button></h3>
            {group.subject?.wholeTextDecisions.map(whole=><WholeText key={whole.id} vote={whole} memberName={memberName} onDecision={selectDecision}/>)}
            <div hidden={!state.expandedSubjectIds.includes(group.id)}>{group.items.map(vote=><button type="button" className="member-votes-row" key={vote.id} data-vote-id={vote.id} onClick={()=>selectDecision(vote.id)}><span className="member-votes-row-copy"><span>{memberVoteLabel(vote,language)}</span>{vote.intention.status==='reported'&&<span className="member-votes-muted">Intention declared</span>}</span><Position vote={vote} memberName={memberName}/><Result vote={vote}/><span aria-hidden="true">›</span></button>)}</div>
          </section>;
        })}
        {!groups.length&&<p className="member-votes-empty">{state.positions==='recorded'?'No recorded positions are available for this period. Choose All decisions to see available outcomes.':'No decisions are available for this period.'}</p>}
        {(state.offset>0||data.pagination.nextOffset!==null)&&<nav className="member-votes-pages" aria-label="Voting records pages"><button type="button" disabled={state.offset===0} onClick={()=>{listScroll.current=0;change({offset:Math.max(0,state.offset-MEMBER_VOTES_PAGE_SIZE)});}}>Previous page</button><button type="button" disabled={data.pagination.nextOffset===null} onClick={()=>{listScroll.current=0;change({offset:data.pagination.nextOffset??state.offset});}}>Next page</button></nav>}
      </div>
      <div ref={detailRef} className="member-votes-pane" hidden={!state.decisionId||Boolean(state.context)} onScroll={event=>{detailScroll.current=event.currentTarget.scrollTop;}}>
        <button className="member-votes-back" type="button" onClick={()=>change({decisionId:null,context:null})}>← Back to votes</button>
        <div ref={headingRef}>{selected?<Detail vote={selected} data={data} memberName={memberName} language={language} onDecision={selectDecision} openContext={context=>change({context})}/>:state.decisionId?<div className="member-votes-empty"><h2 tabIndex={-1}>Vote unavailable</h2><p>The requested decision is unavailable in this period.</p></div>:null}</div>
      </div>
      {state.context&&(contextAllowed?renderContext({...state.context,onBack:()=>change({context:null})}):<div className="member-votes-empty"><button type="button" onClick={()=>change({context:null})}>← Back to vote</button><p>The requested document is unavailable for this vote.</p></div>)}
    </>}
  </section>;
}
