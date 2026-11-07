import type {MouseEvent,ReactNode} from 'react';
import {FoldRow} from './FoldRow';
import {useInsightData} from './InsightData';
import {useData} from './data';
import {dossierLinkClick} from './dossierJourney';
import {dossierHref} from './followDossiers.mjs';
import {PageStrip,StripLink} from './PageStrip';
import {validateVotePeriods,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {documentReferenceLabel,readableDocument,readHref} from './readRoute.mjs';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {TallyHeads,TotalsFigures,VoteRow} from './VoteRow';
import {agendaItemHref,dayDate,longDate,voteHref} from './votePagePresentation.mjs';
import {procedureReferences,validWeekResults,weekResultsRoute} from './weekSummaryPresentation.mjs';
import {comingSlots,comingSummary,counted,highlightCells,pastCounts,pressDate,reasonLine,resultRows,rowAnchor,storyText,validWeekPageResults,validWeekStory,voteDateFor,weekHref,weekNeighbours,weekRoute,weekStoryRoute,type WeekDay} from './weekPagePresentation.mjs';
import type {AgendaTopic,LegislationNavigationResponse,LegislationResponse,WeekResultsResponse,WeekStoryResponse,WeekStoryStory} from './LegislationTypes';
import './VoteSystem.css';
import './WeekPage.css';

type Day=NonNullable<LegislationResponse['agendaSittings']>[number];
const fullReference=/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/;
const VOTE_BLOCK='week-votes';

function jump(event:MouseEvent<HTMLAnchorElement>,id:string) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({block:'start'});
}
const withCommas=(parts:ReactNode[])=>parts.filter(Boolean).flatMap((part,index)=>index?[', ',part]:[part]);
const agendaItemRoute=(topic:AgendaTopic,language:string)=>'insights/legislation?'+new URLSearchParams({lang:language,sitting:topic.sittingId||topic.id.slice(0,17),topic:topic.id});

function PressLine({press,date,voteId,language}:{press:WeekStoryStory['press'];date:string|null;voteId?:string|null;language:string}) {
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

function ResultDay({day,topics,results,language,pressUrls}:{day:Day;topics:AgendaTopic[];results:WeekResultsResponse|null;language:string;pressUrls:Record<string,{url:string}>}) {
  const ui=useUiI18n(),read=results?.days.find(entry=>entry.sittingId===day.id),complete=read?.complete===true;
  const rows=resultRows(day as WeekDay,topics,results,language,ui);
  if(!rows.length)return null;
  const heading=<h3>{dayDate(day.date,language)}{complete&&<> <small><UiMessage id="weekSummary.votes" values={{count:read!.voteCount}}/></small></>}</h3>;
  return <section className="day" data-week-day={day.id}>
    {complete?<TallyHeads heading={heading}/>:<div className="heads static"><span className="main">{heading}</span></div>}
    {read&&!complete&&<p className="note"><UiMessage id="weekSummary.resultsPending"/></p>}
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

// The agenda names a procedure by year and number. The dossier route needs its
// exact full reference, which only the item's own record holds, so it is read when the fold opens.
function ItemReferences({topic,language}:{topic:AgendaTopic;language:string}) {
  const item=useInsightData<LegislationResponse>(topic.procedureIds.length?agendaItemRoute(topic,language):null);
  const procedures=item.data?.detail?.procedures||[];
  return <>
    <ul className="refs">
      {procedureReferences(topic).map((short,index)=>{
        const reference=procedures.find(row=>row.id===topic.procedureIds[index])?.reference;
        return <li key={short}>{reference&&fullReference.test(reference)?<a href={dossierHref(reference,language)} onClick={dossierLinkClick}>{reference}</a>:short}</li>;
      })}
      {topic.documentIds.map(id=><li key={id}>{readableDocument(id)?<a href={readHref({documentId:id,language})} onClick={dossierLinkClick}>{documentReferenceLabel(id)}</a>:documentReferenceLabel(id)}</li>)}
    </ul>
    <p className="open-item"><a className="c" href={agendaItemHref(topic.id,language)} onClick={dossierLinkClick}><UiMessage id="week.open_item"/></a></p>
  </>;
}
function ComingDay({day,topics,language,voteBlockAt}:{day:Day;topics:AgendaTopic[];language:string;voteBlockAt:string|null}) {
  const own=topics.filter(topic=>topic.sittingId===day.id);
  return <section className="day coming" data-week-day={day.id}>
    <div className="heads static"><span className="main"><h3>{dayDate(day.date,language)}</h3></span></div>
    {day.agendaError?<p className="note"><UiMessage id="week.agenda_unavailable"/></p>:!own.length&&<p className="note"><UiMessage id="legislation.agenda_not_yet_published.c9e27b"/></p>}
    {comingSlots(own).map(slot=><div key={slot.key}>
      <div className="slot" id={slot.key===voteBlockAt?VOTE_BLOCK:undefined}><span className="gut">{slot.time}</span><b><UiMessage id={slot.kind==='votes'?'week.slot.votes':'week.slot.debates'}/></b></div>
      {slot.topics.map(topic=>topic.procedureIds.length||topic.documentIds.length
        ?<FoldRow key={topic.id} id={rowAnchor(topic.id)} title={<span lang={topic.titleLanguage??''}>{topic.title}</span>}><ItemReferences topic={topic} language={language}/></FoldRow>
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

  const heading=shown?<UiMessage id="weekSummary.weekOf" values={{date:longDate(shown,language)}}/>:null;
  const stepLink=(target:{week:string;label:string|null},arrow:'previous'|'next')=>{
    const body=arrow==='previous'?<>‹ {target.label}</>:<>{target.label} ›</>;
    return <StripLink href={weekHref(target.week,language)} onClick={dossierLinkClick} wide={body} narrow={body}/>;
  };
  const strip=<PageStrip back={steps.previous?stepLink(steps.previous,'previous'):<span/>}>{steps.next&&stepLink(steps.next,'next')}</PageStrip>;
  const pending=agenda.loading&&!data||pastRead.loading&&!pastRead.data||storyRead.loading&&!storyRead.data;
  const page=(children:ReactNode)=><article className="vs week-page" lang={ui.language} data-week-page={week??''} data-week-pending={pending?'true':undefined}>{children}</article>;

  if(!data) {
    if(agenda.error||!agenda.loading&&week)return page(<>{strip}<h1 tabIndex={-1}>{heading}</h1><p className="say" role="alert"><UiMessage id="week.agenda_unavailable"/> <button type="button" className="word" onClick={agenda.retry}><UiMessage id="week.retry"/></button></p></>);
    return page(<>{strip}<h1 tabIndex={-1}>{heading}</h1><p className="say" role="status"><UiMessage id="insightshared.loading"/></p></>);
  }
  const voteDays=past.filter(day=>topics.some(topic=>topic.sittingId===day.id&&topic.kind==='PLENARY_VOTE')).map(day=>day.id);
  const counts=pastCounts(results,voteDays),aheadTopics=topics.filter(topic=>ahead.some(day=>day.id===topic.sittingId));
  const noVotes=!ahead.length&&!topics.some(topic=>topic.kind==='PLENARY_VOTE')&&results?.items.length===0&&!results?.unlinked?.length&&days.every(day=>day.agendaComplete&&!day.agendaError);
  const voteBlockAt=ahead.flatMap(day=>comingSlots(aheadTopics.filter(topic=>topic.sittingId===day.id))).find(slot=>slot.kind==='votes')?.key??null;
  return page(<>
    {strip}
    <div className={ahead.length?'mast open':'mast'}>
      <h1 tabIndex={-1}>{heading}</h1>
      <p className="say">
        {noVotes?<UiMessage id="weekSummary.noVotes"/>:counts&&<PastCount counts={counts} location={results?.location??null}/>}
        {counts&&ahead.length>0&&' '}
        <ComingCount topics={aheadTopics} language={language}/>
      </p>
    </div>
    {story&&<Stories story={story} language={language}/>}
    {past.length>0&&!noVotes&&<section className="week-section">
      <h2 className="section"><UiMessage id="week.results"/></h2>
      {(pastRead.error||pastRead.data)&&!results&&<p className="note"><UiMessage id="weekSummary.resultsUnavailable"/></p>}
      {past.map(day=><ResultDay key={day.id} day={day} topics={topics} results={results} language={language} pressUrls={story?.press??{}}/>)}
    </section>}
    {ahead.map(day=><ComingDay key={day.id} day={day} topics={aheadTopics} language={language} voteBlockAt={voteBlockAt}/>)}
    <Debates days={past} topics={topics} language={language}/>
  </>);
}
