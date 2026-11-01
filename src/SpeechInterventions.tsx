import {uiErrorText} from './uiErrors.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {useSpeechTranslation} from './SpeechTranslation';
import {AvailabilityNote,PartialValue} from './AvailabilityNote';
import {sourceAvailability} from '../server/source-availability.mjs';
import {brusselsDay} from '../server/analysis-period.mjs';
import {transcriptParagraphs,TranscriptText} from './Transcript';
import {GROUP_VOICE_GROUPS, GROUP_VOICE_GROUPSUi} from './groupVoiceTerms.mjs';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {api,prefetchData,useData} from './data';
import type {Intervention,InterventionStatistics,Speech,SpeechContext,SpeechDetail,SpeechSequenceRow} from './explorerTypes';
import './SpeechInterventions.css';
import {SpeakerName,SpeakerRoles,SpeakerRoleLine} from './SpeakerIdentity';
import {speakerTerm} from './speakerPresentation.mjs';
import {humanDate} from './InsightCharts';
import {selectLanguageText} from './language.mjs';
import {useSpeechVideo} from './SpeechPlayer';

const labels:Record<Intervention['type'],string>={speech:'Speech',written:'Written statement',chair:'Chair',procedure:'Procedure','oral-explanation-of-vote':'Oral explanation of vote','catch-the-eye':'Catch the eye','blue-card-question':'Blue-card question','blue-card-intervention':'Blue-card intervention','blue-card-answer':'Blue-card answer','blue-card-reaction':'Blue-card reaction','blue-card':'Blue card',unclassified:'Unclassified'};
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({speech:ui.t("dossieractivity.speech"),written:ui.t("insightshared.written_statement"),chair:ui.t("batch4.speechinterventions.tsx.chair"),procedure:ui.t("batch4.speechinterventions.tsx.procedure"),'oral-explanation-of-vote':ui.t("batch4.speechinterventions.tsx.oral.explanation.of.vote"),'catch-the-eye':ui.t("batch4.speechinterventions.tsx.catch.the.eye"),'blue-card-question':ui.t("batch4.speechinterventions.tsx.blue.card.question"),'blue-card-intervention':ui.t("batch4.speechinterventions.tsx.blue.card.intervention"),'blue-card-answer':ui.t("batch4.speechinterventions.tsx.blue.card.answer"),'blue-card-reaction':ui.t("batch4.speechinterventions.tsx.blue.card.reaction"),'blue-card':ui.t("batch4.speechinterventions.tsx.blue.card"),unclassified:ui.t("groupVoices.subject.16")});

export const speechCategories=[
  ['total','Total contributions','speech'],['groupOrations','On behalf of a group','speech'],['written','Written statements','written'],['blueQuestions','Blue cards raised','blue-card-question'],['blueAnswers','Blue cards answered','blue-card-answer'],['blueReactions','Blue-card reactions','blue-card-reaction'],['chair','Chairing contributions','chair']
] as const;
export const speechCategoriesUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : ReadonlyArray<readonly [SpeechCategory, string, Intervention['type']]> => ([
  ['total',ui.t("batch4.speechinterventions.tsx.total.contributions"),'speech'],['groupOrations',ui.t("batch4.speechinterventions.tsx.on.behalf.of.a.group"),'speech'],['written',ui.t("batch4.speechinterventions.tsx.written.statements"),'written'],['blueQuestions',ui.t("batch4.speechinterventions.tsx.blue.cards.raised"),'blue-card-question'],['blueAnswers',ui.t("batch4.speechinterventions.tsx.blue.cards.answered"),'blue-card-answer'],['blueReactions',ui.t("batch4.speechinterventions.tsx.blue.card.reactions"),'blue-card-reaction'],['chair',ui.t("batch4.speechinterventions.tsx.chairing.contributions"),'chair']
] as const);

export type SpeechCategory=typeof speechCategories[number][0];
export function matchesSpeechCategory(speech:Speech,category:SpeechCategory) {
  const intervention=speech.intervention;
  switch(category){
    case 'total':return true;
    case 'chair':return intervention?.type==='chair';
    case 'written':return speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT';
    case 'groupOrations':return Boolean(intervention?.onBehalfOf.some(group=>group.politicalGroup));
    case 'blueQuestions':return intervention?.type==='blue-card-question'||intervention?.type==='blue-card-intervention';
    case 'blueAnswers':return intervention?.type==='blue-card-answer';
    case 'blueReactions':return intervention?.type==='blue-card-reaction';
  }
}
export function InterventionIcon({type}:{type:Intervention['type']}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="intervention-icon">
    {type==='chair'?<><g transform="rotate(-40 10 8)"><rect x="4" y="4" width="12" height="6" rx="1"/><path d="M9 10v9a1 1 0 0 0 2 0v-9"/></g><path d="M13 22h9"/></>:type==='procedure'?<path d="M8 5h12M8 12h12M8 19h12M4 5h.01M4 12h.01M4 19h.01"/>:type==='catch-the-eye'?<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></>:type.startsWith('blue-card')?<><rect x="3" y="3" width="13" height="18" rx="2" fill="currentColor" fillOpacity=".12"/>{type==='blue-card-question'?<><path d="M7 8a2.5 2.5 0 0 1 5 0c0 2-2.5 1.5-2.5 4"/><path d="M9.5 16h.01"/></>:type==='blue-card-answer'?<path d="m21 8-5 4 5 4m-5-4h6"/>:<path d="m18 7 4 4-4 4m4-4h-5"/>}</>:type==='written'?<><path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7m-7 4h5"/></>:<><path d="M4 4h16v12H10l-5 4v-4H4Z"/><path d="M8 8h8m-8 4h5"/></>}
  </svg>;
}
export function InterventionBadges({value,language='en'}:{value?:Intervention;language?:string}) {
  const ui = useUiI18n();
  if(!value)return null;
  const label=(value.type==='chair') ? speakerTerm('chair',language) : ({text:labelsUi(ui)[value.type],language:ui.language});
  const badgeProps={className:'intervention-badge '+(value.type.startsWith('blue-card') ? 'is-blue' : ''),title:value.process||undefined,lang:''},badgeContent=<><InterventionIcon type={value.type}/><span lang={label.language}>{label.text}</span></>;
  return <span className="intervention-badges" lang={ui.language}><span {...badgeProps}>{badgeContent}</span>{value.onBehalfOf.map(group=><span className="intervention-group" key={group.uri}><UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group: ((group.politicalGroup && Object.hasOwn(GROUP_VOICE_GROUPS,group.id)) ? <a lang="" href={`?view=groups&gv-group=${group.id}&lang=${language}`} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(history.state,'',event.currentTarget.href);window.dispatchEvent(new PopStateEvent('popstate'));}}>{group.label}</a> : <span lang="">{group.label}</span>)}}/></span>)}</span>;
}

export function InterventionStatistics({member,onItems,onStatus,filter}:{member:number;onItems?:(items:Speech[])=>void;onStatus?:(status:'loading'|'ready'|'unavailable')=>void;filter?:{selected:string;href:(category:SpeechCategory)=>string;select:(category:SpeechCategory)=>void}}) {
  const ui = useUiI18n();
  const [state,setState]=useState<{member:number;data:InterventionStatistics|null;loading:boolean;error:string|null}>({member,data:null,loading:true,error:null});
  const [attempt,setAttempt]=useState(0);
  const {data:result,loading,error}=(state.member===member) ? state : ({data:null,loading:true,error:null});
  const sourceUnavailable=Boolean(result?.coverage.issues?.includes('source-unavailable'));
  const status=loading ? 'loading' : ((error||!result||sourceUnavailable) ? 'unavailable' : 'ready');
  useEffect(()=>onStatus?.(status),[onStatus,status]);
  const missingContributions=result&&((result.coverage.total!==null&&result.coverage.available<result.coverage.total)||(result.coverage.issues||[]).some(issue=>!['retained-corpus','total-unavailable'].includes(issue)));
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    void(async()=>{
      setState(previous=>({member,data:(previous.member===member) ? previous.data : null,loading:true,error:null}));
      try {
        let page:number|null=0,restarts=0;
        while(active&&page!==null) {
          const data:InterventionStatistics=await api<InterventionStatistics>(`speech-statistics/${member}?page=${page}`,controller.signal, undefined, ui);
          if(!active)return;
          if(data.restarted&&++restarts>2)throw new Error(ui.t("batch4.speechinterventions.tsx.counting.was.interrupted"));
          onItems?.(data.items);
          setState({member,data,loading:data.nextPage!==null,error:null});
          page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:uiErrorText(error,ui)}));}
    })();return()=>{active=false;controller.abort();};
  },[member,attempt,onItems]);
  return <section className="intervention-statistics" lang={ui.language} aria-label={ui.t("batch4.speechinterventions.tsx.speaking.statistics")}>
    <div className="intervention-stats-heading"><h3><UiMessage id="batch4.speechinterventions.tsx.at.the.microphone"/></h3><div className="intervention-stats-meta"><span><UiMessage id="batch4.speechinterventions.tsx.term.10"/></span>{loading&&<span className="intervention-counting" role="status"><span className="intervention-spinner" aria-hidden="true"/><span className="intervention-counting-label"><UiMessage id="batch4.speechinterventions.tsx.counting.contributions"/></span></span>}</div></div>
    {result&&<><div className="intervention-stats-grid" aria-busy={loading}>{speechCategoriesUi(ui).map(([key,label,type])=>{
      const chairs=result.items.filter(item=>matchesSpeechCategory(item,'chair')).length;
      if(key==='chair'&&!chairs)return null;
      const written=result.items.filter(item=>matchesSpeechCategory(item,'written')).length;
      const count=result.coverage.issues?.includes('source-unavailable') ? null : (key==='total') ? result.coverage.available : ((key==='chair') ? chairs : ((key==='written') ? ((written||result.coverage.complete) ? written : null) : (result.counts[key]??null)));
      return <div key={key}><InterventionIcon type={type}/><strong>{(filter && (count!==null)) ? <a href={filter.href(key)} aria-label={ui.t("batch4.speechinterventions.tsx.label.count.filter.contributions", {label: String(label), count: String(count)})} aria-current={(filter.selected===key) ? 'true' : undefined} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();filter.select(key);}}>{count}</a> : (count??'—')}</strong><span>{count===null ? label : ui.t('ui.speechStat.'+key,{}, {count})}{count!==null&&key!=='total'&&result.coverage.unclassified>0&&<PartialValue partial/>}</span></div>;
    })}</div>
      {!loading&&<>
        <AvailabilityNote showGaps={false} sources={result.availability||sourceAvailability({sourceKey:'speech-metadata',family:'speeches',start:'2024-07-16',end:brusselsDay(),latestObservedDate:result.coverage.latestDataDate,observedRecords:result.coverage.available,route:'public-api',checkedAt:result.sources.map(source=>source.fetchedAt).filter(Boolean).sort().at(-1)})} kind="speech.record" language={ui.locale} partial={Boolean(missingContributions||result.coverage.unclassified>0)} end={brusselsDay()}/>
        {missingContributions&&result.coverage.total!==null&&result.coverage.total>result.coverage.available&&<p className="intervention-caption"><UiMessage id="coverage.contributionsUnloaded" values={{count:result.coverage.total-result.coverage.available}}/></p>}
        {result.coverage.unclassified>0&&<p className="intervention-caption">{<UiMessage id="batch4.speechinterventions.tsx.count.contributions.could.not.be.classified" values={{count: result.coverage.unclassified}} counts={{count: result.coverage.unclassified}}/>}</p>}
      </>}
    </>}
    {(error||sourceUnavailable)&&!loading&&<p role="alert">{error||ui.t('app.contributions_unavailable')} <button onClick={()=>setAttempt(a=>a+1)}><UiMessage id="batch4.speechinterventions.tsx.retry.counts"/></button></p>}
  </section>;
}

function ConnectedText({speech,language}:{speech:SpeechSequenceRow;language:string}) {
  const ui = useUiI18n();
  const translation=useSpeechTranslation(speech.id,language),state=translation.state,body=state.transcript;
  const video=useSpeechVideo((((speech.kind!=='PLENARY_DEBATE_WRITTEN_STATEMENT') && speech.start) && speech.end) ? speech : null,language);
  const paragraphs=transcriptParagraphs(body?.xml??null).paragraphs;
  return <div className="intervention-connected-text" lang={body?.textLanguage??''}>
    {(body||video.toggle||translation.control)&&<div className="intervention-connected-tools">{body&&<p className="intervention-caption" lang={ui.language}>{body.textLanguage?.toUpperCase()}</p>}{translation.control}{video.toggle}</div>}
    {video.panel}{translation.originalGap&&<p lang={ui.language}><UiMessage id="batch4.speechinterventions.tsx.original.text.unavailable"/></p>}
    {state.loading&&!body&&<p lang={ui.language} role="status"><UiMessage id="batch4.speechinterventions.tsx.loading.contribution"/></p>}{state.error&&<p lang={ui.language}>{state.error} <button onClick={state.retry}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
    {body&&(paragraphs.length ? paragraphs.map((p,i)=><p key={i}><TranscriptText paragraph={p}/></p>) : <p lang={ui.language}><UiMessage id="batch4.speechinterventions.tsx.transcript.unavailable"/></p>)}
  </div>;
}
function SequenceError({message,retryAt,loading,retry}:{message:string;retryAt?:number;loading:boolean;retry:()=>void}) {
  const ui = useUiI18n();
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{setNow(Date.now());if(!retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[retryAt]);
  const seconds=Math.max(0,Math.ceil(((retryAt||0)-now)/1000));
  return <div className="intervention-error"><p>{message}</p><button onClick={retry} disabled={loading||seconds>0}>{loading ? ui.t("batch4.speechinterventions.tsx.retrying.sequence") : ((seconds>0) ? ui.t("batch4.speechinterventions.tsx.retry.sequence.in.seconds.s", {seconds: String(seconds)}) : ui.t("batch4.speechinterventions.tsx.retry.sequence"))}</button>{loading&&<p role="status"><UiMessage id="batch4.speechinterventions.tsx.loading.debate.sequence"/></p>}</div>;
}
function scrollParent(node:HTMLElement):{scrollBy:(x:number,y:number)=>void;bottom:number} {
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const overflow=window.getComputedStyle(parent).overflowY;
    if(/(auto|scroll)/.test(overflow)&&parent.scrollHeight>parent.clientHeight)return {scrollBy:(x,y)=>parent.scrollBy(x,y),bottom:parent.getBoundingClientRect().bottom};
  }
  return {scrollBy:(x,y)=>window.scrollBy(x,y),bottom:window.innerHeight};
}
function Sequence({debate,speechId,language,transcriptLanguage,loading,retry}:{debate:SpeechContext['debates'][number];speechId:string;language:string;transcriptLanguage:string;loading:boolean;retry:()=>void}) {
  const ui = useUiI18n();
  const [full,setFull]=useState(false),[reading,setReading]=useState<string|null>(null);
  const readingRef=useRef<HTMLDivElement>(null),readingId=useId();
  const exchange=debate.exchanges.find(e=>e.ids.includes(speechId)),ids=new Set(exchange?.ids||[]);
  const selectedRows=(full||!exchange) ? debate.records : debate.records.filter(row=>ids.has(row.id));
  // Procedural notes explain the next contribution, rather than extending a finished debate.
  const lastContribution=selectedRows.reduce((last,row,index)=>(row.intervention.type==='procedure') ? last : index,-1);
  const rows=selectedRows.slice(0,lastContribution+1);
  const current=rows.findIndex(row=>row.id===speechId);
  const preloadRoutes=JSON.stringify(debate.error ? ([]) : rows
    .map((row,index)=>({row,distance:Math.abs(index-Math.max(0,current))}))
    .filter(({row})=>row.intervention.type!=='procedure'&&row.id!==speechId)
    .sort((a,b)=>a.distance-b.distance).slice(0,12)
    .map(({row})=>`speech/${encodeURIComponent(row.id)}?lang=${transcriptLanguage}`));
  useEffect(()=>prefetchData(JSON.parse(preloadRoutes)),[preloadRoutes]);
  const anchorRef=useRef<{control:HTMLElement;top:number;own:boolean}|null>(null);
  const toggleReading=(id:string,control:HTMLElement,own=true)=>{
    anchorRef.current={control,top:control.getBoundingClientRect().top,own};
    setReading(value=>(value===id) ? null : id);
  };
  // Closing a contribution above the tapped one shortens the page; keep the tapped control where the reader left it.
  useLayoutEffect(()=>{
    const anchor=anchorRef.current;anchorRef.current=null;
    const scroller=anchor?.control.isConnected ? scrollParent(anchor.control) : null;
    if(anchor&&scroller){const shift=anchor.control.getBoundingClientRect().top-anchor.top;if(shift)scroller.scrollBy(0,shift);}
    const reader=readingRef.current;
    if(!reading||!reader)return;
    reader.focus({preventScroll:true});
    // Reply links open a contribution elsewhere in the sequence, so bring that one into view.
    if(anchor&&!anchor.own)reader.closest('li')?.querySelector('.intervention-read')?.scrollIntoView({block:'start'});
    // A header tapped near the bottom edge scrolls just enough to show the opening lines.
    else if(scroller){const hidden=reader.getBoundingClientRect().top+160-scroller.bottom;if(hidden>0)scroller.scrollBy(0,hidden);}
  },[reading]);
  const time=(row:SpeechSequenceRow)=>row.start ? new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}).format(new Date(row.start)) : null;
  const title=selectLanguageText(debate.titles,language,debate.id,'');
  return <section className="intervention-debate" lang={ui.language}>
    <div className="intervention-sequence-heading"><h4>{(exchange && (!full)) ? <UiMessage id="batch4.speechinterventions.tsx.blue.card.exchange"/> : <UiMessage id="batch4.speechinterventions.tsx.debate.sequence"/>}</h4>{exchange&&<button onClick={()=>setFull(value=>!value)}>{full ? <UiMessage id="batch4.speechinterventions.tsx.show.exchange"/> : <UiMessage id="batch4.speechinterventions.tsx.show.full.debate"/>}</button>}</div>
    <p className="intervention-caption" lang={title.language}>{title.text}</p>
    {debate.error ? <SequenceError message={debate.error} retryAt={debate.retryAt} loading={loading} retry={retry}/> : <ol className="intervention-sequence">{rows.map(row=><li key={row.id} className={((row.id===speechId) ? 'is-current ' : '')+(row.exchangeId ? 'is-exchange' : '')}>
      <div className="intervention-sequence-node"><InterventionIcon type={row.intervention.type}/></div>
      <div className="intervention-sequence-entry">
        {(row.intervention.type==='procedure') ? <p className="intervention-caption">{row.intervention.chair ? <><strong><SpeakerName person={row.intervention.chair} language={language} chair/></strong><br/><SpeakerRoles person={row.intervention.chair} language={language} chair/></> : ((row.intervention.procedureKind==='chair-change') ? ui.t("batch4.speechinterventions.tsx.chair.change.identity.unconfirmed") : (row.intervention.narrative ? <span lang="">{row.intervention.narrative}</span> : ui.t("batch4.speechinterventions.tsx.procedural.note.text.unavailable")))}</p> : <>
          <button type="button" className="intervention-read" onClick={event=>toggleReading(row.id,event.currentTarget)} aria-expanded={reading===row.id} aria-controls={(reading===row.id) ? readingId : undefined}><span className="intervention-read-label"><SpeakerName person={row.intervention.speaker} language={language} chair={row.intervention.type==='chair'}/><small>{row.id===speechId ? <UiMessage id="batch4.speechinterventions.tsx.time.current.speech" values={{time:<span lang={language}>{time(row)}</span>}}/> : <span lang={language}>{time(row)}</span>}</small></span><svg className="intervention-read-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
          <SpeakerRoleLine person={row.intervention.speaker} language={language} chair={row.intervention.type==='chair'} intervention={row.intervention} className="intervention-caption"/>
          {row.id===exchange?.originalId&&<span className="intervention-reply"><UiMessage id="batch4.speechinterventions.tsx.original.speech"/></span>}
          {row.intervention.type!=='chair'&&<InterventionBadges value={row.intervention} language={language}/>}
          {row.replyTo&&(()=>{const text=<>{(row.replyTo===exchange?.originalId) ? <UiMessage id="batch4.speechinterventions.tsx.to.the.original.speech"/> : <UiMessage id="batch4.speechinterventions.tsx.in.reply"/>}</>,target=row.replyTo;
            // Opens the contribution being answered when it is part of the displayed sequence.
            return rows.some(other=>other.id===target) ? <button type="button" className="intervention-reply" onClick={event=>toggleReading(target,event.currentTarget,false)} aria-expanded={reading===target} aria-controls={(reading===target) ? readingId : undefined}>{text}</button> : <span className="intervention-reply">{text}</span>;})()}
          {reading===row.id&&<div ref={readingRef} tabIndex={-1} id={readingId}><ConnectedText speech={row} language={transcriptLanguage}/></div>}
        </>}
      </div>
    </li>)}</ol>}
    {!debate.error&&!debate.coverage.complete&&<p className="intervention-caption"><UiMessage id={debate.coverage.expected===null ? "batch4.speechinterventions.tsx.available.of.unknown.debate.records.available.links.stop.at.missing.contributions" : "batch4.speechinterventions.tsx.available.of.expected.debate.records.available.links.stop.at.missing.contributions"} values={{available: debate.coverage.available,...(debate.coverage.expected===null?{}:{expected:debate.coverage.expected})}}/></p>}
  </section>;
}
export function SpeechContextPanel({id,language,transcriptLanguage=language,preload=true}:{id:string;language:string;transcriptLanguage?:string;preload?:boolean}) {
  const ui = useUiI18n();
  const [open,setOpen]=useState(false);
  const route=`speech-context/${id}?lang=${language}`;
  const state=useData<SpeechContext>(open ? route : null);
  useEffect(()=>(preload && (!open)) ? prefetchData([route]) : undefined,[preload,open,route]);
  const controlId=useId();
  return <div className="intervention-context" lang={ui.language}><button className="intervention-context-toggle" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls={controlId}><UiMessage id="batch4.speechinterventions.tsx.view.speech.in.context"/> <span aria-hidden="true">{open ? '−' : '+'}</span></button>{open&&<div id={controlId}>
    {state.loading&&!state.data&&<p role="status"><UiMessage id="batch4.speechinterventions.tsx.loading.debate.sequence"/></p>}{state.error&&<SequenceError message={state.error} retryAt={state.retryAt} loading={state.loading} retry={state.retry}/>}
    {state.data&&<>{state.data.unavailable&&<p><UiMessage id="batch4.speechinterventions.tsx.no.debate.is.linked.to.this.contribution"/></p>}{state.data.debates.map(debate=><Sequence key={debate.id} debate={debate} speechId={id} language={language} transcriptLanguage={transcriptLanguage} loading={state.loading} retry={state.retry}/>)}</>}
  </div>}</div>;
}
