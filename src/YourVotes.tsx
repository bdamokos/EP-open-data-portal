import {lazy,Suspense,useEffect,useState,useSyncExternalStore} from 'react';
import {useUiI18n} from './UiI18nReact';
import {api} from './data';
import {humanDate} from './InsightShared';
import {plenaryMonday,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import {ballotGroups,ballotVisible,brusselsToday,summarizeVotes,sessionDateRange,type ComparisonData,type ComparisonEntry,type Person} from './yourVoteSummary.mjs';
const DocumentContextReader=lazy(()=>import('./DocumentContextReader').then(module=>({default:module.DocumentContextReader})));
import {createYourVotesStore,YOUR_VOTES_KEY,choiceAgreement,outcomePosition,type Choice} from './yourVoteStore.mjs';
import {useSaved} from './SavedControls';
import {useDossiers} from './DossierControls';
import type {Directory} from './explorerTypes';
import type {AgendaTopic} from './LegislationTypes';
import './YourVotes.css';
const listeners=new Set<()=>void>();let storage:Storage|null=null;try{storage=window.localStorage;}catch{}
export const yourVotesStore=createYourVotesStore(storage,()=>listeners.forEach(fn=>fn()));
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
function useYourVotes(){return useSyncExternalStore(subscribe,yourVotesStore.snapshot);}
window.addEventListener('storage',event=>{if(event.key===YOUR_VOTES_KEY||event.key===null)yourVotesStore.reload();});
type Amendment={id:string;listId?:string;originalText?:string;proposedText?:string;language?:string|null};
type Row={key:string;documentId:string;revision:string|null;kind:string;motion?:string|null;amendments:{number:number;cp:number|null;deleting?:boolean}[];authors?:string[];subject:string[];subjectLanguage?:string|null;part?:number;partText?:string;vote?:{rollCall?:boolean};status?:string;outcome:string|null;decisionId:string|null;amendmentRows:Amendment[];falls?:{amendments:{number:number;cp?:number|null}[];motions?:string[];replacesMotions?:boolean;text?:string};fallsIf?:{key:string;amendments:number[];motion?:string|null}[]};
type Ballot={id:string;title:string;titleLanguage?:string|null;sittingId:string;documentId:string|null;source:string;partial?:boolean;rows:Row[];added:{decisionId:string;label:string;outcome:string}[];procedureIds:string[]};
type Ballots={items:Ballot[]};
function useBallots(sitting:string,language:string){const [data,setData]=useState<Ballots|null>(null),[error,setError]=useState(false);useEffect(()=>{const abort=new AbortController();setData(null);setError(false);api<Ballots>('upcoming-votes?'+new URLSearchParams({sitting,lang:language}),abort.signal).then(value=>{if(abort.signal.aborted)return;if(!Array.isArray(value.items)){setError(true);return;}setData(value);},()=>{if(!abort.signal.aborted)setError(true);});return()=>abort.abort();},[sitting,language]);return {data,error};}
function outcomeLabel(value:string,ui:ReturnType<typeof useUiI18n>){return ui.t('yourVote.'+(({ADOPTED:'adopted',REJECTED:'rejected',LAPSED:'lapsed',WITHDRAWN:'withdrawn'} as Record<string,string>)[value]||'unavailable'));}
function BallotRow({row,ballot,onContext}:{row:Row;ballot:Ballot;onContext:(a:Amendment)=>void}) {
  const ui=useUiI18n(),state=useYourVotes(),saved=state.choices.find(c=>c.key===row.key),[fullPart,setFullPart]=useState(false);
  const label=(key:string)=>ui.t('yourVote.'+key);
  const authors=row.authors?.map(author=>({committee:label('committee'),MEPs:label('members'),rapporteur:label('rapporteur')}[author]||author)).join(', ');
  const number=row.amendments.map(a=>a.number).join(' = '),cp=row.amendments[0]?.cp;
  const title=row.kind==='block'?ui.t('yourVote.block',{count:row.amendments.length}):cp?ui.t('yourVote.amPart',{part:cp,number}):number?ui.t('yourVote.am',{number}):label(({text:'text',motion:'motion',final:'final',procedural:'procedural'} as Record<string,string>)[row.kind]||'unavailable');
  const partText=row.partText?.replace(/\[ROLL-CALL VOTE\]/g,'').trim(),rollCall=row.vote?.rollCall||Boolean(row.partText?.includes('[ROLL-CALL VOTE]'));
  const fallsIf=row.fallsIf?.flatMap(rule=>rule.motion?[rule.motion.replace(/^B-(\d+)-(\d{4})-(\d+)$/,'B$1-$3/$2')]:rule.amendments.map(n=>ui.t('yourVote.am',{number:n})));
  const falling=[...(row.falls?.amendments.map(a=>String(a.number))||[]),...(row.falls?.motions||[]).map(id=>id.replace(/^B-(\d+)-(\d{4})-(\d+)$/,'B$1-$3/$2'))];
  const incoming=fallsIf?.length?ui.t('yourVote.fallsIf',{amendments:[...new Set(fallsIf)].join(', ')}):null;
  const outgoing=falling.length?ui.t('yourVote.fallsOnAdoption',{amendments:(row.falls?.amendments.length?'AM ':'')+falling.join(', ')}):row.falls?.replacesMotions?label('replacesMotions'):row.falls?.text;
  const fallLine=[incoming,outgoing].filter(Boolean).join(' · ');
  return <article className="your-votes-row" data-withdrawn={row.status==='withdrawn'||undefined}>
    <div className="your-votes-row-heading"><h5>{title}{authors&&<> · <span lang="">{authors}</span></>}{row.part&&<> · {label('part')} {row.part}</>}</h5>{rollCall&&<span className="your-votes-tag">{label('rollCallTag')}</span>}{row.amendments.some(a=>a.deleting)&&<span className="your-votes-tag">{label('deletes')}</span>}{row.status&&<span className="your-votes-status">{label(row.status)}</span>}</div>
    {row.kind==='block'&&<details className="your-votes-wording"><summary>{label('numbers')}</summary><p>{row.amendments.map(a=>a.number).join(', ')}</p></details>}
    {partText&&<div className="your-votes-part"><p lang="en" className={fullPart?'':'your-votes-part-preview'}>{partText}</p><button className="insight-text-button" aria-expanded={fullPart} onClick={()=>setFullPart(!fullPart)}>{label(fullPart?'hidePart':'fullPart')}</button></div>}
    {fallLine&&<p className="your-votes-note">{fallLine}</p>}
    {row.amendmentRows.map(a=><div className="your-votes-wording" key={a.id}><details><summary>{label('wording')}{row.amendmentRows.length>1?' · '+ui.t('yourVote.am',{number:a.id.split('-').at(-1)||''}):''}</summary>{a.proposedText&&<div><h6>{label('proposed')}</h6><p lang={a.language||''}>{a.proposedText}</p></div>}{a.originalText&&<div><h6>{label('original')}</h6><p lang={a.language||''}>{a.originalText}</p></div>}{!a.proposedText&&!a.originalText&&<p>{label('wordingUnavailable')}</p>}</details><button className="insight-text-button" onClick={()=>onContext(a)}>{label('context')}</button></div>)}
    <div className="your-votes-row-footer"><div className="your-votes-choices" role="group" aria-label={label('choice')}>{(['for','against','abstaining'] as Choice[]).map(choice=><button key={choice} aria-pressed={saved?.choice===choice} disabled={Boolean(row.status)} onClick={()=>yourVotesStore.choose({key:row.key,documentId:row.documentId,agendaItemId:ballot.id,sittingId:ballot.sittingId,revision:row.revision,choice:saved?.choice===choice?null:choice})}>{label(choice)}</button>)}</div>
      {row.outcome&&<p className="your-votes-result">{label('result')}: <strong>{outcomeLabel(row.outcome,ui)}</strong>{saved&&<> · {label('choice')}: {label(saved.choice)} · {choiceAgreement(saved.choice,outcomePosition(row.outcome))===null?label('noComparison'):label(choiceAgreement(saved.choice,outcomePosition(row.outcome))?'agree':'disagree')}</>}</p>}
      {!row.outcome&&ballot.sittingId.slice(7)<brusselsToday()&&<p className="your-votes-note">{label('unmatched')}</p>}
    </div>
  </article>;
}
export function BallotCard({ballot,language,deadlines=[]}:{ballot:Ballot;language:string;deadlines?:AgendaTopic['deadlines']}) {
  const ui=useUiI18n(),state=useYourVotes(),[all,setAll]=useState(false),[context,setContext]=useState<{documentId:string;amendmentId?:string;listId?:string}|null>(null),groups=ballotGroups(ballot.rows);
  const orphaned=state.choices.filter(c=>c.sittingId===ballot.sittingId&&c.agendaItemId===ballot.id&&c.documentId===ballot.documentId&&!ballot.rows.some(r=>r.key===c.key));
  const starred=state.stars.some(s=>s.id===ballot.id&&s.sittingId===ballot.sittingId),label=(key:string)=>ui.t('yourVote.'+key);
  const upcoming=ballot.sittingId.slice(7)>=brusselsToday(),unpublished=upcoming&&ballot.source==='tabled';
  if(!ballotVisible(ballot.sittingId,ballot.source))return null;
  return <section className="your-votes" lang={ui.messageLocale('yourVote.list')}><header><h3>{label(ballot.source==='voting-list'||unpublished?'list':ballot.source==='retained'?'results':'tabled')}</h3><button aria-pressed={starred} onClick={()=>yourVotesStore.toggleStar({id:ballot.id,sittingId:ballot.sittingId,title:ballot.title})}>{label(starred?'unstar':'star')}</button></header>{state.storageError&&<p role="status">{label('storageError')}</p>}
    {unpublished&&<div className="your-votes-unpublished"><p>{label('notPublished')}</p>{deadlines.filter(d=>d.end&&Number.isFinite(Date.parse(d.end))&&/AMENDMENT/.test(String(typeof d.type==='object'?d.type?.id:d.type))||d.end&&Number.isFinite(Date.parse(d.end))&&/amendments/i.test(d.labels?.en||'')).map(d=><p key={d.id}>{ui.t('yourVote.due',{date:new Intl.DateTimeFormat(ui.language==='en'?'en-GB':ui.locale,{day:'numeric',month:'long',timeZone:'Europe/Brussels'}).format(new Date(d.end!)),time:new Intl.DateTimeFormat(ui.language==='en'?'en-GB':ui.locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Brussels'}).format(new Date(d.end!))})}</p>)}<h4>{label('tabled')}</h4></div>}
    {ballot.partial&&<p>{label(ballot.rows.length?'partial':'amendmentsUnavailable')}</p>}{!ballot.rows.length&&!ballot.partial&&<p>{label('empty')}</p>}
    {(all?groups:groups.slice(0,12)).map((group,i)=><section className="your-votes-group" key={i}><h4 lang={ballot.source==='voting-list'?'en':group.rows[0].subjectLanguage||''}>{group.subject.join(' / ')||label('other')}</h4>{group.rows.map(row=><BallotRow key={row.key} row={row} ballot={ballot} onContext={a=>setContext({documentId:row.documentId,amendmentId:a.id,listId:a.listId})}/>)}</section>)}
    {groups.length>12&&<button className="insight-text-button your-votes-show-all" aria-expanded={all} onClick={()=>setAll(!all)}>{all?label('showLess'):ui.t('yourVote.showAll',{count:ballot.rows.length})}</button>}
    {orphaned.map(choice=><p key={choice.key}>{label('earlierChoice')}: {label(choice.choice)} · {label(upcoming?'changed':'unmatched')} <button onClick={()=>yourVotesStore.choose({...choice,choice:null})}>{label('removeChoice')}</button></p>)}{ballot.added.map(row=><p key={row.decisionId}>{label('added')}: {row.label} · {outcomeLabel(row.outcome,ui)}</p>)}
    {context&&<Suspense fallback={<p>{label('loading')}</p>}><DocumentContextReader language={language} request={{...context,view:'document',onBack:()=>setContext(null)}}/></Suspense>}
  </section>;
}
export function AgendaBallot({sitting,agendaItemId,language,deadlines}:{sitting:string;agendaItemId:string;language:string;deadlines?:AgendaTopic['deadlines']}) {const {data,error}=useBallots(sitting,language),ui=useUiI18n();const items=data?.items.filter(b=>b.id===agendaItemId)||[];return error||data&&!items.length?sitting.slice(7)<brusselsToday()?null:<p>{ui.t('yourVote.error')}</p>:<>{items.map(b=><BallotCard key={b.documentId} ballot={b} language={language} deadlines={deadlines}/>)}</>;}
function ComparisonSummary({entries,comparisons,people}:{entries:ComparisonEntry[];comparisons:Record<string,ComparisonData>;people:Person[]}) {
  const ui=useUiI18n(),summary=summarizeVotes(entries,comparisons,people);
  if(!summary.result.total&&!summary.groups.length&&!summary.members.length)return null;
  return <div className="your-votes-summary-comparison">{summary.result.total>0&&<p className="your-votes-summary-result">{ui.t('yourVote.resultAgreement',summary.result)}</p>}{summary.groups.length>0&&<dl className="your-votes-comparison-counts">{summary.groups.map(g=><div key={g.id}><dt>{g.id}</dt><dd>{ui.t('yourVote.countAgreement',g)}</dd></div>)}</dl>}{summary.members.length>0&&<dl className="your-votes-comparison-counts your-votes-member-counts">{summary.members.map(p=><div key={p.id}><dt>{p.name}</dt><dd>{ui.t('yourVote.countAgreement',p)}</dd></div>)}</dl>}</div>;
}
function FollowingSession({sittings,dates,language,people,dossiers}:{sittings:string[];dates:string[];language:string;people:Person[];dossiers:string[]}) {
  const state=useYourVotes(),ui=useUiI18n(),[data,setData]=useState<Ballot[]|null>(null),[failed,setFailed]=useState(false),[comparisons,setComparisons]=useState<Record<string,ComparisonData>>({}),[comparisonFailed,setComparisonFailed]=useState(false);
  const sittingKey=sittings.join(',');
  useEffect(()=>{const abort=new AbortController();setData(null);setFailed(false);
    Promise.allSettled(sittingKey.split(',').map(sitting=>api<Ballots>('upcoming-votes?'+new URLSearchParams({sitting,lang:language}),abort.signal))).then(results=>{if(abort.signal.aborted)return;setFailed(results.some(r=>r.status==='rejected'||!Array.isArray(r.value.items)));setData(results.flatMap(r=>r.status==='fulfilled'&&Array.isArray(r.value.items)?r.value.items:[]));});return()=>abort.abort();
  },[sittingKey,language]);
  const eligible=data?.filter(b=>state.stars.some(s=>s.id===b.id&&s.sittingId===b.sittingId)||state.choices.some(c=>c.agendaItemId===b.id&&c.sittingId===b.sittingId)||b.rows.some(row=>state.choices.some(c=>c.key===row.key))||b.procedureIds.some(p=>dossiers.includes(p)))||[];
  const entries=(ballots:Ballot[])=>ballots.flatMap(b=>b.rows.flatMap(r=>{const choice=state.choices.find(c=>c.key===r.key);return choice?[{choice:choice.choice,outcome:r.outcome,decisionId:r.decisionId}]:[];}));
  // Request every bound roll call of each loaded held sitting. Neither the
  // request set nor its parameters depend on which rows have local choices.
  const comparisonSittings=[...new Set((data||[]).filter(b=>b.sittingId.slice(7)<=brusselsToday()&&b.rows.some(r=>r.decisionId)).map(b=>b.sittingId))].sort().join(',');
  useEffect(()=>{const abort=new AbortController();setComparisons({});setComparisonFailed(false);if(!comparisonSittings)return;
    const ids=comparisonSittings.split(',');let cursor=0;
    const worker=async()=>{while(cursor<ids.length){const sitting=ids[cursor++];try{const value=await api<{items:(ComparisonData&{decisionId:string})[]}>('ballot-comparisons?'+new URLSearchParams({sitting,lang:language}),abort.signal);if(!Array.isArray(value.items))throw Error();if(!abort.signal.aborted)setComparisons(previous=>({...previous,...Object.fromEntries(value.items.map(item=>[item.decisionId,item]))}));}catch{if(!abort.signal.aborted)setComparisonFailed(true);}}};
    Promise.all(Array.from({length:Math.min(4,ids.length)},worker));return()=>abort.abort();
  },[comparisonSittings,language]);
  const missing=Boolean(data&&state.stars.some(star=>sittings.includes(star.sittingId)&&!data.some(b=>b.id===star.id))||data&&state.choices.some(choice=>sittings.includes(choice.sittingId)&&!data.some(b=>b.id===choice.agendaItemId)));
  if(data&&!eligible.length&&!failed&&!missing)return null;
  return <section className="your-votes-session"><h3 lang={ui.language}>{sessionDateRange(dates,ui.language)}</h3><ComparisonSummary entries={entries(eligible)} comparisons={comparisons} people={people}/>{(failed||missing)&&<p>{ui.t('yourVote.error')}</p>}{comparisonFailed&&<p>{ui.t('yourVote.comparisonUnavailable')}</p>}{!data&&<p>{ui.t('insightshared.loading')}</p>}
    {eligible.map(b=>{const count=b.rows.filter(r=>state.choices.some(c=>c.key===r.key)).length,starred=state.stars.some(s=>s.id===b.id&&s.sittingId===b.sittingId);return <article className="your-votes-summary-card" key={b.id+':'+b.documentId}><header><h4 lang={b.titleLanguage||''}>{b.title}</h4>{starred&&<button className="insight-text-button" onClick={()=>yourVotesStore.toggleStar({id:b.id,sittingId:b.sittingId})}>{ui.t('yourVote.unfollow')}</button>}</header><time dateTime={b.sittingId.slice(7)} lang={ui.language}>{humanDate(b.sittingId.slice(7),ui.language)}</time><p>{count?ui.t('yourVote.choiceCount',{count,total:b.rows.length}):ui.t('yourVote.noChoices')}</p><ComparisonSummary entries={entries([b])} comparisons={comparisons} people={people}/><a className="your-votes-open" href={'?'+new URLSearchParams({view:'legislation',lang:language,'agenda-period':'sitting:'+b.sittingId,'agenda-topic':b.id})}>{ui.t('yourVote.open')}</a></article>;})}
  </section>;
}
export function YourVotes({language,members}:{language:string;members?:Directory['members']}) {
  const state=useYourVotes(),saved=useSaved(),dossiers=useDossiers(),ui=useUiI18n(),[picked,setPicked]=useState(''),[calendar,setCalendar]=useState<string[]>([]),[dossierSittings,setDossierSittings]=useState<string[]>([]),[periods,setPeriods]=useState<VotePeriodsResponse['weeks']>([]);
  const hasSavedVotes=state.choices.length>0||state.stars.length>0||dossiers.items.length>0;
  useEffect(()=>{if(!hasSavedVotes)return;const abort=new AbortController();api<VotePeriodsResponse>('vote-periods',abort.signal).then(data=>{if(Array.isArray(data.weeks))setPeriods(data.weeks);},()=>{});return()=>abort.abort();},[hasSavedVotes]);
  const dossierSelection=dossiers.items.map(d=>d.id).sort().join(','),hasDossiers=Boolean(dossierSelection),needsCalendar=hasDossiers||state.choices.length>0;
  useEffect(()=>{const abort=new AbortController();setDossierSittings([]);if(!dossierSelection)return;
    api<{epoch:string;generation:number;marksReady:boolean}>('insights/following-status',abort.signal).then(async status=>{
      if(!status.marksReady)return;
      const data=await api<{items:{entries:{sourceId?:string}[]}[]}>('insights/following-dossiers?'+new URLSearchParams({epoch:status.epoch,generation:String(status.generation),procedures:dossierSelection}),abort.signal);
      if(!abort.signal.aborted)setDossierSittings(data.items.flatMap(item=>item.entries.flatMap(entry=>entry.sourceId?.match(/MTG-PL-\d{4}-\d{2}-\d{2}/g)||[])));
    }).catch(()=>{});return()=>abort.abort();
  },[dossierSelection]);
  useEffect(()=>{if(!needsCalendar)return;const abort=new AbortController();api<{sittings:{id:string;date:string}[]}>('insights/legislation?lang='+language,abort.signal).then(data=>setCalendar(data.sittings.filter(s=>s.date>=new Date(Date.now()-7*86400000).toISOString().slice(0,10)&&s.date<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)).map(s=>s.id)),()=>{});return()=>abort.abort();},[needsCalendar,language]);
  const selectedPeople=new Set([...saved.items.filter(s=>s.kind==='mep').map(s=>s.id),...(picked?[picked]:[])]);
  const people=[...selectedPeople].map(id=>{const member=members?.find(m=>String(m.id)===id);return {id,name:member?member.firstName+' '+member.lastName:saved.items.find(s=>s.kind==='mep'&&s.id===id)?.title||ui.t('yourVote.mep')};});
  const sittings=[...new Set([...dossierSittings,...dossiers.items.flatMap(d=>d.entries.flatMap(e=>(e.sourceId||e.id).match(/MTG-PL-\d{4}-\d{2}-\d{2}/g)||[])),...calendar,...state.choices.map(c=>c.sittingId),...state.stars.map(c=>c.sittingId)])].sort().reverse();
  const sessions=new Map<string,string[]>();for(const sitting of sittings){const week=plenaryMonday(sitting.slice(7));if(week)sessions.set(week,[...(sessions.get(week)||[]),sitting]);}
  return <section className="your-votes-following" lang={ui.messageLocale('yourVote.yours')}><h2>{ui.t('yourVote.yours')}</h2><label className="your-votes-picker">{ui.t('yourVote.pick')} <select value={picked} onChange={e=>setPicked(e.target.value)}><option value="">{ui.t('yourVote.pick')}</option>{members?.map(m=><option key={m.id} value={m.id}>{m.firstName+' '+m.lastName}</option>)}</select></label><p className="your-votes-note">{ui.t('yourVote.rollCall')}</p>{!sittings.length&&<p>{ui.t('yourVote.noSaved')}</p>}{[...sessions].map(([week,days])=><FollowingSession key={week} sittings={days} dates={periods.find(p=>p.week===week)?.sittings.map(s=>s.date)||days.map(s=>s.slice(7))} language={language} people={people} dossiers={dossiers.items.map(d=>d.id.replace(/^(\d{4})\/(\d{4})[A-Z]?\([A-Z]+\)$/,'$1-$2'))}/>)}</section>;
}
