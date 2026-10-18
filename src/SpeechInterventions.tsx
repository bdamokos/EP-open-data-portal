import {transcriptParagraphs,TranscriptText} from './Transcript';
import {GROUP_VOICE_GROUPS} from './groupVoiceTerms.mjs';
import {useEffect,useId,useRef,useState} from 'react';
import {api,prefetchData,useData,useSpeechData} from './data';
import type {Intervention,InterventionStatistics,Speech,SpeechContext,SpeechDetail,SpeechSequenceRow} from './explorerTypes';
import './SpeechInterventions.css';
import {SpeakerName,SpeakerRoles,SpeakerRoleLine} from './SpeakerIdentity';
import {speakerTerm} from './speakerPresentation.mjs';

const labels:Record<Intervention['type'],string>={speech:'Speech',written:'Written statement',chair:'Chair',procedure:'Procedure','oral-explanation-of-vote':'Oral explanation of vote','catch-the-eye':'Catch the eye','blue-card-question':'Blue-card question','blue-card-intervention':'Blue-card intervention','blue-card-answer':'Blue-card answer','blue-card-reaction':'Blue-card reaction','blue-card':'Blue card',unclassified:'Unclassified'};
export function InterventionIcon({type}:{type:Intervention['type']}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="intervention-icon">
    {type==='procedure'?<path d="M8 5h12M8 12h12M8 19h12M4 5h.01M4 12h.01M4 19h.01"/>:type==='catch-the-eye'?<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></>:type.startsWith('blue-card')?<><rect x="3" y="3" width="13" height="18" rx="2" fill="currentColor" fillOpacity=".12"/>{type==='blue-card-question'?<><path d="M7 8a2.5 2.5 0 0 1 5 0c0 2-2.5 1.5-2.5 4"/><path d="M9.5 16h.01"/></>:type==='blue-card-answer'?<path d="m21 8-5 4 5 4m-5-4h6"/>:<path d="m18 7 4 4-4 4m4-4h-5"/>}</>:type==='written'?<><path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7m-7 4h5"/></>:<><path d="M4 4h16v12H10l-5 4v-4H4Z"/><path d="M8 8h8m-8 4h5"/></>}
  </svg>;
}
export function InterventionBadges({value,language='en',toggle}:{value?:Intervention;language?:string;toggle?:{onClick:()=>void;expanded:boolean;controls?:string}}) {
  if(!value)return null;
  const label=value.type==='chair'?speakerTerm('chair',language):{text:labels[value.type],language:'en'};
  const badgeProps={className:'intervention-badge '+(value.type.startsWith('blue-card')?'is-blue':''),title:value.process||undefined,lang:''},badgeContent=<><InterventionIcon type={value.type}/><span lang={label.language}>{label.text}</span></>;
  return <span className="intervention-badges" lang="en">{toggle?<button type="button" {...badgeProps} onClick={toggle.onClick} aria-expanded={toggle.expanded} aria-controls={toggle.controls}>{badgeContent}</button>:<span {...badgeProps}>{badgeContent}</span>}{value.onBehalfOf.map(group=><span className="intervention-group" key={group.uri}>On behalf of {group.politicalGroup&&Object.hasOwn(GROUP_VOICE_GROUPS,group.id)?<a lang="" href={`?view=groups&gv-group=${group.id}&lang=${language}`} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',event.currentTarget.href);window.dispatchEvent(new PopStateEvent('popstate'));}}>{group.label}</a>:<span lang="">{group.label}</span>}</span>)}</span>;
}

export function InterventionStatistics({member,onItems}:{member:number;onItems?:(items:Speech[])=>void}) {
  const [state,setState]=useState<{member:number;data:InterventionStatistics|null;loading:boolean;error:string|null}>({member,data:null,loading:true,error:null});
  const [attempt,setAttempt]=useState(0);
  const {data:result,loading,error}=state.member===member?state:{data:null,loading:true,error:null};
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    void(async()=>{
      setState(previous=>({member,data:previous.member===member?previous.data:null,loading:true,error:null}));
      try {
        let page:number|null=0,restarts=0;
        while(active&&page!==null) {
          const data:InterventionStatistics=await api<InterventionStatistics>(`speech-statistics/${member}?page=${page}`,controller.signal);
          if(!active)return;
          if(data.restarted&&++restarts>2)throw new Error('Counting was interrupted.');
          onItems?.(data.items);
          setState({member,data,loading:data.nextPage!==null,error:null});
          page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:(error as Error).message}));}
    })();return()=>{active=false;controller.abort();};
  },[member,attempt,onItems]);
  return <section className="intervention-statistics" lang="en" aria-label="Speaking statistics">
    <div className="intervention-stats-heading"><h3>At the microphone</h3><div className="intervention-stats-meta"><span>Term 10</span>{loading&&<span className="intervention-counting" role="status"><span className="intervention-spinner" aria-hidden="true"/><span className="intervention-counting-label">Counting contributions…</span></span>}</div></div>
    {result&&<><div className="intervention-stats-grid" aria-busy={loading}>{[
      ['total','Total contributions','speech'],['groupOrations','On behalf of a group','speech'],['blueQuestions','Blue cards raised','blue-card-question'],['blueAnswers','Blue cards answered','blue-card-answer'],['blueReactions','Blue-card reactions','blue-card-reaction']
    ].map(([key,label,type])=><div key={key}><InterventionIcon type={type as Intervention['type']}/><strong>{key==='total'?result.coverage.available:result.counts[key as keyof typeof result.counts]??'—'}</strong><span>{label}</span></div>)}</div>
      {!loading&&!result.coverage.complete&&<p className="intervention-caption">Partial coverage</p>}
    </>}
    {error&&<p role="alert">{error} <button onClick={()=>setAttempt(a=>a+1)}>Retry counts</button></p>}
  </section>;
}

function ConnectedText({id,language}:{id:string;language:string}) {
  const state=useSpeechData(id,language),body=state.transcript;
  const paragraphs=transcriptParagraphs(body?.xml??null).paragraphs;
  return <div className="intervention-connected-text" lang={body?.textLanguage??''}>
    {state.loading&&!body&&<p lang="en" role="status">Loading contribution…</p>}{state.error&&<p lang="en">{state.error} <button onClick={state.retry}>Retry</button></p>}
    {body&&<><p className="intervention-caption" lang="en">{body.textLanguage?.toUpperCase()}{body.translationType==='machine'?' · Machine translation':''}</p>{paragraphs.length?paragraphs.map((p,i)=><p key={i}><TranscriptText paragraph={p}/></p>):<p lang="en">Transcript unavailable.</p>}{state.data?.websiteUrl&&<a lang="en" href={state.data?.websiteUrl} target="_blank" rel="noreferrer">Parliament’s transcript ↗</a>}</>}
  </div>;
}
function SequenceError({message,retryAt,loading,retry}:{message:string;retryAt?:number;loading:boolean;retry:()=>void}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{setNow(Date.now());if(!retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[retryAt]);
  const seconds=Math.max(0,Math.ceil(((retryAt||0)-now)/1000));
  return <div className="intervention-error"><p>{message}</p><button onClick={retry} disabled={loading||seconds>0}>{loading?'Retrying sequence…':seconds>0?`Retry sequence in ${seconds}s`:'Retry sequence'}</button>{loading&&<p role="status">Loading debate sequence…</p>}</div>;
}
function Sequence({debate,speechId,language,transcriptLanguage,loading,retry}:{debate:SpeechContext['debates'][number];speechId:string;language:string;transcriptLanguage:string;loading:boolean;retry:()=>void}) {
  const [full,setFull]=useState(false),[reading,setReading]=useState<string|null>(null);
  const readingRef=useRef<HTMLDivElement>(null),readingId=useId();
  const exchange=debate.exchanges.find(e=>e.ids.includes(speechId)),ids=new Set(exchange?.ids||[]);
  const selectedRows=full||!exchange?debate.records:debate.records.filter(row=>ids.has(row.id));
  // Procedural notes explain the next contribution, rather than extending a finished debate.
  const lastContribution=selectedRows.reduce((last,row,index)=>row.intervention.type==='procedure'?last:index,-1);
  const rows=selectedRows.slice(0,lastContribution+1);
  const current=rows.findIndex(row=>row.id===speechId);
  const preloadRoutes=JSON.stringify(debate.error?[]:rows
    .map((row,index)=>({row,distance:Math.abs(index-Math.max(0,current))}))
    .filter(({row})=>row.intervention.type!=='procedure'&&row.id!==speechId)
    .sort((a,b)=>a.distance-b.distance).slice(0,12)
    .map(({row})=>`speech/${encodeURIComponent(row.id)}?lang=${transcriptLanguage}`));
  useEffect(()=>prefetchData(JSON.parse(preloadRoutes)),[preloadRoutes]);
  const toggleReading=(id:string)=>setReading(value=>value===id?null:id);
  useEffect(()=>{if(reading){readingRef.current?.focus({preventScroll:true});readingRef.current?.scrollIntoView({block:'nearest'});}},[reading]);
  const time=(row:SpeechSequenceRow)=>row.start?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}).format(new Date(row.start)):null;
  return <section className="intervention-debate" lang="en">
    <div className="intervention-sequence-heading"><h4>{exchange&&!full?'Blue-card exchange':'Debate sequence'}</h4>{exchange&&<button onClick={()=>setFull(value=>!value)}>{full?'Show exchange':'Show full debate'}</button>}</div>
    <p className="intervention-caption" lang={debate.titles[language]?language:debate.titles.en?'en':''}>{debate.titles[language]||debate.titles.en||debate.id}</p>
    {debate.error?<SequenceError message={debate.error} retryAt={debate.retryAt} loading={loading} retry={retry}/>:<ol className="intervention-sequence">{rows.map(row=><li key={row.id} className={(row.id===speechId?'is-current ':'')+(row.exchangeId?'is-exchange':'')}>
      <div className="intervention-sequence-node"><InterventionIcon type={row.intervention.type}/></div>
      <div className="intervention-sequence-entry">
        {row.intervention.type==='procedure'?<p className="intervention-caption">{row.intervention.chair?<><strong><SpeakerName person={row.intervention.chair} language={language} chair/></strong><br/><SpeakerRoles person={row.intervention.chair} language={language} chair/></>:row.intervention.procedureKind==='chair-change'?'Chair change · identity unconfirmed':row.intervention.narrative?<span lang="">{row.intervention.narrative}</span>:'Procedural note · text unavailable'}</p>:<>
          <button className="intervention-read" onClick={()=>toggleReading(row.id)} aria-expanded={reading===row.id} aria-controls={reading===row.id?readingId:undefined}><SpeakerName person={row.intervention.speaker} language={language} chair={row.intervention.type==='chair'}/><small><span lang={language}>{time(row)}</span>{row.id===speechId?' · Current speech':''}</small></button>
          <SpeakerRoleLine person={row.intervention.speaker} language={language} chair={row.intervention.type==='chair'} intervention={row.intervention} className="intervention-caption"/>
          {row.id===exchange?.originalId&&<button type="button" className="intervention-reply" onClick={()=>toggleReading(row.id)} aria-expanded={reading===row.id} aria-controls={reading===row.id?readingId:undefined}>Original speech</button>}
          {row.intervention.type!=='chair'&&<InterventionBadges value={row.intervention} language={language} toggle={{onClick:()=>toggleReading(row.id),expanded:reading===row.id,controls:reading===row.id?readingId:undefined}}/>}
          {row.replyTo&&(()=>{const text=<>↳ {row.replyTo===exchange?.originalId?'To the original speech':'In reply'}</>,target=row.replyTo;
            // Opens the contribution being answered when it is part of the displayed sequence.
            return rows.some(other=>other.id===target)?<button type="button" className="intervention-reply" onClick={()=>toggleReading(target)} aria-expanded={reading===target} aria-controls={reading===target?readingId:undefined}>{text}</button>:<span className="intervention-reply">{text}</span>;})()}
          {reading===row.id&&<div ref={readingRef} tabIndex={-1} id={readingId}><ConnectedText id={row.id} language={transcriptLanguage}/></div>}
        </>}
      </div>
    </li>)}</ol>}
    {!debate.error&&!debate.coverage.complete&&<p className="intervention-caption">{debate.coverage.available} of {debate.coverage.expected??'unknown'} debate records available. Links stop at missing contributions.</p>}
  </section>;
}
export function SpeechContextPanel({id,language,transcriptLanguage=language,preload=true}:{id:string;language:string;transcriptLanguage?:string;preload?:boolean}) {
  const [open,setOpen]=useState(false);
  const route=`speech-context/${id}?lang=${language}`;
  const state=useData<SpeechContext>(open?route:null);
  useEffect(()=>preload&&!open?prefetchData([route]):undefined,[preload,open,route]);
  const controlId=useId();
  return <div className="intervention-context" lang="en"><button className="intervention-context-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls={controlId}>Debate & exchanges <span aria-hidden="true">{open?'−':'+'}</span></button>{open&&<div id={controlId}>
    {state.loading&&!state.data&&<p role="status">Loading debate sequence…</p>}{state.error&&<SequenceError message={state.error} retryAt={state.retryAt} loading={state.loading} retry={state.retry}/>}
    {state.data&&<>{state.data.unavailable&&<p>No debate is linked to this contribution.</p>}{state.data.debates.map(debate=><Sequence key={debate.id} debate={debate} speechId={id} language={language} transcriptLanguage={transcriptLanguage} loading={state.loading} retry={state.retry}/>)}</>}
  </div>}</div>;
}
