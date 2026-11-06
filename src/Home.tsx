// The home view owns the bare URL. It renders progressive sections; each
// section fetches its own data, so a slow or failing section never holds the
// headline. Pure selection logic lives in homeModel.mjs.
import {useEffect,useState} from 'react';
import {interfaceLanguageInUrl} from './interfaceLanguage.mjs';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useData} from './data';
import {useInsightData} from './InsightData';
import {dossierLinkClick} from './dossierJourney';
import {humanDate} from './InsightCharts';
import {InsightStatus} from './InsightShared';
import {agendaTitle} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
import {headlineState,headlineLine,defaultAgendaWeek,agendaView,calendarPeriods,votePicks,unreadRows,homeTerms,longDate,HOME_COUNTRIES,procedureReference} from './homeModel.mjs';
import {brusselsDate} from './plenaryAvailability.mjs';
import {useSaved,useSavedNow} from './SavedControls';
import {summarizeByType} from './followUpdates.mjs';
import type {VotePeriodsResponse} from './plenaryPeriods.mjs';
import type {LegislationResponse,VoteSummary} from './LegislationTypes';
import type {OutsideDirectory} from './OutsideTypes';
import {TextSearch} from './TextSearch';
import {countryName,compareCountries} from './interfaceLabels.mjs';
import './Home.css';

const useHomeDate=()=>{
  const [today,setToday]=useState(brusselsDate);
  useEffect(()=>{const timer=setInterval(()=>setToday(brusselsDate()),60_000);return ()=>clearInterval(timer);},[]);
  return today;
};

const agendaHref=(week:string|null)=>week ? ('?'+new URLSearchParams({view:'legislation','pl-mode':'agenda','agenda-period':'week:'+week})) : '?view=legislation&pl-mode=agenda';
const viewHref=(view:string)=>'?'+new URLSearchParams({view});

const goTo=(search:string)=>{
  const url=new URL(location.href);
  url.search=search;url.hash='';
  history.pushState(history.state,'',url);
  window.dispatchEvent(new Event('popstate'));
};

function FindMeps({language}:{language:string}) {
  const ui=useUiI18n();
  return <label className="home-find" lang={ui.language}>
    <span><UiMessage id="home.find.label"/></span>
    <select value="" onChange={event=>{
      const country=event.target.value;
      if(!country)return;
      const query=new URLSearchParams({view:'meps',country});
      if(interfaceLanguageInUrl(language))query.set('lang',language);
      goTo(query.toString());
    }}>
      <option value=""><UiMessage id="home.find.placeholder"/></option>
      {[...HOME_COUNTRIES].sort((a,b)=>compareCountries(language,a,b,ui)).map(code=><option key={code} value={code} lang={language}>{countryName(language,code,ui)}</option>)}
    </select>
  </label>;
}

export function Home({language}:{language:string}) {
  const ui=useUiI18n();
  const today=useHomeDate();
  // The shared vote-periods calendar drives the headline and the agenda links.
  const calendar=useData<VotePeriodsResponse>('vote-periods',{unavailable:'error.unavailable'});
  const periods=calendarPeriods(calendar.data);
  const weeks=periods?.weeks||[],upcoming=periods?.upcoming||[];
  const settled=Boolean(calendar.data||calendar.error);
  // A failed or malformed calendar is unavailable, never an empty one.
  const unavailable=settled&&!periods;
  const headline=headlineState(today,weeks,upcoming);
  const week=defaultAgendaWeek(today,weeks,upcoming);
  const line=settled?(unavailable?{text:ui.t('home.headline.unavailable'),locale:ui.messageLocale('home.headline.unavailable')}:headlineLine(ui,headline)):null;
  return <div className="home" lang={ui.language}>
    <div className="home-main">
      <header className="home-headline">
        <p className="home-tagline" lang={ui.messageLocale('home.tagline')}><UiMessage id="home.tagline"/></p>
        <h1 tabIndex={-1} aria-busy={settled?undefined:true} lang={line?.locale}>{line?.text??'\u00a0'}</h1>
        <div className="home-search">
          <TextSearch global prefix="global-fts" label={ui.t("batch4.parliamentheader.tsx.35.1")} placeholder={ui.t("home.search.placeholder")} language={language} className="explorer-text-search-global" inline/>
          <FindMeps language={language}/>
        </div>
      </header>
      <HomeAgenda settled={settled} unavailable={unavailable?(calendar.error||ui.t('error.unavailable')):null} week={week} language={language} today={today}/>
      <HomeVotes language={language}/>
    </div>
    <aside className="home-rail">
      <HomeFollowing/>
      <HomeTalking language={language} settled={settled} week={weeks.find(held=>held.sittings.some(sitting=>sitting.date<=today))?.week||null}/>
      <HomeOutside language={language}/>
      <HomeEntries/>
    </aside>
  </div>;
}

function HomeAgenda({settled,unavailable,week,language,today}:{settled:boolean;unavailable:string|null;week:string|null;language:string;today:string}) {
  const ui=useUiI18n();
  const agenda=useInsightData<LegislationResponse>(week?'insights/legislation?'+new URLSearchParams({lang:language,week}):null);
  if(!settled)return null;
  if(unavailable)return <section className="home-section home-agenda"><h2><UiMessage id="home.agenda.section"/></h2><InsightStatus loading={false} error={unavailable}/></section>;
  if(!week)return <section className="home-section home-agenda"><h2><UiMessage id="home.agenda.section"/></h2><p><UiMessage id="home.agenda.empty"/></p></section>;
  const {past,days}=agendaView(agenda.data?.topics,today,week);
  return <section className="home-section home-agenda">
    <h2><UiMessage id={past?'home.agenda.past':'home.agenda.section'}/>{days.length>0&&<a className="home-section-more" href={agendaHref(week)} onClick={dossierLinkClick}><UiMessage id="home.agenda.all"/></a>}</h2>
    <InsightStatus loading={agenda.loading&&!agenda.data} error={agenda.data?null:agenda.error} retry={agenda.retry}/>
    {days.map(({day,rows,more,sittingId})=><div key={day} className="home-agenda-day">
      <h3><time lang='' dateTime={day}>{longDate(day,language)}</time></h3>
      <ol className="home-agenda-list">{rows.map(topic=>{const reference=procedureReference(topic.procedureIds),vote=topic.kind==='PLENARY_VOTE';return <li key={topic.id} className={vote?'is-vote':undefined}>
        <small>{vote?ui.t('home.agenda.vote'):ui.t('home.agenda.debate')}</small>
        <a href={recordHref(topic.id)} onClick={dossierLinkClick}><span lang={topic.titleLanguage??''}>{agendaTitle(topic.title)}</span></a>
        {reference&&<code className="home-reference">{reference}</code>}
      </li>;})}</ol>
      {more>0&&<p className="home-agenda-more"><a href={sittingId?'?'+new URLSearchParams({view:'legislation','pl-mode':'agenda','agenda-period':'sitting:'+sittingId}):agendaHref(week)} onClick={dossierLinkClick}>{ui.t('home.agenda.more',{count:more})}</a></p>}
    </div>)}
    {(!days.length&&agenda.data&&!agenda.loading&&!agenda.error)&&<p><UiMessage id="home.agenda.empty"/></p>}
  </section>;
}

type LatestVote={id:string;date:string;sittingId:string;topicId:string;title:string;titleLanguage:string|null;reference:string|null;outcome:string;totals:{for:number;against:number;abstaining:number};differing:number|null};
type LatestResults={votes:LatestVote[]};
function HomeVotes({language}:{language:string}) {
  const results=useData<LatestResults>('latest-results?'+new URLSearchParams({lang:language}),{unavailable:'error.unavailable'});
  const picks=votePicks(results.data?.votes);
  if(!picks.length)return null;
  return <section className="home-section home-votes">
    <h2><UiMessage id="home.votes.section"/></h2>
    {picks.map(pick=><HomePick key={pick.rule+':'+pick.vote.id} pick={pick} language={language}/>)}
  </section>;
}

const outcomeKeys:Record<string,string>={ADOPTED:'membervotespresentation.adopted',REJECTED:'membervotespresentation.rejected'};
function HomePick({pick,language}:{pick:{rule:string;vote:LatestVote};language:string}) {
  const ui=useUiI18n();
  const vote=pick.vote,totals=vote.totals,sum=totals.for+totals.against+totals.abstaining;
  const href=recordHref(vote.topicId)+'&agenda-vote='+encodeURIComponent(vote.id);
  return <article className="home-pick">
    <h3><UiMessage id={'home.votes.pick.'+pick.rule}/></h3>
    <p className="home-pick-title"><a href={href} onClick={dossierLinkClick}><span lang={vote.titleLanguage||''}>{vote.title}</span></a></p>
    {vote.reference&&<p className="home-pick-ref"><code className="home-reference">{vote.reference}</code></p>}
    <p className="home-pick-meta"><strong>{ui.t(outcomeKeys[vote.outcome])}</strong> · <time lang='' dateTime={vote.date}>{humanDate(vote.date,language)}</time></p>
    {sum>0&&<div className="home-vote-bar" aria-hidden="true">
      <span className="home-vote-bar-for" style={{width:`${totals.for/sum*100}%`}}/>
      <span className="home-vote-bar-against" style={{width:`${totals.against/sum*100}%`}}/>
      <span className="home-vote-bar-abstain" style={{width:`${totals.abstaining/sum*100}%`}}/>
    </div>}
    <p className="home-pick-tally"><UiMessage id="membervotesummary.for_for_against_against_abstaining_abstaining" values={{for:totals.for,against:totals.against,abstaining:totals.abstaining}}/></p>
    {pick.rule==='split'&&vote.differing!=null&&<p className="home-pick-note">{ui.t(vote.differing===1?'home.votes.divergentOne':'home.votes.divergent',{count:vote.differing})}</p>}
  </article>;
}

function HomeFollowing() {
  const ui=useUiI18n();
  const saved=useSaved(),now=useSavedNow();
  const rows=unreadRows(saved.items,now).slice(0,5);
  if(!rows.length)return null;
  return <section className="home-section home-following">
    <h2><UiMessage id="home.following.section"/> <a className="home-section-more" href={viewHref('saved')} onClick={dossierLinkClick}><UiMessage id="home.following.all"/></a></h2>
    {<ol className="home-following-list">{rows.map(row=><li key={row.entry.kind+':'+row.entry.id}>
      <small>{summarizeByType([row.entry],0,ui).replace(/^1 /,'')}</small>
      <a href={followingEntryHref(row.item,row.entry)} onClick={dossierLinkClick}><span lang={row.entry.titleLanguage||''}>{row.entry.title}</span></a>
    </li>)}</ol>}
  </section>;
}

// Follow updates link to where their detail lives today: a followed MEP goes
// to that member's activity, a followed question opens its answers.
const followingEntryHref=(item:{kind:string;id:string},entry:{id:string|number;relatedQuestionId?:string|number})=>{
  if(item.kind==='mep')return '?'+new URLSearchParams({member:item.id,module:'activities',activity:String(entry.id)});
  if(item.kind==='question')return '?'+new URLSearchParams({view:'questions','q-read':String(entry.relatedQuestionId||entry.id)});
  return viewHref('saved');
};

type CloudTerms={words:{word:string;label:string|null;speechCount:number}[]};
function HomeTalking({language,week,settled}:{language:string;week:string|null;settled:boolean}) {
  const cloud=useInsightData<CloudTerms>(week?'insights/speech-cloud?'+new URLSearchParams({lang:language,week,page:'1'}):null);
  const terms=homeTerms(cloud.data?.words);
  // Hold the rail slot while the terms load so the sections below stay put.
  if(!settled||(week&&cloud.loading&&!cloud.data))return <section className="home-section home-topics is-loading" aria-hidden="true"/>;
  if(!week||!terms.length)return null;
  const href='?'+new URLSearchParams({view:'legislation','pl-mode':'cloud','cloud-period':'week:'+week});
  return <section className="home-section home-topics">
    <h2><UiMessage id="home.topics.section"/> <a className="home-section-more" href={href} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    <ul className="home-terms">{terms.map(term=><li key={term}><a href={href} onClick={dossierLinkClick}>{term}</a></li>)}</ul>
  </section>;
}

function HomeOutside({language}:{language:string}) {
  const directory=useData<OutsideDirectory>(`outside/directory?lang=${language}&term=10`,{unavailable:'error.unavailable'});
  const people=directory.data?.people;
  if(!people||!people.length)return null;
  const recent=[...people].filter(person=>person.last).sort((a,b)=>b.last.localeCompare(a.last)||b.appearances-a.appearances).slice(0,4);
  if(!recent.length)return null;
  return <section className="home-section home-outside">
    <h2><UiMessage id="home.outside.section"/> <a className="home-section-more" href={viewHref('outside')} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    <p className="home-section-lead"><UiMessage id="home.outside.lead"/></p>
    <ul className="home-outside-list">{recent.map(person=><li key={person.id}>
      <a href={viewHref('outside')+'&ov-person='+encodeURIComponent(person.id)} onClick={dossierLinkClick}>{person.name}</a>
      <small>{person.role ? <span lang={person.roleLanguageTag||undefined}>{person.role} · </span> : null}<time lang='' dateTime={person.last}>{humanDate(person.last,language)}</time></small>
    </li>)}</ul>
  </section>;
}

function HomeEntries() {
  const ui=useUiI18n();
  return <section className="home-section home-entries" lang={ui.language}>
    <h2><UiMessage id="home.entry.title"/></h2>
    <ul>{(['questions','geopolitics','hemicycle'] as const).map(view=><li key={view}><a href={viewHref(view)} onClick={dossierLinkClick}>{ui.t('home.entry.'+view)}</a></li>)}</ul>
  </section>;
}
