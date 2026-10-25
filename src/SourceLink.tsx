import type {ReactNode} from 'react';
import {humanSourceUrl} from '../server/source-links.mjs';
import './SourceLink.css';

const safeHref=(value:string)=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
// Data endpoints and concept URIs are machine-readable records the app already presents.
const machineReadable=(value:string)=>{try{const url=new URL(value);return url.hostname==='data.europarl.europa.eu'||url.hostname==='eurovoc.europa.eu'||url.hostname==='publications.europa.eu'&&/^\/(?:webapi|resource)\//.test(url.pathname);}catch{return false;}};
// The public page for a source, or null when only a machine-readable record exists.
export function sourcePageUrl(url:string|null|undefined,{language='en',reference}:{language?:string;reference?:string}={}) {
  if(!url)return null;
  return humanSourceUrl(url,{language,reference})||(machineReadable(url)?null:safeHref(url));
}

export function SourceLink({url,language='en',reference,websiteUrl,children,compact=false,contentLanguage='en'}:{url:string;language?:string;reference?:string;websiteUrl?:string|null;children:ReactNode;compact?:boolean;contentLanguage?:string|null}) {
  const suppliedWebsite=websiteUrl&&/^https:\/\/www\.europarl\.europa\.eu\/doceo\/document\/[A-Z0-9-]+_[A-Z]{2}\.html$/.test(websiteUrl)?websiteUrl:null;
  const href=suppliedWebsite||sourcePageUrl(url,{language,reference}),content=<span lang={contentLanguage||''}>{children}</span>;
  return href?<span className={'source-link'+(compact?' source-link-compact':'')}><a href={href} target="_blank" rel="noreferrer">{content}</a></span>:content;
}
