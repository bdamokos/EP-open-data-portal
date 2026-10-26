import {AvailabilityNote,PartialValue} from './AvailabilityNote';
import {periodAvailability,sourceAvailability} from '../server/source-availability.mjs';
import type {SourceAvailability} from '../server/source-availability.mjs';
import {useId,useLayoutEffect,useRef,useState} from 'react';
import {InsightShell,InsightStatus,humanDate} from './InsightShared';
import {InsightSpeechReader} from './InsightReaders';
import type {InsightProps} from './InsightTypes';
import {useInsightData} from './InsightData';
import {useGroupVoicesState} from './useGroupVoicesState';
import {visibleGroupPeople,type GroupVoicePerson} from './groupVoicesState.mjs';
import {GROUP_VOICE_GROUPS as groups,GROUP_VOICE_SUBJECTS as subjects} from './groupVoiceTerms.mjs';
import {speakerPresentation} from './speakerPresentation.mjs';
import {InsightPortrait} from './InsightPortrait';
import './GroupVoices.css';
type Coverage={initialized:boolean;observedOralRecords:number;pending:number;truncated:boolean;note:string};
type Summary={availability?:SourceAvailability;people:GroupVoicePerson[];months:string[];coverage:Coverage;window:{from:string;to:string}};
type Contribution={id:string;personId:string;date:string;subject:string;title:string|null;titleLanguage:string|null;websiteUrl:string|null;websiteLanguage:string|null};
type Contributions={contributions:Contribution[];total:number;nextOffset:number|null;coverage:Coverage};
function Count({count,data,language}:{count:number;data:Summary;language:string}){
  const evidence=data.availability||sourceAvailability({sourceKey:'oral-speeches',family:'speeches',observedRecords:data.coverage.observedOralRecords||0,limited:true});
  const value=periodAvailability({start:data.window.from,end:data.window.to},evidence,count);
  return value.observedCount===null?<span className="gv-unavailable">Unavailable</span>:<>{value.observedCount===0&&value.state==='partial'?'0 so far':value.observedCount.toLocaleString(language)}<PartialValue partial={value.state==='partial'}/></>;
}
const subjectEntries=(person:GroupVoicePerson)=>Object.entries(person.subjects).filter(([,n])=>n>0).sort((a,b)=>Number(a[0]==='unclassified')-Number(b[0]==='unclassified')||b[1]-a[1]||subjects[a[0]].localeCompare(subjects[b[0]]));
function Name({person,language}:{person:GroupVoicePerson;language:string}){
  const display=speakerPresentation({...person,name:person.name||undefined},language).name;
  return <span lang={display.language}>{person.name||person.nameVariants?.length?display.text:`Person ${person.id}`}</span>;
}
function ContributionCard({contribution:c,person,language,selected,onPerson}:{contribution:Contribution;person?:GroupVoicePerson;language:string;selected:boolean;onPerson:()=>void}){
  const [reading,setReading]=useState(false),readerId='gv-speech-'+useId();
  return <article className="gv-contribution">
    <div className="gv-contribution-meta"><time dateTime={c.date} lang={language}>{humanDate(c.date,language)}</time><span>{subjects[c.subject]}</span></div>
    <h3><button className="gv-contribution-title" aria-expanded={reading} aria-controls={reading?readerId:undefined} onClick={()=>setReading(value=>!value)}><span lang={c.titleLanguage||'en'}>{c.title||'Read contribution'}</span><span aria-hidden="true">{reading?'−':'+'}</span></button></h3>
    {person&&<button className="gv-contribution-person" data-gv-contribution={c.id+':'+person.id} aria-pressed={selected} onClick={onPerson}><Name person={person} language={language}/></button>}
    {reading&&<div id={readerId}><InsightSpeechReader id={c.id} language={language}/></div>}
  </article>;
}
export function GroupVoices({language='en',...props}:InsightProps){
  const {state:s,change,endSearch}=useGroupVoicesState();
  const root=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),focusPerson=useRef<{id:string;from:'people'|'contribution';speech?:string}|null>(null);
  // One response keeps the selectors and contribution page on the same
  // saved-data snapshot while the background metadata queue advances.
  const scopeKey=JSON.stringify([language,s.group,s.period]),retained=useRef<{key:string;data:Summary}|null>(null);
  const page=useInsightData<Summary&Contributions>(`insights/group-voices?lang=${language}&group=${s.group}&period=${s.period}${s.person?'&person='+s.person:''}${s.subject?'&subject='+s.subject:''}&offset=${s.offset}`);
  if(page.data)retained.current={key:scopeKey,data:page.data};
  const data=page.data||(retained.current?.key===scopeKey?retained.current.data:null),people=data?.people||[],selected=people.find(p=>p.id===s.person),list=visibleGroupPeople(people,s);
  const scope=people.filter(p=>!s.person||p.id===s.person);
  const total=scope.reduce((n,p)=>n+(s.subject?p.subjects[s.subject]||0:p.total),0),speakers=scope.filter(p=>(s.subject?p.subjects[s.subject]||0:p.total)>0).length;
  const topicRows=Object.entries(subjects).map(([id,label])=>({id,label,count:scope.reduce((n,p)=>n+(p.subjects[id]||0),0)})).filter(t=>t.count>0).sort((a,b)=>Number(a.id==='unclassified')-Number(b.id==='unclassified')||b.count-a.count||a.label.localeCompare(b.label));
  // Keep a selected subject visible when the chosen group has no records for it.
  const shownTopics=s.subject?topicRows.filter(t=>t.id===s.subject).concat(topicRows.some(t=>t.id===s.subject)?[]:[{id:s.subject,label:subjects[s.subject],count:0}]):topicRows;
  const choosePerson=(id:string,from?:'people'|'contribution',speech?:string)=>{focusPerson.current=from?{id,from,speech}:null;change({person:s.person===id?null:id});};
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
  const months=[...new Set([...(data?.months||[]),...(/^\d{4}-\d{2}$/.test(s.period)?[s.period]:[])])].sort().reverse();
  return <InsightShell {...props} language={language} title="Group voices" view="groups"><div className="gv" ref={root} lang="en">
    <p className="gv-intro">Who takes the floor on behalf of a political group?</p>
    <div className="gv-controls"><label>Political group<select value={s.group} onChange={e=>change({group:e.target.value})}>{Object.entries(groups).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label>Period<select value={s.period} onChange={e=>change({period:e.target.value})}><option value="term">Current term · since July 2024</option><option value="12m">Last 12 months</option>{months.map(month=><option lang={language} key={month} value={month}>{monthLabel(month)}</option>)}</select></label></div>
    <InsightStatus loading={page.loading&&!data} error={data?null:page.error} retry={page.retry}/>
    {data&&<><AvailabilityNote sources={data.availability||sourceAvailability({sourceKey:'oral-speeches',family:'speeches',observedRecords:data.coverage.observedOralRecords||0,limited:true})} label="speech" language={language} end={data.window.to} partial={data.coverage.pending>0||data.coverage.truncated}/>
      <div className="gv-summary" aria-live="polite"><div><strong><Count count={total} data={data} language={language}/></strong><span>recorded oral contributions</span></div><div><strong><Count count={speakers} data={data} language={language}/></strong><span>{speakers===1?'speaker':'speakers'}</span></div><div><strong><Count count={topicRows.filter(t=>t.id!=='unclassified'&&(!s.subject||s.subject===t.id)).length} data={data} language={language}/></strong><span>subjects</span></div></div>
      {(s.person||s.subject)&&<div className="gv-selected" aria-label="Active filters">{s.person&&<button onClick={()=>change({person:null})}>{selected?<Name person={selected} language={language}/>:<>Person {s.person}</>} <span aria-hidden="true">×</span><span className="gv-sr"> Remove person filter</span></button>}{s.subject&&<button onClick={()=>change({subject:null})}>{subjects[s.subject]} <span aria-hidden="true">×</span><span className="gv-sr"> Remove subject filter</span></button>}</div>}
      <div className="gv-tabs" role="group" aria-label="Explore group voices">{['people','subjects'].map(tab=><button key={tab} aria-pressed={s.tab===tab} onClick={()=>change({tab})}>{tab==='subjects'?'Subjects':'People'}</button>)}</div>
      {s.tab==='subjects'?<section aria-label="Subjects" className="gv-subjects"><div className="gv-section-heading"><h2>What does {selected?<Name person={selected} language={language}/>:groups[s.group]} speak about?</h2></div>{shownTopics.map(topic=>{const contributors=scope.filter(p=>p.subjects[topic.id]>0).sort((a,b)=>b.subjects[topic.id]-a.subjects[topic.id]);return <article key={topic.id} className="gv-subject"><div className="gv-subject-title"><button aria-pressed={s.subject===topic.id} onClick={()=>change({subject:s.subject===topic.id?null:topic.id})}>{topic.label}</button><strong><Count count={topic.count} data={data} language={language}/></strong></div><div className="gv-subject-people">{contributors.slice(0,3).map(p=><button key={p.id} onClick={()=>choosePerson(p.id)} aria-pressed={s.person===p.id}><Name person={p} language={language}/> <b>{p.subjects[topic.id]}</b></button>)}{contributors.length>3&&<span>+ {contributors.length-3} more</span>}</div></article>;})}{!shownTopics.some(t=>t.count>0)&&<p className="gv-empty">No recorded contributions in this selection. Coverage is incomplete.</p>}</section>:<section aria-label="People" className="gv-people"><div className="gv-section-heading"><h2>Who speaks for {groups[s.group]}?</h2><label className="gv-search"><span className="gv-sr">Find a person</span><input type="search" placeholder="Find a person" value={s.q} onChange={e=>change({q:e.target.value},true)} onBlur={endSearch} onKeyDown={e=>{if(e.key==='Enter')endSearch();}}/></label></div>
        <p className="gv-list-count">{list.rows.length} matching speakers</p><div className="gv-people-labels"><span>Speaker</span><span>Contributions</span><span>{s.subject?`On ${subjects[s.subject]}`:'Subjects'}</span></div>
        {list.visible.map(p=><article className={'gv-person'+(s.person===p.id?' is-selected':'')} key={p.id}><div className="gv-person-name"><InsightPortrait id={p.id} name={p.name} onUnavailable={()=>{}}/><div><button data-gv-person={p.id} aria-pressed={s.person===p.id} onClick={()=>choosePerson(p.id,'people')}><Name person={p} language={language}/></button>{s.person===p.id&&<button className="gv-jump" onClick={jump}>{total} contributions shown below ↓</button>}</div></div><strong className="gv-person-count">{p.count}</strong><div className="gv-person-subjects">{subjectEntries(p).filter(([id])=>!s.subject||s.subject===id).map(([id,count])=>{const active=s.person===p.id&&s.subject===id;return <button key={id} aria-pressed={active} aria-label={active?`${subjects[id]}, ${count}. Remove subject filter`:`${subjects[id]}, ${count}. Show only these contributions`} onClick={()=>change(active?{subject:null}:{person:p.id,subject:id})}>{subjects[id]} <b>{count}</b></button>;})}{s.subject&&subjectEntries(p).some(([id])=>id!==s.subject)&&<small>Also this period: {subjectEntries(p).filter(([id])=>id!==s.subject).map(([id,count])=>`${subjects[id]} ${count}`).join(' · ')}</small>}</div></article>)}
        {!list.rows.length&&<p className="gv-empty">No speakers match these filters.</p>}{list.hasMore&&<button className="gv-show-all" onClick={()=>change({peopleLimit:Math.min(1000,list.rows.length)})}>{list.rows.length>1000?'Show first 1,000 people':`Show all ${list.rows.length} people`}</button>}
      {s.peopleLimit>=1000&&list.rows.length>list.visible.length&&<p className="gv-list-count">Showing {list.visible.length.toLocaleString(language)} matches. Refine the name search to find others.</p>}</section>}
    </>}
    <section className="gv-contributions" aria-busy={page.loading}><div className="gv-section-heading"><h2 ref={heading} tabIndex={-1}>Contributions {page.data&&<small>· <Count count={page.data.total} data={page.data} language={language}/></small>}</h2>{s.subject&&<span>{subjects[s.subject]}</span>}</div><InsightStatus loading={page.loading} error={page.error} retry={page.retry}/>{page.data&&<>{page.data.contributions.map(c=><ContributionCard key={c.id+':'+c.personId} contribution={c} person={people.find(p=>p.id===c.personId)} language={language} selected={s.person===c.personId} onPerson={()=>choosePerson(c.personId,'contribution',c.id)}/>)}{!page.data.contributions.length&&<p className="gv-empty">{data?.coverage.observedOralRecords?'No contributions in this selection · Partial coverage':'Not available yet.'}</p>}<div className="gv-pagination">{s.offset>0&&<button onClick={()=>{change({offset:Math.max(0,s.offset-20)});jump();}}>← Previous</button>}{page.data.nextOffset!==null&&<button onClick={()=>{change({offset:page.data!.nextOffset!});jump();}}>Next →</button>}</div></>}</section>
  </div></InsightShell>;
}
