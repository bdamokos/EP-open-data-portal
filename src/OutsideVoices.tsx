import {SourceLink} from './SourceLink';
import {Status} from './Status';
import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {useData} from './data';
import {useExplorerParam} from './explorerUrl';
import {InsightShell,InsightStatus} from './InsightShared';
import {InsightSpeechReader} from './InsightReaders';
import type {InsightProps} from './InsightTypes';
import type {OutsideAgenda,OutsideContribution,OutsideCoverage,OutsideDetail,OutsideDirectory,OutsidePerson} from './OutsideTypes';
import {clusterOutsideDays,filterOutsidePeople} from './outsideTimeline.mjs';
import type {OutsideTarget as OutsideDayTarget} from './outsideTimeline.mjs';
import {selectLanguageText} from './language.mjs';
import './OutsideVoices.css';

type OutsideTarget=OutsideDayTarget&{speechId?:string};

const groups:Record<string,string>={commission:'Commission',council:'Council presidency',eu:'Other EU institutions',leaders:'Heads of state & government',parliaments:'Other parliaments',international:'International organisations',other:'Other speakers'};
const date=(s:string,language:string)=>new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(s+'T12:00:00Z'));
const month=(s:string,language:string)=>new Intl.DateTimeFormat(language,{month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(s.slice(0,7)+'-01T12:00:00Z'));
const time=(s:string|null,language:string)=>s&&Number.isFinite(Date.parse(s))?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Brussels'}).format(new Date(s)):null;
const title=(s:{titles:Record<string,string>},language:string)=>selectLanguageText(s.titles,language,'Contribution');
// A transformed tag records a translation chain, but this response supplies no target-language metadata.
const roleLanguage=(tag:string|null|undefined)=>tag&&!/-t-/i.test(tag)?tag:'';
function Titles({contributions,language}:{contributions:OutsideContribution[];language:string}) {
  const selected=contributions.map(c=>title(c,language));
  return <>{selected.filter((value,index)=>selected.findIndex(other=>other.text===value.text)===index).map((value,index)=><Fragment key={index}>{index>0&&' · '}<span lang={value.language}>{value.text}</span></Fragment>)}</>;
}
const legislative=(a:OutsideAgenda)=>a.procedures.some(p=>['COD','CNS'].includes(p.type||''));
const procedureRef=(id:string,type:string|null)=>id.replace('-','/')+(type?`(${type})`:'');
const oeil=(id:string,type:string)=>'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference='+encodeURIComponent(procedureRef(id,type));
const itemWebsite=(c:OutsideContribution)=>c.parentDocumentId&&/^CRE-\d+-\d{4}-\d{2}-\d{2}-ITM-\d+(?:-\d+)*$/.test(c.parentDocumentId)?'https://www.europarl.europa.eu/doceo/document/'+c.parentDocumentId+'_EN.html':null;

type OutsideOpener={node:HTMLElement|null;key:string|null};
const captureOpener=():OutsideOpener=>{const node=document.activeElement instanceof HTMLElement?document.activeElement:null;return {node,key:node?.dataset.ovFocus||null};};
const availableFocusTarget=(element:HTMLElement|null|undefined):element is HTMLElement=>Boolean(element?.isConnected&&!element.closest('[hidden],[inert],[aria-hidden="true"]')&&element.getClientRects().length&&window.getComputedStyle(element).visibility!=='hidden'&&window.getComputedStyle(element).display!=='none');
const drawerFocusables=(element:HTMLElement)=>[...element.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],summary,select:not([disabled]),input:not([disabled]),textarea:not([disabled]),iframe,[tabindex]')].filter(target=>!target.matches(':disabled')&&!(target.hasAttribute('tabindex')&&target.tabIndex<0)&&availableFocusTarget(target));

function Sources({coverage}:{coverage?:OutsideCoverage}) {
  return <details className="ov-sources" lang="en"><summary>Sources & coverage{coverage&&!coverage.complete?' · partial':''}</summary><p>Plenary speeches, 2024–present. Counts cover indexed contributions.</p>{coverage?.updatedAt&&<p>Updated <span lang={new Intl.DateTimeFormat().resolvedOptions().locale}>{new Date(coverage.updatedAt).toLocaleDateString()}</span>{coverage.truncated?' · result limit reached':''}</p>}<a href="https://data.europarl.europa.eu/en/developer-corner/opendata-api" target="_blank" rel="noreferrer">European Parliament Open Data ↗</a></details>;
}
function Evidence({contribution:c,language}:{contribution:OutsideContribution;language:string}) {
  const source=c.headerSource||c.source;
  return <details className="ov-evidence" lang="en"><summary>Source</summary><dl><dt>Speech</dt><dd>{c.id}</dd><dt>Person</dt><dd>person/{c.personId}</dd><dt>Agenda item</dt><dd>{c.parentIds.join(', ')||'Not linked'}</dd>{c.reportedParentIds&&<><dt>Transcript chapter</dt><dd>{c.parentDocumentId}</dd><dt>API agenda links</dt><dd>{c.reportedParentIds.join(', ')}</dd></>}<dt>Role language</dt><dd>{c.header?.languageTag||'Unavailable'}{c.header?.original?' · original':''}</dd><dt>Retrieved</dt><dd>{source.fetchedAt}</dd></dl><SourceLink url={source.url} language={language} websiteUrl={c.websiteUrl}>Speech record</SourceLink>{c.rosterSource.sources[0]&&<> · <SourceLink url={c.rosterSource.sources[0].url} language={language}>MEP roster on {c.rosterSource.date}</SourceLink></>}</details>;
}
function Contribution({contribution:c,language,conflict=false,initiallyReading=false}:{contribution:OutsideContribution;language:string;conflict?:boolean;initiallyReading?:boolean}) {
  const [reading,setReading]=useState(initiallyReading);
  const start=time(c.start,language),end=time(c.end,language);
  return <article className="ov-contribution" data-ov-speech={c.id}><div className="ov-contribution-head"><strong lang={language}>{start?start+(end?'–'+end:''):date(c.date,language)}</strong><button lang="en" aria-expanded={reading} onClick={()=>setReading(!reading)}>{reading?'Close speech':'Read / watch'}</button></div>{c.header?.role&&<p lang={roleLanguage(c.header.languageTag)}>{c.header.role}{conflict&&<span lang="en" className="ov-conflict" title="Other contributions record a different speaking capacity"> · role differs</span>}</p>}<div className="ov-links" lang="en">{c.websiteUrl&&<a href={c.websiteUrl} target="_blank" rel="noreferrer">Speech ↗</a>}{itemWebsite(c)&&<a href={itemWebsite(c)!} target="_blank" rel="noreferrer">Debate ↗</a>}</div>{reading&&<div className="ov-speech-reader" role="region" aria-label="Speech" lang="en" tabIndex={-1}><InsightSpeechReader id={c.id} language={language}/></div>}<Evidence contribution={c} language={language}/></article>;
}
function AgendaItem({id,agenda,contributions,language,conflicts,coSpeakers=[],onPerson,speechId}:{id:string;agenda:OutsideAgenda|null;contributions:OutsideContribution[];language:string;conflicts:string[];coSpeakers?:OutsideContribution[];onPerson:(id:string)=>void;speechId?:string}) {
  const selected=title(agenda||contributions[0],language);
  return <section className="ov-item" data-ov-item={id}><h3 tabIndex={-1} lang={selected.language}>{selected.text}</h3><div className="ov-item-meta" lang="en">{agenda?.kind==='PLENARY_ACTIVITY'&&<span>Special event</span>}{agenda?.procedures.map(p=><span key={p.id} className={['COD','CNS'].includes(p.type||'')?'ov-legislative':''}>{p.type?<a href={oeil(p.id,p.type)} target="_blank" rel="noreferrer">{procedureRef(p.id,p.type)} ↗</a>:procedureRef(p.id,null)}</span>)}</div>{contributions.map(c=><Contribution key={c.id} contribution={c} language={language} conflict={conflicts.includes(c.id)} initiallyReading={c.id===speechId&&id===(c.parentIds[0]||'unlinked:'+c.id)}/>)}{coSpeakers.length>0&&<div className="ov-co-speakers" lang="en"><h4>Also speaking</h4>{coSpeakers.map(c=><button key={c.id+'|'+c.personId} onClick={()=>onPerson(c.personId)}><span lang={c.header?.name?'':'en'}>{c.header?.name||`Speaker ${c.personId}`}</span> <small lang={language}>{time(c.start,language)}</small></button>)}</div>}</section>;
}
function DayItems({data,dates,language,onPerson,speechId}:{data:OutsideDetail;dates:string[];language:string;onPerson:(id:string)=>void;speechId?:string}) {
  return <>{dates.map(d=>{
    const rows=data.contributions.filter(c=>c.date===d).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    const ids=[...new Set(rows.flatMap(c=>c.parentIds.length?c.parentIds:['unlinked:'+c.id]))];
    return <section key={d} className="ov-day" data-ov-date={d}><h2 tabIndex={-1} lang={language}>{date(d,language)}</h2>{ids.map(id=><AgendaItem key={id} id={id} agenda={data.agendas.find(a=>a.id===id)||null} contributions={rows.filter(c=>c.parentIds.includes(id)||id==='unlinked:'+c.id)} language={language} conflicts={data.person.roleConflicts} coSpeakers={data.coSpeakers.filter(c=>c.date===d&&c.parentIds.includes(id))} onPerson={onPerson} speechId={speechId}/>)}</section>;
  })}</>;
}
function Presence({people,language,start,end,onPerson,onDays}:{people:OutsidePerson[];language:string;start:string;end:string;onPerson:(id:string)=>void;onDays:(id:string,dates:string[],target?:OutsideTarget)=>void}) {
  const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(500);
  useEffect(()=>{const element=ref.current;if(!element)return;const observer=new ResizeObserver(()=>{const track=element.querySelector('.ov-track');if(track)setWidth(track.getBoundingClientRect().width);});observer.observe(element);return()=>observer.disconnect();},[]);
  // Marker labels mix names, localized dates and English; one attribute cannot express those boundaries.
  return <div className="ov-presence" ref={ref}><div className="ov-axis" lang="en"><span>Speaker</span><div lang={language}><span>{month(start,language)}</span><span>{month(end,language)}</span></div><span>Items · days</span></div>{Object.entries(groups).map(([key,label])=>{
    const list=people.filter(p=>p.capacity===key);if(!list.length)return null;
    return <section key={key}><h2 className="ov-group-title" lang="en">{label}</h2>{list.map(p=><div className="ov-person-row" key={p.id}><div className="ov-person-name"><button lang="" data-ov-focus={'person:'+p.id} onClick={()=>onPerson(p.id)}>{p.name}</button>{p.role&&<small lang={roleLanguage(p.roleLanguageTag)} title={p.role}>{p.role}</small>}</div><div className="ov-track">{clusterOutsideDays(p.days,start,end,width).map(mark=><button key={mark.dates[0]} lang="" data-ov-focus={'mark:'+p.id+':'+mark.dates.join(',')} className={'ov-mark'+(mark.formal?' ov-special':'')+(mark.legislative?' ov-has-law':'')} style={{left:mark.x}} aria-label={`${p.name}, ${mark.dates.length===1?date(mark.dates[0],language):mark.dates.length+' sitting days'}: ${mark.items} agenda ${mark.items===1?'item':'items'}${mark.formal?', special event':''}${mark.legislative?', legislative file':''}`} title={mark.dates.map(d=>date(d,language)).join(', ')} onClick={()=>onDays(p.id,mark.dates,mark.target)}><span className="ov-mark-symbol" aria-hidden="true"><span>{mark.legislative?'L':''}</span></span>{mark.dates.length>1&&<small className="ov-mark-count" aria-hidden="true">{mark.dates.length}</small>}</button>)}</div><div className="ov-person-count" lang="en"><b>{p.unlinkedContributions?(p.appearances?p.appearances+'+':'—'):p.appearances}</b> {p.appearances===1?'item':'items'} · {p.sittingDays} {p.sittingDays===1?'day':'days'}</div></div>)}</section>;
  })}</div>;
}
function Speaker({data,language,tab,setTab,monthFilter,setMonth,onPerson,onDays}:{data:OutsideDetail;language:string;tab:string;setTab:(tab:string)=>void;monthFilter:string|null;setMonth:(month:string|null)=>void;onPerson:(id:string)=>void;onDays:(id:string,dates:string[],target?:OutsideTarget)=>void}) {
  const p=data.person;
  const months:string[]=[];for(let t=new Date(p.first.slice(0,7)+'-01T12:00:00Z');t.toISOString().slice(0,7)<=p.last.slice(0,7);t.setUTCMonth(t.getUTCMonth()+1))months.push(t.toISOString().slice(0,7));
  const byMonth=months.map(m=>{
    const contributions=data.contributions.filter(c=>c.date.startsWith(m));
    return {month:m,items:new Set(contributions.flatMap(c=>c.parentIds)).size,contributions:contributions.length};
  });
  // Native option text and aria-label cannot split the localized month from the retained English suffix.
  const monthLabel=(m:typeof byMonth[number])=>`${month(m.month,language)}: ${!m.contributions?'no indexed contributions':m.items?`${m.items} agenda ${m.items===1?'item':'items'}`:`no linked agenda items, ${m.contributions} indexed ${m.contributions===1?'speech':'speeches'}`}`;
  const maxItems=Math.max(1,...byMonth.map(m=>m.items));
  const dates=[...new Set(data.contributions.map(c=>c.date))].sort().reverse().filter(d=>!monthFilter||d.startsWith(monthFilter));
  return <><div className="ov-person-heading"><h2 lang="" tabIndex={-1}>{p.name}</h2>{p.role&&<p lang={roleLanguage(p.roleLanguageTag)}>{p.role}</p>}</div><div className="ov-totals" lang="en"><span><b>{p.contributions}</b> speeches</span><span><b>{p.unlinkedContributions?(p.appearances?p.appearances+'+':'—'):p.appearances}</b> agenda items</span><span><b>{p.sittingDays}</b> sitting days</span></div><nav className="ov-tabs" lang="en" aria-label="Speaker views">{[['timeline','Timeline'],['appearances','Appearances'],['dossiers','Subjects & dossiers']].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);setMonth(null);}}>{label}</button>)}</nav><div className="ov-speaker-body">
    {p.sittingDays>6&&tab!=='dossiers'&&<label className="ov-month-filter" lang="en">Month<select lang={language==='en'?'en':''} value={monthFilter||''} onChange={event=>{setMonth(event.target.value||null);setTab('appearances');}}><option lang="en" value="">All months</option>{byMonth.map(m=><option key={m.month} lang={language==='en'?'en':''} value={m.month} disabled={!m.contributions}>{monthLabel(m)}</option>)}</select></label>}
    {tab==='timeline'&&<><div className="ov-range" lang={language}>{date(p.first,language)} – {date(p.last,language)}</div>{p.sittingDays>6&&<><h3 lang="en">Activity by month</h3><div className="ov-monthly-scroll" lang="en" role="region" aria-label="Agenda items per month" tabIndex={0}><div className="ov-monthly">{byMonth.map(m=><button key={m.month} lang={language==='en'?'en':''} onClick={()=>{setMonth(m.month);setTab('appearances');}} disabled={!m.contributions} aria-label={monthLabel(m)}><span className="ov-month-bar" aria-hidden="true"><span style={{height:(m.items?Math.max(4,m.items/maxItems*100):0)+'%'}}/></span><b aria-hidden="true">{m.items}</b><small lang={language} aria-hidden="true">{month(m.month,language)}</small></button>)}</div></div></>}<h3 lang="en">{p.sittingDays>6?'Recent speeches':'Speeches'}</h3><div className="ov-appearance-cards">{dates.slice(0,p.sittingDays>6?8:dates.length).flatMap(d=>{
      const rows=data.contributions.filter(c=>c.date===d).sort((a,b)=>(a.start||'').localeCompare(b.start||'')||a.id.localeCompare(b.id));
      return rows.map((c,index)=>{const selected=title(c,language);return <button key={c.id} data-ov-focus={'appearance:'+p.id+':'+d+':'+c.id} onClick={()=>onDays(p.id,[d],{date:d,itemId:c.parentIds[0]||'unlinked:'+c.id,speechId:c.id})}><small lang={language}>{date(d,language)}{time(c.start,language)&&<> · {time(c.start,language)}</>}</small><strong lang={selected.language}>{selected.text}</strong><span lang="en">Read speech{rows.length>1?' '+(index+1):''} →</span></button>;});
    })}</div><details className="ov-roles" lang="en"><summary>Speaking roles over time</summary>{[...data.contributions].sort((a,b)=>a.date.localeCompare(b.date)).map(c=><p key={c.id}><b lang={language}>{date(c.date,language)}</b> · <span lang={c.header?.role?roleLanguage(c.header.languageTag):'en'}>{c.header?.role||'Role not stated'}</span>{p.roleConflicts.includes(c.id)&&' · role differs'}</p>)}</details></>}
    {tab==='appearances'&&<>{monthFilter&&<button className="ov-clear" lang={language} onClick={()=>setMonth(null)}>{month(monthFilter,language)} ×</button>}{dates.map(d=><details className="ov-appearance" key={d}><summary><b lang={language}>{date(d,language)}</b><span><Titles contributions={data.contributions.filter(c=>c.date===d)} language={language}/></span></summary><DayItems data={data} dates={[d]} language={language} onPerson={onPerson}/></details>)}</>}
    {tab==='dossiers'&&[['law','Legislative files'],['other','Other subjects'],['unlinked','No dossier linked']].map(([key,label])=>{
      const items=data.agendas.filter(a=>key==='law'?legislative(a):key==='other'?a.procedureIds.length>0&&!legislative(a):a.procedureIds.length===0);
      return items.length>0&&<section className="ov-dossier-group" key={key}><h3 lang="en">{label} <small>· {items.length}</small></h3>{[...items].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>{const selected=title(a,language);return <div className="ov-dossier" key={a.id}><button data-ov-focus={'dossier:'+p.id+':'+a.id} onClick={()=>onDays(p.id,[a.date],{date:a.date,itemId:a.id})}><small lang={language}>{date(a.date,language)}</small><strong lang={selected.language}>{selected.text}</strong></button><div lang="en">{a.procedures.map(proc=>proc.type?<a key={proc.id} href={oeil(proc.id,proc.type)} target="_blank" rel="noreferrer">{procedureRef(proc.id,proc.type)} ↗</a>:<span key={proc.id}>{procedureRef(proc.id,null)} · type unavailable</span>)}</div></div>;})}</section>;
    })}
    {tab==='dossiers'&&data.contributions.some(c=>c.parentIds.some(id=>!data.agendas.some(a=>a.id===id))||!c.parentIds.length)&&<p className="ov-pending" lang="en">Some agenda links are unavailable.</p>}
    <Sources coverage={data.coverage}/></div></>;
}

export function OutsideVoices({language='en',...props}:InsightProps) {
  const term='10';
  const [person,setPerson]=useExplorerParam<string|null>('ov-person',null);
  const [tab,setTab]=useExplorerParam<string>('ov-tab','timeline',['timeline','appearances','dossiers']);
  const [monthFilter,setMonth]=useExplorerParam<string|null>('ov-month',null);
  const [search,setSearch]=useExplorerParam<string>('ov-q','');
  const [group,setGroup]=useExplorerParam<string>('ov-group','all',['all',...Object.keys(groups)]);
  const [kind,setKind]=useExplorerParam<string>('ov-kind','all',['all','special','debate']);
  const [repeat,setRepeat]=useExplorerParam<string>('ov-repeat','0',['0','1']);
  const [panel,setPanel]=useState<{id:string;dates:string[];target?:OutsideTarget}|null>(null);
  const panelReveal=useRef<typeof panel>(null),drawerContent=useRef<HTMLDivElement>(null);
  const root=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null),opener=useRef<OutsideOpener|null>(null),drawer=useRef<HTMLDivElement>(null);
  const directoryOpener=useRef<OutsideOpener|null>(null),panelReturn=useRef(false),panelOpen=useRef(Boolean(panel));panelOpen.current=Boolean(panel);
  const destination=useRef<{person:string|null;from:HTMLElement|null;returnTo?:OutsideOpener|null}|null>(null);
  const restoreOpener=(saved:OutsideOpener|null)=>{
    const equivalent=saved?.key?[...root.current?.querySelectorAll<HTMLElement>('[data-ov-focus]')||[]].find(element=>element.dataset.ovFocus===saved.key&&availableFocusTarget(element)):null;
    const fallback=[...root.current?.querySelectorAll<HTMLElement>('.ov-person-heading h2,input[type="search"],.ov-back')||[]].find(availableFocusTarget);
    const exact=saved?.node,target=availableFocusTarget(exact)?exact:equivalent||fallback;
    target?.focus({preventScroll:true});
    if(target&&(target===exact||target===equivalent))target.scrollIntoView({block:'nearest'});
  };
  const closePanel=()=>{panelReturn.current=true;setPanel(null);};
  const backToDirectory=()=>{destination.current={person:null,from:document.activeElement instanceof HTMLElement?document.activeElement:null,returnTo:directoryOpener.current};setPerson(null);};
  const directory=useData<OutsideDirectory>(`outside/directory?lang=${language}&term=${term}`);
  const detail=useData<OutsideDetail>(person&&/^[1-9]\d{0,12}$/.test(person)?`outside/${person}?lang=${language}&term=10`:null);
  const panelData=useData<OutsideDetail>(panel?`outside/${panel.id}?lang=${language}&term=10`:null);
  useEffect(()=>{document.querySelector('.explorer-insights')?.scrollTo({top:0});},[person]);
  // The existing person scroll reset must finish before explicit return focus.
  useEffect(()=>{
    const intent=destination.current;if(!intent)return;
    destination.current=null;if(intent.person!==person)return;
    if(document.activeElement!==document.body&&document.activeElement!==intent.from)return;
    if('returnTo' in intent)restoreOpener(intent.returnTo||null);
    else (root.current?.querySelector<HTMLElement>('.ov-person-heading h2')||root.current?.querySelector<HTMLElement>('.ov-back'))?.focus({preventScroll:true});
  },[person,detail.data,panel]);
  useEffect(()=>{if(!panel&&panelReturn.current){panelReturn.current=false;restoreOpener(opener.current);}},[panel]);
  const activeData=panel?panelData:person?detail:directory;
  useEffect(()=>{if(activeData.error||activeData.data&&(activeData.data.coverage.complete||!activeData.data.coverage.pending))return;const timer=setInterval(activeData.retry,15000);return()=>clearInterval(timer);},[activeData.error,activeData.data?.coverage.complete,activeData.data?.coverage.pending,activeData.retry]);
  useEffect(()=>{if(!panel)return;close.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){if([...drawer.current?.querySelectorAll<HTMLElement>('.legal-reference-card')||[]].some(availableFocusTarget))return;event.preventDefault();closePanel();}if(event.key==='Tab'&&drawer.current){const focusable=drawerFocusables(drawer.current);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[panel]);
  useEffect(()=>{
    if(!panel||panelReveal.current!==panel||!panel.target||panelData.data?.person.id!==panel.id)return;
    const content=drawerContent.current;
    const day=[...content?.querySelectorAll<HTMLElement>('[data-ov-date]')||[]].find(node=>node.dataset.ovDate===panel.target!.date);
    const item=panel.target.itemId?[...day?.querySelectorAll<HTMLElement>('[data-ov-item]')||[]].find(node=>node.dataset.ovItem===panel.target!.itemId):null;
    const speech=panel.target.speechId?[...item?.querySelectorAll<HTMLElement>('[data-ov-speech]')||[]].find(node=>node.dataset.ovSpeech===panel.target!.speechId):null;
    const heading=speech?.querySelector<HTMLElement>('.ov-speech-reader')||(item||day)?.querySelector<HTMLElement>(item?'h3':'h2');
    if(!content||!heading)return;
    panelReveal.current=null;
    // Consume this opening once; late data must not interrupt someone already reading.
    if(document.activeElement!==close.current&&document.activeElement!==document.body)return;
    heading.focus({preventScroll:true});
    content.scrollTo({top:content.scrollTop+heading.getBoundingClientRect().top-content.getBoundingClientRect().top,behavior:'instant'});
  },[panel,panelData.data]);
  useEffect(()=>{const restore=()=>{if(panelOpen.current){panelReturn.current=true;setPanel(null);}};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  const openPerson=(id:string)=>{const from=document.activeElement instanceof HTMLElement?document.activeElement:null;if(!person)directoryOpener.current=panel?opener.current:captureOpener();destination.current={person:id,from};panelReturn.current=false;setPanel(null);setPerson(id);setTab('timeline');setMonth(null);window.scrollTo(0,0);};
  const openDays=(id:string,dates:string[],target?:OutsideTarget)=>{opener.current=captureOpener();const next={id,dates,target};panelReveal.current=next;setPanel(next);};
  const availableGroups=useMemo(()=>new Set((directory.data?.people||[]).map(p=>p.capacity)),[directory.data]);
  const activeGroup=availableGroups.has(group)?group:'all';
  const people=useMemo(()=>filterOutsidePeople(directory.data?.people||[],{kind,group:activeGroup,repeat:repeat==='1',search}),[directory.data,kind,activeGroup,repeat,search]);
  const bounds=people.flatMap(p=>p.days.map(d=>d.date)).sort();
  const start='2024-07-16',end=bounds.at(-1)||new Date().toISOString().slice(0,10);
  return <InsightShell {...props} language={language} view="outside" title="Outside voices"><div className="ov" ref={root}>
    {person?<><button className="ov-back" lang="en" onClick={backToDirectory}>← All speakers</button><InsightStatus loading={detail.loading} error={detail.error} retry={detail.retry}/>{detail.data&&<Speaker data={detail.data} language={language} tab={tab} setTab={setTab} monthFilter={monthFilter} setMonth={setMonth} onPerson={openPerson} onDays={openDays}/>}</>:<>
      <Status scope={JSON.stringify([language,term,kind,group,repeat,search])} pending={directory.loading||Boolean(panel)} oncePerScope message={!directory.data||directory.error?null:(people.length?`${people.length} indexed ${people.length===1?'speaker matches':'speakers match'}.`:directory.data.coverage.initialized?'No indexed speakers match.':'Speakers are not indexed yet.')+(!directory.data.coverage.complete?' Partial coverage.':'')}/>
      <div className="ov-filters" lang="en"><label>Speaker<input type="search" placeholder="Name or person ID" value={search} onChange={event=>setSearch(event.target.value)}/></label><label>Event<select value={kind} onChange={event=>setKind(event.target.value)}><option value="all">All events</option><option value="debate">Debates</option><option value="special">Special events</option></select></label><label className="ov-check"><input type="checkbox" checked={repeat==='1'} onChange={event=>setRepeat(event.target.checked?'1':'0')}/>Repeat appearances</label></div>
      <div className="ov-groups" lang="en" aria-label="Speaking capacity">{[['all','All speakers'],...Object.entries(groups).filter(([id])=>availableGroups.has(id))].map(([id,label])=><button key={id} aria-pressed={activeGroup===id} onClick={()=>setGroup(id)}>{label}</button>)}</div><InsightStatus loading={directory.loading&&!directory.data} error={directory.error} retry={directory.retry}/>
      {directory.data&&<><div className="ov-results" lang="en"><strong>{people.length}</strong> speakers{!directory.data.coverage.complete&&<small>Partial coverage</small>}</div><div className="ov-legend" lang="en"><span>■ Contributions</span><span>◇ Special event</span><span className="ov-legislative"><b className="ov-law-symbol" aria-hidden="true">L</b> Legislative file</span></div>{people.length?<Presence people={people} language={language} start={start} end={end} onPerson={openPerson} onDays={openDays}/>:<p className="ov-empty" lang="en">{directory.data.coverage.initialized?'No indexed speakers match.':'Speakers are not indexed yet.'}</p>}<Sources coverage={directory.data.coverage}/></>}
    </>}
    {panel&&<><div className="ov-scrim" onClick={closePanel}/><div className="ov-drawer" ref={drawer} role="dialog" aria-modal="true" aria-labelledby="ov-panel-title"><header><div><small lang={panel.target?language:'en'}>{panel.target?date(panel.target.date,language):panel.dates.length===1?'Sitting day':`${panel.dates.length} sitting days`}</small><h2 id="ov-panel-title" lang={panelData.data?.person.name?'':'en'}>{panelData.data?.person.name||'Speeches'}</h2></div><button lang="en" ref={close} aria-label="Close speeches" onClick={closePanel}>Close</button></header><div className="ov-drawer-content" ref={drawerContent}><InsightStatus loading={panelData.loading} error={panelData.error} retry={panelData.retry}/>{panelData.data&&<><DayItems data={panelData.data} dates={panel.dates} language={language} onPerson={openPerson} speechId={panelReveal.current===panel?panel.target?.speechId:undefined}/><button className="ov-open-person" lang="en" onClick={()=>openPerson(panel.id)}>Open speaker page →</button></>}</div></div></>}
  </div></InsightShell>;
}
