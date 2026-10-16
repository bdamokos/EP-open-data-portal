import {PocAnalysisPeriod} from './PocAnalysisPeriod';
import type {AnalysisPeriod} from '../server/analysis-period.mjs';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {api} from './pocData';
import {createPocClient} from './pocClient.mjs';
import {humanDate} from './PocInsightCharts';
import {InsightSpeechReader} from './PocInsightReaders';
import './PocSpeechCloud.css';

type CloudPerson={id:string;name:string|null;currentMep:boolean;role:string|null};
type CloudSpeech={id:string;date:string;title:string;machineTranslation:boolean;people:CloudPerson[]};
export type SpeechCloudResult={scope:{kind:'member'|'sitting'|'topic';phase:'upcoming'|'past'};language:string;words:{word:string;label:string|null;speechCount:number;occurrences:number;speechIds:string[]}[];speeches:CloudSpeech[];coverage:{transcripts:number;matchedSpeechRecords:number;missingLanguage:number;unreadableText:number;complete:boolean;truncated:boolean;associationUnavailable:boolean;sourceRecords?:{unique:number;declared:number|null;duplicates:number;issues:string[]}};window:{start:string|null;end:string|null};nextPage:number|null};
const client=createPocClient(api,{maxEntries:48,maxAge:30*60_000,timeoutFor:()=>35_000});
const languages='bg cs da de el en es et fi fr ga hr hu it lt lv nl pl pt ro sk sl sv'.split(' ');
const wordLabel=(word:string)=>['ai','gdp','nato'].includes(word)?word.toUpperCase():word;

function useCloud(route:string) {
  const [attempt,setAttempt]=useState(0),failedPage=useRef(0);
  const [state,setState]=useState<{route:string;data:SpeechCloudResult|null;loading:boolean;error:string|null}>({route,data:null,loading:true,error:null});
  useEffect(()=>{
    let active=true;
    const forcePage=state.route===route?failedPage.current:null;
    setState(previous=>({route,data:previous.route===route?previous.data:null,loading:true,error:null}));
    void (async()=>{
      let page:number|null=0;
      try {
        while(active&&page!==null) {
          failedPage.current=page;
          const data:SpeechCloudResult=await client.get(route+'&page='+page,{force:attempt>0&&page===forcePage});
          if(!active)return;
          setState({route,data,loading:data.nextPage!==null,error:null});
          page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:(error as Error).message}));}
    })();
    return()=>{active=false;};
  },[route,attempt]);
  return {...(state.route===route?state:{route,data:null,loading:true,error:null}),retry:()=>setAttempt(value=>value+1)};
}

export function PocSpeechCloud({member,sitting,topic,country,interfaceLanguage='en',title,controls,onSpeech,onSpeakers,onSpeechSpeakers}:{member?:number;sitting?:string;topic?:string;country?:string|null;interfaceLanguage?:string;title?:string|false;controls?:ReactNode;onSpeech?:(id:string,language:string)=>void;onSpeakers?:(people:{id:string;name:string;role:string|null}[],speechId?:string)=>void;onSpeechSpeakers?:(speeches:{id:string;people:CloudPerson[]}[])=>void}) {
  const [language,setLanguage]=useState('en'),[days,setDays]=useState<AnalysisPeriod>(90),[word,setWord]=useState<string|null>(null),[more,setMore]=useState(false),[reading,setReading]=useState<string|null>(null),examples=useRef<HTMLHeadingElement>(null);
  const reader=useRef<HTMLDivElement>(null),sourceButtons=useRef(new Map<string,HTMLButtonElement>()),readerId=useId();
  const params=new URLSearchParams({lang:language});if(member){params.set('member',String(member));params.set('days',String(days));}else if(sitting)params.set('sitting',sitting);if(topic)params.set('topic',topic);if(country)params.set('country',country);
  const {data,loading,error,retry}=useCloud('insights/speech-cloud?'+params),selected=data?.words.find(term=>term.word===word);
  useEffect(()=>{setWord(null);setReading(null);setMore(false);},[member,sitting,topic,country,language,days]);
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
  return <section className="poc-cloud">
    <header className="poc-cloud-heading">{title!==false&&<h3>{title||(member?'Speech word cloud':topic?'Words in this debate':'Plenary word cloud')}</h3>}<div className="poc-cloud-controls">{controls}<label>Text language<select value={language} onChange={event=>setLanguage(event.target.value)}>{languages.map(code=><option key={code} value={code}>{languageLabel(code)}</option>)}</select></label>{member&&<PocAnalysisPeriod value={days} periods={[30,90,180,365]} onChange={setDays}/>}</div></header>
    {data&&<p className="poc-cloud-caption"><strong>{data.coverage.transcripts} {data.coverage.transcripts===1?'speech':'speeches'}</strong>{speakers>0&&<> · {speakers} {speakers===1?'speaker':'speakers'}</>}{data.window.start&&<> · {humanDate(data.window.start,interfaceLanguage)}{data.window.end&&data.window.end!==data.window.start&&<> — {humanDate(data.window.end,interfaceLanguage)}</>}</>}{(data.coverage.truncated||(!data.coverage.complete&&!loading))&&<> · <strong>Partial coverage</strong></>}</p>}
    {loading&&!data&&<p role="status">Loading speech text…</p>}
    {data?.words.length?<><div className="poc-cloud-words">{data.words.slice(0,more?60:initialTerms).map((term,index)=><button key={term.word} aria-pressed={word===term.word} style={{fontSize:`calc(1rem + var(--cloud-scale, 1.05rem) * ${Math.sqrt(frequencies[index]/Math.max(1,...frequencies))})`}} onClick={()=>choose(term.word)}>{term.label||wordLabel(term.word)}<small>{data.coverage.transcripts===1?term.occurrences:term.speechCount}</small></button>)}</div><div className="poc-cloud-footer"><small>{data.coverage.transcripts===1?'Occurrences in this speech':'Number of speeches mentioning each term'}{data.speeches.some(speech=>speech.machineTranslation)?' · includes machine translations':''}</small>{data.words.length>initialTerms&&<button onClick={()=>setMore(value=>!value)} aria-expanded={more}>{more?'Fewer terms':'More terms'}</button>}</div></>:data&&!loading&&<p>{data.coverage.associationUnavailable?'No earlier debate is linked to this item.':data.scope.phase==='upcoming'&&!data.window.start?'The sitting has not taken place.':data.coverage.missingLanguage?'Parliament has not supplied text in this language.':'No oral speeches in this selection.'}</p>}
    {data&&!loading&&(data.coverage.missingLanguage>0||data.coverage.unreadableText>0||!data.coverage.complete)&&<p className="poc-cloud-caption">{data.coverage.sourceRecords&&data.coverage.sourceRecords.declared!==null&&<>Source records: {data.coverage.sourceRecords.unique} of {data.coverage.sourceRecords.declared}. </>}{data.coverage.missingLanguage>0&&<>{data.coverage.missingLanguage} without text in {languageLabel(language)}. </>}{data.coverage.unreadableText>0&&<>{data.coverage.unreadableText} texts could not be read. </>}{!data.coverage.complete&&<>The cloud covers the available records.</>}</p>}
    {loading&&data&&<p className="poc-cloud-progress" role="status">Loading more speeches…</p>}
    {error&&<p role="alert">{data?.words.length?'Some speech text could not be loaded.':'Speech text could not be loaded.'} <button onClick={retry}>Try again</button></p>}
    {selected&&<section className="poc-cloud-examples">
      <h4 ref={examples} tabIndex={-1}>{selected.label||wordLabel(selected.word)} <small>in {selected.speechCount} {selected.speechCount===1?'speech':'speeches'}</small></h4>
      {selected.speechIds.length<selected.speechCount&&<p className="poc-cloud-caption">Showing {selected.speechIds.length} examples</p>}
      <div>{selected.speechIds.map(id=>{
        const speech=data?.speeches.find(s=>s.id===id);if(!speech)return null;
        const name=speech.people.map(person=>person.name).filter(Boolean).join(', ')||speech.title,open=!onSpeech&&reading===id;
        return <article key={id}>
          <button className="poc-cloud-source" ref={button=>{if(button)sourceButtons.current.set(id,button);else sourceButtons.current.delete(id);}} aria-label={(open?'Close':'Read')+' speech by '+name} aria-expanded={onSpeech?undefined:open} aria-controls={open?readerId:undefined} onClick={()=>readSpeech(id)}>
            <strong>{name}</strong><span>{speech.title}</span><small>{humanDate(speech.date,interfaceLanguage)}</small><span className="poc-cloud-read-action">{open?'Close speech':'Read speech'}</span>
          </button>
          {open&&<div className="poc-cloud-reader" ref={reader} id={readerId} tabIndex={-1} role="region" aria-label={'Speech by '+name}>
            <InsightSpeechReader key={id} id={id} language={language} highlight={selected.label||selected.word} onSpeakers={onSpeakers}/>
          </div>}
        </article>;
      })}</div>
    </section>}
  </section>;
}
