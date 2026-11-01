import type {ComponentProps} from 'react';
// Shared presentation for browser-local saves and follows.
export function StarControl({saved,label,labelLanguage,compact=false,...props}:Omit<ComponentProps<'button'>,'children'>&{saved:boolean;label:string;labelLanguage?:string;compact?:boolean}){
 return <button {...props} className={'explorer-save-button'+(saved?' is-saved':'')} aria-pressed={saved}><span aria-hidden="true">{saved?'★':'☆'}</span>{!compact&&<span lang={labelLanguage}>{label}</span>}</button>;
}
