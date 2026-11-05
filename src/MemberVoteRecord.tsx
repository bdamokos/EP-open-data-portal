import {useMemo} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import type {MemberVoteRecordDeparture,MemberVoteRecordResponse} from './MemberVoteRecordTypes';
import {MEMBER_VOTE_RECORD_LIMIT,memberVoteRecordRoute,recordAlignment,recordShare,recordSummary,recordTrend,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';
import {memberVotesJourneyParams} from './memberVotesJourney.mjs';
import './MemberVoteRecord.css';

const dateLabel=(value:string|null,locale:string)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date):value;
};
const percent=(share:number|null,ui:ReturnType<typeof useUiI18n>)=>share===null?ui.t('membervoterecord.noValue'):ui.t('membervoterecord.percent',{value:recordShare(share)??0});
const trendPath=(points:{x:number;y:number}[])=>points.map((point,index)=>(index?'L':'M')+point.x.toFixed(2)+' '+point.y.toFixed(2)).join(' ');

// A departure stays a real link so it can be opened in a new tab, while a
// plain click keeps the in-page journey state and loaded votes content.
const decisionHref=(memberId:number,item:MemberVoteRecordDeparture)=>{
  if(typeof window==='undefined')return null;
  const url=new URL(window.location.href);
  for(const key of [...url.searchParams.keys()])if(key.startsWith('mv-'))url.searchParams.delete(key);
  url.searchParams.set('member',String(memberId));url.searchParams.set('module','votes');
  const journey={memberId:Number(memberId),state:{week:'latest',sittingId:item.sittingId,positions:'all' as const,alignment:'all' as const,offset:0,decisionId:item.decisionId,snapshotId:null,expandedSubjectIds:[],context:null,recordScope:'all' as const,recordOffset:0},adoptedId:null,invalid:false};
  for(const [key,value] of memberVotesJourneyParams(journey))url.searchParams.set(key,value);
  return url.href;
};

function Trend({data}:{data:MemberVoteRecordResponse}) {
  const ui=useUiI18n();
  const trend=useMemo(()=>recordTrend(data),[data]);
  const width=320,height=118,paddingX=18,paddingY=14;
  const points=trend.map((day,index)=>({
    ...day,
    x:trend.length===1?width/2:paddingX+index*(width-paddingX*2)/(trend.length-1),
    y:day.share===null?null:paddingY+(1-day.share)*(height-paddingY*2),
  }));
  const runs:{x:number;y:number}[][]=[];
  let run:{x:number;y:number}[]=[];
  for(const point of points){
    if(point.y===null){if(run.length)runs.push(run);run=[];continue;}
    run.push({x:point.x,y:point.y});
  }
  if(run.length)runs.push(run);
  const lines=runs.filter(item=>item.length>1);
  if(!points.length)return <p className="member-vote-record-empty"><UiMessage id="membervoterecord.trend.empty"/></p>;
  return <figure className="member-vote-record-trend">
    <h3><UiMessage id="membervoterecord.trend.heading"/></h3>
    <svg viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true" focusable="false">
      <line x1={paddingX} x2={width-paddingX} y1={paddingY} y2={paddingY} className="member-vote-record-grid"/>
      <line x1={paddingX} x2={width-paddingX} y1={height/2} y2={height/2} className="member-vote-record-grid"/>
      <line x1={paddingX} x2={width-paddingX} y1={height-paddingY} y2={height-paddingY} className="member-vote-record-grid"/>
      {lines.map((run,index)=><path key={index} d={trendPath(run)} className="member-vote-record-line"/>)}
      {points.map(point=>point.y===null?null:<circle key={point.sittingId} cx={point.x} cy={point.y} r={3.5} className="member-vote-record-dot"/>)}
    </svg>
    <figcaption>
      <p className="visually-hidden"><UiMessage id="membervoterecord.trend.alternative"/></p>
      <ul className="visually-hidden">{points.map(point=><li key={point.sittingId}>{point.share===null
        ? <UiMessage id="membervoterecord.trend.gap" values={{date:dateLabel(point.date,ui.locale)}}/>
        : <UiMessage id="membervoterecord.trend.point" values={{date:dateLabel(point.date,ui.locale),share:percent(point.share,ui),with:point.withGroup??0,comparable:point.comparable??0}}/>}</li>)}</ul>
    </figcaption>
  </figure>;
}

function Departures({data,memberId,scope,onOffset,onOpenDecision}:{data:MemberVoteRecordResponse;memberId:number;scope:'all'|'final';onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const departures=data.departures;
  return <section className="member-vote-record-departures">
    <h3>{scope==='final'?<UiMessage id="membervoterecord.departures.final"/>:<UiMessage id="membervoterecord.departures.all"/>}</h3>
    {!departures.total&&<p className="member-vote-record-empty">{scope==='final'?<UiMessage id="membervoterecord.departures.final.empty"/>:<UiMessage id="membervoterecord.departures.empty"/>}</p>}
    {Boolean(departures.total)&&<ol start={departures.offset+1}>{departures.items.map(item=><li key={item.decisionId+item.sittingId}>
      <a href={decisionHref(memberId,item)??undefined} onClick={event=>{
        if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        event.preventDefault();onOpenDecision(item);
      }}>{dateLabel(item.date,ui.locale)} · {item.text||ui.t('membervoterecord.untitled')}</a>
    </li>)}</ol>}
    {Boolean(departures.total)&&<p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.range" values={{start:departures.offset+1,end:departures.offset+departures.items.length,total:departures.total}}/></p>}
    <div className="member-vote-record-departure-actions">
      {departures.offset>0&&<button type="button" onClick={()=>onOffset(0)}><UiMessage id="membervoterecord.departures.first"/></button>}
      {departures.nextOffset!==null&&<button type="button" onClick={()=>onOffset(departures.nextOffset??0)}><UiMessage id="membervoterecord.departures.more"/></button>}
    </div>
  </section>;
}

export function MemberVoteRecord({memberId,language,scope,offset,onScopeChange,onOffset,onOpenDecision}:{
  memberId:number;language:string;scope:'all'|'final';offset:number;
  onScopeChange:(scope:'all'|'final')=>void;onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void;
}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:MEMBER_VOTE_RECORD_LIMIT,offset}),[memberId,language,scope,offset]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  if(!data)return <section className="member-vote-record" lang={ui.language} aria-label={ui.t('membervoterecord.heading')}>
    <p className={request.error||!request.loading?'member-vote-record-status':'member-vote-record-status'} role="status">
      {request.error||!request.loading?<UiMessage id="membervoterecord.unavailable"/>:<UiMessage id="membervoterecord.loading"/>}
    </p>
  </section>;
  const figures=recordAlignment(data,scope);
  const groupKnown=data.group.status==='attached';
  const comparison=data.comparison;
  return <section className="member-vote-record" lang={ui.language} aria-labelledby="member-vote-record-heading">
    <header className="member-vote-record-header">
      <div>
        <h2 id="member-vote-record-heading"><UiMessage id="membervoterecord.heading"/></h2>
        <p className="member-vote-record-muted">{data.period.to===null
          ? <UiMessage id="membervoterecord.period.open" values={{from:dateLabel(data.period.from,ui.locale)}}/>
          : <UiMessage id="membervoterecord.period" values={{from:dateLabel(data.period.from,ui.locale),to:dateLabel(data.period.to,ui.locale)}}/>}</p>
      </div>
      <div className="member-vote-record-filter" role="group" aria-label={ui.t('membervoterecord.scope.label')}>
        <button type="button" aria-pressed={scope==='all'} onClick={()=>onScopeChange('all')}><UiMessage id="membervoterecord.scope.all"/></button>
        <button type="button" aria-pressed={scope==='final'} onClick={()=>onScopeChange('final')}><UiMessage id="membervoterecord.scope.final"/></button>
      </div>
    </header>
    <p className="member-vote-record-coverage">{data.coverage.status==='complete'
      ? <UiMessage id="membervoterecord.coverage.complete" values={{sittings:data.coverage.sittings}}/>
      : data.coverage.status==='partial'
        ? <UiMessage id="membervoterecord.coverage.partial" values={{included:data.coverage.included,sittings:data.coverage.sittings}}/>
        : <UiMessage id="membervoterecord.coverage.unavailable"/>}</p>
    <dl className="member-vote-record-ballots">
      <div><dt><UiMessage id="membervoterecord.ballots.recorded"/></dt><dd>{ui.number(data.ballots.recorded)}</dd></div>
      <div><dt><UiMessage id="membervoterecord.ballots.named"/></dt><dd>{ui.number(data.ballots.named)}</dd></div>
      {data.ballots.chaired>0&&<div><dt><UiMessage id="membervoterecord.ballots.chaired"/></dt><dd>{ui.number(data.ballots.chaired)}</dd></div>}
    </dl>
    {!groupKnown?<p className="member-vote-record-note">{data.group.status==='non-attached'
      ? <UiMessage id="membervoterecord.nonAttached"/>
      : <UiMessage id="membervoterecord.groupUnavailable"/>}</p>:<>
      {figures&&<>
        <dl className="member-vote-record-figures">
          <div><dt><UiMessage id="membervoterecord.withGroup"/></dt><dd>{percent(figures.withShare,ui)}</dd><small><UiMessage id="membervoterecord.comparable" values={{with:figures.with,comparable:figures.comparable}}/></small></div>
          <div><dt><UiMessage id="membervoterecord.againstGroup"/></dt><dd>{percent(figures.againstShare,ui)}</dd><small><UiMessage id="membervoterecord.comparable" values={{with:figures.against,comparable:figures.comparable}}/></small></div>
          <div><dt><UiMessage id="membervoterecord.abstained"/></dt><dd>{ui.number(figures.abstained)}</dd><small><UiMessage id="membervoterecord.ofRecorded" values={{recorded:figures.total}}/></small></div>
          <div><dt><UiMessage id="membervoterecord.notComparable"/></dt><dd>{ui.number(figures.notComparable)}</dd><small><UiMessage id="membervoterecord.notComparableDetail"/></small></div>
        </dl>
        <p className="member-vote-record-muted"><UiMessage id="membervoterecord.groupLine"/></p>
      </>}
      {comparison&&<p className="member-vote-record-comparison"><UiMessage id="membervoterecord.comparison" values={{
        group:percent(comparison.group.median,ui),groupMembers:comparison.group.members,
        parliament:percent(comparison.parliament.median,ui),parliamentMembers:comparison.parliament.members,
      }}/></p>}
      <Trend data={data}/>
      <Departures data={data} memberId={memberId} scope={scope} onOffset={onOffset} onOpenDecision={onOpenDecision}/>
    </>}
  </section>;
}

export function MemberVoteRecordSummary({memberId,language,onOpen}:{memberId:number;language:string;onOpen:()=>void}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,limit:0}),[memberId,language]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  if(!data)return <p className="member-vote-record-summary member-vote-record-status" role="status">{request.error||!request.loading?<UiMessage id="membervoterecord.unavailable"/>:<UiMessage id="membervoterecord.loading"/>}</p>;
  const summary=recordSummary(data);
  const chaired=summary.chaired?ui.t('membervoterecord.summary.chaired',{count:summary.chaired}):'';
  return <p className="member-vote-record-summary"><button type="button" onClick={onOpen}>{summary.recorded===0
    ? <UiMessage id="membervoterecord.summary.empty"/>
    : summary.attached&&summary.share!==null
      ? <UiMessage id="membervoterecord.summary.attached" values={{share:percent(summary.share,ui),recorded:summary.recorded,chaired}}/>
      : <UiMessage id="membervoterecord.summary.nonAttached" values={{recorded:summary.recorded,chaired}}/>}</button></p>;
}
