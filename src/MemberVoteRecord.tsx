import {useEffect,useMemo,useState} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import type {MemberVoteRecordDeparture,MemberVoteRecordResponse} from './MemberVoteRecordTypes';
import {MEMBER_VOTE_RECORD_LIMIT,memberVoteRecordRoute,recordAlignment,recordComparison,recordShare,recordSummary,recordTrend,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import './MemberVoteRecord.css';

const dateLabel=(value:string|null,locale:string)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date):value;
};
const percent=(share:number|null,ui:ReturnType<typeof useUiI18n>)=>share===null?ui.t('membervoterecord.noValue'):ui.t('membervoterecord.percent',{value:recordShare(share)??0});
const num=(ui:ReturnType<typeof useUiI18n>,value:number)=>new Intl.NumberFormat(ui.language).format(value);
const MARKER_LIMIT=24;
const COMPACT='(max-width: 639px)';
// Narrow screens fold the trend and the departures behind disclosures to keep the panel short.
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
const trendPath=(points:{x:number;y:number}[])=>points.map((point,index)=>(index?'L':'M')+point.x.toFixed(2)+' '+point.y.toFixed(2)).join(' ');

const votesHref=(memberId:number)=>{
  if(typeof window==='undefined')return null;
  const url=new URL(window.location.href);
  url.searchParams.set('member',String(memberId));url.searchParams.set('module','votes');
  return url.href;
};

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

function Trend({data,scope,caption=true}:{data:MemberVoteRecordResponse;scope:'all'|'final';caption?:boolean}) {
  const ui=useUiI18n();
  const trend=useMemo(()=>recordTrend(data,scope),[data,scope]);
  const width=320,height=96,paddingX=34,paddingY=10,right=10;
  const points=trend.map((day,index)=>({
    ...day,
    x:trend.length===1?(paddingX+width-right)/2:paddingX+index*(width-paddingX-right)/(trend.length-1),
    y:day.share===null?null:paddingY+(1-day.share)*(height-paddingY*2),
  }));
  if(!points.some(point=>point.y!==null))return null;
  // Dozens of markers merge into a bar, so a long series is drawn as a line and only isolated points keep one.
  const dense=points.length>MARKER_LIMIT;
  // A null sitting breaks the line instead of drawing through a zero.
  const runs:{x:number;y:number}[][]=[];
  let run:{x:number;y:number}[]=[];
  for(const point of points){
    if(point.y===null){if(run.length)runs.push(run);run=[];continue;}
    run.push({x:point.x,y:point.y});
  }
  if(run.length)runs.push(run);
  return <figure className="member-vote-record-trend">
    {caption&&<figcaption><UiMessage id="membervoterecord.trend.heading"/></figcaption>}
    <div className="member-vote-record-plot">
    <span className="member-vote-record-tick" style={{top:paddingY/height*100+'%'}} aria-hidden="true">100%</span>
    <span className="member-vote-record-tick" style={{top:'50%'}} aria-hidden="true">50%</span>
    <span className="member-vote-record-tick" style={{top:(height-paddingY)/height*100+'%'}} aria-hidden="true">0%</span>
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {[paddingY,height/2,height-paddingY].map(y=><line key={y} x1={paddingX} x2={width-right} y1={y} y2={y} className="member-vote-record-grid"/>)}
      {runs.filter(item=>item.length>1).map((item,index)=><path key={index} d={trendPath(item)} className="member-vote-record-line"/>)}
      {points.map((point,index)=>point.y===null||dense&&(points[index-1]?.y??null)!==null||dense&&(points[index+1]?.y??null)!==null?null:<circle key={point.sittingId} cx={point.x} cy={point.y} r={3} className="member-vote-record-dot"/>)}
    </svg>
    </div>
    <div className="member-vote-record-axis"><span>{dateLabel(trend[0].date,ui.locale)}</span><span>{dateLabel(trend[trend.length-1].date,ui.locale)}</span></div>
    <p className="visually-hidden"><UiMessage id="membervoterecord.trend.alternative"/></p>
    <ul className="visually-hidden">{points.map(point=><li key={point.sittingId}>{point.share===null
      ? <UiMessage id="membervoterecord.trend.gap" values={{date:dateLabel(point.date,ui.locale)}}/>
      : <UiMessage id="membervoterecord.trend.point" values={{date:dateLabel(point.date,ui.locale),share:percent(point.share,ui),count:point.withGroup??0,comparable:point.comparable??0}}/>}</li>)}</ul>
  </figure>;
}

const PAGE=MEMBER_VOTE_RECORD_LIMIT;

// One page of departures, fetched on its own so a reload restores every page already shown.
function DeparturePage({memberId,language,scope,offset,onOpenDecision}:{memberId:number;language:string;scope:'all'|'final';offset:number;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:PAGE,offset}),[memberId,language,scope,offset]);
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

function Departures({data,memberId,language,scope,offset,onOffset,onOpenDecision}:{data:MemberVoteRecordResponse;memberId:number;language:string;scope:'all'|'final';offset:number;onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const total=data.departures.total;
  // The URL offset is the last page shown; every page up to it is rendered, in order.
  const pages=Math.floor(offset/PAGE)+1,shown=Math.min(pages*PAGE,total);
  return <section className="member-vote-record-departures">
    <h3><UiMessage id="membervoterecord.departures.all"/></h3>
    {!total&&<p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.empty"/></p>}
    {Boolean(total)&&<ol>{Array.from({length:pages},(_,page)=><DeparturePage key={scope+page} memberId={memberId} language={language} scope={scope} offset={page*PAGE} onOpenDecision={onOpenDecision}/>)}</ol>}
    {shown<total&&<>
      <p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.range" values={{start:1,end:shown,total}}/></p>
      <div className="member-vote-record-departure-actions"><button type="button" onClick={()=>onOffset(pages*PAGE)}><UiMessage id="membervoterecord.departures.more"/></button></div>
    </>}
  </section>;
}

export function MemberVoteRecord({memberId,language,scope,offset,onScopeChange,onOffset,onOpenDecision}:{
  memberId:number;language:string;scope:'all'|'final';offset:number;
  onScopeChange:(scope:'all'|'final')=>void;onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void;
}) {
  const ui=useUiI18n();
  const compact=useCompact();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:MEMBER_VOTE_RECORD_LIMIT,offset:0}),[memberId,language,scope]);
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
  const medianLine=medians?<UiMessage id="membervoterecord.medians" values={{group:percent(medians.group.median,ui),parliament:percent(medians.parliament.median,ui)}}/>:null;
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
    <dl className="member-vote-record-figures">
      {groupKnown&&<>
        <div><dt><UiMessage id="membervoterecord.withGroup"/></dt><dd>{percent(figures.withShare,ui)}</dd>
          <small>{figures.comparable?<UiMessage id="membervoterecord.share.detail" values={{count:figures.with,comparable:figures.comparable}}/>:null}</small>
          {medians&&<small className="member-vote-record-wide">{medianLine}</small>}</div>
        <div><dt><UiMessage id="membervoterecord.againstGroup"/></dt><dd>{figures.comparable?num(ui,figures.against):ui.t('membervoterecord.noValue')}</dd>
          <small>{figures.comparable?<UiMessage id="membervoterecord.share.detail" values={{count:figures.against,comparable:figures.comparable}}/>:null}</small></div>
      </>}
      <div><dt><UiMessage id="membervoterecord.recorded"/></dt>
        <dd>{ballots.named===null?num(ui,ballots.recorded):<UiMessage id="membervoterecord.recorded.value" values={{recorded:num(ui,ballots.recorded),named:num(ui,ballots.named)}}/>}</dd>
        {ballots.named!==null&&<small><UiMessage id="membervoterecord.recorded.detail"/></small>}
        {ballots.chaired>0&&<small className="member-vote-record-keep"><UiMessage id="membervoterecord.chaired" values={{count:num(ui,ballots.chaired)}}/></small>}
        {data.group.status!=='attached'&&<small className="member-vote-record-keep">{data.group.status==='non-attached'?<UiMessage id="membervoterecord.nonAttached"/>:<UiMessage id="membervoterecord.groupUnavailable"/>}</small>}</div>
    </dl>
    {groupKnown&&<>
      <Disclosure compact={compact} summary={<UiMessage id="membervoterecord.trend.heading"/>}>
        {compact&&medianLine&&<p className="member-vote-record-muted">{medianLine}</p>}
        <Trend data={data} scope={scope} caption={!compact}/>
      </Disclosure>
      <Disclosure compact={compact} summary={<><UiMessage id="membervoterecord.departures.all"/> · {num(ui,data.departures.total)}</>}>
        <Departures data={data} memberId={memberId} language={language} scope={scope} offset={offset} onOffset={onOffset} onOpenDecision={onOpenDecision}/>
      </Disclosure>
    </>}
  </section>;
}

export function MemberVoteRecordSummary({memberId,language,onOpen}:{memberId:number;language:string;onOpen:()=>void}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,limit:0}),[memberId,language]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  if(!data)return <p className="member-vote-record-summary member-vote-record-status" role="status">{request.error||!request.loading?<UiMessage id="membervoterecord.unavailable"/>:<UiMessage id="membervoterecord.loading"/>}</p>;
  if(data.coverage.included===0)return <p className="member-vote-record-summary member-vote-record-status" role="status"><UiMessage id="membervoterecord.pending"/></p>;
  const summary=recordSummary(data);
  const chaired=summary.chaired?ui.t('membervoterecord.summary.chaired',{count:summary.chaired}):'';
  const coverage=data.coverage.status==='partial'?ui.t('membervoterecord.summary.coverage',{included:data.coverage.included,sittings:data.coverage.sittings}):'';
  return <p className="member-vote-record-summary"><a href={votesHref(memberId)??undefined} onClick={event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onOpen();
  }}>{summary.recorded===0
    ? <UiMessage id="membervoterecord.summary.empty"/>
    : summary.attached&&summary.share!==null
      ? <UiMessage id="membervoterecord.summary.attached" values={{share:percent(summary.share,ui),recorded:summary.recorded,chaired,coverage}}/>
      : <UiMessage id="membervoterecord.summary.nonAttached" values={{recorded:summary.recorded,chaired,coverage}}/>}</a></p>;
}
