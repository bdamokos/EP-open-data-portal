import {useEffect,useMemo,useState} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import type {MemberVoteRecordBreakdownList,MemberVoteRecordDeparture,MemberVoteRecordResponse} from './MemberVoteRecordTypes';
import {MEMBER_VOTE_RECORD_LIMIT,memberVoteRecordRoute,recordAlignment,recordComparison,recordShare,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import './MemberVoteRecord.css';

const dateLabel=(value:string|null,locale:string)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date):value;
};
const percent=(share:number|null,ui:ReturnType<typeof useUiI18n>)=>share===null?ui.t('membervoterecord.noValue'):ui.t('membervoterecord.percent',{value:recordShare(share)??0});
const num=(ui:ReturnType<typeof useUiI18n>,value:number)=>new Intl.NumberFormat(ui.language).format(value);
const COMPACT='(max-width: 639px)';
// Narrow screens fold the departures behind a disclosure to keep the panel short.
function useCompact() {
  const [compact,setCompact]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.(COMPACT)?.matches===true);
  useEffect(()=>{
    const query=window.matchMedia?.(COMPACT);
    if(!query)return;
    const update=()=>setCompact(query.matches);
    update();query.addEventListener?.('change',update);
    return ()=>query.removeEventListener?.('change',update);
  },[]);
  return compact;
}
function Disclosure({compact,summary,children}:{compact:boolean;summary:React.ReactNode;children:React.ReactNode}) {
  const [open,setOpen]=useState(false);
  if(!compact)return <>{children}</>;
  return <details className="member-vote-record-disclosure" open={open} onToggle={event=>setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>{summary}</summary>{children}
  </details>;
}

// A departure stays a real link so it can be opened in a new tab, while a
// plain click keeps the in-page journey state and loaded votes content.
const decisionHref=(memberId:number,item:MemberVoteRecordDeparture)=>{
  if(typeof window==='undefined')return null;
  const url=new URL(window.location.href);
  for(const key of [...url.searchParams.keys()])if(key.startsWith('mv-'))url.searchParams.delete(key);
  url.searchParams.set('member',String(memberId));url.searchParams.set('module','votes');
  const journey={memberId:Number(memberId),state:{week:'latest',sittingId:item.sittingId,positions:'all' as const,alignment:'all' as const,offset:0,decisionId:item.decisionId,snapshotId:null,expandedSubjectIds:[],context:null},adoptedId:null,invalid:false};
  for(const [key,value] of memberVotesJourneyParams(journey))url.searchParams.set(key,value);
  return url.href;
};

const positionLabel=(position:string|null,ui:ReturnType<typeof useUiI18n>)=>position?ui.t('votegroups.position.'+position):ui.t('membervoterecord.noValue');

const PAGE=MEMBER_VOTE_RECORD_LIMIT;

// One page of departures, fetched on its own so a reload restores every page already shown.
function DeparturePage({memberId,language,scope,tag,offset,onOpenDecision}:{memberId:number;language:string;scope:'all'|'final';tag:string|null;offset:number;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:PAGE,offset,tag}),[memberId,language,scope,tag,offset]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  if(!data)return null;
  return <>{data.departures.items.map(item=>{
    const primary=item.subject?.text??item.text,primaryLanguage=item.subject?.text?item.subject.language:item.language;
    const markLanguage=(code:string|null)=>code&&code!=='mul'&&code!==ui.language?code:undefined;
    return <li key={item.decisionId+item.sittingId}>
      <a href={decisionHref(memberId,item)??undefined} lang={markLanguage(primaryLanguage)} onClick={event=>{
        if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        event.preventDefault();onOpenDecision(item);
      }}>{primary||ui.t('membervoterecord.departures.untitled')}</a>
      {item.subject?.text&&item.text&&<span className="member-vote-record-label" lang={markLanguage(item.language)}>{item.text}</span>}
      <small>{dateLabel(item.date,ui.locale)} · <UiMessage id="membervoterecord.departures.line" values={{position:positionLabel(item.position,ui),line:positionLabel(item.line,ui)}}/></small>
    </li>;
  })}</>;
}

function Departures({data,memberId,language,scope,tag,offset,onOffset,onTagChange,onOpenDecision}:{data:MemberVoteRecordResponse;memberId:number;language:string;scope:'all'|'final';tag:string|null;offset:number;onOffset:(offset:number)=>void;onTagChange:(tag:string|null)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const total=data.departures.total;
  // The URL offset is the last page shown; every page up to it is rendered, in order.
  const pages=Math.floor(offset/PAGE)+1,shown=Math.min(pages*PAGE,total);
  return <section className="member-vote-record-departures">
    <h3><UiMessage id="membervoterecord.departures.all"/></h3>
    {tag&&<p className="member-vote-record-filterline">
      <span><UiMessage id="membervoterecord.filter.on" values={{label:<span lang={data.departures.tag?.language&&data.departures.tag.language!=='mul'&&data.departures.tag.language!==ui.language?data.departures.tag.language:undefined}>{data.departures.tag?.label??''}</span>}}/></span>
      <button type="button" onClick={()=>onTagChange(null)}><UiMessage id="membervoterecord.filter.clear"/></button>
    </p>}
    {!total&&<p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.empty"/></p>}
    {Boolean(total)&&<ol>{Array.from({length:pages},(_,page)=><DeparturePage key={scope+(tag??'')+page} memberId={memberId} language={language} scope={scope} tag={tag} offset={page*PAGE} onOpenDecision={onOpenDecision}/>)}</ol>}
    {shown<total&&<>
      <p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.range" values={{start:1,end:shown,total}}/></p>
      <div className="member-vote-record-departure-actions"><button type="button" onClick={()=>onOffset(pages*PAGE)}><UiMessage id="membervoterecord.departures.more"/></button></div>
    </>}
  </section>;
}

// Rows share one grid so the label, share and count each keep one edge in both lists.
function BreakdownList({heading,list,tag,onTag}:{heading:string;list:MemberVoteRecordBreakdownList;tag:string|null;onTag:(tag:string|null)=>void}) {
  const ui=useUiI18n();
  return <div className="member-vote-record-list">
    <h4>{heading}</h4>
    <ul>{list.rows.map(row=><li key={row.key}>
      <button type="button" aria-pressed={tag===row.key} onClick={()=>onTag(tag===row.key?null:row.key)}>
        <span className="member-vote-record-row-label" lang={row.language&&row.language!=='mul'&&row.language!==ui.language?row.language:undefined}>{row.label}</span>
        <span className="member-vote-record-row-share">{ui.t('membervoterecord.percent',{value:Math.round(row.share*100)})}</span>
        <span className="member-vote-record-row-count">{ui.t('membervoterecord.breakdown.votes',{count:num(ui,row.comparable)})}</span>
      </button>
    </li>)}</ul>
  </div>;
}

function Breakdown({data,tag,onTag}:{data:MemberVoteRecordResponse;tag:string|null;onTag:(tag:string|null)=>void}) {
  const ui=useUiI18n();
  const breakdown=data.breakdown;
  // Nothing eligible, no group line or too few votes: no section at all.
  if(!breakdown)return null;
  const lists=[
    {id:'topics',heading:ui.t('membervoterecord.breakdown.topics'),list:breakdown.topics},
    {id:'countries',heading:ui.t('membervoterecord.breakdown.countries'),list:breakdown.countries},
  ].filter(item=>item.list.rows.length>0);
  return <section className="member-vote-record-breakdown" aria-labelledby="member-vote-record-breakdown-heading">
    <h3 id="member-vote-record-breakdown-heading"><UiMessage id="membervoterecord.breakdown.heading"/></h3>
    {lists.length===0
      ? <p className="member-vote-record-muted"><UiMessage id="membervoterecord.breakdown.none"/></p>
      : <div className={'member-vote-record-lists'+(lists.length===1?' member-vote-record-lists-single':'')}>{lists.map(item=><BreakdownList key={item.id} heading={item.heading} list={item.list} tag={tag} onTag={onTag}/>)}</div>}
  </section>;
}

export function MemberVoteRecord({memberId,language,scope,offset,tag,onScopeChange,onTagChange,onOffset,onOpenDecision}:{
  memberId:number;language:string;scope:'all'|'final';offset:number;tag:string|null;
  onScopeChange:(scope:'all'|'final')=>void;onTagChange:(tag:string|null)=>void;onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void;
}) {
  const ui=useUiI18n();
  const compact=useCompact();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:MEMBER_VOTE_RECORD_LIMIT,offset:0,tag}),[memberId,language,scope,tag]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  if(!data)return <section className="member-vote-record" lang={ui.language} aria-label={ui.t('membervoterecord.heading')}>
    <p className="member-vote-record-status" role="status">
      {request.error||!request.loading?<UiMessage id="membervoterecord.unavailable"/>:<UiMessage id="membervoterecord.loading"/>}
    </p>
  </section>;
  // Before the first projection there is nothing to count, and zeros would read as real figures.
  if(data.coverage.included===0)return <section className="member-vote-record" lang={ui.language} aria-label={ui.t('membervoterecord.heading')}>
    <p className="member-vote-record-status" role="status"><UiMessage id="membervoterecord.pending"/></p>
  </section>;
  const figures=recordAlignment(data,scope);
  // With no comparable vote at all there is nothing to say about the group line.
  const groupKnown=data.group.status==='attached'&&recordAlignment(data,'all')!==null&&(recordAlignment(data,'all')?.comparable??0)>0&&figures!==null;
  const medians=recordComparison(data,scope);
  const {ballots}=data;
  return <section className="member-vote-record" lang={ui.language} aria-labelledby="member-vote-record-heading">
    <header className="member-vote-record-header">
      <div>
        <h2 id="member-vote-record-heading"><UiMessage id="membervoterecord.heading"/></h2>
        <p className="member-vote-record-muted">{data.period.to===null
          ? <UiMessage id="membervoterecord.period.open" values={{from:dateLabel(data.period.from,ui.locale)}}/>
          : <UiMessage id="membervoterecord.period" values={{from:dateLabel(data.period.from,ui.locale),to:dateLabel(data.period.to,ui.locale)}}/>}
          {data.coverage.status==='partial'&&<> · <UiMessage id="membervoterecord.coverage.partial" values={{missing:data.coverage.missing}}/></>}</p>
      </div>
      {groupKnown&&<div className="member-vote-record-filter" role="group" aria-label={ui.t('membervoterecord.scope.label')}>
        <button type="button" aria-pressed={scope==='all'} onClick={()=>onScopeChange('all')}><UiMessage id="membervoterecord.scope.all"/></button>
        <button type="button" aria-pressed={scope==='final'} onClick={()=>onScopeChange('final')}><UiMessage id="membervoterecord.scope.final"/></button>
      </div>}
    </header>
    {groupKnown&&<dl className="member-vote-record-figures">
      <div><dt><UiMessage id="membervoterecord.againstGroup"/></dt><dd>{num(ui,figures.against)}</dd></div>
      <div><dt><UiMessage id="membervoterecord.withGroup"/></dt><dd>{percent(figures.withShare,ui)}</dd>
        {medians&&<small className="member-vote-record-keep"><UiMessage id="membervoterecord.medians" values={{group:percent(medians.group.median,ui)}}/></small>}</div>
    </dl>}
    {(ballots.chaired>0||data.group.status!=='attached'||!groupKnown)&&<p className="member-vote-record-notes">
      {ballots.chaired>0&&<span><UiMessage id="membervoterecord.chaired" values={{count:num(ui,ballots.chaired)}}/></span>}
      {data.group.status==='non-attached'&&<span><UiMessage id="membervoterecord.nonAttached"/></span>}
      {data.group.status==='unavailable'&&<span><UiMessage id="membervoterecord.groupUnavailable"/></span>}
      {data.group.status==='attached'&&!groupKnown&&<span><UiMessage id="membervoterecord.noComparable"/></span>}
    </p>}
    {groupKnown&&<Breakdown data={data} tag={tag} onTag={onTagChange}/>}
    {groupKnown&&<Disclosure compact={compact} summary={<><UiMessage id="membervoterecord.departures.all"/> · {num(ui,data.departures.total)}</>}>
      <Departures data={data} memberId={memberId} language={language} scope={scope} tag={tag} offset={offset} onOffset={onOffset} onTagChange={onTagChange} onOpenDecision={onOpenDecision}/>
    </Disclosure>}
  </section>;
}
