import {AvailabilityNote} from './AvailabilityNote';
import type {SourceAvailability} from '../server/source-availability.mjs';
import {SittingCalendarNotice} from './PlenaryPeriodNavigation';
import {usePersonName} from './PersonName';
import type {SpeechSpeaker} from './legislationContributors.mjs';
import {AnalysisPeriodControl} from './AnalysisPeriod';
import type {AnalysisPeriod} from '../server/analysis-period.mjs';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {api} from './data';
import {createSpeechCloudClient} from './sittingCalendarCache.mjs';
import {humanDate} from './InsightCharts';
import {InsightSpeechReader} from './InsightReaders';
import {TextSearch} from './TextSearch';
import './SpeechCloud.css';

type CloudPerson=SpeechSpeaker&{currentMep:boolean};
type CloudSpeech={id:string;date:string;title:string;titleLanguage?:string|null;machineTranslation:boolean;people:CloudPerson[]};
export type SpeechCloudResult={availability?:SourceAvailability;restarted?:boolean;scope:{kind:'member'|'sitting'|'week'|'topic';phase:'upcoming'|'past'};language:string;words:{word:string;label:string|null;speechCount:number;occurrences:number;speechIds:string[]}[];speeches:CloudSpeech[];coverage:{catalogueComplete?:boolean;basis?:string;transcripts:number;matchedSpeechRecords:number;missingLanguage:number;unreadableText:number;complete:boolean;truncated:boolean;associationUnavailable:boolean;sourceRecords?:{unique:number;declared:number|null;duplicates:number;issues:string[]}};window:{start:string|null;end:string|null};nextPage:number|null};
const client=createSpeechCloudClient(api);
const languages='bg cs da de el en es et fi fr ga hr hu it lt lv nl pl pt ro sk sl sv'.split(' ');
const wordLabel=(word:string)=>['ai','gdp','nato'].includes(word)?word.toUpperCase():word;

function useCloud(route:string) {
  const [attempt,setAttempt]=useState(0),failedPage=useRef(0);
  const [state,setState]=useState<{route:string;data:SpeechCloudResult|null;loading:boolean;error:string|null}>({route,data:null,loading:true,error:null});
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    const retryPage=attempt>0&&state.route===route?failedPage.current:null;
    setState(previous=>({route,data:previous.route===route?previous.data:null,loading:true,error:null}));
    void (async()=>{
      let page:number|null=retryPage??0,restarts=0;
      try {
        while(active&&page!==null) {
          failedPage.current=page;
          const data:SpeechCloudResult=await client.get(route+'&page='+page,{force:page===retryPage,signal:controller.signal});
          if(!active)return;
          if(data.restarted) {
            client.expireMatching(cachedRoute=>cachedRoute.startsWith(route+'&page='));
            if(++restarts>2){failedPage.current=0;throw new Error('Speeches were updated while loading. Try again.');}
          }
          setState({route,data,loading:data.nextPage!==null,error:null});
          page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:(error as Error).message}));}
    })();
    return()=>{active=false;controller.abort();};
  },[route,attempt]);
  return {...(state.route===route?state:{route,data:null,loading:true,error:null}),retry:()=>setAttempt(value=>value+1)};
}

export function SpeechCloud({member,sitting,week,topic,country,interfaceLanguage='en',title,controls,onSpeech,onSpeakers,onSpeechSpeakers}:{member?:number;sitting?:string;week?:string;topic?:string;country?:string|null;interfaceLanguage?:string;title?:string|false;controls?:ReactNode;onSpeech?:(id:string,language:string)=>void;onSpeakers?:(people:(SpeechSpeaker&{name:string})[],speechId?:string)=>void;onSpeechSpeakers?:(speeches:{id:string;people:CloudPerson[]}[])=>void}) {
  const displayName=usePersonName();
  const [language,setLanguage]=useState('en'),[days,setDays]=useState<AnalysisPeriod>('term'),[word,setWord]=useState<string|null>(null),[more,setMore]=useState(false),[reading,setReading]=useState<string|null>(null),examples=useRef<HTMLHeadingElement>(null);
  const reader=useRef<HTMLDivElement>(null),sourceButtons=useRef(new Map<string,HTMLButtonElement>()),readerId=useId();
  const params=new URLSearchParams({lang:language});if(member){params.set('member',String(member));params.set('days',String(days));}else if(week)params.set('week',week);else if(sitting)params.set('sitting',sitting);if(topic)params.set('topic',topic);if(country)params.set('country',country);
  const {data,loading,error,retry}=useCloud('insights/speech-cloud?'+params),selected=data?.words.find(term=>term.word===word);
  useEffect(()=>{setWord(null);setReading(null);setMore(false);},[member,sitting,week,topic,country,language,days]);
  useEffect(()=>{if(!reading)return;const frame=requestAnimationFrame(()=>{reader.current?.focus({preventScroll:true});reader.current?.scrollIntoView({block:'start'});});return()=>cancelAnimationFrame(frame);},[reading]);
  useEffect(()=>{if(!data||!onSpeakers)return;const people=[...new Map(data.speeches.flatMap(speech=>speech.people).filter((p):p is CloudPerson&{name:string}=>Boolean(p.name)).map(p=>[p.id,p])).values()];onSpeakers(people);},[data,onSpeakers]);
  useEffect(()=>{if(data)onSpeechSpeakers?.(data.speeches);},[data,onSpeechSpeakers]);
  const languageLabel=(code:string)=>new Intl.DisplayNames([interfaceLanguage],{type:'language'}).of(code)||code.toUpperCase();
  const initialTerms=member?8:16;
  const frequencies=data?.words.map(term=>data.coverage.transcripts===1?term.occurrences:term.speechCount)||[];
  const speakers=new Set(data?.speeches.flatMap(speech=>speech.people.map(person=>person.id))||[]).size;
  function choose(term:string){setWord(previous=>previous===term?null:term);setReading(null);requestAnimationFrame(()=>{examples.current?.focus({preventScroll:true});examples.current?.scrollIntoView({block:'start'});});}
  function readSpeech(id:string){
    if(onSpeech){onSpeech(id,language);return;}
    if(reading===id){setReading(null);requestAnimationFrame(()=>sourceButtons.current.get(id)?.focus({preventScroll:true}));}
    else setReading(id);
  }
  return <section lang="en" className="explorer-cloud">
    <header className="explorer-cloud-heading">{title!==false&&<h3 lang={title?'':'en'}>{title||(member?'Speech word cloud':topic?'Words in this debate':'Plenary word cloud')}</h3>}<div className="explorer-cloud-controls">{controls&&<span lang={interfaceLanguage} style={{display:'contents'}}>{controls}</span>}<label>Text language<select value={language} onChange={event=>setLanguage(event.target.value)}>{languages.map(code=><option lang={interfaceLanguage} key={code} value={code}>{languageLabel(code)}</option>)}</select></label>{member&&<AnalysisPeriodControl value={days} periods={[30,90,180,365]} onChange={setDays}/>}</div></header>
    {!member&&!topic&&<TextSearch prefix="agenda-fts" label={week?'Search this week’s speeches':'Search this sitting’s speeches'} language={interfaceLanguage} kinds={['speech']} scopeIdentity={JSON.stringify({sitting,week,country})} from={data?.window.start||undefined} to={data?.window.end||undefined} country={country||undefined} sourceIds={!data?.window.start?[]:undefined} disabledReason={!data?.window.start||!data?.window.end?data?'No sittings in this selection.':'Loading dates in this selection…':undefined}/>}
    {data&&<SittingCalendarNotice complete={data.coverage.catalogueComplete}/>}
    {data&&<p className="explorer-cloud-caption"><strong>{data.coverage.transcripts} {data.coverage.transcripts===1?'speech':'speeches'}</strong>{!member&&speakers>0&&<> · {speakers} {speakers===1?'speaker':'speakers'}</>}{data.window.start&&<> · <span lang={interfaceLanguage}>{humanDate(data.window.start,interfaceLanguage)}</span>{data.window.end&&data.window.end!==data.window.start&&<> — <span lang={interfaceLanguage}>{humanDate(data.window.end,interfaceLanguage)}</span></>}</>}</p>}
    {data&&<AvailabilityNote sources={data.availability} label="text" language={interfaceLanguage} end={data.window.end} partial={data.coverage.truncated||!data.coverage.complete||data.coverage.missingLanguage>0||data.coverage.unreadableText>0}/>}
    {loading&&!data&&<p role="status">Loading speech text…</p>}
    {data?.words.length?<><div className="explorer-cloud-words" lang={data.language??''}>{data.words.slice(0,more?60:initialTerms).map((term,index)=><button key={term.word} aria-pressed={word===term.word} style={{fontSize:`calc(1rem + var(--cloud-scale, 1.05rem) * ${Math.sqrt(frequencies[index]/Math.max(1,...frequencies))})`}} onClick={()=>choose(term.word)}>{term.label||wordLabel(term.word)}<small>{data.coverage.transcripts===1?term.occurrences:term.speechCount}</small></button>)}</div><div className="explorer-cloud-footer"><small>{data.coverage.transcripts===1?'Occurrences in this speech':'Number of speeches mentioning each term'}{data.speeches.some(speech=>speech.machineTranslation)?' · includes machine translations':''}</small>{data.words.length>initialTerms&&<button onClick={()=>setMore(value=>!value)} aria-expanded={more}>{more?'Fewer terms':'More terms'}</button>}</div></>:data&&!loading&&<p>{data.coverage.associationUnavailable?'No earlier debate is linked to this item.':data.scope.phase==='upcoming'&&!data.window.start?(week?'This plenary week has not taken place.':'The sitting has not taken place.'):data.coverage.missingLanguage?(data.coverage.basis==='retained-corpus'?'No text in this language.':'Not available in this language.'):(data.coverage.basis==='retained-corpus'?'No speeches in this selection.':'No oral speeches in this selection.')}</p>}
    {data&&!loading&&(data.coverage.missingLanguage>0||data.coverage.unreadableText>0)&&<p className="explorer-cloud-caption">{data.coverage.missingLanguage>0?`${data.coverage.missingLanguage} without text in this language. `:''}{data.coverage.unreadableText>0?`${data.coverage.unreadableText} texts unreadable.`:''}</p>}
    {loading&&data&&<p className="explorer-cloud-progress" role="status">Loading more speeches…</p>}
    {error&&<p role="alert">{data?.words.length?'Some speech text could not be loaded.':'Speech text could not be loaded.'} <button onClick={retry}>Try again</button></p>}
    {selected&&<section className="explorer-cloud-examples">
      <h4 ref={examples} tabIndex={-1}><span lang={data?.language??''} style={{fontSize:'inherit'}}>{selected.label||wordLabel(selected.word)}</span> <small>in {selected.speechCount} {selected.speechCount===1?'speech':'speeches'}</small></h4>
      {selected.speechIds.length<selected.speechCount&&<p className="explorer-cloud-caption">Showing {selected.speechIds.length} examples</p>}
      <div>{selected.speechIds.map(id=>{
        const speech=data?.speeches.find(s=>s.id===id);if(!speech)return null;
        const people=speech.people.map(person=>displayName(person.id,person.name)).filter(Boolean).join(', '),name=people||speech.title,open=!onSpeech&&reading===id;
        const sourceLabel=speech.people.map(person=>person.name).filter(Boolean).join(', ');
        return <article key={id}>
          <button className="explorer-cloud-source" ref={button=>{if(button)sourceButtons.current.set(id,button);else sourceButtons.current.delete(id);}} aria-label={(open?'Close':'Read')+' speech by '+name} aria-expanded={onSpeech?undefined:open} aria-controls={open?readerId:undefined} onClick={()=>readSpeech(id)}>
            <strong title={sourceLabel&&sourceLabel!==name?`Source label: ${sourceLabel}`:undefined} lang={people?'':speech.titleLanguage??''}>{name}</strong><span lang={speech.titleLanguage??''}>{speech.title}</span><small lang={interfaceLanguage}>{humanDate(speech.date,interfaceLanguage)}</small><span className="explorer-cloud-read-action">{open?'Close speech':'Read speech'}</span>
          </button>
          {open&&<div className="explorer-cloud-reader" ref={reader} id={readerId} tabIndex={-1} role="region" aria-label={'Speech by '+name}>
            <InsightSpeechReader key={id} id={id} language={interfaceLanguage} transcriptLanguage={language} highlight={selected.label||selected.word} onSpeakers={onSpeakers}/>
          </div>}
        </article>;
      })}</div>
    </section>}
  </section>;
}
