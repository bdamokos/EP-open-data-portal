import type {MouseEvent,ReactNode} from 'react';
import {FoldRow} from './FoldRow';
import {groupLabel} from './groupLabels';
import {useInsightData} from './InsightData';
import {useData} from './data';
import {dossierLinkClick} from './dossierJourney';
import {PageStrip,StripLink} from './PageStrip';
import {PersonName} from './PersonName';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {TallyHeads,TotalsFigures,VoteRow} from './VoteRow';
import {agendaItemHref,dayDate,longDate,voteHref} from './votePagePresentation.mjs';
import {validWeekResults,weekResultsRoute} from './weekSummaryPresentation.mjs';
import {comingSlots,comingSummary,counted,foldFacts,highlightCells,itemHasFacts,pastCounts,pressDate,pressFullDate,reasonLine,resultRows,rowAnchor,storyText,validWeekItem,validWeekPageResults,validWeekStory,voteDateFor,weekHref,weekItemRoute,weekNeighbours,weekRoute,weekStoryRoute,type WeekDay} from './weekPagePresentation.mjs';
import type {AgendaTopic,LegislationNavigationResponse,LegislationResponse,WeekItemLine,WeekItemResponse,WeekResultsResponse,WeekStoryResponse,WeekStoryStory} from './LegislationTypes';
import './VoteSystem.css';
import './WeekPage.css';

type Day=NonNullable<LegislationResponse['agendaSittings']>[number];
const VOTE_BLOCK='week-votes';

function jump(event:MouseEvent<HTMLAnchorElement>,id:string) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({block:'start'});
}
const withCommas=(parts:ReactNode[])=>parts.filter(Boolean).flatMap((part,index)=>index?[', ',part]:[part]);

function PressLine({press,date,voteId,language}:{press:{url:string};date:string|null;voteId?:string|null;language:string}) {
  return <p className="press">
    {date&&<span className="muted"><UiMessage id="week.story.from" values={{date}}/></span>}
    <span className="press-links">
      <a className="c" href={press.url} target="_blank" rel="noreferrer"><UiMessage id="week.story.read_more"/></a>
      {voteId&&<a className="c" href={voteHref(voteId,language)} onClick={dossierLinkClick}><UiMessage id="week.story.see_vote"/></a>}
    </span>
  </p>;
}
function StoryFigures({story}:{story:WeekStoryStory}) {
  const vote=story.vote;
  if(counted(vote?.totals))return <TotalsFigures totals={vote.totals}/>;
  return vote?.method==='VOTE_HAND'?<p className="story-hands"><UiMessage id="week.show_of_hands"/></p>:null;
}
function StoryWords({story,big,language}:{story:WeekStoryStory;big?:boolean;language:string}) {
  const ui=useUiI18n(),text=storyText(story.press);
  return <>
    <p className="meta reason">{reasonLine(story.reasons,ui)}</p>
    <h2 className={big?'story-big':'story-t'} lang="en">{story.press.title}</h2>
    {text&&<p className="quote" lang="en">{text}</p>}
    <PressLine press={story.press} date={pressDate(story.press.publishedAt,language)} voteId={story.vote?.id} language={language}/>
  </>;
}
function Stories({story,language}:{story:WeekStoryResponse;language:string}) {
  const ui=useUiI18n(),[first,...rest]=story.stories,cells=highlightCells(story.highlights,language,ui);
  return <div className="week-stories">
    {first&&<section className="lead"><div className="lead-story"><StoryWords story={first} big language={language}/></div><StoryFigures story={first}/></section>}
    {rest.length>0&&<section className="stories">{rest.map(row=><article className="story" key={row.press.id||row.key}><StoryWords story={row} language={language}/><StoryFigures story={row}/></article>)}</section>}
    {cells.length>0&&<section className="deck"><div className="deck-cells">{cells.map(cell=><div className="cell" key={cell.key}>
      <p className="meta label">{cell.label}</p>
      {cell.href?<a className="t" lang={cell.language} href={cell.href} onClick={dossierLinkClick}>{cell.text}</a>:<span className="t" lang={cell.language}>{cell.text}</span>}
      {cell.value&&<p className="meta value">{cell.value}</p>}
      {counted(cell.totals)&&<TotalsFigures totals={cell.totals}/>}
    </div>)}</div></section>}
  </div>;
}

function AgendaFailed({retry,inline=false}:{retry:()=>void;inline?:boolean}) {
  const body=<><UiMessage id="week.agenda_unavailable"/> <button type="button" className="word" onClick={retry}><UiMessage id="week.retry"/></button></>;
  return inline?<p className="say" role="alert">{body}</p>:<p className="note" role="alert">{body}</p>;
}
function ResultDay({day,topics,results,language,pressUrls,retry}:{day:Day;topics:AgendaTopic[];results:WeekResultsResponse|null;language:string;pressUrls:Record<string,{url:string}>;retry:()=>void}) {
  const ui=useUiI18n(),read=results?.days.find(entry=>entry.sittingId===day.id),complete=read?.complete===true;
  const rows=resultRows(day as WeekDay,topics,results,language,ui);
  if(!rows.length&&!day.agendaError)return null;
  const heading=<h3>{dayDate(day.date,language)}{complete&&<> <small><UiMessage id="weekSummary.votes" values={{count:read!.voteCount}}/></small></>}</h3>;
  return <section className="day" data-week-day={day.id}>
    {complete?<TallyHeads heading={heading}/>:<div className="heads static"><span className="main">{heading}</span></div>}
    {day.agendaError&&<AgendaFailed retry={retry}/>}
    {results&&!complete&&rows.length>0&&<p className="note"><UiMessage id="weekSummary.resultsPending"/></p>}
    {rows.map(row=>{
      const cells=complete?row.cells:{},pressUrl=row.agendaItemId?pressUrls[row.agendaItemId]?.url:null;
      const title=row.href?<a className="t" lang={row.language} href={row.href} onClick={dossierLinkClick}>{row.text}</a>:<span className="t" lang={row.language}>{row.text}</span>;
      const sub=withCommas([
        cells.label&&<span key="label" lang="">{cells.label}</span>,
        complete&&row.votes!==null&&<UiMessage key="votes" id="weekSummary.votes" values={{count:row.votes}}/>,
        row.debated&&<UiMessage key="debated" id="week.row.debated" values={{date:dayDate(row.debated,language)}}/>,
        pressUrl&&<a key="press" href={pressUrl} target="_blank" rel="noreferrer"><UiMessage id="week.row.press"/></a>,
      ]);
      return <div key={row.key} id={row.anchor??undefined}><VoteRow title={title} sub={sub.length?sub:undefined} word={cells.word} rejected={cells.rejected} totals={cells.totals} across={cells.hands?<UiMessage id="week.show_of_hands"/>:cells.words}/></div>;
    })}
  </section>;
}
function Debates({days,topics,language}:{days:Day[];topics:AgendaTopic[];language:string}) {
  const filled=days.map(day=>({day,rows:topics.filter(topic=>topic.sittingId===day.id&&topic.kind!=='PLENARY_VOTE')})).filter(entry=>entry.rows.length);
  if(!filled.length)return null;
  return <section className="week-section"><h2 className="section"><UiMessage id="week.debates"/></h2>
    {filled.map(({day,rows})=><section className="day" key={day.id}>
      <div className="heads static"><span className="main"><h3>{dayDate(day.date,language)}</h3></span></div>
      {rows.map(topic=>{
        const date=voteDateFor(topic,topics),target=topics.find(other=>other.kind==='PLENARY_VOTE'&&other.date===date&&other.procedureIds.some(id=>topic.procedureIds.includes(id)));
        return <VoteRow key={topic.id} tight title={<a className="t" lang={topic.titleLanguage??''} href={agendaItemHref(topic.id,language)} onClick={dossierLinkClick}>{topic.title}</a>} across={target&&date?<a href={'#'+rowAnchor(target.id)} onClick={event=>jump(event,rowAnchor(target.id))}><UiMessage id="week.debate.vote" values={{date:dayDate(date,language)}}/></a>:undefined}/>;
      })}
    </section>)}
  </section>;
}

function StandingLine({line,language}:{line:WeekItemLine;language:string}) {
  const {date,tally,committees}=line.values||{},values:Record<string,ReactNode>={};
  if(date)values.date=longDate(date,language);
  if(tally)values.tally=<UiMessage id="dossierstatus.tally" values={{for:tally.for,against:tally.against,abstaining:tally.abstaining}}/>;
  if(committees?.length)values.committee=<span lang={committees[0].language||language}>{new Intl.ListFormat(language,{style:'long',type:'conjunction'}).format(committees.map(row=>row.name===row.code?row.code:row.name+' ('+row.code+')'))}</span>;
  // The shared sentence has one committee's report; a joint report is theirs.
  return <p className="standing"><UiMessage id={line.id==='dossierstatus.reported'&&committees&&committees.length>1?'week.fold.reported_joint':line.id} values={values}/></p>;
}
// What a reader wants to know about a coming item, from a small reply read when the fold first opens.
function ItemFacts({topic,topics,sittingIds,language}:{topic:AgendaTopic;topics:AgendaTopic[];sittingIds:string[];language:string}) {
  const ui=useUiI18n(),route=weekItemRoute(topic,sittingIds,language),read=useInsightData<WeekItemResponse>(route);
  const item=validWeekItem(read.data)?read.data:null,facts=foldFacts(item,topic,topics);
  const people=withCommas((item?.rapporteurs||[]).map(person=>{
    const name=<PersonName id={person.id} label={person.name} fallback={person.name}/>;
    return <span key={person.id}>{person.currentMep?<a href={'?'+new URLSearchParams({lang:language,member:person.id,module:'profile'})}>{name}</a>:name}{person.group&&<> ({groupLabel(person.group,ui)})</>}</span>;
  }));
  const press=item?.press,kinds=(item?.procedures||[]).filter(procedure=>procedure.code);
  return <div className="facts">
    {route&&read.loading&&!item&&<p role="status"><UiMessage id="insightshared.loading"/></p>}
    {route&&!read.loading&&!item&&<p role="alert"><UiMessage id="week.fold.unavailable"/></p>}
    {press&&<div className="fold-press"><p className="quote" lang="en">{storyText(press)}</p><PressLine press={press} date={pressFullDate(press.publishedAt,language)} language={language}/></div>}
    {kinds.map(procedure=><p key={procedure.id} className="kind"><UiMessage id={'week.kind.'+procedure.code}/></p>)}
    {people.length>0&&<p className="rapporteurs"><UiMessage id={people.length===1?'week.fold.rapporteur':'week.fold.rapporteurs'} values={{names:<>{people}</>}}/></p>}
    {item?.standing.map(line=><StandingLine key={line.id} line={line} language={language}/>)}
    {(facts.voteDate||facts.debateDate||facts.amendments)&&<ul className="refs">
      {facts.voteDate&&<li><UiMessage id="week.debate.vote" values={{date:dayDate(facts.voteDate,language)}}/></li>}
      {facts.debateDate&&<li><UiMessage id="week.fold.debate" values={{date:longDate(facts.debateDate,language)}}/></li>}
      {facts.amendments&&<li><UiMessage id="week.fold.amendments" values={{count:facts.amendments}} counts={{count:facts.amendments}}/></li>}
    </ul>}
    <p className="open-item"><a className="c" href={agendaItemHref(topic.id,language)} onClick={dossierLinkClick}><UiMessage id="week.open_item"/></a></p>
  </div>;
}
function ComingDay({day,topics,sittingIds,language,voteBlockAt,retry}:{day:Day;topics:AgendaTopic[];sittingIds:string[];language:string;voteBlockAt:string|null;retry:()=>void}) {
  const own=topics.filter(topic=>topic.sittingId===day.id);
  return <section className="day coming" data-week-day={day.id}>
    <div className="heads static"><span className="main"><h3>{dayDate(day.date,language)}</h3></span></div>
    {day.agendaError?<AgendaFailed retry={retry}/>:!own.length&&<p className="note"><UiMessage id="legislation.agenda_not_yet_published.c9e27b"/></p>}
    {comingSlots(own).map(slot=><div key={slot.key}>
      <div className="slot" id={slot.key===voteBlockAt?VOTE_BLOCK:undefined}><span className="gut">{slot.time}</span><b><UiMessage id={slot.kind==='votes'?'week.slot.votes':'week.slot.debates'}/></b></div>
      {slot.topics.map(topic=>itemHasFacts(topic)
        ?<FoldRow key={topic.id} id={rowAnchor(topic.id)} title={<span lang={topic.titleLanguage??''}>{topic.title}</span>}><ItemFacts topic={topic} topics={topics} sittingIds={sittingIds} language={language}/></FoldRow>
        :<div className="itemrow" key={topic.id} id={rowAnchor(topic.id)}><span className="t" lang={topic.titleLanguage??''}>{topic.title}</span></div>)}
    </div>)}
  </section>;
}

function ComingCount({topics,language}:{topics:AgendaTopic[];language:string}) {
  const ui=useUiI18n(),summary=comingSummary(topics);
  if(!summary.votes&&!summary.others)return null;
  const votes=ui.t('weekSummary.votes',{count:summary.votes});
  const clause=summary.date&&summary.time?<UiMessage id="week.coming.votes_one_slot" values={{votes,date:dayDate(summary.date,language),time:summary.time}}/>
    :summary.date?<UiMessage id="week.coming.votes_one_day" values={{votes,date:dayDate(summary.date,language)}}/>
    :<UiMessage id="week.coming.votes" values={{votes}}/>;
  return <>
    {summary.votes>0&&<a href={'#'+VOTE_BLOCK} onClick={event=>jump(event,VOTE_BLOCK)}>{clause}</a>}
    {summary.votes>0&&summary.others>0&&' '}
    {summary.others>0&&<UiMessage id="week.coming.others" values={{count:summary.others}} counts={{count:summary.others}}/>}
  </>;
}
function PastCount({counts,location}:{counts:{votes:number;items:number};location:string|null}) {
  const ui=useUiI18n(),values={votes:ui.t('weekSummary.votes',{count:counts.votes}),items:ui.t('weekSummary.agendaItems',{count:counts.items})};
  return location?<UiMessage id="week.past.say" values={{...values,place:location}}/>:<UiMessage id="week.past.say_noplace" values={values}/>;
}

export function WeekPage({week,language}:{week:string|null;language:string}) {
  const ui=useUiI18n();
  const agenda=useInsightData<LegislationResponse|LegislationNavigationResponse>(week?weekRoute(week,language):null);
  const data=agenda.data?.sitting?agenda.data as LegislationResponse:null;
  const shown=data?.week??(week&&week!=='latest'?week:null),days=data?.agendaSittings||[];
  const past=days.filter(day=>day.phase!=='upcoming'),ahead=days.filter(day=>day.phase==='upcoming'),topics=data?.topics||[];
  const pastRead=useInsightData<WeekResultsResponse>(shown&&past.length?weekResultsRoute(shown,language):null);
  const results=validWeekResults(pastRead.data)&&validWeekPageResults(pastRead.data)?pastRead.data:null;
  // Only a finished week has stories.
  const storyRead=useInsightData<WeekStoryResponse>(shown&&days.length&&days.every(day=>day.phase==='past')?weekStoryRoute(shown,language):null);
  const story=validWeekStory(storyRead.data)?storyRead.data:null;
  const calendar=useData<VotePeriodsResponse>('vote-periods',{unavailable:'error.records'});
  const steps=shown&&validateVotePeriods(calendar.data)?weekNeighbours(calendar.data,shown,language):{previous:null,next:null};

  // Until a week is known (calendar pending, or latest failed) the page keeps the view's title.
  const heading=shown?<UiMessage id="weekSummary.weekOf" values={{date:longDate(shown,language)}}/>:<UiMessage id="plenarymodes.plenary_agenda"/>;
  const stepLink=(target:{week:string;label:string|null},arrow:'previous'|'next')=>{
    const body=arrow==='previous'?<>‹ {target.label}</>:<>{target.label} ›</>;
    return <StripLink href={weekHref(target.week,language)} onClick={dossierLinkClick} wide={body} narrow={body}/>;
  };
  const strip=<PageStrip back={steps.previous?stepLink(steps.previous,'previous'):<span/>}>{steps.next&&stepLink(steps.next,'next')}</PageStrip>;
  // No week yet means the calendar is still choosing one; Back must not land on this placeholder.
  const pending=week===null||agenda.loading&&!data||pastRead.loading&&!pastRead.data||storyRead.loading&&!storyRead.data;
  const page=(children:ReactNode)=><article className="vs week-page" lang={ui.language} data-week-page={week??''} data-week-pending={pending?'true':undefined}>{children}</article>;

  if(!data) {
    if(agenda.error||!agenda.loading&&week)return page(<>{strip}<h1 tabIndex={-1}>{heading}</h1><AgendaFailed retry={agenda.retry} inline/></>);
    return page(<>{strip}<h1 tabIndex={-1}>{heading}</h1><p className="say" role="status"><UiMessage id="insightshared.loading"/></p></>);
  }
  // Any past day can hold votes, even with none on its agenda, so a total needs every one of them read.
  const pastIds=past.map(day=>day.id),allPastRead=pastIds.every(id=>results?.days.some(day=>day.sittingId===id));
  const counts=pastCounts(results,pastIds),aheadTopics=topics.filter(topic=>ahead.some(day=>day.id===topic.sittingId));
  // A subset of a day's agenda must not read as its total.
  const aheadRead=ahead.every(day=>day.agendaComplete&&!day.agendaError);
  const noVotes=!ahead.length&&!topics.some(topic=>topic.kind==='PLENARY_VOTE')&&results?.items.length===0&&!results.unlinked?.length&&allPastRead&&results.days.every(day=>day.complete)&&days.every(day=>day.agendaComplete&&!day.agendaError);
  const resultsFailed=Boolean((pastRead.error||pastRead.data)&&!results);
  const anyResults=resultsFailed||past.some(day=>day.agendaError||resultRows(day as WeekDay,topics,results,language,ui).length>0);
  const voteBlockAt=ahead.flatMap(day=>comingSlots(aheadTopics.filter(topic=>topic.sittingId===day.id))).find(slot=>slot.kind==='votes')?.key??null;
  return page(<>
    {strip}
    <div className={ahead.length?'mast open':'mast'}>
      <h1 tabIndex={-1}>{heading}</h1>
      <p className="say">
        {noVotes?<UiMessage id="weekSummary.noVotes"/>:counts&&<PastCount counts={counts} location={results?.location??null}/>}
        {counts&&aheadRead&&ahead.length>0&&' '}
        {aheadRead&&<ComingCount topics={aheadTopics} language={language}/>}
      </p>
    </div>
    {story&&<Stories story={story} language={language}/>}
    {anyResults&&!noVotes&&<section className="week-section">
      <h2 className="section"><UiMessage id="week.results"/></h2>
      {resultsFailed&&<p className="note"><UiMessage id="weekSummary.resultsUnavailable"/></p>}
      {past.map(day=><ResultDay key={day.id} day={day} topics={topics} results={results} language={language} pressUrls={story?.press??{}} retry={agenda.retry}/>)}
    </section>}
    {ahead.map(day=><ComingDay key={day.id} day={day} topics={topics} sittingIds={ahead.map(row=>row.id)} language={language} voteBlockAt={voteBlockAt} retry={agenda.retry}/>)}
    <Debates days={past} topics={topics} language={language}/>
  </>);
}
