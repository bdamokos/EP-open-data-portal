import {useEffect,useId,useRef,useState} from 'react';
import {api,useData} from './pocData';
import type {Intervention,InterventionStatistics,Speech,SpeechContext,SpeechDetail,SpeechSequenceRow} from './pocTypes';
import './PocSpeechInterventions.css';

const labels:Record<Intervention['type'],string>={speech:'Speech',written:'Written statement',chair:'Chair',procedure:'Procedure','catch-the-eye':'Catch the eye','blue-card-question':'Blue-card question','blue-card-intervention':'Blue-card intervention','blue-card-answer':'Blue-card answer','blue-card-reaction':'Blue-card reaction','blue-card':'Blue card',unclassified:'Speech'};
export function InterventionIcon({type}:{type:Intervention['type']}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="intervention-icon">
    {type==='catch-the-eye'?<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></>:type.startsWith('blue-card')?<><rect x="3" y="3" width="13" height="18" rx="2" fill="currentColor" fillOpacity=".12"/>{type==='blue-card-question'?<><path d="M7 8a2.5 2.5 0 0 1 5 0c0 2-2.5 1.5-2.5 4"/><path d="M9.5 16h.01"/></>:type==='blue-card-answer'?<path d="m21 8-5 4 5 4m-5-4h6"/>:<path d="m18 7 4 4-4 4m4-4h-5"/>}</>:type==='written'?<><path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7m-7 4h5"/></>:<><path d="M4 4h16v12H10l-5 4v-4H4Z"/><path d="M8 8h8m-8 4h5"/></>}
  </svg>;
}
export function InterventionBadges({value}:{value?:Intervention}) {
  if(!value)return null;
  return <span className="intervention-badges"><span className={'intervention-badge '+(value.type.startsWith('blue-card')?'is-blue':'')} title={value.process||undefined}><InterventionIcon type={value.type}/>{labels[value.type]}</span>{value.onBehalfOf.map(group=><span className="intervention-group" key={group.uri}>On behalf of {group.label}</span>)}</span>;
}

export function PocInterventionStatistics({member,onItems}:{member:number;onItems?:(items:Speech[])=>void}) {
  const [state,setState]=useState<{member:number;data:InterventionStatistics|null;loading:boolean;error:string|null}>({member,data:null,loading:true,error:null});
  const [attempt,setAttempt]=useState(0),[all,setAll]=useState(false);
  const result=state.member===member?state.data:null;
  useEffect(()=>{setAll(false);},[member]);
  useEffect(()=>{
    let active=true;
    void(async()=>{
      setState(previous=>({member,data:previous.member===member?previous.data:null,loading:true,error:null}));
      try {
        let page:number|null=0;
        while(page!==null) {
          const data:InterventionStatistics=await api<InterventionStatistics>(`speech-statistics/${member}?page=${page}`);
          if(!active)return;
          onItems?.(data.items);
          setState({member,data,loading:all&&data.nextPage!==null,error:null});
          if(!all)break;page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:(error as Error).message}));}
    })();return()=>{active=false;};
  },[member,attempt,all,onItems]);
  return <section className="intervention-statistics" aria-label="Speaking statistics">
    <div className="intervention-stats-heading"><h3>At the microphone</h3><span>Term 10</span></div>
    {result&&<><div className="intervention-stats-grid">{[
      ['groupOrations','On behalf of a group','speech'],['blueQuestions','Blue cards raised','blue-card-question'],['blueAnswers','Blue cards answered','blue-card-answer'],['blueReactions','Blue-card reactions','blue-card-reaction']
    ].map(([key,label,type])=><div key={key}><InterventionIcon type={type as Intervention['type']}/><strong>{result.counts[key as keyof typeof result.counts]??'—'}</strong><span>{label}</span></div>)}</div>
      <p className="intervention-caption">{result.coverage.available}{result.coverage.total!==null&&result.coverage.available!==result.coverage.total?` of ${result.coverage.total}`:''} contributions{state.loading?' · Loading…':!result.coverage.complete?' · Partial coverage':''}</p>
      {result.groups.length>0&&<p className="intervention-group-counts">{result.groups.map(group=><span key={group.id}>{group.label} <strong>{group.count}</strong></span>)}</p>}
      {!state.loading&&result.nextPage!==null&&<button onClick={()=>{setAll(true);setAttempt(a=>a+1);}}>Count all contributions</button>}
      <details className="intervention-source"><summary>About these counts</summary><p>Counts use Parliament’s speech headers and recorded group designations. Blue cards answered counts replies; reactions are counted separately.</p><p>Group names refer to the designation at the time of the speech.</p>{result.coverage.headers<result.coverage.available&&<p>{result.coverage.available-result.coverage.headers} contributions have no readable English speaker header.</p>}<p>Catch-the-eye sections appear in the debate sequence.</p>{result.sources.map(item=><a key={item.url} href={item.url} target="_blank" rel="noreferrer">Source · {new Date(item.fetchedAt).toLocaleDateString()} ↗</a>)}</details>
    </>}
    {state.loading&&!result&&<p role="status">Counting contributions…</p>}
    {state.error&&<p>{state.error} <button onClick={()=>setAttempt(a=>a+1)}>Retry counts</button></p>}
  </section>;
}

function ConnectedText({id,language}:{id:string;language:string}) {
  const state=useData<SpeechDetail>(`speech/${id}?lang=${language}`);
  const xml=state.data?.xml,doc=xml?new DOMParser().parseFromString(xml,'application/xml'):null;
  const paragraphs=doc&&!doc.querySelector('parsererror')?[...doc.getElementsByTagNameNS('*','p')].map(p=>p.textContent?.replace(/\s+([,.;:!?])/g,'$1').trim()).filter(Boolean):[];
  return <div className="intervention-connected-text" lang={state.data?.textLanguage||undefined}>
    {state.loading&&!state.data&&<p role="status">Loading contribution…</p>}{state.error&&<p>{state.error} <button onClick={state.retry}>Retry</button></p>}
    {state.data&&<><p className="intervention-caption">{state.data.textLanguage?.toUpperCase()}{state.data.translationType==='machine'?' · Machine translation':''}</p>{paragraphs.length?paragraphs.map((p,i)=><p key={i}>{p}</p>):<p>Transcript unavailable.</p>}{state.data.websiteUrl&&<a href={state.data.websiteUrl} target="_blank" rel="noreferrer">Parliament’s transcript ↗</a>}</>}
  </div>;
}
function Sequence({debate,speechId,language}:{debate:SpeechContext['debates'][number];speechId:string;language:string}) {
  const [full,setFull]=useState(false),[reading,setReading]=useState<string|null>(null);
  const readingRef=useRef<HTMLDivElement>(null),readingId=useId();
  const exchange=debate.exchanges.find(e=>e.ids.includes(speechId)),ids=new Set(exchange?.ids||[]);
  const rows=full||!exchange?debate.records:debate.records.filter(row=>ids.has(row.id));
  useEffect(()=>{if(reading){readingRef.current?.focus({preventScroll:true});readingRef.current?.scrollIntoView({block:'nearest'});}},[reading]);
  const time=(row:SpeechSequenceRow)=>row.start?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}).format(new Date(row.start)):null;
  return <section className="intervention-debate">
    <div className="intervention-sequence-heading"><h4>{exchange&&!full?'Blue-card exchange':'Debate sequence'}</h4>{exchange&&<button onClick={()=>setFull(value=>!value)}>{full?'Show exchange':'Show full debate'}</button>}</div>
    <p className="intervention-caption">{debate.titles[language]||debate.titles.en||debate.id}</p>
    {debate.error?<p>{debate.error}</p>:<ol className="intervention-sequence">{rows.map(row=><li key={row.id} className={(row.id===speechId?'is-current ':'')+(row.exchangeId?'is-exchange':'')}>
      <div className="intervention-sequence-node"><InterventionIcon type={row.intervention.type}/></div>
      <div className="intervention-sequence-entry">
        {row.intervention.type==='procedure'?<p className="intervention-caption">{row.intervention.narrative}</p>:<>
          <button className="intervention-read" onClick={()=>setReading(value=>value===row.id?null:row.id)} aria-expanded={reading===row.id} aria-controls={reading===row.id?readingId:undefined}><span>{row.intervention.speaker?.name||'Contribution'}</span><small>{time(row)}{row.id===speechId?' · Current speech':''}</small></button>
          {row.id===exchange?.originalId&&<span className="intervention-reply">Original speech</span>}
          <InterventionBadges value={row.intervention}/>
          {row.replyTo&&<span className="intervention-reply">↳ {row.replyTo===exchange?.originalId?'To the original speech':'In reply'}</span>}
          {reading===row.id&&<div ref={readingRef} tabIndex={-1} id={readingId}><ConnectedText id={row.id} language={language}/></div>}
        </>}
      </div>
    </li>)}</ol>}
    <details className="intervention-source"><summary>Sequence sources</summary><p>Exchanges follow debate order, numbered contributions and speaker IDs. Catch-the-eye speeches sit between the published section markers.</p>{!debate.coverage.complete&&<p>{debate.coverage.available} of {debate.coverage.expected??'unknown'} debate records available. Links stop at missing contributions.</p>}{debate.sources?.map(item=><a key={item.url} href={item.url} target="_blank" rel="noreferrer">Source · {new Date(item.fetchedAt).toLocaleDateString()} ↗</a>)}</details>
  </section>;
}
export function PocSpeechContext({id,language}:{id:string;language:string}) {
  const [open,setOpen]=useState(false);
  const state=useData<SpeechContext>(open?`speech-context/${id}?lang=${language}`:null);
  const controlId=useId();
  return <div className="intervention-context"><button className="intervention-context-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls={controlId}>Debate & exchanges <span aria-hidden="true">{open?'−':'+'}</span></button>{open&&<div id={controlId}>
    {state.loading&&!state.data&&<p role="status">Loading debate sequence…</p>}{state.error&&<p>{state.error} <button onClick={state.retry}>Retry sequence</button></p>}
    {state.data&&<>{state.data.unavailable&&<p>No debate is linked to this contribution.</p>}{state.data.debates.map(debate=><Sequence key={debate.id} debate={debate} speechId={id} language={language}/>)}</>}
  </div>}</div>;
}
