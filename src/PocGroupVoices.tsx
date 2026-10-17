import {useLayoutEffect,useRef} from 'react';
import {InsightShell,InsightStatus,humanDate,insightMemberHref} from './PocInsightShared';
import type {InsightProps} from './PocInsightTypes';
import {useInsightData} from './PocInsightData';
import {useGroupVoicesState} from './useGroupVoicesState';
import {visibleGroupPeople,type GroupVoicePerson} from './groupVoicesState.mjs';
import {GROUP_VOICE_GROUPS as groups,GROUP_VOICE_SUBJECTS as subjects} from './groupVoiceTerms.mjs';
import {speakerPresentation} from './pocSpeakerPresentation.mjs';
import {PocInsightPortrait} from './PocInsightPortrait';
import './PocGroupVoices.css';
type Coverage={initialized:boolean;observedOralRecords:number;pending:number;truncated:boolean;note:string};
type GroupSubjects={id:string;total:number;subjects:Record<string,number>};
type Summary={people:GroupVoicePerson[];months:string[];coverage:Coverage;window:{from:string;to:string};groupSubjects?:GroupSubjects[]};
type Contribution={id:string;personId:string;date:string;subject:string;title:string|null;titleLanguage:string|null;websiteUrl:string|null;websiteLanguage:string|null};
type Contributions={contributions:Contribution[];total:number;nextOffset:number|null;coverage:Coverage};
const subjectEntries=(person:GroupVoicePerson)=>Object.entries(person.subjects).filter(([,n])=>n>0).sort((a,b)=>Number(a[0]==='unclassified')-Number(b[0]==='unclassified')||b[1]-a[1]||subjects[a[0]].localeCompare(subjects[b[0]]));
const groupColors:Record<string,string>={PPE:'#55aaff',S_D:'#ff677b',PFE:'#b98ae3',ECR:'#87a8df',RENEW:'#f8d35b',VERTS_ALE:'#48c78e',THE_LEFT:'#eb8ac1',ESN:'#cda681'};
const groupShort:Record<string,string>={VERTS_ALE:'Greens',THE_LEFT:'Left'};
const percent=(value:number,language:string)=>new Intl.NumberFormat(language,{style:'percent',maximumFractionDigits:value<0.1?1:0}).format(value);
// Shares use each group's classified contributions, so group size and
// unclassified coverage do not drive the comparison. No classified records
// means the share is unavailable, not zero.
const groupSubjectShares=(rows:GroupSubjects[],subject:string)=>Object.keys(groups).map(id=>{const row=rows.find(r=>r.id===id),classified=row?row.total-(row.subjects.unclassified||0):0,count=row?.subjects[subject]||0;return {id,count,classified,share:classified>0?count/classified:null};});
function GroupComparison({rows,subject,current,language,onGroup}:{rows:GroupSubjects[];subject:string;current:string;language:string;onGroup:(group:string)=>void}){
  const shares=groupSubjectShares(rows,subject),max=Math.max(0.0001,...shares.map(r=>r.share||0));
  return <div className="gv-compare" role="group" aria-label={`${subjects[subject]} across political groups`}>{shares.map(r=>{
    const label=groups[r.id],value=r.share===null?'No classified records':`${percent(r.share,language)} of classified contributions (${r.count.toLocaleString(language)})`;
    return <button key={r.id} aria-pressed={r.id===current} onClick={()=>onGroup(r.id)} aria-label={`${label}: ${value}. Show ${label} on ${subjects[subject]}`} title={`${label}: ${value}`}>
      <span className="gv-compare-value" lang={language}>{r.share===null?'–':percent(r.share,language)}</span>
      <span className="gv-compare-track" aria-hidden="true"><span style={{height:(r.share||0)/max*100+'%',background:groupColors[r.id]}}/></span>
      <span className="gv-compare-label" aria-hidden="true">{groupShort[r.id]||label}</span>
    </button>;})}</div>;
}
function Name({person,language}:{person:GroupVoicePerson;language:string}){
  const display=speakerPresentation({...person,name:person.name||undefined},language).name;
  return <span lang={display.language}>{person.name||person.nameVariants?.length?display.text:`Person ${person.id}`}</span>;
}
export function PocGroupVoices({language='en',...props}:InsightProps){
  const {state:s,change,endSearch}=useGroupVoicesState();
  const root=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),focusPerson=useRef<{id:string;from:'people'|'contribution';speech?:string}|null>(null);
  // One response keeps the selector matrix and contribution page on the same
  // saved-data snapshot while the background metadata queue advances.
  const scopeKey=JSON.stringify([language,s.group,s.period]),retained=useRef<{key:string;data:Summary}|null>(null);
  const page=useInsightData<Summary&Contributions>(`insights/group-voices?lang=${language}&group=${s.group}&period=${s.period}${s.person?'&person='+s.person:''}${s.subject?'&subject='+s.subject:''}&offset=${s.offset}`);
  if(page.data)retained.current={key:scopeKey,data:page.data};
  const data=page.data||(retained.current?.key===scopeKey?retained.current.data:null),people=data?.people||[],selected=people.find(p=>p.id===s.person),list=visibleGroupPeople(people,s);
  const scope=people.filter(p=>!s.person||p.id===s.person);
  const total=scope.reduce((n,p)=>n+(s.subject?p.subjects[s.subject]||0:p.total),0),speakers=scope.filter(p=>(s.subject?p.subjects[s.subject]||0:p.total)>0).length;
  const topicRows=Object.entries(subjects).map(([id,label])=>({id,label,count:scope.reduce((n,p)=>n+(p.subjects[id]||0),0)})).filter(t=>t.count>0).sort((a,b)=>Number(a.id==='unclassified')-Number(b.id==='unclassified')||b.count-a.count||a.label.localeCompare(b.label));
  const max=Math.max(1,...topicRows.filter(t=>t.id!=='unclassified').map(t=>t.count));
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
  return <InsightShell {...props} language={language} title="Group voices" view="groups" compactNotice><div className="gv" ref={root} lang="en">
    <p className="gv-intro">Who takes the floor on behalf of a political group?</p>
    <div className="gv-controls"><label>Political group<select value={s.group} onChange={e=>change({group:e.target.value})}>{Object.entries(groups).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label>Period<select value={s.period} onChange={e=>change({period:e.target.value})}><option value="term">Current term · since July 2024</option><option value="12m">Last 12 months</option>{months.map(month=><option lang={language} key={month} value={month}>{monthLabel(month)}</option>)}</select></label></div>
    <InsightStatus loading={page.loading&&!data} error={data?null:page.error} retry={page.retry}/>
    {data&&<><p className="gv-coverage">{data.coverage.truncated?'Showing the most recent 20,000 recorded designations · partial coverage':data.coverage.note}{data.coverage.pending>0?' · More records are being indexed.':''}</p>
      <div className="gv-summary" aria-live="polite"><div><strong>{total.toLocaleString(language)}</strong><span>recorded oral contributions</span></div><div><strong>{speakers.toLocaleString(language)}</strong><span>{speakers===1?'speaker':'speakers'}</span></div><div><strong>{topicRows.filter(t=>t.id!=='unclassified'&&(!s.subject||s.subject===t.id)).length}</strong><span>subjects</span></div></div>
      {(s.person||s.subject)&&<div className="gv-selected" aria-label="Active filters">{s.person&&<button onClick={()=>change({person:null})}>{selected?<Name person={selected} language={language}/>:<>Person {s.person}</>} <span aria-hidden="true">×</span><span className="gv-sr"> Remove person filter</span></button>}{s.subject&&<button onClick={()=>change({subject:null})}>{subjects[s.subject]} <span aria-hidden="true">×</span><span className="gv-sr"> Remove subject filter</span></button>}</div>}
      <div className="gv-tabs" role="group" aria-label="Explore group voices">{['people','subjects'].map(tab=><button key={tab} aria-pressed={s.tab===tab} onClick={()=>change({tab})}>{tab==='subjects'?'Subjects':'People'}</button>)}</div>
      {s.tab==='subjects'?<section aria-label="Subjects" className="gv-subjects"><div className="gv-section-heading"><h2>What does {selected?<Name person={selected} language={language}/>:groups[s.group]} speak about?</h2><p>Editorial subject groupings · one primary subject per contribution{data.groupSubjects?' · columns compare each group’s share of its classified contributions':''}</p></div>{topicRows.filter(t=>!s.subject||t.id===s.subject).map(topic=>{const contributors=scope.filter(p=>p.subjects[topic.id]>0).sort((a,b)=>b.subjects[topic.id]-a.subjects[topic.id]);return <article key={topic.id} className="gv-subject"><div className="gv-subject-title"><button aria-pressed={s.subject===topic.id} onClick={()=>change({subject:s.subject===topic.id?null:topic.id})}>{topic.label}</button><strong>{topic.count}</strong></div><div className="gv-bar" aria-hidden="true"><span style={{width:Math.min(1,topic.count/max)*100+'%'}}/></div><div className="gv-subject-people">{contributors.slice(0,3).map(p=><button key={p.id} onClick={()=>choosePerson(p.id)} aria-pressed={s.person===p.id}><Name person={p} language={language}/> <b>{p.subjects[topic.id]}</b></button>)}{contributors.length>3&&<span>+ {contributors.length-3} more</span>}</div>{topic.id!=='unclassified'&&data.groupSubjects&&<GroupComparison rows={data.groupSubjects} subject={topic.id} current={s.group} language={language} onGroup={group=>change({group,subject:topic.id})}/>}</article>;})}{!topicRows.length&&<p className="gv-empty">No recorded contributions in this selection. Coverage is incomplete.</p>}</section>:<section aria-label="People" className="gv-people"><div className="gv-section-heading"><h2>Who speaks for {groups[s.group]}?</h2><label className="gv-search"><span className="gv-sr">Find a person</span><input type="search" placeholder="Find a person" value={s.q} onChange={e=>change({q:e.target.value},true)} onBlur={endSearch} onKeyDown={e=>{if(e.key==='Enter')endSearch();}}/></label></div>
        <p className="gv-list-count">{list.rows.length} matching speakers</p><div className="gv-people-labels"><span>Speaker</span><span>Contributions</span><span>{s.subject?`On ${subjects[s.subject]}`:'Subjects (recorded contributions)'}</span></div>
        {list.visible.map(p=><article className={'gv-person'+(s.person===p.id?' is-selected':'')} key={p.id}><div className="gv-person-name"><PocInsightPortrait id={p.id} name={p.name} onUnavailable={()=>{}}/><div><button data-gv-person={p.id} aria-pressed={s.person===p.id} onClick={()=>choosePerson(p.id,'people')}><Name person={p} language={language}/></button>{s.person===p.id&&<button className="gv-jump" onClick={jump}>{total} contributions shown below ↓</button>}</div></div><strong className="gv-person-count">{p.count}</strong><div className="gv-person-subjects">{subjectEntries(p).filter(([id])=>!s.subject||s.subject===id).map(([id,count])=>{const active=s.person===p.id&&s.subject===id;return <button key={id} aria-pressed={active} aria-label={active?`${subjects[id]}, ${count}. Remove subject filter`:`${subjects[id]}, ${count}. Show only these contributions`} onClick={()=>change(active?{subject:null}:{person:p.id,subject:id})}>{subjects[id]} <b>{count}</b></button>;})}{s.subject&&subjectEntries(p).some(([id])=>id!==s.subject)&&<small>Also this period: {subjectEntries(p).filter(([id])=>id!==s.subject).map(([id,count])=>`${subjects[id]} ${count}`).join(' · ')}</small>}</div></article>)}
        {!list.rows.length&&<p className="gv-empty">No speakers match these filters in the available records.</p>}{list.hasMore&&<button className="gv-show-all" onClick={()=>change({peopleLimit:Math.min(1000,list.rows.length)})}>{list.rows.length>1000?'Show first 1,000 people':`Show all ${list.rows.length} people`}</button>}
      {s.peopleLimit>=1000&&list.rows.length>list.visible.length&&<p className="gv-list-count">Showing {list.visible.length.toLocaleString(language)} matches. Refine the name search to find others.</p>}</section>}
    </>}
    <section className="gv-contributions" aria-busy={page.loading}><div className="gv-section-heading"><h2 ref={heading} tabIndex={-1}>Contributions {page.data&&<small>· {page.data.total.toLocaleString(language)}</small>}</h2>{s.subject&&<span>{subjects[s.subject]}</span>}</div><InsightStatus loading={page.loading} error={page.error} retry={page.retry}/>{page.data&&<>{page.data.contributions.map(c=>{const person=people.find(p=>p.id===c.personId);return <article key={c.id+':'+c.personId}><div className="gv-contribution-meta"><time dateTime={c.date} lang={language}>{humanDate(c.date,language)}</time><span>{subjects[c.subject]}</span></div><h3>{c.websiteUrl?<a href={c.websiteUrl} target="_blank" rel="noreferrer" lang={c.titleLanguage||'en'}>{c.title||'Read contribution'} ↗</a>:<a href={insightMemberHref(c.personId,language,c.id)} lang={c.titleLanguage||'en'} onClick={props.onMember?e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();props.onMember?.(Number(c.personId),c.id);}:undefined}>{c.title||'Read contribution'}</a>}</h3>{person&&<button className="gv-contribution-person" data-gv-contribution={c.id+':'+person.id} aria-pressed={s.person===person.id} onClick={()=>choosePerson(person.id,'contribution',c.id)}><Name person={person} language={language}/></button>}</article>;})}{!page.data.contributions.length&&<p className="gv-empty">{data?.coverage.observedOralRecords?'No recorded contributions in this selection. Coverage is incomplete.':'Recorded group designations are not available yet.'}</p>}<div className="gv-pagination">{s.offset>0&&<button onClick={()=>{change({offset:Math.max(0,s.offset-20)});jump();}}>← Previous</button>}{page.data.nextOffset!==null&&<button onClick={()=>{change({offset:page.data!.nextOffset!});jump();}}>Next →</button>}</div></>}</section>
  </div></InsightShell>;
}
