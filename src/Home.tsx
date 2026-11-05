// The home view owns the bare URL. It renders progressive sections; each
// section fetches its own data, so a slow or failing section never holds the
// headline. Pure selection logic lives in homeModel.mjs.
import {useEffect,useState} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useData} from './data';
import {useInsightData} from './InsightData';
import {dossierLinkClick} from './dossierJourney';
import {humanDate} from './InsightCharts';
import {InsightStatus} from './InsightShared';
import {agendaTitle,lastFullQuarter,point,placeValue,risers,topicsHref} from './topicPresentation.mjs';
import {recordHref} from './TopicsLinks';
import {headlineState,defaultAgendaWeek,agendaRows,votePicks,unreadRows} from './homeModel.mjs';
import {brusselsDate} from './plenaryAvailability.mjs';
import {useSaved,useSavedNow} from './SavedControls';
import {summarizeByType} from './followUpdates.mjs';
import type {VotePeriodsResponse} from './plenaryPeriods.mjs';
import type {TopicOverview} from './TopicsTypes';
import type {LegislationResponse,VoteSummary} from './LegislationTypes';
import type {OutsideDirectory} from './OutsideTypes';
import './Home.css';

const useHomeDate=()=>{
  const [today,setToday]=useState(brusselsDate);
  useEffect(()=>{const timer=setInterval(()=>setToday(brusselsDate()),60_000);return ()=>clearInterval(timer);},[]);
  return today;
};

const agendaHref=week=>week ? ('?'+new URLSearchParams({view:'legislation','pl-mode':'agenda','agenda-period':'week:'+week})) : '?view=legislation&pl-mode=agenda';
const viewHref=view=>'?'+new URLSearchParams({view});

export function Home({language}:{language:string}) {
  const ui=useUiI18n();
  const today=useHomeDate();
  // The shared vote-periods calendar drives the headline and the agenda links.
  const calendar=useData<VotePeriodsResponse>('vote-periods',{unavailable:'error.unavailable'});
  const weeks=calendar.data?.weeks||[],upcoming=calendar.data?.upcoming||[];
  const headline=headlineState(today,weeks,upcoming);
  const week=defaultAgendaWeek(today,weeks,upcoming);
  return <div className="home" lang={ui.language}>
    <div className="home-main">
      <header className="home-headline">
        <h1 tabIndex={-1}>
          {(calendar.error&&!calendar.data?.weeks) ? <UiMessage id="home.headline.unavailable"/> :
            (headline.case==='sitting-today') ?
              (headline.city ? ui.t('home.headline.today_city',{city:headline.city}) : <UiMessage id="home.headline.today_plain"/>) :
            ((headline.case==='sitting-later-this-week'||headline.case==='next-known')&&headline.nextDate) ?
              (headline.city ? ui.t('home.headline.next_city',{date:humanDate(headline.nextDate,language),city:headline.city}) : ui.t('home.headline.next_plain',{date:humanDate(headline.nextDate,language)})) :
            <UiMessage id="home.headline.none"/>}
        </h1>
        <p className="home-headline-link"><a href={agendaHref(week)} onClick={dossierLinkClick}><UiMessage id="home.agenda.open"/></a></p>
      </header>
      <HomeAgenda week={week} language={language} today={today}/>
      <HomeVotes language={language} today={today} week={week}/>
    </div>
    <aside className="home-rail">
      <HomeFollowing/>
      <HomeTopics language={language}/>
      <HomeOutside language={language}/>
    </aside>
  </div>;
}

function HomeAgenda({week,language,today}:{week:string|null;language:string;today:string}) {
  const agenda=useInsightData<LegislationResponse>(week?'insights/legislation?'+new URLSearchParams({lang:language,week}):null);
  if(!week||(!agenda.data&&!agenda.loading&&!agenda.error))return null;
  const rows=agendaRows(agenda.data?.topics,today,6);
  return <section className="home-section home-agenda">
    <h2><UiMessage id="home.agenda.section"/> <a className="home-section-more" href={agendaHref(week)} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    <InsightStatus loading={agenda.loading&&!agenda.data} error={agenda.data?null:agenda.error} retry={agenda.retry}/>
    {rows.length ? <ol className="home-agenda-list">{rows.map(row=><li key={row.topic.id}>
      <small><time lang='' dateTime={row.day}>{humanDate(row.day,language)}</time></small>
      <a href={recordHref(row.topic.id)} onClick={dossierLinkClick}><span lang={row.topic.titleLanguage??''}>{agendaTitle(row.topic.title)}</span></a>
    </li>)}</ol> : (agenda.data&&!agenda.loading&&!agenda.error ? <p><UiMessage id="home.agenda.empty"/></p> : null)}
  </section>;
}

function HomeVotes({language,today,week}:{language:string;today:string;week:string|null}) {
  // The agenda route is shared and cached; the picks then open the latest
  // held vote record of that sitting week.
  const base=useInsightData<LegislationResponse>(week?'insights/legislation?'+new URLSearchParams({lang:language,week}):null);
  const voteTopic=base.data?.topics.filter(topic=>topic.kind==='PLENARY_VOTE'&&topic.date<=today).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const detail=useInsightData<LegislationResponse>(voteTopic?'insights/legislation?'+new URLSearchParams({lang:language,sitting:voteTopic.sittingId||('MTG-PL-'+voteTopic.date),topic:voteTopic.id}):null);
  const picks=detail.data?.detail?votePicks(detail.data.detail.votes,detail.data.detail.finalVotePatterns?.finalTextVoteIds||[]):[];
  if(!base.data)return null;
  return <section className="home-section home-votes">
    <h2><UiMessage id="home.votes.section"/></h2>
    {detail.loading&&!detail.data&&<p role="status"><UiMessage id="insightshared.loading"/></p>}
    {(!detail.data&&detail.error)&&<InsightStatus loading={false} error={detail.error} retry={detail.retry}/>}
    {picks.map(pick=><HomePick key={pick.rule+':'+pick.vote.id} pick={pick} topicId={detail.data!.detail!.id} language={language}/>)}
    {(detail.data&&!detail.loading&&(picks.length===0))&&<p><UiMessage id="home.votes.none"/></p>}
  </section>;
}

type HomePickData={rule:string;vote:VoteSummary;totals:{for:number;against:number;abstaining:number}};
function HomePick({pick,topicId,language}:{pick:HomePickData;topicId:string;language:string}) {
  const vote=pick.vote,totals=pick.totals,inVoting=totals.for+totals.against+totals.abstaining;
  return <article className="home-pick">
    <h3><UiMessage id={'home.votes.pick.'+pick.rule}/></h3>
    <p className="home-pick-meta"><time lang='' dateTime={vote.date}>{humanDate(vote.date,language)}</time></p>
    {topicId&&vote.title&&<p className="home-pick-link"><a href={recordHref(topicId)+'&agenda-vote='+encodeURIComponent(vote.id)} onClick={dossierLinkClick}><span lang="">{vote.title}</span></a></p>}
    {pick.rule==='divergent'&&typeof vote.groupDeviations==='number'&&vote.groupDeviations>0&&<p className="home-pick-note"><UiMessage id="home.votes.divergent" counts={{count:vote.groupDeviations}} values={{count:vote.groupDeviations}}/></p>}
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
  if(!saved.items.length)return null;
  return <section className="home-section home-following">
    <h2><UiMessage id="home.following.section"/> <a className="home-section-more" href={viewHref('saved')} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    {rows.length ? <ol className="home-following-list">{rows.map(row=><li key={row.entry.kind+':'+row.entry.id}>
      <small>{summarizeByType([row.entry],0,ui).replace(/^1 /,'')}</small>
      <a href={followingEntryHref(row.item,row.entry)} onClick={dossierLinkClick}><span lang={row.entry.titleLanguage||''}>{row.entry.title}</span></a>
    </li>)}</ol> : <p><UiMessage id="home.following.none"/></p>}
  </section>;
}

// Follow updates link to where their detail lives today: a followed MEP goes
// to that member's activity, a followed question opens its answers.
const followingEntryHref=(item,entry)=>{
  if(item.kind==='mep')return '?'+new URLSearchParams({member:item.id,module:'activities',activity:entry.id});
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
    <h2><UiMessage id="outsidevoices.outside_voices.a027e6"/> <a className="home-section-more" href={viewHref('outside')} onClick={dossierLinkClick}><UiMessage id="home.more"/></a></h2>
    <p className="home-section-lead"><UiMessage id="home.outside.lead"/></p>
    <ul className="home-outside-list">{recent.map(person=><li key={person.id}>
      <a href={viewHref('outside')+'&ov-person='+encodeURIComponent(person.id)} onClick={dossierLinkClick}>{person.name}</a>
      <small>{person.role ? <span lang={person.roleLanguageTag||undefined}>{person.role} · </span> : null}<time lang='' dateTime={person.last}>{humanDate(person.last,language)}</time></small>
    </li>)}</ul>
  </section>;
}
