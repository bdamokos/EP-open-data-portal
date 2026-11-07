import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {useData} from './data';
import {UiMessage,useUiI18n} from './UiI18nReact';
import type {MemberVoteRecordBreakdownList,MemberVoteRecordResponse} from './MemberVoteRecordTypes';
import {MEMBER_VOTE_RECORD_LIMIT,memberVoteRecordRoute,recordShare,recordView,validateMemberVoteRecordResponse} from './MemberVoteRecordModel.mjs';
import {dossierLinkClick} from './dossierJourney';
import {voteHref} from './votePagePresentation.mjs';
import {FoldRow} from './FoldRow';
import {VoteMark} from './VoteMark';
import {VoteRow} from './VoteRow';
import {WordSwitch} from './WordSwitch';
import type {VotePosition} from './votePositions';
import './VoteSystem.css';
import './MemberVoteRecord.css';

const dateLabel=(value:string|null,locale:string)=>{
  if(!value)return '';
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat(locale==='en'?'en-GB':locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date):value;
};
const percent=(share:number|null,ui:ReturnType<typeof useUiI18n>)=>share===null?ui.t('membervoterecord.noValue'):ui.t('membervoterecord.percent',{value:recordShare(share)??0});
const num=(ui:ReturnType<typeof useUiI18n>,value:number)=>new Intl.NumberFormat(ui.language).format(value);
const markLanguage=(code:string|null|undefined,ui:ReturnType<typeof useUiI18n>)=>code&&code!=='mul'&&code!==ui.language?code:undefined;
// The phone layout of the vote system starts below 768 px.
const PHONE='(max-width: 767px)';
function usePhone() {
  const [phone,setPhone]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.(PHONE)?.matches===true);
  useEffect(()=>{
    const query=window.matchMedia?.(PHONE);
    if(!query)return;
    const update=()=>setPhone(query.matches);
    update();query.addEventListener?.('change',update);
    return ()=>query.removeEventListener?.('change',update);
  },[]);
  return phone;
}

const positionName=(position:VotePosition,ui:ReturnType<typeof useUiI18n>)=>ui.t('votegroups.position.'+position);
// A mark and its word; a position the record doesn't hold is a dash.
const positionLine=(position:VotePosition|null,ui:ReturnType<typeof useUiI18n>):ReactNode=>position?<><VoteMark position={position}/>{positionName(position,ui)}</>:ui.t('membervoterecord.noValue');

const PAGE=MEMBER_VOTE_RECORD_LIMIT;

// A control that is replaced while its data loads gives the keyboard back to the page. The click names
// what to focus once it is there: a breakdown row by key, or the first row of an appended page.
// The wish ends when the reader moves focus or points elsewhere, and when the record changes or unmounts.
type FocusTarget={pick:string|null}|{row:number};
let focusAfterLoad:FocusTarget|null=null;
const cancelFocus=()=>{focusAfterLoad=null;document.removeEventListener('focusin',cancelFocus,true);document.removeEventListener('pointerdown',cancelFocus,true);};
const armFocus=(target:FocusTarget)=>{
  cancelFocus();focusAfterLoad=target;
  document.addEventListener('focusin',cancelFocus,true);document.addEventListener('pointerdown',cancelFocus,true);
};
function useRestoreFocus(ready:boolean) {
  useEffect(()=>{
    const target=focusAfterLoad;
    if(!target||!ready)return;
    const found='row' in target?document.querySelectorAll<HTMLElement>('.mvr-rows a.t')[target.row]:target.pick?document.querySelector<HTMLElement>('[data-pick="'+target.pick+'"]'):null;
    if(found){cancelFocus();found.focus();}
    else if('pick' in target)cancelFocus();
  });
}

// One page of departures, fetched on its own so a reload restores every page already shown.
// It reports once its rows are in, and says so when it fails.
function DeparturePage({memberId,language,scope,tag,offset,onLoaded}:{memberId:number;language:string;scope:'all'|'final';tag:string|null;offset:number;onLoaded:()=>void}) {
  const ui=useUiI18n();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:PAGE,offset,tag}),[memberId,language,scope,tag,offset]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  useEffect(()=>{if(data)onLoaded();},[data,onLoaded]);
  if(!data)return request.error||!request.loading?<p className="mvr-more" role="status"><span className="muted"><UiMessage id="membervoterecord.unavailable"/></span><button type="button" className="c word" onClick={request.retry}><UiMessage id="week.retry"/></button></p>:null;
  return <>{data.departures.items.map(item=>{
    const primary=item.subject?.text??item.text,primaryLanguage=item.subject?.text?item.subject.language:item.language;
    const label=item.subject?.text&&item.text?<span className="blk" lang={markLanguage(item.language,ui)}>{item.text}</span>:null;
    const title=<a className="t" href={voteHref(item.decisionId,ui.language)} lang={markLanguage(primaryLanguage,ui)} onClick={dossierLinkClick}>{primary||ui.t('membervoterecord.departures.untitled')}</a>;
    const sub=<>{label}{dateLabel(item.date,ui.locale)} · <UiMessage id="membervoterecord.departures.line" values={{position:positionLine(item.position,ui),line:positionLine(item.line,ui)}}/></>;
    return <VoteRow key={item.decisionId+item.sittingId} tight title={title} sub={sub}/>;
  })}</>;
}

// The pages up to the URL offset, never past the last one. They load one after the other, so a
// saved link with a large offset can't start more than one read at a time.
function DeparturePages({memberId,language,scope,tag,total,offset,onOffset}:{memberId:number;language:string;scope:'all'|'final';tag:string|null;total:number;offset:number;onOffset:(offset:number)=>void}) {
  const pages=Math.min(Math.floor(offset/PAGE)+1,Math.max(1,Math.ceil(total/PAGE)));
  const [reached,setReached]=useState(0);
  useRestoreFocus(true);
  // Back to an earlier offset drops the later pages; what has loaded never counts past what is shown.
  const loaded=Math.min(reached,pages);
  const mounted=Math.min(pages,loaded+1);
  const shown=Math.min(loaded*PAGE,total);
  return <>
    <div className="mvr-rows">{Array.from({length:mounted},(_,page)=><DeparturePage key={page} memberId={memberId} language={language} scope={scope} tag={tag} offset={page*PAGE} onLoaded={()=>setReached(count=>Math.max(count,page+1))}/>)}</div>
    {loaded===pages&&shown<total&&<p className="mvr-more">
      <span className="meta"><UiMessage id="membervoterecord.departures.range" values={{start:1,end:shown,total}}/></span>
      <button type="button" className="c word" onClick={()=>{armFocus({row:pages*PAGE});onOffset(pages*PAGE);}}><UiMessage id="membervoterecord.departures.more"/></button>
    </p>}
  </>;
}

function Departures({data,memberId,language,scope,tag,offset,onOffset,onTagChange}:{data:MemberVoteRecordResponse;memberId:number;language:string;scope:'all'|'final';tag:string|null;offset:number;onOffset:(offset:number)=>void;onTagChange:(tag:string|null)=>void}) {
  const ui=useUiI18n();
  const total=data.departures.total;
  return <>
    {tag&&<p className="mvr-filter">
      <span><UiMessage id="membervoterecord.filter.on" values={{label:<span lang={markLanguage(data.departures.tag?.language,ui)}>{data.departures.tag?.label??''}</span>}}/></span>
      <button type="button" className="c word" onClick={()=>onTagChange(null)}><UiMessage id="membervoterecord.filter.clear"/></button>
    </p>}
    {!total&&<p className="muted mvr-none"><UiMessage id="membervoterecord.departures.empty"/></p>}
    {Boolean(total)&&<DeparturePages key={memberId+scope+(tag??'')+total} memberId={memberId} language={language} scope={scope} tag={tag} total={total} offset={offset} onOffset={onOffset}/>}
  </>;
}

// A list row sits on the vote system's row grid: label, then the two number columns.
const capitalise=(text:string,language:string)=>text.charAt(0).toLocaleUpperCase(language||'en')+text.slice(1);
function BreakdownList({heading,list,tag,onTag}:{heading:string;list:MemberVoteRecordBreakdownList;tag:string|null;onTag:(tag:string|null)=>void}) {
  const ui=useUiI18n();
  return <div className="mvr-list">
    <div className="heads static"><h4 className="main">{heading}</h4><span className="n hd sh"><UiMessage id="membervoterecord.breakdown.differs"/></span><span className="n hd ct"><UiMessage id="membervoterecord.breakdown.count"/></span></div>
    <ul>{list.rows.map(row=>{
      // EuroVoc labels are lower case in the source; capitalised for display only.
      const label=row.key.startsWith('topic:')?capitalise(row.label,row.language):row.label;
      // Votes that differed out of the row's comparable votes, the complement of the server's with-group share.
      const share=ui.t('membervoterecord.percent',{value:Math.round((row.comparable-row.withGroup)*100/row.comparable)}),count=num(ui,row.comparable);
      return <li key={row.key} className="row tight">
        <span className="main"><button type="button" className="t pick" data-pick={row.key} aria-pressed={tag===row.key} aria-label={ui.t('membervoterecord.breakdown.row',{label,share,count})} lang={markLanguage(row.language,ui)} onClick={()=>onTag(tag===row.key?null:row.key)}>{label}</button></span>
        <span className="n sh">{share}</span>
        <span className="n ct">{count}</span>
      </li>;
    })}</ul>
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
  return <section className="mvr-section mvr-breakdown" aria-labelledby="member-vote-record-breakdown-heading">
    <h3 id="member-vote-record-breakdown-heading"><UiMessage id="membervoterecord.breakdown.heading"/></h3>
    {lists.length===0
      ? <p className="muted"><UiMessage id="membervoterecord.breakdown.none"/></p>
      : <div className={'mvr-lists'+(lists.length===1?' single':'')}>{lists.map(item=><BreakdownList key={item.id} heading={item.heading} list={item.list} tag={tag} onTag={onTag}/>)}</div>}
  </section>;
}

export function MemberVoteRecord({memberId,language,scope,offset,tag,onScopeChange,onTagChange,onOffset}:{
  memberId:number;language:string;scope:'all'|'final';offset:number;tag:string|null;
  onScopeChange:(scope:'all'|'final')=>void;onTagChange:(tag:string|null)=>void;onOffset:(offset:number)=>void;
}) {
  const ui=useUiI18n();
  const phone=usePhone();
  const route=useMemo(()=>memberVoteRecordRoute(memberId,{language,scope,limit:MEMBER_VOTE_RECORD_LIMIT,offset:0,tag}),[memberId,language,scope,tag]);
  const request=useData<MemberVoteRecordResponse>(route,{unavailable:'membervoterecord.unavailable'});
  const data=request.data&&validateMemberVoteRecordResponse(request.data,{memberId})?request.data:null;
  // On a phone the list is a fold; a tag opens it so the way back to all is in view.
  const [listOpen,setListOpen]=useState(tag!==null);
  useEffect(()=>{if(tag!==null)setListOpen(true);},[tag]);
  // Selecting or clearing a filter replaces the panel while it loads; focus goes back to the row that was pressed.
  const changeTag=(next:string|null)=>{armFocus({pick:next??tag});onTagChange(next);};
  useRestoreFocus(data!==null&&recordView(data,scope).state==='record');
  useEffect(()=>cancelFocus,[memberId,scope]);
  const status=(id:string)=><section className="vs mvr" lang={ui.language} aria-label={ui.t('membervoterecord.heading')}><p className="muted" role="status"><UiMessage id={id}/></p></section>;
  if(!data)return status(request.error||!request.loading?'membervoterecord.unavailable':'membervoterecord.loading');
  const view=recordView(data,scope);
  // Before the first projection there is nothing to count, and zeros would read as real figures.
  if(view.state==='pending')return status('membervoterecord.pending');
  const {figures,medians}=view;
  const {ballots,coverage}=data;
  const departures=view.list&&(phone
    ? <div className="frows"><FoldRow title={<UiMessage id="membervoterecord.votedDifferently"/>} value={num(ui,data.departures.total)} open={listOpen} onOpenChange={setListOpen}>
        <Departures data={data} memberId={memberId} language={language} scope={scope} tag={tag} offset={offset} onOffset={onOffset} onTagChange={changeTag}/>
      </FoldRow></div>
    : <section className="mvr-section"><h3><UiMessage id="membervoterecord.votedDifferently"/></h3>
        <Departures data={data} memberId={memberId} language={language} scope={scope} tag={tag} offset={offset} onOffset={onOffset} onTagChange={changeTag}/>
      </section>);
  return <section className="vs mvr" lang={ui.language} aria-labelledby="member-vote-record-heading">
    <header className="mvr-head">
      <div>
        <h2 id="member-vote-record-heading"><UiMessage id="membervoterecord.heading"/></h2>
        <p className="meta">{data.period.to===null
          ? <UiMessage id="membervoterecord.period.open" values={{from:dateLabel(data.period.from,ui.locale)}}/>
          : <UiMessage id="membervoterecord.period" values={{from:dateLabel(data.period.from,ui.locale),to:dateLabel(data.period.to,ui.locale)}}/>}</p>
        {coverage.status==='partial'&&(coverage.missing>0||coverage.unprojectedDecisions>0)&&<p className="meta">
          {coverage.missing>0&&coverage.unprojectedDecisions>0
            ? <UiMessage id="membervoterecord.coverage.partialBoth" values={{missing:coverage.missing,count:coverage.unprojectedDecisions}}/>
            : coverage.missing>0
              ? <UiMessage id="membervoterecord.coverage.partial" values={{missing:coverage.missing}}/>
              : <UiMessage id="membervoterecord.coverage.partialVotes" values={{count:coverage.unprojectedDecisions}}/>}
        </p>}
      </div>
      {view.known&&<WordSwitch label={ui.t('membervoterecord.scope.label')} value={scope} onChange={onScopeChange} options={[{value:'all',label:<UiMessage id="membervoterecord.scope.all"/>},{value:'final',label:<UiMessage id="membervoterecord.scope.final"/>}]}/>}
    </header>
    {figures&&<dl className="mvr-figs">
      <div><dt className="meta"><UiMessage id="membervoterecord.differsFromGroup"/></dt><dd>{num(ui,figures.against)}</dd></div>
      <div><dt className="meta"><UiMessage id="membervoterecord.withGroup"/></dt><dd>{percent(figures.withShare,ui)}</dd>
        {medians&&<small className="meta"><UiMessage id="membervoterecord.medians" values={{group:percent(medians.group.median,ui)}}/></small>}</div>
    </dl>}
    {(ballots.chaired>0||view.note)&&<p className="meta mvr-notes">
      {ballots.chaired>0&&<span><UiMessage id="membervoterecord.chaired" values={{count:num(ui,ballots.chaired)}}/></span>}
      {view.note==='nonAttached'&&<span><UiMessage id="membervoterecord.nonAttached"/></span>}
      {view.note==='groupUnavailable'&&<span><UiMessage id="membervoterecord.groupUnavailable"/></span>}
      {view.note==='noComparable'&&<span><UiMessage id="membervoterecord.noComparable"/></span>}
    </p>}
    {view.known&&<Breakdown data={data} tag={tag} onTag={changeTag}/>}
    {departures}
  </section>;
}
