import {useDossierReaderState,navigateDossier} from './dossierJourney';
import {topicsHref,agendaTitle,withBoundaryTies} from './topicPresentation.mjs';
import {TopicFinder} from './TopicFinder';
import {TopicBatch,RecordTopics} from './RecordTopics';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {AvailabilityNote} from './AvailabilityNote';
import {periodAvailability,sourceAvailability} from '../server/source-availability.mjs';
import type {SourceAvailability} from '../server/source-availability.mjs';
import {useId,useLayoutEffect,useRef,useState} from 'react';
import {InsightShell,InsightStatus,humanDate} from './InsightShared';
import {InsightSpeechReader} from './InsightReaders';
import type {InsightProps} from './InsightTypes';
import {useInsightData} from './InsightData';
import {useGroupVoicesState} from './useGroupVoicesState';
import {visibleGroupPeople,type GroupVoicePerson} from './groupVoicesState.mjs';
import {GROUP_VOICE_GROUPS as groups,GROUP_VOICE_SUBJECTS as subjects, GROUP_VOICE_SUBJECTSUi as subjectsUi, GROUP_VOICE_GROUPSUi as groupsUi} from './groupVoiceTerms.mjs';
import {speakerPresentation} from './speakerPresentation.mjs';
import {InsightPortrait} from './InsightPortrait';
import './GroupVoices.css';
type Coverage={initialized:boolean;observedOralRecords:number;pending:number;truncated:boolean;note:string};
type Summary={topicAvailability?:{state:'available'|'partial'|'unavailable';unresolvedContributions:number};availability?:SourceAvailability;people:GroupVoicePerson[];ready?:boolean;retiredSubject?:boolean;subjects:{id:string;label:string}[];months:string[];coverage:Coverage;window:{from:string;to:string}};
type Contribution={id:string;personId:string;date:string;subject:string;title:string|null;titleLanguage:string|null;websiteUrl:string|null;websiteLanguage:string|null};
type Contributions={contributions:Contribution[];total:number|null;nextOffset:number|null;coverage:Coverage};
function groupCount(data:Summary,count:number|null){
  // Archive failures without a known speaker or group cannot qualify this
  // group's recorded counts. Selection limits remain explicit below.
  if(count===null)return {observedCount:null,state:'unavailable'};
  const evidence=data.availability?{...data.availability,gaps:[]}:sourceAvailability({sourceKey:'oral-speeches',family:'speeches',observedRecords:data.coverage.observedOralRecords||0,limited:true});
  return periodAvailability({start:data.window.from,end:data.window.to},evidence,count);
}
function Count({count,data,language}:{count:number|null;data:Summary;language:string}){
  const ui = useUiI18n();
  const value=groupCount(data,count);
  return value.observedCount===null?<span className="gv-unavailable"><UiMessage id="grouplabels.ts.unavailable"/></span>:<>{value.observedCount===0&&value.state==='partial'?ui.t("groupvoices.0_so_far.e7fb51"):value.observedCount.toLocaleString(language)}</>;
}
const subjectEntries=(person:GroupVoicePerson)=>Object.entries(person.subjects).filter(([,n])=>n>0).sort((a,b)=>Number(a[0]==='unclassified')-Number(b[0]==='unclassified')||b[1]-a[1]||a[0].localeCompare(b[0]));
function Name({person,language}:{person:GroupVoicePerson;language:string}){
  const ui = useUiI18n();
  const display=speakerPresentation({...person,name:person.name||undefined},language).name;
  return <span lang={display.language}>{(person.name||person.nameVariants?.length) ? display.text : ui.t("groupvoices.person_personid.0fc55c", {personId: String(person.id)})}</span>;
}
function ContributionCard({contribution:c,person,language,selected,onPerson}:{contribution:Contribution;person?:GroupVoicePerson;language:string;selected:boolean;onPerson:()=>void}){
  const ui = useUiI18n();
  const [reading,setReading]=useState(false),readerId='gv-speech-'+useId();
  return <article className="gv-contribution">
    <RecordTopics id={c.id}/><div className="gv-contribution-meta"><time dateTime={c.date} lang={language}>{humanDate(c.date,language)}</time></div>
    <h3><button className="gv-contribution-title" aria-expanded={reading} aria-controls={reading ? readerId : undefined} onClick={()=>setReading(value=>!value)}><span lang={c.title ? (c.titleLanguage||'') : ui.messageLocale("groupvoices.read_contribution.0bb6a3")}>{c.title?agendaTitle(c.title):ui.t("groupvoices.read_contribution.0bb6a3")}</span><span aria-hidden="true">{reading ? '−' : '+'}</span></button></h3>
    {person&&<button className="gv-contribution-person" data-gv-contribution={c.id+':'+person.id} aria-pressed={selected} onClick={onPerson}><Name person={person} language={language}/></button>}
    {reading&&<div id={readerId}><InsightSpeechReader id={c.id} language={language}/></div>}
  </article>;
}
export function GroupVoices({language='en',...props}:InsightProps){
  const ui = useUiI18n();
  const [expandedTopics,setExpandedTopics]=useDossierReaderState<string[]>('group-topic-contributors',[]);
  const {state:s,change,endSearch}=useGroupVoicesState();
  const root=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),focusPerson=useRef<{id:string;from:'people'|'contribution';speech?:string}|null>(null);
  // One response keeps the selectors and contribution page on the same
  // saved-data snapshot while the background metadata queue advances.
  const scopeKey=JSON.stringify([language,s.group,s.period]),retained=useRef<{key:string;data:Summary}|null>(null);
  const page=useInsightData<Summary&Contributions>(`insights/group-voices?lang=${language}&group=${s.group}&period=${s.period}${s.person ? ('&person='+s.person) : ''}${s.subject ? ('&subject='+s.subject) : ''}&offset=${s.offset}`);
  if(page.data)retained.current={key:scopeKey,data:page.data};
  const data=page.data||((retained.current?.key===scopeKey) ? retained.current.data : null),people=data?.people||[],selected=people.find(p=>p.id===s.person),list=visibleGroupPeople(people,s);
  const labels=data?.subjects?Object.fromEntries(data.subjects.map(t=>[t.id,t.label])):subjectsUi(ui);
  const topicsKnown=data?.ready!==false&&(!data?.topicAvailability||data.topicAvailability.state==='available');
 const scope=people.filter(p=>!s.person||p.id===s.person);
  const total=s.subject&&!topicsKnown?null:scope.reduce((n,p)=>n+(s.subject ? (p.subjects[s.subject]||0) : p.total),0),speakers=s.subject&&!topicsKnown?null:scope.filter(p=>(s.subject ? (p.subjects[s.subject]||0) : p.total)>0).length;
  const topicRows=Object.entries(labels).map(([id,label])=>({id,label,count:scope.reduce((n,p)=>n+(p.subjects[id]||0),0)})).filter(t=>t.count>0).sort((a,b)=>Number(a.id==='unclassified')-Number(b.id==='unclassified')||b.count-a.count||a.label.localeCompare(b.label));
  // Keep a selected subject visible when the chosen group has no records for it.
  const shownTopics=s.subject ? [...topicRows.filter(t=>t.id===s.subject),...(topicRows.some(t=>t.id===s.subject)?[]:[{id:s.subject,label:labels[s.subject]||s.subject,count:topicsKnown?0:null}])] : topicRows;
  const choosePerson=(id:string,from?:'people'|'contribution',speech?:string)=>{focusPerson.current=from ? ({id,from,speech}) : null;change({person:(s.person===id) ? null : id});};
  useLayoutEffect(()=>{
    const intent=focusPerson.current;if(!intent)return;
    if(intent.from==='people'){
      root.current?.querySelector<HTMLButtonElement>(`[data-gv-person="${intent.id}"]`)?.focus({preventScroll:true});focusPerson.current=null;return;
    }
    // Keep keyboard users in Contributions through the loading gap. Restore
    // the exact speech/person control only if they have not moved elsewhere.
    if(page.loading&&!page.data){heading.current?.focus({preventScroll:true});return;}
    if(document.activeElement===heading.current||document.activeElement===document.body){
      const button=root.current?.querySelector<HTMLButtonElement>(`[data-gv-contribution="${intent.speech}:${intent.id}"]`);
      (button||heading.current)?.focus({preventScroll:true});
    }
    focusPerson.current=null;
  },[s.person,page.data,page.loading,page.error]);
  const jump=()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start',behavior:'smooth'});};
  const monthLabel=(value:string)=>new Intl.DateTimeFormat(language,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-15T12:00:00Z'));
  const months=[...new Set([...(data?.months||[]),...(/^\d{4}-\d{2}$/.test(s.period) ? ([s.period]) : ([]))])].sort().reverse();
  return <InsightShell {...props} language={language} title={ui.t("groupvoices.group_voices.f21b8b")} view="groups"><div className="gv" ref={root} lang={ui.language}>
    <p className="gv-intro"><UiMessage id="groupvoices.who_takes_the_floor_on_behalf_of_a_political_group.377e92"/></p>
    <div className="gv-controls"><label><UiMessage id="groupvoices.political_group.c2db1f"/><select value={s.group} onChange={e=>change({group:e.target.value})}>{Object.entries(groupsUi(ui)).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label><UiMessage id="plenaryPeriod.select.1"/><select value={s.period} onChange={e=>change({period:e.target.value})}><option value="term"><UiMessage id="groupvoices.current_term_since_july_2024.8cce97"/></option><option value="12m"><UiMessage id="groupvoices.last_12_months.0245d9"/></option>{months.map(month=><option lang={language} key={month} value={month}>{monthLabel(month)}</option>)}</select></label></div>
    <InsightStatus loading={page.loading&&!data} error={data ? null : page.error} retry={page.retry}/>
    {data&&<><AvailabilityNote showGaps={false} sources={data.availability||sourceAvailability({sourceKey:'oral-speeches',family:'speeches',observedRecords:data.coverage.observedOralRecords||0,limited:true})} kind="speech" language={language} end={data.window.to} partial={data.coverage.pending>0||data.coverage.truncated}/>
      {!topicsKnown&&<p className="gv-unavailable"><UiMessage id={data.topicAvailability?.state==='partial'?'topics.classificationIncomplete':'topics.classificationUnavailable'}/></p>}{data.coverage.truncated&&<p className="gv-list-count"><UiMessage id="coverage.contributionLimit"/></p>}
      <div className="gv-summary" aria-live="polite">{([
        [total,'ui.groupContributionUnit','groupvoices.recorded_oral_contributions.000262'],
        [speakers,'ui.speakerUnit','groupvoices.speakers.c2a951'],
        [topicsKnown?topicRows.filter(t=>t.id!=='unclassified'&&(!s.subject||s.subject===t.id)).length:null,'topics.topics','topics.topics']
      ] as const).map(([value,unit,unknown])=>{const count=groupCount(data,value).observedCount;return <div key={unit}><strong><Count count={value} data={data} language={language}/></strong><span>{count===null ? ui.t(unknown) : ui.t(unit==='topics.topics'&&count===1?'topics.topic':unit,{}, {count})}</span></div>;})}</div>
      {(s.person||s.subject)&&<div className="gv-selected" aria-label={ui.t("groupvoices.active_filters.15363e")}>{s.person&&<button onClick={()=>change({person:null})}>{selected ? <Name person={selected} language={language}/> : <><UiMessage id="groupvoices.person_personid.0fc55c" values={{personId: s.person}}/></>} <span aria-hidden="true">×</span><span className="gv-sr"><UiMessage id="groupvoices.remove_person_filter.c1cae0"/></span></button>}{s.subject&&<button onClick={()=>change({subject:null})}>{labels[s.subject]} <span aria-hidden="true">×</span><span className="gv-sr"><UiMessage id="groupvoices.remove_subject_filter.f8cef4"/></span></button>}</div>}
      <div className="gv-tabs" role="group" aria-label={ui.t("groupvoices.explore_group_voices.d4063f")}>{['people','subjects'].map(tab=><button key={tab} aria-pressed={s.tab===tab} onClick={()=>change({tab})}>{(tab==='subjects') ? <UiMessage id="topics.topics"/> : <UiMessage id="groupvoices.people.b37554"/>}</button>)}</div>
      {(s.tab==='subjects') ? <section aria-label={ui.t('topics.topics')} className="gv-subjects"><div className="gv-section-heading"><h2><UiMessage id="groupvoices.what_does_group_speak_about.ae61b7" values={{group: (selected ? <Name person={selected} language={language}/> : groupsUi(ui)[s.group])}}/></h2></div>{shownTopics.map(topic=>{const contributors=scope.filter(p=>p.subjects[topic.id]>0).sort((a,b)=>b.subjects[topic.id]-a.subjects[topic.id]),expanded=expandedTopics.includes(topic.id),preview=withBoundaryTies(contributors,3,p=>p.subjects[topic.id]),visible=expanded?contributors:preview;return <article key={topic.id} className="gv-subject"><div className="gv-subject-title"><button aria-pressed={s.subject===topic.id} onClick={()=>change({subject:(s.subject===topic.id) ? null : topic.id})}>{topic.label}</button><button onClick={()=>{change({subject:topic.id});jump();}}><Count count={topic.count} data={data} language={language}/></button></div><div className="gv-subject-people">{visible.map(p=><button key={p.id} onClick={()=>change({person:p.id,subject:topic.id})} aria-pressed={s.person===p.id}><>{<Name person={p} language={language}/>} {<b>{p.subjects[topic.id]}</b>}</></button>)}{contributors.length>preview.length&&<button aria-expanded={expanded} onClick={()=>setExpandedTopics(expanded?expandedTopics.filter(id=>id!==topic.id):[...expandedTopics,topic.id])}><UiMessage id={expanded?'topics.less':'topics.more'}/></button>}</div></article>;})}{!shownTopics.some(t=>(t.count||0)>0)&&topicsKnown&&groupCount(data,0).observedCount===0&&<p className="gv-empty"><UiMessage id="coverage.contributionsEmpty"/></p>}</section> : <section aria-label={ui.t("groupvoices.people.b37554")} className="gv-people"><div className="gv-section-heading"><h2><UiMessage id="groupvoices.who_speaks_for_group.37b3ac" values={{group: groupsUi(ui)[s.group]}}/></h2><label className="gv-search"><span className="gv-sr"><UiMessage id="groupvoices.find_a_person.8c22d6"/></span><input type="search" placeholder={ui.t("groupvoices.find_a_person.8c22d6")} value={s.q} onChange={e=>change({q:e.target.value},true)} onBlur={endSearch} onKeyDown={e=>{if(e.key==='Enter')endSearch();}}/></label></div>
        <p className="gv-list-count"><UiMessage id="groupvoices.count_matching_speakers.777f9a" values={{count: list.rows.length}} counts={{count: list.rows.length}}/></p><div className="gv-people-labels"><span><UiMessage id="insightshared.speaker"/></span><span><UiMessage id="insightshared.contributions"/></span><span>{s.subject ? ui.t("groupvoices.on_subject.9c6725", {subject: String(labels[s.subject])}) : ui.t('topics.topics')}</span></div>
        {list.visible.map(p=><article className={'gv-person'+((s.person===p.id) ? ' is-selected' : '')} key={p.id}><div className="gv-person-name"><InsightPortrait id={p.id} name={p.name} onUnavailable={()=>{}}/><div><button data-gv-person={p.id} aria-pressed={s.person===p.id} onClick={()=>choosePerson(p.id,'people')}><Name person={p} language={language}/></button>{s.person===p.id&&total!==null&&<button className="gv-jump" onClick={jump}><UiMessage id="groupvoices.total_contributions_shown_below.9817c4" values={{total: total}} counts={{total: total}}/></button>}</div></div><strong className="gv-person-count">{p.count}</strong><div className="gv-person-subjects">{subjectEntries(p).filter(([id])=>!s.subject||s.subject===id).map(([id,count])=>{const active=s.person===p.id&&s.subject===id;return <button key={id} aria-pressed={active} aria-label={active ? ui.t("groupvoices.subject_count_remove_subject_filter.a4270f", {subject: String(labels[id]), count: String(count)}) : ui.t("groupvoices.subject_count_show_only_these_contributions.9447a7", {subject: String(labels[id]), count: String(count)})} onClick={()=>change(active ? ({subject:null}) : ({person:p.id,subject:id}))}><>{labels[id]} {<b>{count}</b>}</></button>;})}{s.subject&&subjectEntries(p).some(([id])=>id!==s.subject)&&<small><UiMessage id="groupvoices.also_this_period_subjectentries.e93c0e" values={{subjects: subjectEntries(p).filter(([id])=>id!==s.subject).map(([id,count])=>ui.t("groupvoices.subject_count.2419a7", {subject: String(labels[id]), count: String(count)})).join(' · ')}}/></small>}</div></article>)}
        {!list.rows.length&&(!s.subject||topicsKnown)&&groupCount(data,0).observedCount===0&&<p className="gv-empty"><UiMessage id="groupvoices.no_speakers_match_these_filters.1b56d0"/></p>}{list.hasMore&&<button className="gv-show-all" onClick={()=>change({peopleLimit:list.rows.length})}>{ui.t("groupvoices.show_all_count_people.289649", {count: String(list.rows.length)}, {count: list.rows.length})}</button>}
</section>}
    </>}
    <TopicFinder language={language} onSelect={i=>{if(i.role==='topic')change({subject:i.key});else navigateDossier(topicsHref(i.key));}}/>{(data?.retiredSubject||s.subject&&!s.subject.startsWith('oeil:'))&&<p><UiMessage id="topics.retired"/> <button onClick={()=>change({subject:null})}><UiMessage id="topics.clear"/></button></p>}<p><UiMessage id="topics.overlap"/></p><section className="gv-contributions" aria-busy={page.loading}><div className="gv-section-heading"><h2 ref={heading} tabIndex={-1}><UiMessage id="insightshared.contributions"/> {page.data&&<small>· <Count count={page.data.total} data={page.data} language={language}/></small>}</h2>{s.subject&&<span>{labels[s.subject]}</span>}</div><InsightStatus loading={page.loading} error={page.error} retry={page.retry}/>{page.data&&<><TopicBatch language={language} ids={page.data.contributions.map(c=>c.id)}>{page.data.contributions.map(c=><ContributionCard key={c.id+':'+c.personId} contribution={c} person={people.find(p=>p.id===c.personId)} language={language} selected={s.person===c.personId} onPerson={()=>choosePerson(c.personId,'contribution',c.id)}/>)}</TopicBatch>{!page.data.contributions.length&&groupCount(page.data,page.data.total).observedCount===0&&<p className="gv-empty"><UiMessage id="coverage.contributionsEmpty"/></p>}<div className="gv-pagination">{s.offset>0&&<button onClick={()=>{change({offset:Math.max(0,s.offset-20)});jump();}}><UiMessage id="groupvoices.previous.471492"/></button>}{page.data.nextOffset!==null&&<button onClick={()=>{change({offset:page.data!.nextOffset!});jump();}}><UiMessage id="groupvoices.next.2f04eb"/></button>}</div></>}</section>
  </div></InsightShell>;
}
