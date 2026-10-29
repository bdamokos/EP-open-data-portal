import {legislationContributors,legislationOffice,mergeSpeechSpeakers,orderLegislationPeople,type SpeechHeaders,type SpeechSpeaker} from './legislationContributors.mjs';
import {PersonName,usePersonName} from './PersonName';
import {selectLanguageText} from './language.mjs';
import {matchesCountry} from './countries.mjs';
import {useExplorerParam} from './explorerUrl';
import {PlenaryLiveBanner,ScheduledNow} from './PlenaryLive';
import {useState,useEffect,useLayoutEffect,useRef,useCallback,useId} from 'react';
import {plenaryModes,plenaryModeTitles,type PlenaryMode} from './plenaryModes';
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
import {DossierActivity,DossierWorkLinks} from './DossierActivity';
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
const contributionTime=(value:string|null,language:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Brussels'}).format(new Date(value)):null;
const positions={for:'For',against:'Against',abstaining:'Abstaining'};
const committeeAction=(kind:string)=>({COMMITTEE_TABLING_REPORT:'Draft report',COMMITTEE_TABLING_OPINION:'Draft opinion',COMMITTEE_TABLING_AMENDMENT:'Amendments',COMMITTEE_ADOPTING_REPORT:'Report adopted',COMMITTEE_ADOPTING_OPINION:'Opinion adopted',COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT:'Provisional agreement'} as Record<string,string>)[kind]||'Committee decision';
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
function ContributorAnalysis({stats,language}:{stats:InsightStats;language:string}) {
  if(stats.denominator<=0&&!(stats.groupContributions?.total))return null;
  return <details className="insight-author-analysis" open><summary>About the contributors</summary><InsightDemographics stats={stats} language={language}/></details>;
}
function VoteView({vote,language,onMember,country}:{country:string|null;vote:NamedVote;language:string;onMember:InsightProps['onMember']}) {
  const [position,setPosition]=useState<keyof typeof positions>('for'),[group,setGroup]=useState<string|null>(null),[showPeople,setShowPeople]=useState(false),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null),browse=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setPosition('for');setGroup(null);setShowPeople(false);},[vote.id,country]);
  const choices=Object.keys(positions) as (keyof typeof positions)[];
  const countryPeople=(p:keyof typeof positions)=>(vote.groups?.[p]||[]).filter(person=>matchesCountry(country,person.country));
  const groupPeople=(code:string,p:keyof typeof positions)=>(vote.politicalGroups?.find(row=>row.code===code)?.positions[p]||[]).filter(person=>matchesCountry(country,person.country));
  const people=countryPeople(position),filtered=group?groupPeople(group,position):people;
  const groups=(vote.politicalGroups||[]).map(row=>row.code).filter(code=>choices.some(p=>groupPeople(code,p).length)).sort((a,b)=>choices.reduce((n,p)=>n+groupPeople(b,p).length-groupPeople(a,p).length,0)||a.localeCompare(b));
  function choose(p:keyof typeof positions,g:string|null){const active=document.activeElement;if(active instanceof HTMLButtonElement&&!active.closest('.insight-voter-list'))opener.current=active;setPosition(p);setGroup(g);setShowPeople(true);requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});});}
  const titles={...vote.titles,...Object.fromEntries(Object.entries(vote.subjects).filter(([,text])=>text.trim()))};
  const label=interfaceTerm('vote',language),title=selectLanguageText(titles,language,label.text,label.language);
  return <section className="insight-vote-detail" lang="en">
    <h3 lang={title.language}>{title.text}</h3>
    <p className="insight-record-meta"><span lang={voteScope(vote.scope,language).language}>{voteScope(vote.scope,language).text}</span><span lang={language}>{humanDate(vote.date,language)}</span><span>{vote.outcome.toLowerCase()}</span></p>
    <div className="insight-vote-totals">{choices.map(p=><div key={p} className={'vote-'+p}><h3>{positions[p]} <strong>{country?countryPeople(p).length:vote.aggregateTotals[p]??'—'}</strong></h3>{country&&<small>of {vote.aggregateTotals[p]??'—'} across Parliament</small>}</div>)}</div>
    {vote.namedVotersAvailable&&<><h4>Political groups</h4><p className="insight-chart-caption">{country?<>Named voters elected in <span lang={language}>{countryName(country,language)}</span></>:'Named voters across Parliament'}. Select a count to see the MEPs.</p><div className="insight-vote-matrix"><div className="insight-vote-matrix-head"><span>Political group</span>{choices.map(p=><span key={p}>{positions[p]}</span>)}</div>{groups.map(code=>{const counts=choices.map(p=>groupPeople(code,p).length),total=counts.reduce((sum,n)=>sum+n,0);return <div className="insight-vote-group-row" key={code}><span lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(code)?'en':''}><i style={{background:groupColor(code)}}/>{groupLabel(code)}</span>{choices.map((p,index)=><button lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(code)?'en':''} key={p} className={'vote-'+p} style={{backgroundSize:`${counts[index]/Math.max(1,total)*100}% 100%`}} aria-label={`${groupLabel(code)}, ${positions[p].toLowerCase()}: ${counts[index]} ${counts[index]===1?'MEP':'MEPs'}`} aria-pressed={showPeople&&position===p&&group===code} disabled={!counts[index]} onClick={()=>choose(p,code)}>{counts[index]}</button>)}</div>;})}</div>{!groups.length&&<p>No named voters in this election country.</p>}{!showPeople&&groups.length>0&&<button ref={browse} className="insight-text-button" onClick={()=>choose(choices.find(p=>countryPeople(p).length>0)||'for',null)}>Browse voters</button>}</>}
    {vote.namedVotersAvailable&&!vote.totalsMatchNamed&&<p className="insight-secondary">The named-voter list differs from Parliament’s published totals.</p>}
    {vote.namedVotersAvailable&&showPeople&&<section className="insight-voter-list"><div className="insight-section-heading"><h3 ref={heading} tabIndex={-1}>{positions[position]}{group?<> · <span lang={['NI','TheLeft','Verts/ALE','Unknown','unavailable'].includes(group)?'en':''}>{groupLabel(group)}</span></>:''} <small>{filtered.length} MEPs</small></h3><button className="insight-text-button" onClick={()=>{setShowPeople(false);requestAnimationFrame(()=>{const target=opener.current?.isConnected?opener.current:browse.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});});}}>Hide voters</button></div><div className="insight-chart-switch" role="group" aria-label="Vote position">{choices.map(p=><button key={p} aria-pressed={position===p} onClick={()=>choose(p,group)}>{positions[p]}</button>)}</div>{group&&<button className="insight-text-button" onClick={()=>setGroup(null)}>All groups</button>}<InsightPeople key={vote.id+position+(group||'')} people={filtered} language={language} onMember={onMember}/>{!filtered.length&&<p>No named voters in this selection.</p>}</section>}
    {!vote.namedVotersAvailable&&<p>Individual votes unavailable.</p>}
    <details><summary>Vote corrections</summary>{choices.map(p=>vote.intendedCorrections[p].length?<p key={p}>Intended {positions[p].toLowerCase()}: {vote.intendedCorrections[p].map((x,index)=><span key={x.id} lang={x.name?'':'en'}>{index?', ':''}{x.name||'MEP'}</span>)}.</p>:null)}{!Object.values(vote.intendedCorrections).some(a=>a.length)&&<p>No corrections.</p>}</details>
  </section>;
}
function SittingCloud({sitting,sittings,agendaPeriod,language,onSearchScopeChange,latestAvailable=true}:{latestAvailable?:boolean;agendaPeriod:string;sitting:string;sittings:LegislationResponse['sittings'];language:string;onSearchScopeChange:()=>void}) {
  const [country,setCountry]=useExplorerParam<string|null>('cloud-country',null);
  // Explicit sitting links retain their day; unselected visits default to the latest plenary week.
  const [period,setPeriod]=useExplorerParam('cloud-period',agendaPeriod.startsWith('week:')?agendaPeriod:sitting?'sitting:'+sitting:weekPeriod(latestHeldSitting(sittings,latestAvailable))),[kind,value]=[period.slice(0,period.indexOf(':')),period.slice(period.indexOf(':')+1)];
  function chooseCountry(value:string|null){if(value!==country)onSearchScopeChange();setCountry(value);}
  function choosePeriod(value:string){if(value!==period)onSearchScopeChange();setPeriod(value);}
  const controls=<><PlenaryPeriodSelect value={period} sittings={sittings} language={language} onChange={choosePeriod}/><CountryFilter country={country} onChange={chooseCountry} language={language}/></>;
  return <section className="insight-sitting-cloud">{country&&<div className="insight-active-filters" lang="en"><button onClick={()=>chooseCountry(null)}>MEPs elected in <span lang={language}>{countryName(country,language)}</span> ×</button></div>}{value?<SpeechCloud title={false} controls={controls} {...(kind==='week'?{week:value}:{sitting:value})} country={country} interfaceLanguage={language}/>:<><div className="explorer-cloud-controls">{controls}</div><p lang="en">Latest week unavailable. Choose a period.</p></>}</section>;
}
function TopicVotes({detail,route,country,language,onMember,today,retry}:{detail:NonNullable<LegislationResponse['detail']>;route:string;country:string|null;language:string;onMember:InsightProps['onMember'];today:string;retry:()=>void}) {
  const [vote,setVote]=useExplorerParam<string>('agenda-vote','');
  const requested=Boolean(vote&&vote!==detail.selectedVote?.id);
  // Vote changes must not clear the agenda item or remount its dossier and speeches.
  const selected=useInsightData<LegislationResponse>(requested&&detail.votes.length?route+'&vote='+encodeURIComponent(vote):null);
  const shown=requested?selected.data?.detail?.selectedVote:detail.selectedVote;
  const availability=plenaryAvailability(detail,'vote',today);
  return <section lang="en" aria-busy={requested&&selected.loading}><h2>{detail.votes.length?'How MEPs voted':'Voting results'}</h2>{detail.votes.length?<><label className="insight-vote-select">Vote<select value={vote||detail.selectedVote?.id||''} onChange={e=>setVote(e.target.value)}>{detail.votes.map(v=><option lang="" key={v.id} value={v.id}>{voteScope(v.scope,language).text} · {v.subject||v.title}</option>)}</select></label><InsightStatus loading={requested&&selected.loading&&!shown} error={requested?selected.error:null} retry={selected.retry}/>{shown&&<VoteView country={country} vote={shown} language={language} onMember={onMember}/>}</>:availability&&<p role={availability.state==='error'?'alert':undefined}>{availability.message}{availability.state==='error'&&<> <button onClick={retry}>Try again</button></>}</p>}</section>;
}
export function Legislation(props:InsightProps&{members?:DirectoryMember[]}) {
  const today=usePlenaryDate();
  const [dossierMetadata,setDossierMetadata]=useState<DossierReference|null>(null);
  const displayName=usePersonName();
  const readerId=useId(),speechTop=useRef<HTMLElement>(null),speechJump=useRef<HTMLDetailsElement>(null),speechJumpSummary=useRef<HTMLElement>(null);
  const [country,setCountry]=useExplorerParam<string|null>('agenda-country',null);
  const [mode,setMode]=useExplorerParam<PlenaryMode>('pl-mode','agenda',plenaryModes),[officialTopic,setOfficialTopic]=useExplorerParam<string|null>('trend-source',null),[referenceDraft,setReferenceDraft]=useState(''),[reference,setReference]=useExplorerParam<string>('dossier-ref',''),[referenceError,setReferenceError]=useState('');
  const pageTitle=plenaryModeTitles[mode];
  useEffect(()=>{window.document.title=`${pageTitle} — European Parliament data explorer`;},[pageTitle]);
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
  const selectedViewPeriod=mode==='participation'?hotPeriod:mode==='cloud'?cloudPeriod:'';
  const params=new URLSearchParams({lang:language});
  if(mode==='agenda'&&(agendaPeriod.startsWith('week:')||!agendaPeriod&&!sitting))params.set('week',agendaPeriod.slice(5)||'latest');
  else if(agendaPeriod.startsWith('sitting:')&&mode==='agenda')params.set('sitting',agendaPeriod.slice(8));
  else if(selectedViewPeriod.startsWith('sitting:'))params.set('sitting',selectedViewPeriod.slice(8));
  else if(selectedViewPeriod.startsWith('week:'))params.set('week',selectedViewPeriod.slice(5));
  else if(sitting)params.set('sitting',sitting);
  const base=useInsightData<LegislationResponse|LegislationNavigationResponse>(['agenda','cloud','participation'].includes(mode)?'insights/legislation?'+params:null,sameAgendaRoute),navigation=base.data,data=navigation?.sitting?navigation as LegislationResponse:null;
  // Retain navigation only: results remain fenced to the current request by useInsightData.
  const [agendaSittings,setAgendaSittings]=useState<LegislationResponse['sittings']>([]);
  useEffect(()=>{if(navigation)setAgendaSittings(navigation.sittings);},[navigation]);
  const requestedWeek=params.get('week'),requestedSitting=params.get('sitting');
  const selectedPeriod=requestedWeek==='latest'&&data?(data.week?'week:'+data.week:'sitting:'+data.sitting.id):requestedWeek?'week:'+requestedWeek:'sitting:'+(requestedSitting||data?.sitting.id||'');
  const selectedTopic=data?.topics.find(item=>item.id===topic);
  const topicSitting=selectedTopic?.sittingId||data?.sitting.id||sitting||'';
  const detailRoute=agendaItemRoute(language,topicSitting,topic);
  const selected=useInsightData<LegislationResponse>(mode==='agenda'&&topic&&data?detailRoute:null),detail=selected.data?.detail,displayTopic=detail||selectedTopic,detailRef=useRef<HTMLElement>(null),agendaRef=useRef<HTMLElement>(null),detailNavRef=useRef<HTMLDivElement>(null);
  const focusEpoch=useRef(0),detailFocusEpoch=useRef(0);
  const documentFocus=useRef<{target:string;opener:HTMLButtonElement|null;opening:boolean;epoch:number;scope:string}|null>(null);
  const documentScope=JSON.stringify([mode,topic,language,displayTopic?.id]);
  const documentTarget=(event:string|null)=>readerId+(event?'-committee-'+encodeURIComponent(event):'-agenda');
  function toggleDocument(id:string,event:string|null,opener:HTMLButtonElement|null=null) {
    const opening=document!==id||documentEvent!==event,target=documentTarget(event);
    // A restored journey may have remounted its original trigger.
    const trigger=opener||[...detailRef.current?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]')||[]].find(button=>button.getAttribute('aria-controls')===target)||null;
    documentFocus.current={target,opener:trigger,opening,epoch:focusEpoch.current,scope:documentScope};
    setDocument(opening?id:null);setDocumentEvent(opening?event:null);
  }
  useLayoutEffect(()=>{
    const intent=documentFocus.current;documentFocus.current=null;
    if(!intent||intent.scope!==documentScope||intent.epoch!==focusEpoch.current||dossierJourneyRestoring())return;
    const target=intent.opening?window.document.getElementById(intent.target):intent.opener;
    if(target?.isConnected&&!target.hidden){target.focus({preventScroll:true});target.scrollIntoView({block:intent.opening?'start':'nearest',behavior:'instant'});}
  },[document,documentEvent,documentScope]);
  function renderDocumentReader(event:string|null) {
    const active=Boolean(document&&documentEvent===event);
    return <div id={documentTarget(event)} hidden={!active} tabIndex={-1} role="region" aria-label={active?'Document '+document:undefined}>{active&&<><button className="insight-text-button" onClick={()=>toggleDocument(document!,event)}>Close document</button><InsightQuestionReader key={document} id={document!} member={documentMember} language={language} heading={'Document '+document}/></>}</div>;
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
  useEffect(()=>{setSpeech(dossierJourneyRestoring()?dossierReaderValue('agenda-speech',detail?.speeches[0]?.sourceId||null):detail?.speeches[0]?.sourceId||null);setDocument(dossierJourneyRestoring()?dossierReaderValue('agenda-document',null):null);setDocumentEvent(dossierJourneyRestoring()?dossierReaderValue('agenda-document-event',null):null);if(!dossierJourneyRestoring()&&displayTopic&&innerWidth<=1000&&focusEpoch.current===detailFocusEpoch.current){detailRef.current?.focus({preventScroll:true});detailNavRef.current?.scrollIntoView({block:'start'});}},[displayTopic?.id]);
  const [speakerNames,setSpeakerNames]=useState<Record<string,string>>({}),[speechHeaders,setSpeechHeaders]=useState<SpeechHeaders>({});
  useEffect(()=>{setSpeakerNames({});setSpeechHeaders({});},[detail?.id]);
  const rememberSpeechSpeakers=useCallback((speeches:{id:string;people:SpeechSpeaker[]}[])=>{setSpeechHeaders(previous=>mergeSpeechSpeakers(previous,speeches));},[]);
  const rememberSpeakers=useCallback((people:(SpeechSpeaker&{name:string})[],speechId?:string)=>{setSpeakerNames(previous=>{const changed=people.filter(p=>previous[p.id]!==p.name);return changed.length?{...previous,...Object.fromEntries(changed.map(p=>[p.id,p.name]))}:previous;});if(speechId)rememberSpeechSpeakers([{id:speechId,people}]);},[rememberSpeechSpeakers]);
  const contributors=detail?legislationContributors(detail,speechHeaders):null;
  const sourceRecordsUnavailable=Boolean(detail&&(detail.voteCoverage.truncated||detail.coverage.roleRowsTruncated||detail.coverage.gaps.length>0||detail.coverage.missingDocumentIds?.length));
  const speechAvailability=detail?.kind==='PLENARY_DEBATE'?plenaryAvailability(detail,'speech',today):null;
  const earlierSpeeches=Boolean(detail?.speeches.length&&detail.speeches.every(s=>s.date<detail.date));
  const shownPeople=contributors?orderLegislationPeople(contributors.people,contributors.roles,props.members).filter(p=>matchesCountry(country,p.country)):[],shownSpeeches=detail?.speeches.filter(s=>!country||s.people.some(p=>matchesCountry(country,p.country)))||[];
  useEffect(()=>{setSpeech(dossierJourneyRestoring()?dossierReaderValue('agenda-speech',shownSpeeches[0]?.sourceId||null):shownSpeeches[0]?.sourceId||null);},[country,detail?.id]);
  const speechIndex=shownSpeeches.findIndex(s=>s.sourceId===speech),currentSpeech=shownSpeeches[speechIndex];
  const speechLabel=(s:typeof shownSpeeches[number])=>(s.people.map(p=>displayName(p.id,p.currentMep?p.name:speakerNames[p.id]||p.name)||'Speaker').join(', ')||'Speech')+(contributionTime(s.start,language)?` · ${contributionTime(s.start,language)} Brussels`:'')+(s.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT'?' · Written statement':'');
  function pageSpeech(offset:number,scroll=false){
    const next=shownSpeeches[speechIndex+offset];
    if(speechIndex<0||!next)return;
    setSpeech(next.sourceId);
    if(scroll)requestAnimationFrame(()=>speechTop.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
  }
  const documentMember=detail?.people.find(p=>p.currentMep)?.id;
  function chooseAgendaTopic(id:string){if(id!==topic)resetSearchPosition();if(data?.week)setAgendaPeriod('week:'+data.week);setTopic(id);setVote('');}
  function showAgenda(){
    const opener=agendaRef.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]');
    chooseAgendaTopic('');
    window.requestAnimationFrame(()=>{if(opener?.isConnected){opener.focus({preventScroll:true});opener.scrollIntoView({block:'nearest'});}else agendaRef.current?.scrollIntoView({block:'start'});});
  }
  function chooseAgendaPeriod(period:string){resetSearchPosition();setAgendaPeriod(period);setSitting(period.startsWith('sitting:')?period.slice(8):'');setTopic('');setVote('');}
  function chooseCountry(value:string|null){if(value!==country)resetSearchPosition();setCountry(value);}
  function chooseMode(next:typeof mode){if(next!==mode)resetSearchPosition();setMode(next);}
  return <InsightShell {...props} view="legislation" title={pageTitle}><PlenaryLiveBanner language={language}/><nav className="insight-chart-switch insight-mode-nav" lang="en" aria-label="Explore plenary"><button aria-pressed={mode==='agenda'} onClick={()=>chooseMode('agenda')}>Agenda</button><button aria-pressed={mode==='participation'} onClick={()=>chooseMode('participation')}>What’s hot</button><button aria-pressed={mode==='cloud'} onClick={()=>chooseMode('cloud')}>Word cloud</button><button aria-pressed={mode==='trends'} onClick={()=>chooseMode('trends')}>Topic timeline</button><button aria-pressed={mode==='dossier'} onClick={()=>chooseMode('dossier')}>Dossiers</button></nav>{mode==='agenda'&&<div className="insight-controls" lang="en"><PlenaryPeriodSelect value={selectedPeriod} sittings={navigation?.sittings||agendaSittings} language={language} onChange={chooseAgendaPeriod} includeLatest/>{data&&<span>{data.coverage.agendaError&&!data.topics.length?'Agenda unavailable':data.topics.length+' agenda items'}{data.week&&!data.coverage.agendaComplete?' · partial':''}{(data.agendaSittings||[data.sitting]).every(day=>day.phase==='upcoming')?' · upcoming':''}</span>}</div>}{mode==='agenda'&&('selectionUnavailable' in (navigation||{})?<p lang="en">Latest week unavailable. Choose a period.</p>:<SittingCalendarNotice complete={navigation?.coverage.catalogueComplete}/>)} {['agenda','cloud','participation'].includes(mode)&&<InsightStatus loading={base.loading&&!data} error={base.error} retry={base.retry} loadingMessage={mode==='agenda'?'Loading agenda…':undefined} errorMessage={mode==='agenda'?'Could not load this agenda. Choose another period or reload.':undefined}/>}
    {mode==='dossier'&&<section className="insight-dossier-finder" lang="en"><form className="insight-controls" noValidate onSubmit={event=>{event.preventDefault();const parsed=parseProcedureReference(referenceDraft);if(parsed.error!==undefined){setReferenceError(parsed.error);return;}setReferenceDraft(parsed.reference);setReference(parsed.reference);setReferenceError('');}}><label>Procedure reference<input value={referenceDraft} onChange={event=>{setReferenceDraft(event.target.value);setReferenceError('');}} placeholder="e.g. 2025/0407(COD)" spellCheck={false} autoComplete="off" aria-invalid={Boolean(referenceError)} aria-describedby="dossier-reference-hint"/></label><button type="submit">Open dossier</button></form><p className="insight-secondary" id="dossier-reference-hint">Paste a procedure reference or a Legislative Observatory link.{!reference&&<> Example: <button type="button" className="insight-text-button" onClick={()=>{setReferenceDraft('2025/0407(COD)');setReference('2025/0407(COD)');setReferenceError('');}}>2025/0407(COD)</button></>}</p>{referenceError&&<p role="alert">{referenceError}</p>}{reference&&<ProcedureContext key={reference} reference={reference} language={language} showTitle fallbackTitle={dossierMetadata?.reference===reference?dossierMetadata:null} onTopic={topic=>{setOfficialTopic(topic.id);setTrendTopic(topic.id);setTrendWeek('');setTrendSearch('');setTrendDossier(null);chooseMode('trends');}}><DossierActivity key={'activity:'+reference+':'+language} reference={reference} language={language} onProcedure={setDossierMetadata}/></ProcedureContext>}</section>}
    {mode==='trends'&&<TopicTrends key={officialTopic||'catalogue'} language={language} initialTopic={officialTopic}/>}
    {data&&mode==='agenda'&&data.coverage.agendaError&&<p role="alert" lang="en">{data.week?<>Agenda unavailable for <span lang={language}>{data.agendaSittings?.filter(day=>day.agendaError).map(day=>humanDate(day.date,language)).join(', ')}</span>.</>:'Agenda unavailable for this sitting.'} <button onClick={base.retry}>Reload</button></p>}
    {navigation&&mode==='cloud'&&<SittingCloud latestAvailable={navigation.coverage.latestAvailable} sitting={sitting} agendaPeriod={agendaPeriod} sittings={navigation.sittings} language={language} onSearchScopeChange={resetSearchPosition}/>}
    {navigation&&mode==='participation'&&<Participation latestAvailable={navigation.coverage.latestAvailable} language={language} sittings={navigation.sittings} onTopic={(sitting,topic)=>{resetSearchPosition();setAgendaPeriod('');setSitting(sitting);setTopic(topic);setVote('');setCountry(null);setMode('agenda');}}/>}
    {data&&mode==='agenda'&&<div className="insight-agenda-view" data-topic-selected={Boolean(topic)}><div className="insight-agenda-navigation" lang="en" ref={detailNavRef}><button className="insight-text-button" onClick={showAgenda}>Back to agenda</button><label className="insight-agenda-select" lang="en">Agenda item<select value={topic} onChange={event=>event.target.value?chooseAgendaTopic(event.target.value):showAgenda()}><option value="">All agenda items</option>{data.week?data.agendaSittings?.map(day=><optgroup lang={language} key={day.id} label={humanDate(day.date,language)}>{data.topics.filter(item=>item.sittingId===day.id).map(item=><option lang={compoundLanguage(item.kind==='PLENARY_VOTE'?voteLabel.language:'en',item.titleLanguage)} key={item.id} value={item.id}>{item.kind==='PLENARY_VOTE'?voteLabel.text:'Debate'} · {item.title}</option>)}</optgroup>):data.topics.map(item=><option lang={compoundLanguage(item.kind==='PLENARY_VOTE'?voteLabel.language:'en',item.titleLanguage)} key={item.id} value={item.id}>{item.kind==='PLENARY_VOTE'?voteLabel.text:'Debate'} · {item.title}</option>)}</select></label></div><div className="insight-legislation-grid"><aside ref={agendaRef} className="insight-agenda" lang="en" aria-label="Sitting agenda">{(data.agendaSittings||[data.sitting]).map(day=><div key={day.id}>{data.week&&<h3 lang={language}>{humanDate(day.date,language)}</h3>}{data.topics.filter(item=>!data.week||item.sittingId===day.id).map(t=><button key={t.id} aria-pressed={topic===t.id} onPointerEnter={event=>{if(event.pointerType!=='touch')preloadAgendaTopic(t);}} onPointerLeave={cancelHover} onFocus={()=>preloadAgendaTopic(t)} onBlur={cancelHover} onClick={()=>chooseAgendaTopic(t.id)}><ScheduledNow id={t.id}/><small lang={t.kind==='PLENARY_VOTE'?voteLabel.language:'en'}>{t.kind==='PLENARY_VOTE'?voteLabel.text:'Debate'}</small><strong lang={t.titleLanguage??''}>{t.title}</strong></button>)}{data.week&&'agendaError' in day&&day.agendaError&&<p>Agenda unavailable.</p>}{!data.topics.some(item=>!data.week||item.sittingId===day.id)&&!('agendaError' in day&&day.agendaError)&&<p>{day.phase==='upcoming'?'Agenda not yet published.':'Agenda unavailable.'}</p>}</div>)}</aside>
    <section className="insight-topic-detail" lang="en" data-agenda-topic={detail?.id||''} data-agenda-pending={selected.loading?'true':undefined} ref={detailRef} tabIndex={-1}><InsightStatus loading={selected.loading&&!detail} error={selected.error} retry={selected.retry} errorMessage={selectedTopic?'Details unavailable.':undefined}/>{!displayTopic?<h2>{topic?(selected.error?'Agenda item unavailable':'Loading…'):'Choose an agenda item'}</h2>:<><div className="insight-eyebrow"><span lang={displayTopic.kind==='PLENARY_VOTE'?voteLabel.language:'en'}>{displayTopic.kind==='PLENARY_VOTE'?voteLabel.text:'Debate'}</span> · <span lang={language}>{humanDate(displayTopic.date,language)}</span></div><h2 lang={displayTopic.titleLanguage??''}>{displayTopic.title}</h2><div className="insight-dossier-links">{(detail?.procedures||[]).filter(p=>p.websiteUrl).map(p=><a key={p.id} href={p.websiteUrl!} target="_blank" rel="noreferrer">Dossier {p.reference} ↗</a>)}{displayTopic.documentIds.filter(id=>/^(?:A|B|RC)-|^[A-Z]{3,5}-(?:AD|AL|AM|PA|PR)-/.test(id)).map(id=><button key={id} aria-expanded={document===id&&!documentEvent} aria-controls={documentTarget(null)} onClick={event=>toggleDocument(id,null,event.currentTarget)}>{document===id&&!documentEvent?'Hide':'Read'} {id}</button>)}</div>
      {renderDocumentReader(null)}
      {detail&&<>
      {detail.procedures.filter(p=>/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(p.reference||'')).slice(0,2).map(procedure=><ProcedureContext key={procedure.id} reference={procedure.reference!} language={language} onTopic={topic=>{setOfficialTopic(topic.id);setTrendTopic(topic.id);setTrendWeek('');setTrendSearch('');setTrendDossier(null);chooseMode('trends');}}/>)}
      {detail.phase==='upcoming'&&<p className="insight-upcoming-label">Scheduled for <span lang={language}>{humanDate(detail.date,language)}</span></p>}
      <div className="insight-contribution-scope"><div className="insight-controls insight-detail-country"><CountryFilter country={country} onChange={chooseCountry} language={language}/></div>{country&&<div className="insight-active-filters"><button onClick={()=>chooseCountry(null)}>MEPs elected in <span lang={language}>{countryName(country,language)}</span> ×</button><span>{shownPeople.length} of {contributors!.people.length} contributors · {shownSpeeches.length} of {detail.speeches.length} listed speeches</span></div>}</div>
      {detail.kind==='PLENARY_VOTE'&&<TopicVotes detail={detail} route={detailRoute} country={country} language={language} onMember={props.onMember} today={today} retry={selected.retry}/>}
      {speechAvailability&&<p className="insight-secondary" role={speechAvailability.state==='error'?'alert':undefined}>{speechAvailability.message}{earlierSpeeches&&' Earlier linked speeches are shown below.'}{speechAvailability.state==='error'&&<> <button onClick={selected.retry}>Try again</button></>}</p>}
      <TextSearch prefix="agenda-fts" label="Search linked speeches" language={language} kinds={['speech']} scopeIdentity={detail.id+':'+(country||'')} sourceIds={shownSpeeches.map(speech=>speech.sourceId)} disabledReason={!shownSpeeches.length?'No linked speeches are available for this selection.':undefined}/>
      {detail.coverage.speechAssociations.sources.length>0&&<SpeechCloud key={detail.id} sitting={topicSitting} topic={detail.id} country={country} interfaceLanguage={language} onSpeakers={rememberSpeakers} onSpeechSpeakers={rememberSpeechSpeakers}/>}
      {shownSpeeches.length>0&&<section className="insight-speech-panel"><h3>{earlierSpeeches?'Earlier speeches':'Speeches'} <small>{shownSpeeches.length} listed</small></h3>
        <nav className="insight-speech-pager" aria-label="Speeches" ref={speechTop}>
          <button aria-label="Previous speech" aria-disabled={speechIndex<=0} onClick={()=>pageSpeech(-1)}><span aria-hidden="true">‹</span></button>
          <div className="insight-speech-position"><strong aria-live="polite" aria-atomic="true">Speech {speechIndex+1} of {shownSpeeches.length}</strong>{currentSpeech&&<span lang="">{speechLabel(currentSpeech)}</span>}</div>
          <button aria-label="Next speech" aria-disabled={speechIndex<0||speechIndex===shownSpeeches.length-1} onClick={()=>pageSpeech(1)}><span aria-hidden="true">›</span></button>
        </nav>
        <details className="insight-speech-jump" ref={speechJump}><summary ref={speechJumpSummary}>Jump to speech</summary><ol>{shownSpeeches.map(s=><li key={s.sourceId}><button lang="" aria-current={s.sourceId===speech?'true':undefined} onClick={()=>{setSpeech(s.sourceId);if(speechJump.current)speechJump.current.open=false;speechJumpSummary.current?.focus({preventScroll:true});}}>{speechLabel(s)}</button></li>)}</ol></details>
        {currentSpeech&&<><InsightSpeechReader key={speech} id={currentSpeech.sourceId} language={language} onSpeakers={rememberSpeakers}/>
          <nav className="insight-speech-pager insight-speech-pager-bottom" aria-label="Speeches, bottom">
            <button aria-label="Previous speech" aria-disabled={speechIndex<=0} onClick={()=>pageSpeech(-1,true)}><span aria-hidden="true">‹</span> Previous</button>
            <span>{speechIndex+1} / {shownSpeeches.length}</span>
            <button aria-label="Next speech" aria-disabled={speechIndex===shownSpeeches.length-1} onClick={()=>pageSpeech(1,true)}>Next <span aria-hidden="true">›</span></button>
          </nav></>}
      </section>}
      <section className="insight-participants"><div className="insight-section-heading"><h3>Who is involved</h3><span>{shownPeople.length?<>{shownPeople.length} {shownPeople.length===1?'person':'people'}</>:country?'No matches':'No records yet'}</span></div><InsightPeople previewCount={6} people={shownPeople.map(p=>({...p,name:!p.currentMep&&speakerNames[p.id]?speakerNames[p.id]:p.name,office:!p.currentMep?legislationOffice(detail,speechHeaders,p.id,language)?.text:null,officeLanguage:!p.currentMep?legislationOffice(detail,speechHeaders,p.id,language)?.language:null}))} language={language} onMember={props.onMember} roles={contributors!.roles} renderSecondary={person=><DossierWorkLinks references={detail.procedures.filter(p=>p.reference).map(p=>({id:p.id,reference:p.reference!}))} person={person.id} language={language}/>}/>{!shownPeople.length&&<p>{country?'No listed contributors match this country filter.':'No contributors listed.'}</p>}</section>
      {!shownSpeeches.length&&detail.speeches.length>0&&country&&<p className="insight-secondary">No listed speeches match this country filter.</p>}
      {detail.committeeWork.length>0&&<section className="insight-committee-work"><h3>Committee work</h3><ol>{detail.committeeWork.map(event=><li key={event.id}><time lang={language}>{humanDate(event.date,language)}</time><div><strong>{committeeAction(event.kind)}</strong>{event.committees?.map(c=><p key={c.code}>{c.websiteUrl?<a lang="" href={c.websiteUrl} target="_blank" rel="noreferrer">{c.code} · {c.name.replace(/^Committee on /,'')} ↗</a>:c.code}</p>)}<div className="insight-document-links">{event.documentIds.map(id=><button key={id} aria-expanded={document===id&&documentEvent===event.id} aria-controls={documentTarget(event.id)} onClick={click=>toggleDocument(id,event.id,click.currentTarget)}>{document===id&&documentEvent===event.id?'Hide':'Read'} {id}</button>)}{!event.documentIds.length&&detail.procedures.find(p=>p.id===event.procedureId)?.websiteUrl&&<a href={detail.procedures.find(p=>p.id===event.procedureId)!.websiteUrl!} target="_blank" rel="noreferrer">Dossier ↗</a>}</div>{renderDocumentReader(event.id)}</div></li>)}</ol></section>}
      {!country&&detail.kind!=='PLENARY_VOTE'&&<ContributorAnalysis stats={contributors!.stats} language={language}/>}
      {(detail.coverage.speechAssociations.truncated||sourceRecordsUnavailable)&&<p className="insight-secondary" lang="en">{[
        detail.coverage.speechAssociations.truncated&&'Selected debates only',
        sourceRecordsUnavailable&&'Some records unavailable',
      ].filter(Boolean).join(' · ')}</p>}
    </>}</>}</section></div></div>}
  </InsightShell>;
}
