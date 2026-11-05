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
import {agendaTitle,lastFullQuarter,point,placeValue,risers,topicsHref} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
import {headlineState,defaultAgendaWeek,agendaRows,votePicks,unreadRows,HOME_COUNTRIES,procedureReference} from './homeModel.mjs';
import {brusselsDate} from './plenaryAvailability.mjs';
import {useSaved,useSavedNow} from './SavedControls';
import {summarizeByType} from './followUpdates.mjs';
import type {VotePeriodsResponse} from './plenaryPeriods.mjs';
import type {TopicOverview} from './TopicsTypes';
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

const longDate=(value:string,language:string)=>new Intl.DateTimeFormat(language,{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Brussels'}).format(new Date(value+'T12:00:00Z'));

function headlineText(ui:ReturnType<typeof useUiI18n>,headline:{case:string;city?:string|null;nextDate?:string},language:string) {
  const city=headline.city,date=headline.nextDate?longDate(headline.nextDate,language):'';
  switch(headline.case) {
    case 'sitting-today': return city ? ui.t('home.headline.today_city',{city}) : ui.t('home.headline.today_plain');
    case 'sitting-later-this-week': return city ? ui.t('home.headline.later_city',{city,date}) : ui.t('home.headline.later_plain',{date});
    case 'next-known': return city ? ui.t('home.headline.next_city',{city,date}) : ui.t('home.headline.next_plain',{date});
    default: return ui.t('home.headline.none');
  }
}

const goTo=(search:string)=>{
  const url=new URL(location.href);
  url.search=search;url.hash='';
  history.pushState(history.state,'',url);
  window.dispatchEvent(new PopStateEvent('popstate'));
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
  const weeks=calendar.data?.weeks||[],upcoming=calendar.data?.upcoming||[];
  const settled=Boolean(calendar.data||calendar.error);
  const headline=headlineState(today,weeks,upcoming);
  const week=defaultAgendaWeek(today,weeks,upcoming);
  return <div className="home" lang={ui.language}>
    <div className="home-main">
      <header className="home-headline">
        <h1 tabIndex={-1} aria-busy={settled?undefined:true}>{!settled ? '\u00a0' : (calendar.error&&!calendar.data?.weeks) ? ui.t('home.headline.unavailable') : headlineText(ui,headline,language)}</h1>
        <div className="home-search">
          <TextSearch global prefix="global-fts" label={ui.t("batch4.parliamentheader.tsx.35.1")} language={language} className="explorer-text-search-global" inline/>
          <FindMeps language={language}/>
        </div>
      </header>
      <HomeAgenda settled={settled} week={week} language={language} today={today}/>
      <HomeVotes language={language} today={today} week={weeks.find(held=>held.sittings.some(sitting=>sitting.date<=today))?.week||null}/>
    </div>
    <aside className="home-rail">
      <HomeFollowing/>
      <HomeTopics language={language}/>
      <HomeOutside language={language}/>
      <HomeEntries/>
    </aside>
  </div>;
}

function HomeAgenda({settled,week,language,today}:{settled:boolean;week:string|null;language:string;today:string}) {
  const ui=useUiI18n();
  const agenda=useInsightData<LegislationResponse>(week?'insights/legislation?'+new URLSearchParams({lang:language,week}):null);
  if(!settled)return null;
  if(!week)return <section className="home-section home-agenda"><h2><UiMessage id="home.agenda.section"/></h2><p><UiMessage id="home.agenda.empty"/></p></section>;
  const rows=agendaRows(agenda.data?.topics,today,8);
  const days=[...new Set(rows.map(row=>row.day))];
  return <section className="home-section home-agenda">
    <h2><UiMessage id="home.agenda.section"/> <a className="home-section-more" href={agendaHref(week)} onClick={dossierLinkClick}><UiMessage id="home.agenda.all"/></a></h2>
    <InsightStatus loading={agenda.loading&&!agenda.data} error={agenda.data?null:agenda.error} retry={agenda.retry}/>
    {days.map(day=><div key={day} className="home-agenda-day">
      <h3><time lang='' dateTime={day}>{longDate(day,language)}</time></h3>
      <ol className="home-agenda-list">{rows.filter(row=>row.day===day).map(row=>{const reference=procedureReference(row.topic.procedureIds);return <li key={row.topic.id}>
        <small>{row.topic.kind==='PLENARY_VOTE'?ui.t('home.agenda.vote'):ui.t('home.agenda.debate')}</small>
        <a href={recordHref(row.topic.id)} onClick={dossierLinkClick}><span lang={row.topic.titleLanguage??''}>{agendaTitle(row.topic.title)}</span></a>
        {reference&&<code className="home-reference">{reference}</code>}
      </li>;})}</ol>
    </div>)}
    {(!rows.length&&agenda.data&&!agenda.loading&&!agenda.error)&&<p><UiMessage id="home.agenda.empty"/></p>}
  </section>;
}

function HomeVotes({language,today,week}:{language:string;today:string;week:string|null}) {
  // The agenda route is shared and cached; the picks then open the latest
  // held vote record of that sitting week.
  const base=useInsightData<LegislationResponse>(week?'insights/legislation?'+new URLSearchParams({lang:language,week}):null);
  const voteTopic=base.data?.topics.filter(topic=>topic.kind==='PLENARY_VOTE'&&topic.date<=today).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const detail=useInsightData<LegislationResponse>(voteTopic?'insights/legislation?'+new URLSearchParams({lang:language,sitting:voteTopic.sittingId||('MTG-PL-'+voteTopic.date),topic:voteTopic.id}):null);
  const picks=detail.data?.detail?votePicks(detail.data.detail.votes,detail.data.detail.finalVotePatterns?.finalTextVoteIds||[]):[];
  if(!week||!picks.length)return null;
  return <section className="home-section home-votes">
    <h2><UiMessage id="home.votes.section"/></h2>
    {picks.map(pick=><HomePick key={pick.rule+':'+pick.vote.id} pick={pick} topicId={detail.data!.detail!.id} language={language}/>)}
  </section>;
}

const outcomeKeys:Record<string,string>={ADOPTED:'membervotespresentation.adopted',REJECTED:'membervotespresentation.rejected',LAPSED:'membervotespresentation.lapsed',WITHDRAWN:'membervotespresentation.withdrawn'};
type HomePickData={rule:string;vote:VoteSummary;totals:{for:number;against:number;abstaining:number}};
function HomePick({pick,topicId,language}:{pick:HomePickData;topicId:string;language:string}) {
  const ui=useUiI18n();
  const vote=pick.vote,totals=pick.totals,inVoting=totals.for+totals.against+totals.abstaining;
  return <article className="home-pick">
    <h3><UiMessage id={'home.votes.pick.'+pick.rule}/></h3>
    <p className="home-pick-meta"><time lang='' dateTime={vote.date}>{humanDate(vote.date,language)}</time>{outcomeKeys[vote.outcome]?' · '+ui.t(outcomeKeys[vote.outcome]):''}</p>
    {topicId&&vote.title&&<p className="home-pick-link"><a href={recordHref(topicId)+'&agenda-vote='+encodeURIComponent(vote.id)} onClick={dossierLinkClick}><span lang="">{vote.title}</span></a></p>}
    {pick.rule==='divergent'&&typeof vote.groupDeviations==='number'&&vote.groupDeviations>0&&<p className="home-pick-note">{ui.t(vote.groupDeviations===1?'home.votes.divergentOne':'home.votes.divergent',{count:vote.groupDeviations})}</p>}
    {(inVoting>0)&&<div className="home-vote-bar" aria-hidden="true">
      <span className="home-vote-bar-for" style={{width:`${totals.for/inVoting*100}%`}}/>
      <span className="home-vote-bar-against" style={{width:`${totals.against/inVoting*100}%`}}/>
      <span className="home-vote-bar-abstain" style={{width:`${totals.abstaining/inVoting*100}%`}}/>
    </div>}
    {(inVoting>0)&&(vote.subject||vote.title)&&<p className="home-pick-tally"><UiMessage id="membervotesummary.for_for_against_against_abstaining_abstaining" values={{for:totals.for,against:totals.against,abstaining:totals.abstaining}}/></p>}
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

type TopicRank={item:TopicOverview['items'][number];count:number};
function HomeTopics({language}:{language:string}) {
  const overview=useInsightData<TopicOverview>('topics/overview?'+new URLSearchParams({role:'topic',lang:language,askers:'all'}));
  const data=overview.data;
  if(!data||overview.loading&&!data.items.length)return null;
  const last=lastFullQuarter(data),lastIndex=data.periods.indexOf(last);
  const rising=new Set(risers(data,lastIndex,'q',true).flatMap(row=>row.item.key));
  const ranked=(data.items as TopicRank['item'][]).map(item=>({item,count:placeValue(point(item,last),'q',true)})).filter(row=>row.count>0).sort((a,b)=>b.count-a.count||a.item.key.localeCompare(b.item.key)).slice(0,5);
  if(!ranked.length)return null;
  return <section className="home-section home-topics">
    <h2><UiMessage id="home.topics.section"/> <a className="home-section-more" href={viewHref('geopolitics')} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    <p className="home-section-lead"><UiMessage id="home.topics.lead"/></p>
    <ol className="home-topics-list">{ranked.map(row=><li key={row.item.key}>
      <a href={topicsHref(row.item.key)} onClick={dossierLinkClick}><span lang={row.item.labelLanguage||undefined}>{rising.has(row.item.key)?'↑ ':''}{row.item.label}</span><strong>{row.count}</strong></a>
    </li>)}</ol>
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
