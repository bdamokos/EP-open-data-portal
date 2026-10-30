import {UiMessage, useUiI18n} from './UiI18nReact';
import {useState} from 'react';
import {useSpeechData} from './data';
import {transcriptLanguage} from '../server/transcript-language.mjs';
import './SpeechTranslation.css';

// Only a source annotation establishes the original language. Available
// editions and the UI language do not establish provenance.
export function useSpeechTranslation(id:string,requested:string,interfaceLanguage=requested) {
  const ui = useUiI18n();
  const key=id+':'+requested;
  const [choice,setChoice]=useState<{key:string;source:string;translation:string|null}|null>(null);
  const current=(choice?.key===key) ? choice : null;
  const selected=current?.source??requested;
  const state=useSpeechData(id,selected);
  const body=state.transcript;
  const annotation=transcriptLanguage(body?.xml??null);
  const sources=[...new Set(annotation.tags.filter(tag=>tag.includes('-t-')).map(tag=>tag.split('-t-')[0]))];
  const machine=body?.translationType==='machine'||annotation.machine;
  const source=(sources.length===1) ? sources[0] : null;
  const original=Boolean(current);
  // A language request may return another edition. Never label that fallback
  // as the original or display it in place of the requested source text.
  const exactOriginal=!original||body?.translationType==='original'&&body.textLanguage===current?.source;
  const name=(code:string)=>{try{return new Intl.DisplayNames(['en'],{type:'language'}).of(code)||code;}catch{return code;}};
  const control=(current||machine) ? <span className="speech-translation" lang="en">
    <span>{original ? ui.t("textsearch.original_text") : ui.t("batch6.speechtranslation.machine.translation.25")}</span>{' · '}
    {original ? <button type="button" onClick={()=>setChoice(null)}><UiMessage id="batch6.speechtranslation.show.translation.26"/>{current!.translation ? (` (${name(current!.translation)})`) : null}</button> : (source ? <button type="button" onClick={()=>setChoice({key,source,translation:body?.textLanguage??null})}><UiMessage id="batch6.speechtranslation.show.original.language.27" values={{language: name(source)}}/></button> : <span><UiMessage id="batch6.speechtranslation.original.language.unavailable.28"/></span>)}
  </span> : null;
  return {state:{...state,transcript:exactOriginal ? body : null},selected,control,reset:()=>setChoice(null),
    originalAudio:original||requested!==interfaceLanguage&&body?.translationType==='original',
    originalGap:original&&!state.loading&&!exactOriginal};
}
