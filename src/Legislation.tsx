import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {contributionFilters,legislationAmendmentCounts,legislationLatestSpeech,legislationActivity,legislationContributors,legislationOffice,mergeSpeechSpeakers,orderLegislationPeople,type SpeechHeaders,type SpeechSpeaker} from './legislationContributors.mjs';
import {committeeAmendmentList,committeeAmendmentTarget} from './amendmentModel.mjs';
import {PersonName,usePersonName} from './PersonName';
import {selectLanguageText} from './language.mjs';
import {matchesCountry} from './countries.mjs';
import {useExplorerParam} from './explorerUrl';
import {PlenaryLiveBanner,ScheduledNow} from './PlenaryLive';
import {lazy,Suspense,useState,useEffect,useLayoutEffect,useRef,useCallback,useId} from 'react';
import {plenaryModes,plenaryModeTitles,type PlenaryMode, plenaryModeTitlesUi} from './plenaryModes';
import {prefetchInsightData,useInsightData} from './InsightData';
import {InsightShell,InsightStatus,InsightPeople,InsightDemographics,humanDate} from './InsightShared';
import {groupColor,groupLabel} from './InsightCharts';
import {CountryFilter} from './CountryFilter';
import {InsightQuestionReader,InsightSpeechReader} from './InsightReaders';
import type {InsightProps,InsightStats} from './InsightTypes';
import {countryName} from './CountryMap';
import {interfaceTerm,voteScope,compoundLanguage} from './terms.mjs';
import {Participation} from './Participation';
import {PlenaryPeriodSelect,latestHeldSitting,weekPeriod,SittingCalendarNotice} from './PlenaryPeriodNavigation';
import {SpeechCloud} from './SpeechCloud';
import {TextSearch} from './TextSearch';
import {ProcedureContext} from './ProcedureContext';
import {useDossierReaderState,dossierReaderValue,dossierJourneyRestoring} from './dossierJourney';
import {DossierActivity,DossierAmendmentLinks,DossierWorkLinks} from './DossierActivity';
import type {DossierReference} from './DossierActivityTypes';
import {TopicTrends} from './TopicTrends';
import {parseProcedureReference} from './procedureReference.mjs';
import type {LegislationResponse,LegislationNavigationResponse,NamedVote} from './LegislationTypes';
import type {DirectoryMember} from './explorerTypes';
import {brusselsDate,plenaryAvailability} from './plenaryAvailability.mjs';
function usePlenaryDate() {
  const [today,setToday]=useState(brusselsDate);
  useEffect(()=>{const timer=setInterval(()=>setToday(brusselsDate()),60_000);return()=>clearInterval(timer);},[]);
  return today;
}
const contributionTime=(value:string|null,language:string)=>(value && Number.isFinite(Date.parse(value))) ? new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Brussels'}).format(new Date(value)) : null;
const positions={for:'For',against:'Against',abstaining:'Abstaining'};
export const positionsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof positions => ({for:ui.t("membervotespresentation.for"),against:ui.t("membervotespresentation.against"),abstaining:ui.t("membervotesummary.abstaining")});

const committeeAction=(kind:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>({COMMITTEE_TABLING_REPORT:ui.t("legislation.draft_report.b4f899"),COMMITTEE_TABLING_OPINION:ui.t("legislation.draft_opinion.ed1618"),COMMITTEE_TABLING_AMENDMENT:ui.t("legislation.amendments.900866"),COMMITTEE_ADOPTING_REPORT:ui.t("legislation.report_adopted.6593b6"),COMMITTEE_ADOPTING_OPINION:ui.t("legislation.opinion_adopted.de956c"),COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT:ui.t("legislation.provisional_agreement.74dd3c")} as Record<string,string>)[kind]||ui.t("legislation.committee_decision.a027f4");
const agendaItemRoute=(language:string,sitting:string,topic:string)=>'insights/legislation?'+new URLSearchParams({lang:language,sitting,topic});
// Pinning the week in an item URL names the agenda already on screen.
// Only this exact latest/concrete-week pair may share a completed response.
function sameAgendaRoute(loaded:string,requested:string,data:LegislationResponse|LegislationNavigationResponse) {
  if(!('week' in data)||!data.week)return false;
  const previous=new URL(loaded,'https://explorer.invalid/'),next=new URL(requested,'https://explorer.invalid/');
  if(previous.searchParams.get('week')!=='latest'||next.searchParams.get('week')!==data.week)return false;
  previous.searchParams.set('week',data.week);
  return previous.href===next.href;
}
const CommitteeAmendmentsReader=lazy(()=>import('./Amendments').then(module=>({default:module.Amendments})));
function CommitteeAmendments({id,procedure,language}:{id:string;procedure:string;language:string}) {
  const ui = useUiI18n();
  const [open,setOpen]=useDossierReaderState('committee-amendments:'+procedure+':'+id,false);
  if(!committeeAmendmentList(id)&&!committeeAmendmentTarget(id))return null;
  return <details className="insight-committee-amendments" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><UiMessage id="legislation.view_amendments.26f33f"/></summary>{open&&<Suspense fallback={<p role="status"><UiMessage id="legislation.loading_amendments.0d4c10"/></p>}><CommitteeAmendmentsReader scope="committee" list={committeeAmendmentList(id) ? id : undefined} document={committeeAmendmentTarget(id) ? id : undefined} procedure={procedure} language={language} heading={ui.t("legislation.committee_amendments.bf18f4")}/></Suspense>}</details>;
}
function ContributorActivity({detail,headers,person,language,onSpeech}:{detail:NonNullable<LegislationResponse['detail']>;headers:SpeechHeaders;person:string;language:string;onSpeech:(id:string)=>void}) {
  const ui = useUiI18n();
  const counts=legislationActivity(detail,headers,person),amendments=legislationAmendmentCounts(detail,person),latest=legislationLatestSpeech(detail,headers,person);
  const references=detail.procedures.filter(p=>p.reference).map(p=>({id:p.id,reference:p.reference!}));
  return <><ul className="insight-person-activity" lang={ui.language} aria-label={ui.t("legislation.linked_activity.36fb57")}>
    {counts.speeches!==null&&<li>{<UiMessage id="legislation.speeches_speeches.c01055" values={{speeches: counts.speeches}} counts={{speeches: counts.speeches}}/>}</li>}
    {counts.statements&&<li>{<UiMessage id="legislation.statements_written_statements.7e4375" values={{statements: counts.statements}} counts={{statements: counts.statements}}/>}</li>}
    {(['committee','plenary'] as const).map(stage=>((amendments[stage]!==null) && (amendments[stage]!>0)) ? <li key={stage}><DossierAmendmentLinks references={references} person={person} language={language} stage={stage} count={amendments[stage]!}/></li> : null)}
  </ul>{latest&&<button type="button" className="insight-text-button" onClick={()=>onSpeech(latest.sourceId)}><UiMessage id="legislation.latest_plenary_contribution_date.57f87c" values={{date: <span lang={language}>{humanDate(latest.date,language)}</span>}}/></button>}</>;
}
function ContributorAnalysis({stats,language}:{stats:InsightStats;language:string}) {
  if(stats.denominator<=0&&!stats.groupContributions?.total)return null;
  return <details className="insight-author-analysis" open><summary><UiMessage id="legislation.about_the_contributors.9f2242"/></summary><InsightDemographics stats={stats} language={language}/></details>;
}
function VoteView({vote,language,onMember,country}:{country:string|null;vote:NamedVote;language:string;onMember:InsightProps['onMember']}) {
  const ui = useUiI18n();
  const [position,setPosition]=useState<keyof typeof positions>('for'),[group,setGroup]=useState<string|null>(null),[showPeople,setShowPeople]=useState(false),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null),browse=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setPosition('for');setGroup(null);setShowPeople(false);},[vote.id,country]);
  const choices=Object.keys(positionsUi(ui)) as (keyof typeof positions)[];
  const countryPeople=(p:keyof typeof positions)=>(vote.groups?.[p]||[]).filter(person=>matchesCountry(country,person.country));
  const groupPeople=(code:string,p:keyof typeof positions)=>(vote.politicalGroups?.find(row=>row.code===code)?.positions[p]||[]).filter(person=>matchesCountry(country,person.country));
  const people=countryPeople(position),filtered=group ? groupPeople(group,position) : people;
  const groups=(vote.politicalGroups||[]).map(row=>row.code).filter(code=>choices.some(p=>groupPeople(code,p).length)).sort((a,b)=>choices.reduce((n,p)=>n+groupPeople(b,p).length-groupPeople(a,p).length,0)||a.localeCompare(b));
  function choose(p:keyof typeof positions,g:string|null){const active=document.activeElement;if(active instanceof HTMLButtonElement&&!active.closest('.insight-voter-list'))opener.current=active;setPosition(p);setGroup(g);setShowPeople(true);requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});});}
  const titles={...vote.titles,...Object.fromEntries(Object.entries(vote.subjects).filter(([,text])=>text.trim()))};
  const label=interfaceTerm('vote',language),title=selectLanguageText(titles,language,label.text,label.language);
  return <section className="insight-vote-detail" lang={ui.language}>
    <h3 lang={title.language}>{title.text}</h3>
    <p className="insight-record-meta"><span lang={voteScope(vote.scope,language, ui).language}>{voteScope(vote.scope,language, ui).text}</span><span lang={language}>{humanDate(vote.date,language)}</span><span>{vote.outcome.toLowerCase()}</span></p>
    <div className="insight-vote-totals">{choices.map(p=><div key={p} className={'vote-'+p}><h3>{positionsUi(ui)[p]} <strong>{country ? countryPeople(p).length : (vote.aggregateTotals[p]??'—')}</strong></h3>{country&&<small><UiMessage id="legislation.of_count_across_parliament.dffd8c" values={{count: (vote.aggregateTotals[p]??'—')}}/></small>}</div>)}</div>
    {vote.namedVotersAvailable&&<><h4><UiMessage id="insightshared.political_groups"/></h4><p className="insight-chart-caption">{country ? <UiMessage id="legislation.named_voters_elected_in_countryname_select_a_count_to_see_the_meps.5d4e97" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/> : <UiMessage id="legislation.named_voters_across_parliament_select_a_count_to_see_the_meps.4bc20f"/>}</p><div className="insight-vote-matrix"><div className="insight-vote-matrix-head"><span><UiMessage id="groupvoices.political_group.c2db1f"/></span>{choices.map(p=><span key={p}>{positionsUi(ui)[p]}</span>)}</div>{groups.map(code=>{const counts=choices.map(p=>groupPeople(code,p).length),total=counts.reduce((sum,n)=>sum+n,0);return <div className="insight-vote-group-row" key={code}><span lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(code) ? 'en' : ''}><i style={{background:groupColor(code)}}/>{groupLabel(code, ui)}</span>{choices.map((p,index)=><button lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(code) ? 'en' : ''} key={p} className={'vote-'+p} style={{backgroundSize:`${counts[index]/Math.max(1,total)*100}% 100%`}} aria-label={ui.t("legislation.grouplabel_position_count_meps.f476b0", {group: String(groupLabel(code, ui)), position: String(positionsUi(ui)[p].toLowerCase()), count: counts[index]})} aria-pressed={showPeople&&position===p&&group===code} disabled={!counts[index]} onClick={()=>choose(p,code)}>{counts[index]}</button>)}</div>;})}</div>{!groups.length&&<p><UiMessage id="legislation.no_named_voters_in_this_election_country.f82bd9"/></p>}{!showPeople&&groups.length>0&&<button ref={browse} className="insight-text-button" onClick={()=>choose(choices.find(p=>countryPeople(p).length>0)||'for',null)}><UiMessage id="legislation.browse_voters.83b3d0"/></button>}</>}
    {vote.namedVotersAvailable&&!vote.totalsMatchNamed&&<p className="insight-secondary"><UiMessage id="legislation.the_named_voter_list_differs_from_parliament_s_published_totals.d739ef"/></p>}
    {vote.namedVotersAvailable&&showPeople&&<section className="insight-voter-list"><div className="insight-section-heading"><h3 ref={heading} tabIndex={-1}>{positionsUi(ui)[position]}{group ? <> · <span lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(group) ? 'en' : ''}>{groupLabel(group, ui)}</span></> : ''} <small><UiMessage id="legislation.count_meps.e2c717" values={{count: filtered.length}}/></small></h3><button className="insight-text-button" onClick={()=>{setShowPeople(false);requestAnimationFrame(()=>{const target=opener.current?.isConnected ? opener.current : browse.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});});}}><UiMessage id="legislation.hide_voters.3bf222"/></button></div><div className="insight-chart-switch" role="group" aria-label={ui.t("legislation.vote_position.4dccce")}>{choices.map(p=><button key={p} aria-pressed={position===p} onClick={()=>choose(p,group)}>{positionsUi(ui)[p]}</button>)}</div>{group&&<button className="insight-text-button" onClick={()=>setGroup(null)}><UiMessage id="legislation.all_groups.33c7d0"/></button>}<InsightPeople key={vote.id+position+(group||'')} people={filtered} language={language} onMember={onMember}/>{!filtered.length&&<p><UiMessage id="legislation.no_named_voters_in_this_selection.51d18b"/></p>}</section>}
    {!vote.namedVotersAvailable&&<p><UiMessage id="legislation.individual_votes_unavailable.ca5dc2"/></p>}
    <details><summary><UiMessage id="legislation.vote_corrections.b7dcb6"/></summary>{choices.map(p=>vote.intendedCorrections[p].length ? <p key={p}><UiMessage id="legislation.intended_position_people.c15a86" values={{position: positionsUi(ui)[p], people: vote.intendedCorrections[p].map((x,index)=><span key={x.id} lang={x.name ? '' : 'en'}>{index ? ', ' : ''}{x.name||ui.t("insightshared.mep")}</span>)}}/></p> : null)}{!Object.values(vote.intendedCorrections).some(a=>a.length)&&<p><UiMessage id="legislation.no_corrections.9b95da"/></p>}</details>
  </section>;
}
function SittingCloud({sitting,sittings,agendaPeriod,language,onSearchScopeChange,latestAvailable=true}:{latestAvailable?:boolean;agendaPeriod:string;sitting:string;sittings:LegislationResponse['sittings'];language:string;onSearchScopeChange:()=>void}) {
  const ui = useUiI18n();
  const [country,setCountry]=useExplorerParam<string|null>('cloud-country',null);
  // Explicit sitting links retain their day; unselected visits default to the latest plenary week.
  const [period,setPeriod]=useExplorerParam('cloud-period',agendaPeriod.startsWith('week:') ? agendaPeriod : (sitting ? ('sitting:'+sitting) : weekPeriod(latestHeldSitting(sittings,latestAvailable)))),[kind,value]=[period.slice(0,period.indexOf(':')),period.slice(period.indexOf(':')+1)];
  function chooseCountry(value:string|null){if(value!==country)onSearchScopeChange();setCountry(value);}
  function choosePeriod(value:string){if(value!==period)onSearchScopeChange();setPeriod(value);}
  const controls=<><PlenaryPeriodSelect value={period} sittings={sittings} language={language} onChange={choosePeriod}/><CountryFilter country={country} onChange={chooseCountry} language={language}/></>;
  return <section className="insight-sitting-cloud">{country&&<div className="insight-active-filters" lang={ui.language}><button onClick={()=>chooseCountry(null)}><UiMessage id="legislation.meps_elected_in_countryname.9c4b7d" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/></button></div>}{value ? <SpeechCloud title={false} controls={controls} {...((kind==='week') ? ({week:value}) : ({sitting:value}))} country={country} interfaceLanguage={language}/> : <><div className="explorer-cloud-controls">{controls}</div><p lang={ui.language}><UiMessage id="legislation.latest_week_unavailable_choose_a_period.103440"/></p></>}</section>;
}
function TopicVotes({detail,route,country,language,onMember,today,retry}:{detail:NonNullable<LegislationResponse['detail']>;route:string;country:string|null;language:string;onMember:InsightProps['onMember'];today:string;retry:()=>void}) {
  const ui = useUiI18n();
  const [vote,setVote]=useExplorerParam<string>('agenda-vote','');
  const requested=Boolean(vote&&vote!==detail.selectedVote?.id);
  // Vote changes must not clear the agenda item or remount its dossier and speeches.
  const selected=useInsightData<LegislationResponse>((requested && detail.votes.length) ? (route+'&vote='+encodeURIComponent(vote)) : null);
  const shown=requested ? selected.data?.detail?.selectedVote : detail.selectedVote;
  const availability=plenaryAvailability(detail,'vote',today, ui);
  return <section lang={ui.language} aria-busy={requested&&selected.loading}><h2>{detail.votes.length ? <UiMessage id="legislation.how_meps_voted.789bfc"/> : <UiMessage id="legislation.voting_results.ddda32"/>}</h2>{detail.votes.length ? <><label className="insight-vote-select"><UiMessage id="legislation.vote.64f872"/><select value={vote||detail.selectedVote?.id||''} onChange={e=>setVote(e.target.value)}>{detail.votes.map(v=><option lang="" key={v.id} value={v.id}>{voteScope(v.scope,language, ui).text} · {v.subject||v.title}</option>)}</select></label><InsightStatus loading={requested&&selected.loading&&!shown} error={requested ? selected.error : null} retry={selected.retry}/>{shown&&<VoteView country={country} vote={shown} language={language} onMember={onMember}/>}</> : (availability&&<p role={(availability.state==='error') ? 'alert' : undefined}>{availability.message}{availability.state==='error'&&<> <button onClick={retry}><UiMessage id="commissionfollowups.try_again"/></button></>}</p>)}</section>;
}
export function Legislation(props:InsightProps&{members?:DirectoryMember[]}) {
  const ui = useUiI18n();
  const today=usePlenaryDate();
  const [dossierMetadata,setDossierMetadata]=useState<DossierReference|null>(null);
  const displayName=usePersonName();
  const readerId=useId(),speechTop=useRef<HTMLElement>(null),speechJump=useRef<HTMLDetailsElement>(null),speechJumpSummary=useRef<HTMLElement>(null);
  const [country,setCountry]=useExplorerParam<string|null>('agenda-country',null);
  const [contribution,setContribution]=useExplorerParam<'all'|'committee'|'plenary'>('agenda-contribution','all',contributionFilters);
  const [mode,setMode]=useExplorerParam<PlenaryMode>('pl-mode','agenda',plenaryModes),[officialTopic,setOfficialTopic]=useExplorerParam<string|null>('trend-source',null),[referenceDraft,setReferenceDraft]=useState(''),[reference,setReference]=useExplorerParam<string>('dossier-ref',''),[referenceError,setReferenceError]=useState('');
  const pageTitle=plenaryModeTitlesUi(ui)[mode];
  useEffect(()=>{window.document.title=ui.t("legislation.pagetitle_european_parliament_data_explorer.42a26b", {pageTitle: String(pageTitle)});},[pageTitle]);
  const [,setTrendTopic]=useExplorerParam<string>('trend-topic',''),[,setTrendWeek]=useExplorerParam<string>('trend-week',''),[,setTrendSearch]=useExplorerParam<string>('trend-search',''),[,setTrendDossier]=useExplorerParam<string|null>('trend-dossier',null);
  const [agendaPeriod,setAgendaPeriod]=useExplorerParam<string>('agenda-period','');
  const [,setSearchOffset]=useExplorerParam<number>('agenda-fts-offset',-1);
  const [,setSearchPage]=useExplorerParam<number>('agenda-fts-page',0),[,setSearchRead]=useExplorerParam<string>('agenda-fts-read','');
  // Reset only explicit scope navigation; saved links and Back adopt their own result position.
  const resetSearchPosition=useCallback(()=>{setSearchPage(0);setSearchOffset(-1);setSearchRead('');},[setSearchPage,setSearchOffset,setSearchRead]);
  const language=props.language||'en', [sitting,setSitting]=useExplorerParam<string>('pl-sitting',''),[topic,setTopic]=useExplorerParam<string>('agenda-topic',''),[,setVote]=useExplorerParam<string>('agenda-vote',''),[speech,setSpeech]=useDossierReaderState<string|null>('agenda-speech',null),[document,setDocument]=useDossierReaderState<string|null>('agenda-document',null),[documentEvent,setDocumentEvent]=useDossierReaderState<string|null>('agenda-document-event',null);
  const voteLabel=interfaceTerm('vote',language);
  useEffect(()=>setReferenceDraft(reference),[reference]);
  const [hotPeriod]=useExplorerParam('hot-period',''),[cloudPeriod]=useExplorerParam('cloud-period','');
  const selectedViewPeriod=(mode==='participation') ? hotPeriod : ((mode==='cloud') ? cloudPeriod : '');
  const params=new URLSearchParams({lang:language});
  if(mode==='agenda'&&(agendaPeriod.startsWith('week:')||!agendaPeriod&&!sitting))params.set('week',agendaPeriod.slice(5)||'latest');
  else if(agendaPeriod.startsWith('sitting:')&&mode==='agenda')params.set('sitting',agendaPeriod.slice(8));
  else if(selectedViewPeriod.startsWith('sitting:'))params.set('sitting',selectedViewPeriod.slice(8));
  else if(selectedViewPeriod.startsWith('week:'))params.set('week',selectedViewPeriod.slice(5));
  else if(sitting)params.set('sitting',sitting);
  const base=useInsightData<LegislationResponse|LegislationNavigationResponse>(['agenda','cloud','participation'].includes(mode) ? ('insights/legislation?'+params) : null,sameAgendaRoute),navigation=base.data,data=navigation?.sitting ? (navigation as LegislationResponse) : null;
  // Retain navigation only: results remain fenced to the current request by useInsightData.
  const [agendaSittings,setAgendaSittings]=useState<LegislationResponse['sittings']>([]);
  useEffect(()=>{if(navigation)setAgendaSittings(navigation.sittings);},[navigation]);
  const requestedWeek=params.get('week'),requestedSitting=params.get('sitting');
  const selectedPeriod=((requestedWeek==='latest') && data) ? (data.week ? ('week:'+data.week) : ('sitting:'+data.sitting.id)) : (requestedWeek ? ('week:'+requestedWeek) : ('sitting:'+(requestedSitting||data?.sitting.id||'')));
  const selectedTopic=data?.topics.find(item=>item.id===topic);
  const topicSitting=selectedTopic?.sittingId||data?.sitting.id||sitting||'';
  const detailRoute=agendaItemRoute(language,topicSitting,topic);
  const selected=useInsightData<LegislationResponse>((((mode==='agenda') && topic) && data) ? detailRoute : null),detail=selected.data?.detail,displayTopic=detail||selectedTopic,detailRef=useRef<HTMLElement>(null),agendaRef=useRef<HTMLElement>(null),detailNavRef=useRef<HTMLDivElement>(null);
  const focusEpoch=useRef(0),detailFocusEpoch=useRef(0);
  const documentFocus=useRef<{target:string;opener:HTMLButtonElement|null;opening:boolean;epoch:number;scope:string}|null>(null);
  const [documentMember,setDocumentMember]=useDossierReaderState<string|undefined>('agenda-document-member',undefined);
  const documentScope=JSON.stringify([mode,topic,language,displayTopic?.id]);
  const documentTarget=(event:string|null)=>readerId+(event ? ('-committee-'+encodeURIComponent(event)) : '-agenda');
  function toggleDocument(id:string,event:string|null,opener:HTMLButtonElement|null=null) {
    const opening=document!==id||documentEvent!==event,target=documentTarget(event);
    if(opening)setDocumentMember(detail?.people.find(person=>person.currentMep)?.id);
    // A restored journey may have remounted its original trigger.
    const trigger=opener||[...detailRef.current?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]')||[]].find(button=>button.getAttribute('aria-controls')===target)||null;
    documentFocus.current={target,opener:trigger,opening,epoch:focusEpoch.current,scope:documentScope};
    setDocument(opening ? id : null);setDocumentEvent(opening ? event : null);
  }
  useLayoutEffect(()=>{
    const intent=documentFocus.current;documentFocus.current=null;
    if(!intent||intent.scope!==documentScope||intent.epoch!==focusEpoch.current||dossierJourneyRestoring())return;
    const target=intent.opening ? window.document.getElementById(intent.target) : intent.opener;
    if(target?.isConnected&&!target.hidden){target.focus({preventScroll:true});target.scrollIntoView({block:intent.opening ? 'start' : 'nearest',behavior:'instant'});}
  },[document,documentEvent,documentScope]);
  function renderDocumentReader(event:string|null) {
    const active=Boolean(document&&documentEvent===event);
    return <div id={documentTarget(event)} hidden={!active} tabIndex={-1} role="region" aria-label={active ? ui.t("legislation.document_document.9aabe4", {document: String(document)}) : undefined}>{active&&<><button className="insight-text-button" onClick={()=>toggleDocument(document!,event)}><UiMessage id="legislation.close_document.7866c7"/></button><InsightQuestionReader key={document} id={document!} member={documentMember} language={language} heading={ui.t("legislation.document_document.9aabe4", {document: String(document)})}/></>}</div>;
  }
  useEffect(()=>{
    const changed=()=>{focusEpoch.current++;};
    window.document.addEventListener('focusin',changed);
    return()=>window.document.removeEventListener('focusin',changed);
  },[]);
  // A delayed response must not override focus moved after this navigation.
  useEffect(()=>{detailFocusEpoch.current=focusEpoch.current;},[topic,language,agendaPeriod,sitting,mode]);
  const pendingHover=useRef<(()=>void)|null>(null);
  const cancelHover=useCallback(()=>{pendingHover.current?.();pendingHover.current=null;},[]);
  useEffect(()=>cancelHover,[cancelHover,language,selectedPeriod,mode,topic]);
  function preloadAgendaTopic(item:LegislationResponse['topics'][number]) {
    cancelHover();
    // The shared queue waits for intent, yields to foreground reads and retains
    // one in-flight read so clicking can join it without another request.
    if(item.id!==topic&&data)pendingHover.current=prefetchInsightData([agendaItemRoute(language,item.sittingId||data.sitting.id,item.id)]);
  }
  useEffect(()=>{setSpeech(dossierJourneyRestoring() ? dossierReaderValue('agenda-speech',detail?.speeches[0]?.sourceId||null) : (detail?.speeches[0]?.sourceId||null));setDocument(dossierJourneyRestoring() ? dossierReaderValue('agenda-document',null) : null);setDocumentEvent(dossierJourneyRestoring() ? dossierReaderValue('agenda-document-event',null) : null);if(!dossierJourneyRestoring()&&displayTopic&&innerWidth<=1000&&focusEpoch.current===detailFocusEpoch.current){detailRef.current?.focus({preventScroll:true});detailNavRef.current?.scrollIntoView({block:'start'});}},[displayTopic?.id]);
  const [speakerNames,setSpeakerNames]=useState<Record<string,string>>({}),[speechHeaders,setSpeechHeaders]=useState<SpeechHeaders>({});
  useEffect(()=>{setSpeakerNames({});setSpeechHeaders({});},[detail?.id]);
  const rememberSpeechSpeakers=useCallback((speeches:{id:string;people:SpeechSpeaker[]}[])=>{setSpeechHeaders(previous=>mergeSpeechSpeakers(previous,speeches));},[]);
  const rememberSpeakers=useCallback((people:(SpeechSpeaker&{name:string})[],speechId?:string)=>{setSpeakerNames(previous=>{const changed=people.filter(p=>previous[p.id]!==p.name);return changed.length ? ({...previous,...Object.fromEntries(changed.map(p=>[p.id,p.name]))}) : previous;});if(speechId)rememberSpeechSpeakers([{id:speechId,people}]);},[rememberSpeechSpeakers]);
  const contributors=detail ? legislationContributors(detail,speechHeaders,contribution) : null;
  const sourceRecordsUnavailable=Boolean(detail&&(detail.voteCoverage.truncated||detail.coverage.roleRowsTruncated||detail.coverage.gaps.length>0||detail.coverage.missingDocumentIds?.length));
  const speechAvailability=(detail?.kind==='PLENARY_DEBATE') ? plenaryAvailability(detail,'speech',today, ui) : null;
  const earlierSpeeches=Boolean(detail?.speeches.length&&detail.speeches.every(s=>s.date<detail.date));
  const shownPeople=contributors ? orderLegislationPeople(contributors.people,contributors.roles,props.members).filter(p=>matchesCountry(country,p.country)) : ([]),shownSpeeches=detail?.speeches.filter(s=>!country||s.people.some(p=>matchesCountry(country,p.country)))||[];
  useEffect(()=>{setSpeech(dossierJourneyRestoring() ? dossierReaderValue('agenda-speech',shownSpeeches[0]?.sourceId||null) : (shownSpeeches[0]?.sourceId||null));},[country,detail?.id]);
  const speechIndex=shownSpeeches.findIndex(s=>s.sourceId===speech),currentSpeech=shownSpeeches[speechIndex];
  const speechLabel=(s:typeof shownSpeeches[number])=>{
    const speakers=s.people.map(p=>displayName(p.id,p.currentMep ? p.name : (speakerNames[p.id]||p.name))||ui.t('insightshared.speaker')).join(', ')||ui.t('dossieractivity.speech');
    const time=contributionTime(s.start,language),written=s.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT';
    return written ? ui.t(time?'legislation.speakers_time_brussels_written_statement.684324':'legislation.speakers_written_statement.811c16',{speakers,time:time||''}) : (time ? ui.t('legislation.speakers_time_brussels.05daf4',{speakers,time}) : speakers);
  };
  function pageSpeech(offset:number,scroll=false){
    const next=shownSpeeches[speechIndex+offset];
    if(speechIndex<0||!next)return;
    setSpeech(next.sourceId);
    if(scroll)requestAnimationFrame(()=>speechTop.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}));
  }
  function chooseAgendaTopic(id:string){if(id!==topic)resetSearchPosition();if(data?.week)setAgendaPeriod('week:'+data.week);setTopic(id);setVote('');}
  function showAgenda(){
    const opener=agendaRef.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]');
    chooseAgendaTopic('');
    window.requestAnimationFrame(()=>{if(opener?.isConnected){opener.focus({preventScroll:true});opener.scrollIntoView({block:'nearest'});}else agendaRef.current?.scrollIntoView({block:'start'});});
  }
  function chooseAgendaPeriod(period:string){resetSearchPosition();setAgendaPeriod(period);setSitting(period.startsWith('sitting:') ? period.slice(8) : '');setTopic('');setVote('');}
  function chooseCountry(value:string|null){if(value!==country)resetSearchPosition();setCountry(value);}
  function chooseMode(next:typeof mode){if(next!==mode)resetSearchPosition();setMode(next);}
  return <InsightShell {...props} view="legislation" title={pageTitle}><PlenaryLiveBanner language={language}/><nav className="insight-chart-switch insight-mode-nav" lang={ui.language} aria-label={ui.t("legislation.explore_plenary.294d91")}><button aria-pressed={mode==='agenda'} onClick={()=>chooseMode('agenda')}><UiMessage id="legislation.agenda.891e9d"/></button><button aria-pressed={mode==='participation'} onClick={()=>chooseMode('participation')}><UiMessage id="plenarymodes.what_s_hot"/></button><button aria-pressed={mode==='cloud'} onClick={()=>chooseMode('cloud')}><UiMessage id="legislation.word_cloud.e3f724"/></button><button aria-pressed={mode==='trends'} onClick={()=>chooseMode('trends')}><UiMessage id="plenarymodes.topic_timeline"/></button><button aria-pressed={mode==='dossier'} onClick={()=>chooseMode('dossier')}><UiMessage id="plenarymodes.dossiers"/></button></nav>{mode==='agenda'&&<div className="insight-controls" lang={ui.language}><PlenaryPeriodSelect value={selectedPeriod} sittings={navigation?.sittings||agendaSittings} language={language} onChange={chooseAgendaPeriod} includeLatest/>{data&&<span>{ui.t(agendaSummaryKey(Boolean(data.coverage.agendaError&&!data.topics.length),Boolean(data.week&&!data.coverage.agendaComplete),(data.agendaSittings||[data.sitting]).every(day=>day.phase==='upcoming')),{count:data.topics.length})}</span>}</div>}{mode==='agenda'&&(('selectionUnavailable' in (navigation||{})) ? <p lang={ui.language}><UiMessage id="legislation.latest_week_unavailable_choose_a_period.103440"/></p> : <SittingCalendarNotice complete={navigation?.coverage.catalogueComplete}/>)} {['agenda','cloud','participation'].includes(mode)&&<InsightStatus loading={base.loading&&!data} error={base.error} retry={base.retry} loadingMessage={(mode==='agenda') ? ui.t("legislation.loading_agenda.26ee57") : undefined} errorMessage={(mode==='agenda') ? ui.t("legislation.could_not_load_this_agenda_choose_another_period_or_reload.214ba9") : undefined}/>}
    {mode==='dossier'&&<section className="insight-dossier-finder" lang={ui.language}><form className="insight-controls" noValidate onSubmit={event=>{event.preventDefault();const parsed=parseProcedureReference(referenceDraft, ui);if(parsed.error!==undefined){setReferenceError(parsed.error);return;}setReferenceDraft(parsed.reference);setReference(parsed.reference);setReferenceError('');}}><label><UiMessage id="legislation.procedure_reference.c40758"/><input value={referenceDraft} onChange={event=>{setReferenceDraft(event.target.value);setReferenceError('');}} placeholder={ui.t("legislation.e_g_2025_0407_cod.76ea7d")} spellCheck={false} autoComplete="off" aria-invalid={Boolean(referenceError)} aria-describedby="dossier-reference-hint"/></label><button type="submit"><UiMessage id="dossierCard.detail.3"/></button></form><p className="insight-secondary" id="dossier-reference-hint">{reference ? <UiMessage id="legislation.paste_a_procedure_reference_or_a_legislative_observatory_link.20d582"/> : <UiMessage id="legislation.paste_a_procedure_reference_or_a_legislative_observatory_link_example_example.67013f" values={{example:<button type="button" className="insight-text-button" onClick={()=>{setReferenceDraft('2025/0407(COD)');setReference('2025/0407(COD)');setReferenceError('');}}>2025/0407(COD)</button>}}/>}</p>{referenceError&&<p role="alert">{referenceError}</p>}{reference&&<ProcedureContext key={reference} reference={reference} language={language} showTitle fallbackTitle={(dossierMetadata?.reference===reference) ? dossierMetadata : null} onTopic={topic=>{setOfficialTopic(topic.id);setTrendTopic(topic.id);setTrendWeek('');setTrendSearch('');setTrendDossier(null);chooseMode('trends');}}><DossierActivity key={'activity:'+reference+':'+language} reference={reference} language={language} onProcedure={setDossierMetadata}/></ProcedureContext>}</section>}
    {mode==='trends'&&<TopicTrends key={officialTopic||'catalogue'} language={language} initialTopic={officialTopic}/>}
    {data&&mode==='agenda'&&data.coverage.agendaError&&<p role="alert" lang={ui.language}>{data.week ? <><UiMessage id="legislation.agenda_unavailable_for_dates.3383b8" values={{dates: <span lang={language}>{data.agendaSittings?.filter(day=>day.agendaError).map(day=>humanDate(day.date,language)).join(', ')}</span>}}/></> : ui.t("legislation.agenda_unavailable_for_this_sitting.aac90b")} <button onClick={base.retry}><UiMessage id="insightshared.reload.cce715"/></button></p>}
    {navigation&&mode==='cloud'&&<SittingCloud latestAvailable={navigation.coverage.latestAvailable} sitting={sitting} agendaPeriod={agendaPeriod} sittings={navigation.sittings} language={language} onSearchScopeChange={resetSearchPosition}/>}
    {navigation&&mode==='participation'&&<Participation latestAvailable={navigation.coverage.latestAvailable} language={language} sittings={navigation.sittings} onTopic={(sitting,topic)=>{resetSearchPosition();setAgendaPeriod('');setSitting(sitting);setTopic(topic);setVote('');setCountry(null);setMode('agenda');}}/>}
    {data&&mode==='agenda'&&<div className="insight-agenda-view" data-topic-selected={Boolean(topic)}><div className="insight-agenda-navigation" lang={ui.language} ref={detailNavRef}><button className="insight-text-button" onClick={showAgenda}><UiMessage id="legislation.back_to_agenda.266ceb"/></button><label className="insight-agenda-select" lang={ui.language}><UiMessage id="legislation.agenda_item.39cc14"/><select value={topic} onChange={event=>event.target.value ? chooseAgendaTopic(event.target.value) : showAgenda()}><option value=""><UiMessage id="legislation.all_agenda_items.81aa11"/></option>{data.week ? data.agendaSittings?.map(day=><optgroup lang={language} key={day.id} label={humanDate(day.date,language)}>{data.topics.filter(item=>item.sittingId===day.id).map(item=><option lang={compoundLanguage((item.kind==='PLENARY_VOTE') ? voteLabel.language : 'en',item.titleLanguage)} key={item.id} value={item.id}>{(item.kind==='PLENARY_VOTE') ? voteLabel.text : ui.t("legislation.debate.b7b027")} · {item.title}</option>)}</optgroup>) : data.topics.map(item=><option lang={compoundLanguage((item.kind==='PLENARY_VOTE') ? voteLabel.language : 'en',item.titleLanguage)} key={item.id} value={item.id}>{(item.kind==='PLENARY_VOTE') ? voteLabel.text : ui.t("legislation.debate.b7b027")} · {item.title}</option>)}</select></label></div><div className="insight-legislation-grid"><aside ref={agendaRef} className="insight-agenda" lang={ui.language} aria-label={ui.t("legislation.sitting_agenda.d0c24b")}>{(data.agendaSittings||[data.sitting]).map(day=><div key={day.id}>{data.week&&<h3 lang={language}>{humanDate(day.date,language)}</h3>}{data.topics.filter(item=>!data.week||item.sittingId===day.id).map(t=><button key={t.id} aria-pressed={topic===t.id} onPointerEnter={event=>{if(event.pointerType!=='touch')preloadAgendaTopic(t);}} onPointerLeave={cancelHover} onFocus={()=>preloadAgendaTopic(t)} onBlur={cancelHover} onClick={()=>chooseAgendaTopic(t.id)}><ScheduledNow id={t.id}/><small lang={(t.kind==='PLENARY_VOTE') ? voteLabel.language : 'en'}>{(t.kind==='PLENARY_VOTE') ? voteLabel.text : ui.t("legislation.debate.b7b027")}</small><strong lang={t.titleLanguage??''}>{t.title}</strong></button>)}{data.week&&'agendaError' in day&&day.agendaError&&<p><UiMessage id="legislation.agenda_unavailable.4483be"/></p>}{!data.topics.some(item=>!data.week||item.sittingId===day.id)&&!('agendaError' in day&&day.agendaError)&&<p>{(day.phase==='upcoming') ? <UiMessage id="legislation.agenda_not_yet_published.c9e27b"/> : <UiMessage id="legislation.agenda_unavailable.4483be"/>}</p>}</div>)}</aside>
    <section className="insight-topic-detail" lang={ui.language} data-agenda-topic={displayTopic?.id||''} data-agenda-pending={selected.loading ? 'true' : undefined} ref={detailRef} tabIndex={-1}><InsightStatus loading={selected.loading&&!detail} error={selected.error} retry={selected.retry} errorMessage={selectedTopic ? ui.t("legislation.details_unavailable.f578af") : undefined}/>{(!displayTopic) ? <h2>{(topic && selected.error) ? ui.t("legislation.agenda_item_unavailable.d8245e") : ((topic && (!selected.error)) ? ui.t("insightshared.loading") : ui.t("legislation.choose_an_agenda_item.68360f"))}</h2> : <><div className="insight-eyebrow"><span lang={(displayTopic.kind==='PLENARY_VOTE') ? voteLabel.language : 'en'}>{(displayTopic.kind==='PLENARY_VOTE') ? voteLabel.text : ui.t("legislation.debate.b7b027")}</span> · <span lang={language}>{humanDate(displayTopic.date,language)}</span></div><h2 lang={displayTopic.titleLanguage??''}>{displayTopic.title}</h2><div className="insight-dossier-links">{(detail?.procedures||[]).filter(p=>p.websiteUrl).map(p=><a key={p.id} href={p.websiteUrl!} target="_blank" rel="noreferrer"><UiMessage id="legislation.dossier_reference.15535b" values={{reference: String(p.reference ?? '')}}/></a>)}{displayTopic.documentIds.filter(id=>/^(?:A|B|RC)-|^(?:[A-Z]{3,5}|CJ\d{2})-(?:AD|AL|AM|PA|PR)-/.test(id)).map(id=><button key={id} aria-expanded={document===id&&!documentEvent} aria-controls={documentTarget(null)} onClick={event=>toggleDocument(id,null,event.currentTarget)}>{((document===id) && (!documentEvent)) ? <UiMessage id="legislation.hide_id.bbed1e" values={{id: String(id ?? '')}}/> : <UiMessage id="legislation.read_id.de4be3" values={{id: String(id ?? '')}}/>}</button>)}</div>
      {renderDocumentReader(null)}
      {detail&&<>
      {detail.procedures.filter(p=>/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(p.reference||'')).slice(0,2).map(procedure=><ProcedureContext key={procedure.id} reference={procedure.reference!} language={language} onTopic={topic=>{setOfficialTopic(topic.id);setTrendTopic(topic.id);setTrendWeek('');setTrendSearch('');setTrendDossier(null);chooseMode('trends');}}/>)}
      {detail.phase==='upcoming'&&<p className="insight-upcoming-label"><UiMessage id="legislation.scheduled_for_date.4b514b" values={{date: <span lang={language}>{humanDate(detail.date,language)}</span>}}/></p>}
      <div className="insight-contribution-scope"><div className="insight-controls insight-detail-country"><CountryFilter country={country} onChange={chooseCountry} language={language}/></div>{country&&<div className="insight-active-filters"><button onClick={()=>chooseCountry(null)}><UiMessage id="legislation.meps_elected_in_countryname.9c4b7d" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/></button><span><UiMessage id="legislation.shownpeople_of_totalpeople_contributors_shownspeeches_of_totalspeeches_listed_speeche.8f434c" values={{shownPeople: shownPeople.length, totalPeople: contributors!.people.length, shownSpeeches: shownSpeeches.length, totalSpeeches: detail.speeches.length}}/></span></div>}</div>
      {detail.kind==='PLENARY_VOTE'&&<TopicVotes detail={detail} route={detailRoute} country={country} language={language} onMember={props.onMember} today={today} retry={selected.retry}/>}
      {speechAvailability&&<p className="insight-secondary" role={(speechAvailability.state==='error') ? 'alert' : undefined}>{speechAvailability.message}{earlierSpeeches&&ui.t("legislation.earlier_linked_speeches_are_shown_below.9b2bcd")}{speechAvailability.state==='error'&&<> <button onClick={selected.retry}><UiMessage id="commissionfollowups.try_again"/></button></>}</p>}
      <TextSearch prefix="agenda-fts" label={ui.t("legislation.search_linked_speeches.1d2a60")} language={language} kinds={['speech']} scopeIdentity={detail.id+':'+(country||'')} sourceIds={shownSpeeches.map(speech=>speech.sourceId)} disabledReason={(!shownSpeeches.length) ? ui.t("legislation.no_linked_speeches_are_available_for_this_selection.a6a717") : undefined}/>
      {detail.coverage.speechAssociations.sources.length>0&&<SpeechCloud key={detail.id} sitting={topicSitting} topic={detail.id} country={country} interfaceLanguage={language} onSpeakers={rememberSpeakers} onSpeechSpeakers={rememberSpeechSpeakers}/>}
      {shownSpeeches.length>0&&<section className="insight-speech-panel"><h3>{earlierSpeeches ? <UiMessage id="legislation.earlier_speeches_count_listed.d1e6bd" values={{count:<small>{shownSpeeches.length}</small>}} counts={{count:shownSpeeches.length}}/> : <>{ui.t("dossieractivity.speeches")} <small><UiMessage id="legislation.count_listed.703e33" values={{count:shownSpeeches.length}}/></small></>}</h3>
        <nav className="insight-speech-pager" aria-label={ui.t("dossieractivity.speeches")} ref={speechTop}>
          <button aria-label={ui.t("legislation.previous_speech.52d5e7")} aria-disabled={speechIndex<=0} onClick={()=>pageSpeech(-1)}><span aria-hidden="true">‹</span></button>
          <div className="insight-speech-position"><strong aria-live="polite" aria-atomic="true"><UiMessage id="legislation.speech_speechnumber_of_count.73b64d" values={{speechNumber: (speechIndex+1), count: shownSpeeches.length}}/></strong>{currentSpeech&&<span lang="">{speechLabel(currentSpeech)}</span>}</div>
          <button aria-label={ui.t("legislation.next_speech.4ed12e")} aria-disabled={speechIndex<0||speechIndex===shownSpeeches.length-1} onClick={()=>pageSpeech(1)}><span aria-hidden="true">›</span></button>
        </nav>
        <details className="insight-speech-jump" ref={speechJump}><summary ref={speechJumpSummary}><UiMessage id="legislation.jump_to_speech.193a38"/></summary><ol>{shownSpeeches.map(s=><li key={s.sourceId}><button lang="" aria-current={(s.sourceId===speech) ? 'true' : undefined} onClick={()=>{setSpeech(s.sourceId);if(speechJump.current)speechJump.current.open=false;speechJumpSummary.current?.focus({preventScroll:true});}}>{speechLabel(s)}</button></li>)}</ol></details>
        {currentSpeech&&<><InsightSpeechReader key={speech} id={currentSpeech.sourceId} language={language} onSpeakers={rememberSpeakers}/>
          <nav className="insight-speech-pager insight-speech-pager-bottom" aria-label={ui.t("legislation.speeches_bottom.166999")}>
            <button aria-label={ui.t("legislation.previous_speech.52d5e7")} aria-disabled={speechIndex<=0} onClick={()=>pageSpeech(-1,true)}><span aria-hidden="true">‹</span>  <UiMessage id="textsearch.previous"/></button>
            <span>{speechIndex+1} / {shownSpeeches.length}</span>
            <button aria-label={ui.t("legislation.next_speech.4ed12e")} aria-disabled={speechIndex===shownSpeeches.length-1} onClick={()=>pageSpeech(1,true)}><UiMessage id="textsearch.next"/> <span aria-hidden="true">›</span></button>
          </nav></>}
      </section>}
      <section className="insight-participants"><div className="insight-section-heading"><h3><UiMessage id="legislation.who_is_involved.e6f55b"/></h3><label className="insight-contribution-filter"><UiMessage id="legislation.contribution.982d5a"/><select value={contribution} onChange={event=>setContribution(event.target.value as typeof contribution)}><option value="all"><UiMessage id="legislation.all_contributors.267ac6"/></option><option value="committee"><UiMessage id="legislation.committee_amendment_authors.d966d1"/></option><option value="plenary"><UiMessage id="legislation.plenary_amendment_authors.11da35"/></option></select></label><span>{shownPeople.length ? <>{<UiMessage id="legislation.count_people.83f265" values={{count: shownPeople.length}} counts={{count: shownPeople.length}}/>}</> : (country ? ui.t("textsearch.no_matches") : ui.t("legislation.no_records_yet.e619c5"))}</span></div><InsightPeople previewCount={6} people={shownPeople.map(p=>({...p,name:((!p.currentMep) && speakerNames[p.id]) ? speakerNames[p.id] : p.name,office:(!p.currentMep) ? legislationOffice(detail,speechHeaders,p.id,language, ui)?.text : null,officeLanguage:(!p.currentMep) ? legislationOffice(detail,speechHeaders,p.id,language, ui)?.language : null}))} language={language} onMember={props.onMember} roles={contributors!.roles} renderSecondary={person=><><ContributorActivity detail={detail} headers={speechHeaders} person={person.id} language={language} onSpeech={id=>{setSpeech(id);requestAnimationFrame(()=>{speechTop.current?.scrollIntoView({block:'start'});const heading=speechTop.current?.querySelector<HTMLElement>('.insight-speech-position strong');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}});}}/><DossierWorkLinks references={detail.procedures.filter(p=>p.reference).map(p=>({id:p.id,reference:p.reference!}))} person={person.id} language={language}/></>}/>{!shownPeople.length&&<p><UiMessage id="legislation.no_matching_contributors.b162e0"/></p>}</section>
      {!shownSpeeches.length&&detail.speeches.length>0&&country&&<p className="insight-secondary"><UiMessage id="legislation.no_listed_speeches_match_this_country_filter.5e7efa"/></p>}
      {detail.committeeWork.length>0&&<section className="insight-committee-work"><h3><UiMessage id="legislation.committee_work.df8696"/></h3><ol>{detail.committeeWork.map(event=><li key={event.id}><time lang={language}>{humanDate(event.date,language)}</time><div><strong>{committeeAction(event.kind, ui)}</strong>{event.committees?.map(c=><p key={c.code}>{c.websiteUrl ? <a lang="" href={c.websiteUrl} target="_blank" rel="noreferrer">{c.code} · {c.name.replace(/^Committee on /,'')} ↗</a> : c.code}</p>)}<div className="insight-document-links">{event.documentIds.map(id=><button key={id} aria-expanded={document===id&&documentEvent===event.id} aria-controls={documentTarget(event.id)} onClick={click=>toggleDocument(id,event.id,click.currentTarget)}>{((document===id) && (documentEvent===event.id)) ? <UiMessage id="legislation.hide_id.bbed1e" values={{id: String(id ?? '')}}/> : <UiMessage id="legislation.read_id.de4be3" values={{id: String(id ?? '')}}/>}</button>)}{!event.documentIds.length&&detail.procedures.find(p=>p.id===event.procedureId)?.websiteUrl&&<a href={detail.procedures.find(p=>p.id===event.procedureId)!.websiteUrl!} target="_blank" rel="noreferrer"><UiMessage id="legislation.dossier.6a6fa3"/></a>}</div>{event.documentIds.map(id=><CommitteeAmendments key={id} id={id} procedure={event.procedureId} language={language}/>)}{renderDocumentReader(event.id)}</div></li>)}</ol></section>}
      {!country&&detail.kind!=='PLENARY_VOTE'&&<ContributorAnalysis stats={contributors!.stats} language={language}/>}
      {(detail.coverage.speechAssociations.truncated||sourceRecordsUnavailable)&&<p className="insight-secondary" lang={ui.language}>{[
        detail.coverage.speechAssociations.truncated&&ui.t("legislation.selected_debates_only.fc5bc9"),
        sourceRecordsUnavailable&&ui.t("legislation.some_records_unavailable.eb8aa3"),
      ].filter(Boolean).join(' · ')}</p>}
    </>}</>}</section></div></div>}
  </InsightShell>;
}

function agendaSummaryKey(unavailable:boolean,partial:boolean,upcoming:boolean) {
  if(unavailable)return partial ? (upcoming?'legislation.agenda_unavailable_partial_upcoming.976fc2':'legislation.agenda_unavailable_partial.eb9071') : (upcoming?'legislation.agenda_unavailable_upcoming.d27b89':'legislation.agenda_unavailable.eca2fa');
  return partial ? (upcoming?'legislation.count_agenda_items_partial_upcoming.f82584':'legislation.count_agenda_items_partial.0f8e0a') : (upcoming?'legislation.count_agenda_items_upcoming.f32904':'legislation.count_agenda_items.2d249f');
}
