import {uiErrorText} from './uiErrors.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {AvailabilityNote} from './AvailabilityNote';
import type {SourceAvailability} from '../server/source-availability.mjs';
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
export type SpeechCloudResult={availability?:SourceAvailability;restarted?:boolean;scope:{kind:'member'|'sitting'|'week'|'topic';phase:'upcoming'|'past'};language:string;words:{word:string;label:string|null;speechCount:number;occurrences:number;speechIds:string[]}[];speeches:CloudSpeech[];coverage:{catalogueComplete?:boolean;basis?:string;transcripts:number;matchedSpeechRecords:number;missingLanguage:number;missingLanguageAlternatives?:{language:string;count:number}[];unreadableText:number;complete:boolean;truncated:boolean;associationUnavailable:boolean;sourceRecords?:{unique:number;declared:number|null;duplicates:number;issues:string[]}};window:{start:string|null;end:string|null};nextPage:number|null};
const client=createSpeechCloudClient(api);
const languages='bg cs da de el en es et fi fr ga hr hu it lt lv nl pl pt ro sk sl sv'.split(' ');
const wordLabel=(word:string)=>['ai','gdp','nato'].includes(word) ? word.toUpperCase() : word;

function useCloud(route:string) {
  const ui = useUiI18n();
  const [attempt,setAttempt]=useState(0),failedPage=useRef(0);
  const [state,setState]=useState<{route:string;data:SpeechCloudResult|null;loading:boolean;error:string|null}>({route,data:null,loading:true,error:null});
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    const retryPage=((attempt>0) && (state.route===route)) ? failedPage.current : null;
    setState(previous=>({route,data:(previous.route===route) ? previous.data : null,loading:true,error:null}));
    void (async()=>{
      let page:number|null=retryPage??0,restarts=0;
      try {
        while(active&&page!==null) {
          failedPage.current=page;
          const data:SpeechCloudResult=await client.get(route+'&page='+page,{force:page===retryPage,signal:controller.signal});
          if(!active)return;
          if(data.restarted) {
            client.expireMatching(cachedRoute=>cachedRoute.startsWith(route+'&page='));
            if(++restarts>2){failedPage.current=0;throw new Error(ui.t("speechcloud.speeches_were_updated_while_loading_try_again.90be1f"));}
          }
          setState({route,data,loading:data.nextPage!==null,error:null});
          page=data.nextPage;
        }
      }catch(error){if(active)setState(previous=>({...previous,loading:false,error:uiErrorText(error,ui)}));}
    })();
    return()=>{active=false;controller.abort();};
  },[route,attempt]);
  return {...((state.route===route) ? state : ({route,data:null,loading:true,error:null})),retry:()=>setAttempt(value=>value+1)};
}

export function SpeechCloud({member,sitting,week,topic,country,interfaceLanguage='en',title,controls,onSpeech,onSpeakers,onSpeechSpeakers}:{member?:number;sitting?:string;week?:string;topic?:string;country?:string|null;interfaceLanguage?:string;title?:string|false;controls?:ReactNode;onSpeech?:(id:string,language:string)=>void;onSpeakers?:(people:(SpeechSpeaker&{name:string})[],speechId?:string)=>void;onSpeechSpeakers?:(speeches:{id:string;people:CloudPerson[]}[])=>void}) {
  const ui = useUiI18n();
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
  const initialTerms=member ? 8 : 16;
  const frequencies=data?.words.map(term=>(data.coverage.transcripts===1) ? term.occurrences : term.speechCount)||[];
  const speakers=new Set(data?.speeches.flatMap(speech=>speech.people.map(person=>person.id))||[]).size;
  const missingAlternatives=data&&(data.coverage.missingLanguage>0||data.coverage.unreadableText>0)?(data.coverage.missingLanguageAlternatives||[]).filter(item=>languages.includes(item.language)&&item.language!==language&&Number.isSafeInteger(item.count)&&item.count>0):[];
  function choose(term:string){setWord(previous=>(previous===term) ? null : term);setReading(null);requestAnimationFrame(()=>{examples.current?.focus({preventScroll:true});examples.current?.scrollIntoView({block:'start'});});}
  function readSpeech(id:string){
    if(onSpeech){onSpeech(id,language);return;}
    if(reading===id){setReading(null);requestAnimationFrame(()=>sourceButtons.current.get(id)?.focus({preventScroll:true}));}
    else setReading(id);
  }
  return <section lang={ui.language} className="explorer-cloud">
    <header className="explorer-cloud-heading">{title!==false&&<h3 lang={title ? '' : ui.messageLocale(member?"speechcloud.speech_word_cloud.7e6a72":topic?"speechcloud.words_in_this_debate.e2aabe":"plenarymodes.plenary_word_cloud")}>{title||(member ? ui.t("speechcloud.speech_word_cloud.7e6a72") : (topic ? ui.t("speechcloud.words_in_this_debate.e2aabe") : ui.t("plenarymodes.plenary_word_cloud")))}</h3>}<div className="explorer-cloud-controls">{controls&&<span lang={interfaceLanguage} style={{display:'contents'}}>{controls}</span>}<label><UiMessage id="textsearch.text_language"/><select value={language} onChange={event=>setLanguage(event.target.value)}>{languages.map(code=><option lang={interfaceLanguage} key={code} value={code}>{languageLabel(code)}</option>)}</select></label>{member&&<AnalysisPeriodControl value={days} periods={[30,90,180,365]} onChange={setDays}/>}</div></header>
    {!member&&!topic&&<TextSearch prefix="agenda-fts" label={week ? ui.t("speechcloud.search_this_week_s_speeches.90aeac") : ui.t("speechcloud.search_this_sitting_s_speeches.c879f1")} language={interfaceLanguage} kinds={['speech']} scopeIdentity={JSON.stringify({sitting,week,country})} from={data?.window.start||undefined} to={data?.window.end||undefined} country={country||undefined} sourceIds={(!data?.window.start) ? ([]) : undefined} disabledReason={(!data?.window.start||!data?.window.end) ? ((data && (data.scope.phase==='upcoming')) ? ui.t("speechcloud.no_speeches_yet.56f207") : ((data && (!(data.scope.phase==='upcoming'))) ? ui.t("speechcloud.sitting_dates_unavailable.71b057") : ui.t("speechcloud.loading_dates_in_this_selection.483ea6"))) : undefined}/>}
    {data&&<p className="explorer-cloud-caption"><strong>{<UiMessage id="speechcloud.transcripts_speeches.851fc7" values={{transcripts: data.coverage.transcripts}} counts={{transcripts: data.coverage.transcripts}}/>}</strong>{!member&&speakers>0&&<> · <UiMessage id="groupvoices.count_speakers.47ae64" values={{count:speakers}}/></>}{data.window.start&&<> · <span lang={interfaceLanguage}>{humanDate(data.window.start,interfaceLanguage)}</span>{data.window.end&&data.window.end!==data.window.start&&<> — <span lang={interfaceLanguage}>{humanDate(data.window.end,interfaceLanguage)}</span></>}</>}</p>}
    {data&&<AvailabilityNote showGaps={false} sources={data.availability} kind="text" language={interfaceLanguage} end={data.window.end} partial={data.coverage.truncated||!data.coverage.complete||data.coverage.missingLanguage>0||data.coverage.unreadableText>0}/>}
    {loading&&!data&&<p role="status"><UiMessage id="speechcloud.loading_speech_text.8d62de"/></p>}
    {data?.words.length ? <><div className="explorer-cloud-words" lang={data.language??''}>{data.words.slice(0,more ? 60 : initialTerms).map((term,index)=><button key={term.word} aria-pressed={word===term.word} style={{fontSize:`calc(1rem + var(--cloud-scale, 1.05rem) * ${Math.sqrt(frequencies[index]/Math.max(1,...frequencies))})`}} onClick={()=>choose(term.word)}>{term.label||wordLabel(term.word)}<small>{(data.coverage.transcripts===1) ? term.occurrences : term.speechCount}</small></button>)}</div><div className="explorer-cloud-footer"><small>{((data.coverage.transcripts===1) && data.speeches.some(speech=>speech.machineTranslation)) ? <UiMessage id="speechcloud.occurrences_in_this_speech_includes_machine_translations.082d5b"/> : (((data.coverage.transcripts===1) && (!data.speeches.some(speech=>speech.machineTranslation))) ? <UiMessage id="speechcloud.occurrences_in_this_speech.46ef33"/> : (((!(data.coverage.transcripts===1)) && data.speeches.some(speech=>speech.machineTranslation)) ? <UiMessage id="speechcloud.number_of_speeches_mentioning_each_term_includes_machine_translations.735a87"/> : <UiMessage id="speechcloud.number_of_speeches_mentioning_each_term.41801c"/>))}</small>{data.words.length>initialTerms&&<button onClick={()=>setMore(value=>!value)} aria-expanded={more}>{more ? <UiMessage id="speechcloud.fewer_terms.3144b7"/> : <UiMessage id="speechcloud.more_terms.1c4516"/>}</button>}</div></> : (data&&!loading&&<p>{data.coverage.associationUnavailable ? ui.t("speechcloud.no_earlier_debate_is_linked_to_this_item.0b62c3") : ((((data.scope.phase==='upcoming') && (!data.window.start)) && week) ? ui.t("speechcloud.this_plenary_week_has_not_taken_place.d32230") : ((((data.scope.phase==='upcoming') && (!data.window.start)) && (!week)) ? ui.t("speechcloud.the_sitting_has_not_taken_place.c5bb87") : ((((!(data.scope.phase==='upcoming'&&!data.window.start)) && data.coverage.missingLanguage) && (data.coverage.basis==='retained-corpus')) ? ui.t("speechcloud.no_text_in_this_language.24032c") : ((((!(data.scope.phase==='upcoming'&&!data.window.start)) && data.coverage.missingLanguage) && (!(data.coverage.basis==='retained-corpus'))) ? ui.t("speechcloud.not_available_in_this_language.37fcae") : ((((!(data.scope.phase==='upcoming'&&!data.window.start)) && (!data.coverage.missingLanguage)) && (data.coverage.basis==='retained-corpus')) ? ui.t("speechcloud.no_speeches_in_this_selection.838c04") : ui.t("speechcloud.no_oral_speeches_in_this_selection.185781"))))))}</p>)}
    {data&&!loading&&(data.coverage.missingLanguage>0||data.coverage.unreadableText>0)&&<p className="explorer-cloud-caption">{(data.coverage.missingLanguage>0) ? ui.t("speechcloud.missinglanguage_without_text_in_this_language.ad0413", {missingLanguage: String(data.coverage.missingLanguage)}, {missingLanguage: data.coverage.missingLanguage}) : ''} { (data.coverage.unreadableText>0) ? ui.t("speechcloud.unreadabletext_texts_unreadable.20c3fb", {unreadableText: String(data.coverage.unreadableText)}, {unreadableText: data.coverage.unreadableText}) : ''}</p>}
    {data&&!loading&&data.coverage.truncated&&<p className="explorer-cloud-caption"><UiMessage id="coverage.speechAnalysisLimit" values={{count:data.coverage.transcripts}}/></p>}
    {loading&&data&&<p className="explorer-cloud-progress" role="status"><UiMessage id="speechcloud.loading_more_speeches.a3ae37"/></p>}
    {!loading&&missingAlternatives.length>0&&<div className="explorer-cloud-alternatives"><span><UiMessage id="commissionfollowups.other_languages"/>:</span>{missingAlternatives.map(item=><button type="button" key={item.language} lang={interfaceLanguage} onClick={()=>setLanguage(item.language)}>{languageLabel(item.language)} ({item.count})</button>)}</div>}
    {error&&<p role="alert">{data?.words.length ? ui.t("speechcloud.some_speech_text_could_not_be_loaded.be591a") : ui.t("speechcloud.speech_text_could_not_be_loaded.9d3271")} <button onClick={retry}><UiMessage id="commissionfollowups.try_again"/></button></p>}
    {selected&&<section className="explorer-cloud-examples">
      <h4 ref={examples} tabIndex={-1}><span lang={data?.language??''} style={{fontSize:'inherit'}}>{selected.label||wordLabel(selected.word)}</span> <small>{<UiMessage id="speechcloud.in_count_speeches.a25a1a" values={{count: selected.speechCount}} counts={{count: selected.speechCount}}/>}</small></h4>
      {selected.speechIds.length<selected.speechCount&&<p className="explorer-cloud-caption"><UiMessage id="speechcloud.showing_count_examples.915265" values={{count: selected.speechIds.length}} counts={{count: selected.speechIds.length}}/></p>}
      <div>{selected.speechIds.map(id=>{
        const speech=data?.speeches.find(s=>s.id===id);if(!speech)return null;
        const people=speech.people.map(person=>displayName(person.id,person.name)).filter(Boolean).join(', '),name=people||speech.title,open=!onSpeech&&reading===id;
        const sourceLabel=speech.people.map(person=>person.name).filter(Boolean).join(', ');
        return <article key={id}>
          <button className="explorer-cloud-source" ref={button=>{if(button)sourceButtons.current.set(id,button);else sourceButtons.current.delete(id);}} aria-label={open ? ui.t("speechcloud.close_speech_by_name.d05ec7", {name: String(name)}) : ui.t("speechcloud.read_speech_by_name.6619e3", {name: String(name)})} aria-expanded={onSpeech ? undefined : open} aria-controls={open ? readerId : undefined} onClick={()=>readSpeech(id)}>
            <strong title={(sourceLabel && (sourceLabel!==name)) ? ui.t("speechcloud.source_label_sourcelabel.efbb7e", {sourceLabel: String(sourceLabel)}) : undefined} lang={people ? '' : (speech.titleLanguage??'')}>{name}</strong><span lang={speech.titleLanguage??''}>{speech.title}</span><small lang={interfaceLanguage}>{humanDate(speech.date,interfaceLanguage)}</small><span className="explorer-cloud-read-action">{open ? <UiMessage id="outsidevoices.close_speech.376ea0"/> : <UiMessage id="dossieractivity.read_speech"/>}</span>
          </button>
          {open&&<div className="explorer-cloud-reader" ref={reader} id={readerId} tabIndex={-1} role="region" aria-label={ui.t("speechcloud.speech_by_name.2d8318", {name: String(name)})}>
            <InsightSpeechReader key={id} id={id} language={interfaceLanguage} transcriptLanguage={language} highlight={selected.label||selected.word} onSpeakers={onSpeakers}/>
          </div>}
        </article>;
      })}</div>
    </section>}
  </section>;
}
