import {useMemo} from 'react';
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
  const journey={memberId:Number(memberId),state:{week:'latest',sittingId:item.sittingId,positions:'all' as const,alignment:'all' as const,offset:0,decisionId:item.decisionId,snapshotId:null,expandedSubjectIds:[],context:null,recordScope:'all' as const,recordOffset:0},adoptedId:null,invalid:false};
  for(const [key,value] of memberVotesJourneyParams(journey))url.searchParams.set(key,value);
  return url.href;
};

const positionLabel=(position:string|null,ui:ReturnType<typeof useUiI18n>)=>position?ui.t('votegroups.position.'+position):ui.t('membervoterecord.noValue');

function Trend({data,scope}:{data:MemberVoteRecordResponse;scope:'all'|'final'}) {
  const ui=useUiI18n();
  const trend=useMemo(()=>recordTrend(data,scope),[data,scope]);
  const width=320,height=96,paddingX=34,paddingY=10,right=10;
  const points=trend.map((day,index)=>({
    ...day,
    x:trend.length===1?(paddingX+width-right)/2:paddingX+index*(width-paddingX-right)/(trend.length-1),
    y:day.share===null?null:paddingY+(1-day.share)*(height-paddingY*2),
  }));
  if(!points.some(point=>point.y!==null))return null;
  // A null sitting breaks the line instead of drawing through a zero.
  const runs:{x:number;y:number}[][]=[];
  let run:{x:number;y:number}[]=[];
  for(const point of points){
    if(point.y===null){if(run.length)runs.push(run);run=[];continue;}
    run.push({x:point.x,y:point.y});
  }
  if(run.length)runs.push(run);
  return <figure className="member-vote-record-trend">
    <figcaption><UiMessage id="membervoterecord.trend.heading"/></figcaption>
    <div className="member-vote-record-plot">
    <span className="member-vote-record-tick" style={{top:paddingY/height*100+'%'}} aria-hidden="true">100%</span>
    <span className="member-vote-record-tick" style={{top:'50%'}} aria-hidden="true">50%</span>
    <span className="member-vote-record-tick" style={{top:(height-paddingY)/height*100+'%'}} aria-hidden="true">0%</span>
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {[paddingY,height/2,height-paddingY].map(y=><line key={y} x1={paddingX} x2={width-right} y1={y} y2={y} className="member-vote-record-grid"/>)}
      {runs.filter(item=>item.length>1).map((item,index)=><path key={index} d={trendPath(item)} className="member-vote-record-line"/>)}
      {points.map(point=>point.y===null?null:<circle key={point.sittingId} cx={point.x} cy={point.y} r={3} className="member-vote-record-dot"/>)}
    </svg>
    </div>
    <div className="member-vote-record-axis"><span>{dateLabel(trend[0].date,ui.locale)}</span><span>{dateLabel(trend[trend.length-1].date,ui.locale)}</span></div>
    <p className="visually-hidden"><UiMessage id="membervoterecord.trend.alternative"/></p>
    <ul className="visually-hidden">{points.map(point=><li key={point.sittingId}>{point.share===null
      ? <UiMessage id="membervoterecord.trend.gap" values={{date:dateLabel(point.date,ui.locale)}}/>
      : <UiMessage id="membervoterecord.trend.point" values={{date:dateLabel(point.date,ui.locale),share:percent(point.share,ui),count:point.withGroup??0,comparable:point.comparable??0}}/>}</li>)}</ul>
  </figure>;
}

function Departures({data,memberId,onOffset,onOpenDecision}:{data:MemberVoteRecordResponse;memberId:number;onOffset:(offset:number)=>void;onOpenDecision:(item:MemberVoteRecordDeparture)=>void}) {
  const ui=useUiI18n();
  const departures=data.departures;
  return <section className="member-vote-record-departures">
    <h3><UiMessage id="membervoterecord.departures.all"/></h3>
    {!departures.total&&<p className="member-vote-record-muted"><UiMessage id="membervoterecord.departures.empty"/></p>}
    {Boolean(departures.total)&&<ol start={departures.offset+1}>{departures.items.map(item=><li key={item.decisionId+item.sittingId}>
      <a href={decisionHref(memberId,item)??undefined} onClick={event=>{
        if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        event.preventDefault();onOpenDecision(item);
      }}>{item.text||ui.t('membervoterecord.departures.untitled')}</a>
      <small>{dateLabel(item.date,ui.locale)} · <UiMessage id="membervoterecord.departures.line" values={{position:positionLabel(item.position,ui),line:positionLabel(item.line,ui)}}/></small>
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
    <p className="member-vote-record-status" role="status">
      {request.error||!request.loading?<UiMessage id="membervoterecord.unavailable"/>:<UiMessage id="membervoterecord.loading"/>}
    </p>
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
      <div className="member-vote-record-filter" role="group" aria-label={ui.t('membervoterecord.scope.label')}>
        <button type="button" aria-pressed={scope==='all'} onClick={()=>onScopeChange('all')}><UiMessage id="membervoterecord.scope.all"/></button>
        <button type="button" aria-pressed={scope==='final'} onClick={()=>onScopeChange('final')}><UiMessage id="membervoterecord.scope.final"/></button>
      </div>
    </header>
    <dl className="member-vote-record-figures">
      {groupKnown&&<>
        <div><dt><UiMessage id="membervoterecord.withGroup"/></dt><dd>{percent(figures.withShare,ui)}</dd>
          <small>{figures.comparable?<UiMessage id="membervoterecord.share.detail" values={{count:figures.with,comparable:figures.comparable}}/>:null}</small>
          {medians&&<small><UiMessage id="membervoterecord.medians" values={{group:percent(medians.group.median,ui),parliament:percent(medians.parliament.median,ui)}}/></small>}</div>
        <div><dt><UiMessage id="membervoterecord.againstGroup"/></dt><dd>{figures.comparable?num(ui,figures.against):ui.t('membervoterecord.noValue')}</dd>
          <small>{figures.comparable?<UiMessage id="membervoterecord.share.detail" values={{count:figures.against,comparable:figures.comparable}}/>:null}</small></div>
      </>}
      <div><dt><UiMessage id="membervoterecord.recorded"/></dt>
        <dd>{ballots.named===null?num(ui,ballots.recorded):<UiMessage id="membervoterecord.recorded.value" values={{recorded:num(ui,ballots.recorded),named:num(ui,ballots.named)}}/>}</dd>
        {ballots.named!==null&&<small><UiMessage id="membervoterecord.recorded.detail"/></small>}
        {ballots.chaired>0&&<small><UiMessage id="membervoterecord.chaired" values={{count:num(ui,ballots.chaired)}}/></small>}
        {data.group.status!=='attached'&&<small>{data.group.status==='non-attached'?<UiMessage id="membervoterecord.nonAttached"/>:<UiMessage id="membervoterecord.groupUnavailable"/>}</small>}</div>
    </dl>
    {groupKnown&&<>
      <Trend data={data} scope={scope}/>
      <Departures data={data} memberId={memberId} onOffset={onOffset} onOpenDecision={onOpenDecision}/>
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
  return <p className="member-vote-record-summary"><a href={votesHref(memberId)??undefined} onClick={event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onOpen();
  }}>{summary.recorded===0
    ? <UiMessage id="membervoterecord.summary.empty"/>
    : summary.attached&&summary.share!==null
      ? <UiMessage id="membervoterecord.summary.attached" values={{share:percent(summary.share,ui),recorded:summary.recorded,chaired}}/>
      : <UiMessage id="membervoterecord.summary.nonAttached" values={{recorded:summary.recorded,chaired}}/>}</a></p>;
}
