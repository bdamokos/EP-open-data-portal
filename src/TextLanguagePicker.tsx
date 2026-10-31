import {UiMessage, useUiI18n} from './UiI18nReact';
import {useState,type ReactNode} from 'react';
import {languagePreference} from '../server/language-order.mjs';
import {languageName} from './interfaceLabels.mjs';
import './TextLanguagePicker.css';

export function TextLanguageFallback({requested,actual,interfaceLanguage,comparison=false}:{requested:string;actual:string|null;interfaceLanguage:string;comparison?:boolean}) {
  const ui = useUiI18n();
  if(!actual||actual===requested)return null;
  const name=(code:string)=>{try{return new Intl.DisplayNames([interfaceLanguage],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
  return <small className="text-language-note" lang={ui.language}>{comparison ? <UiMessage id="textlanguagepicker.requested.unavailable.in.one.or.both.texts.showing.actual" values={{requested: <span lang={interfaceLanguage}>{name(requested)}</span>, actual: <span lang={interfaceLanguage}>{name(actual)}</span>}}/> : <UiMessage id="textlanguagepicker.requested.unavailable.showing.actual" values={{requested: <span lang={interfaceLanguage}>{name(requested)}</span>, actual: <span lang={interfaceLanguage}>{name(actual)}</span>}}/>}</small>;
}

export function TextLanguagePicker({available,requested,value,onChange,label: labelProp,visibleLabel=true,note,title,preserveFocus=false}:{available:readonly string[];requested:string;value:string|null;onChange:(language:string)=>void;label?:string;visibleLabel?:boolean;note?:ReactNode;title?:string;preserveFocus?:boolean}) {
  const ui = useUiI18n();
const label = labelProp ?? ui.t("textsearch.text_language");

  const [focused,setFocused]=useState(false);
  const ordered=languagePreference(available,requested);
  return <>{(ordered.length>1||preserveFocus&&focused)&&<label className="text-language-picker" lang={ui.language}>{visibleLabel&&label}<select className="text-language-select" onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} aria-label={label} title={title} value={(value && ordered.includes(value)) ? value : ''} onChange={event=>onChange(event.target.value)}>
    {(!value||!ordered.includes(value))&&<option value="" disabled><UiMessage id="grouplabels.ts.unavailable"/></option>}
    {ordered.map(code=><option lang={code} key={code} value={code}>{languageName(code)}</option>)}
  </select></label>}{note}</>;
}
