import {PocSourceLink} from './PocSourceLink';
import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {linkedSegments,noteReferences,referenceKeys,type LinkSpan} from '../server/legal-reference-text.mjs';
import {useData} from './pocData';
import {humanDate} from './PocInsightCharts';
import type {DocumentLink,DocumentNote,NoteAnchor} from './pocTypes';
import './PocReferences.css';

type Source={name:string;url:string;fetchedAt:string};
export type ResolvedReference={key:string;kind:'act'|'document'|'procedure'|'question';status:'found'|'not-found'|'ambiguous'|'unavailable';stale?:boolean;
  celex?:string|null;title?:string|null;titleLanguage?:string|null;date?:string|null;inForce?:boolean|null;procedure?:string|null;eurLexUrl?:string;
  id?:string|null;answerIds?:string[];source?:Source};
type Summary={reference:string;title:string;language:string;summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string;fetchedAt:string}};source:{url:string;fetchedAt:string}};
// How the document itself supports a reference: its own hyperlink, or the footnote that follows the citation.
type Evidence={status:'hyperlink';url:string}|{status:'confirmed'|'other'|'from-note';note:string;noteId:string;others?:string[]};
type OpenCard={key:string;text:string;trigger:HTMLElement;pinned:boolean;evidence?:Evidence};
type Scope={references:Map<string,ResolvedReference>;noteKeys:Map<string,{linked:string[];cited:string[]}>;notePrefix:string;open:OpenCard|null;show:(card:OpenCard)=>void;hoverEnd:()=>void;cardId:string};
const ReferenceScopeContext=createContext<Scope|null>(null);

// The current term began on 16 July 2024. Older acts are described, not claimed as indexed activity.
const TERM_START='2024-07-16';
const actType:Record<string,string>={R:'Regulation',L:'Directive',D:'Decision',F:'Framework decision'};
const documentType:Record<string,string>={PC:'Commission proposal',DC:'Commission document',SC:'Staff working document',JC:'Joint document'};
const questionType:Record<string,string>={E:'Written question',P:'Priority question',O:'Oral question'};
const stageName=(stage:string)=>({'first-reading':'First reading','parliament-decision':'Parliament’s decision','final-act':'Final act',proposal:'Commission proposal',document:'Summary'} as Record<string,string>)[stage]||'Summary';
const displayDate=(value:string|null|undefined,language:string)=>value?humanDate(value,language):null;
const finePointer=()=>typeof matchMedia==='function'&&matchMedia('(hover: hover) and (pointer: fine)').matches;

export function useReferenceLookup(texts:string[],language:string) {
  const joined=texts.join('\u0000');
  const keys=useMemo(()=>referenceKeys(texts),[joined]);
  const state=useData<{references:ResolvedReference[]}>(keys.length?'references?'+new URLSearchParams({keys:keys.join(','),lang:language}):null);
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>{if(!state.loading)setRetrying(false);},[state.loading]);
  const retry=useCallback(()=>{setRetrying(true);state.retry();},[state.retry]);
  const references=useMemo(()=>new Map((state.data?.references||[]).map(reference=>[reference.key,reference])),[state.data]);
  return {...state,retry,references,unavailable:retrying||Boolean(state.error)||[...references.values()].some(reference=>reference.status==='unavailable'||reference.stale)};
}
const linked=(reference:ResolvedReference|undefined)=>reference?.status==='found';
// Different keys can name one work, such as COM(2024) 225 and CELEX 52024DC0225.
const identity=(scope:Scope,key:string)=>{const reference=scope.references.get(key);return reference?.celex||reference?.id||reference?.procedure||key;};
const distinctFound=(scope:Scope,keys:string[])=>{const seen=new Set<string>(),result:string[]=[];for(const key of keys){if(!linked(scope.references.get(key)))continue;const id=identity(scope,key);if(!seen.has(id)){seen.add(id);result.push(key);}}return result;};
const allFound=(scope:Scope,noteId:string)=>{const note=scope.noteKeys.get(noteId);return note?distinctFound(scope,[...note.linked,...note.cited]):[];};
// A footnote's own hyperlink identifies it; its text citations count only when it has no resolved link.
const noteIdentifies=(scope:Scope,noteId:string)=>{const note=scope.noteKeys.get(noteId);if(!note)return null;const links=distinctFound(scope,note.linked);const found=links.length?links:distinctFound(scope,note.cited);return found.length===1?found[0]:null;};

// Wraps one reader. Opened question readers appear below the text, so reading stays in place.
export function ReferenceScope({texts,language,children,renderQuestion,notes=[],notePrefix=''}:{texts:string[];language:string;children:ReactNode;renderQuestion?:(id:string)=>ReactNode;notes?:DocumentNote[];notePrefix?:string}) {
  const lookup=useReferenceLookup(texts,language),references=lookup.references;
  const noteKeys=useMemo(()=>new Map(notes.map(note=>[note.id,noteReferences(note)])),[notes]);
  const [open,setOpen]=useState<OpenCard|null>(null),[question,setQuestion]=useState<string|null>(null);
  const wrapper=useRef<HTMLDivElement>(null),card=useRef<HTMLDivElement>(null),timer=useRef<number>(0),cardId=useId();
  const close=useCallback((restore=false)=>{setOpen(current=>{if(restore)current?.trigger.focus();return null;});},[]);
  const show=useCallback((next:OpenCard)=>{window.clearTimeout(timer.current);setOpen(current=>current?.pinned&&!next.pinned&&current.key!==next.key?current:next);},[]);
  const hoverEnd=useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setOpen(current=>current?.pinned?current:null),250);},[]);
  useEffect(()=>()=>window.clearTimeout(timer.current),[]);
  useEffect(()=>{
    if(!open)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close(true);};
    const pointer=(event:PointerEvent)=>{const target=event.target as Node;if(!card.current?.contains(target)&&!open.trigger.contains(target))close();};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',pointer);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',pointer);};
  },[open,close]);
  const [position,setPosition]=useState<{top:number;left:number;width:number}|null>(null);
  useLayoutEffect(()=>{
    if(!open||!wrapper.current){setPosition(null);return;}
    const place=()=>{
      const box=wrapper.current!.getBoundingClientRect(),anchor=open.trigger.getBoundingClientRect(),width=Math.min(400,box.width);
      setPosition({top:anchor.bottom-box.top+6,left:Math.max(0,Math.min(anchor.left-box.left,box.width-width)),width});
    };
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[open]);
  useEffect(()=>{if(open?.pinned){card.current?.focus({preventScroll:true});card.current?.scrollIntoView({block:'nearest'});}},[open?.key,open?.pinned,position]);
  const scope=useMemo(()=>({references,noteKeys,notePrefix,open,show,hoverEnd,cardId}),[references,noteKeys,notePrefix,open,show,hoverEnd,cardId]);
  const reference=open?references.get(open.key):undefined;
  return <ReferenceScopeContext.Provider value={scope}><div className="legal-reference-scope" ref={wrapper}>
    {children}
    {lookup.unavailable&&<p className="legal-reference-retry" role="status">Reference details are temporarily unavailable. <button type="button" className="legal-reference-text-button" disabled={lookup.loading} onClick={lookup.retry}>{lookup.loading?'Retrying references…':'Retry references'}</button></p>}
    {open&&reference&&position&&<div ref={card} id={cardId} className="legal-reference-card" role="dialog" aria-label={open.text} tabIndex={-1} style={position}
      onPointerEnter={()=>window.clearTimeout(timer.current)} onPointerLeave={event=>{if(event.pointerType==='mouse')hoverEnd();}}>
      <ReferenceCard reference={reference} text={open.text} language={language} evidence={open.evidence} notePrefix={notePrefix} references={references} onQuestion={renderQuestion?id=>{setQuestion(id);close();}:undefined}/>
      <button type="button" className="legal-reference-close" aria-label="Close" onClick={()=>close(true)}>×</button>
    </div>}
    {question&&renderQuestion&&<div className="legal-reference-question"><button type="button" className="legal-reference-text-button" onClick={()=>setQuestion(null)}>Close referenced question</button>{renderQuestion(question)}</div>}
  </div></ReferenceScopeContext.Provider>;
}

function ReferenceCard({reference,text,language,onQuestion,evidence,notePrefix,references}:{reference:ResolvedReference;text:string;language:string;onQuestion?:(id:string)=>void;evidence?:Evidence;notePrefix:string;references:Map<string,ResolvedReference>}) {
  const procedure=reference.kind==='procedure'?reference.procedure:reference.procedure||null;
  const [summaryOpen,setSummaryOpen]=useState(reference.kind==='procedure');
  useEffect(()=>setSummaryOpen(reference.kind==='procedure'),[reference.key]);
  const celex=reference.celex||'',sector=celex.slice(5,7).replace(/\d/g,'');
  const kind=reference.kind==='question'?questionType[reference.id?.[0]||'E']:reference.kind==='procedure'?'Legislative procedure':celex.startsWith('1')?'EU Treaty':reference.kind==='act'?'EU law · '+(actType[celex[5]]||'Act'):documentType[sector]||'EU document';
  const status=reference.kind==='act'&&reference.inForce!==null&&reference.inForce!==undefined?(reference.inForce?'In force':'No longer in force'):null;
  const older=reference.date&&reference.date<TERM_START&&reference.kind!=='question'?'Before the current term':null;
  return <>
    <p className="legal-reference-kind">{[kind,status].filter(Boolean).join(' · ')}</p>
    {reference.kind!=='procedure'&&<p className="legal-reference-title" lang={reference.titleLanguage||undefined}>{reference.title||text}</p>}
    <p className="legal-reference-meta">{[displayDate(reference.date,language),procedure&&reference.kind!=='procedure'?'Procedure '+procedure:null,older].filter(Boolean).join(' · ')}</p>
    {reference.stale&&<p className="legal-reference-meta">Saved description{reference.source?.fetchedAt?' from '+displayDate(reference.source.fetchedAt,language):''}; a newer check of the official source is pending.</p>}
    <div className="legal-reference-actions">
      {reference.kind==='question'&&reference.id&&onQuestion&&<button type="button" onClick={()=>onQuestion(reference.id!)}>{reference.answerIds?.length?'Read question and answer':'Read question'}</button>}
      {procedure&&reference.kind!=='procedure'&&<button type="button" aria-expanded={summaryOpen} onClick={()=>setSummaryOpen(value=>!value)}>{summaryOpen?'Hide dossier summary':'Dossier summary'}</button>}
      {reference.eurLexUrl&&<a href={reference.eurLexUrl} target="_blank" rel="noreferrer">EUR-Lex ↗</a>}
      {procedure&&<a className="legal-reference-secondary" href={'?'+new URLSearchParams({view:'legislation','pl-mode':'dossier','dossier-ref':procedure})}>Dossier view</a>}
    </div>
    {evidence&&<EvidenceNote evidence={evidence} notePrefix={notePrefix} references={references}/>}
    {procedure&&summaryOpen&&<DossierSummary reference={procedure} language={language} showTitle={reference.kind==='procedure'}/>}
    {reference.source&&<p className="legal-reference-source">{reference.source.name}{reference.celex?' · CELEX '+reference.celex:''}</p>}
  </>;
}

const shortLabel=(reference:ResolvedReference|undefined,key:string)=>{const title=reference?.title||reference?.celex||key.replace(/^[a-z]+:/,'');return title.length>90?title.slice(0,88)+'…':title;};
function EvidenceNote({evidence,notePrefix,references}:{evidence:Evidence;notePrefix:string;references:Map<string,ResolvedReference>}) {
  if(evidence.status==='hyperlink'){let host='';try{host=new URL(evidence.url).hostname;}catch{}return <p className="legal-reference-evidence">The document links this text to {host||'this source'}.</p>;}
  const note=<a href={`#${notePrefix}-note-${evidence.noteId}`}>footnote {evidence.note}</a>;
  if(evidence.status==='confirmed')return <p className="legal-reference-evidence is-confirmed"><span aria-hidden="true">✓ </span>The document’s {note} gives the same identifier.</p>;
  if(evidence.status==='from-note')return <p className="legal-reference-evidence is-confirmed">Identified by the document’s {note}.</p>;
  return <p className="legal-reference-evidence">The document’s {note} points to {(evidence.others||[]).map(key=>shortLabel(references.get(key),key)).join('; ')}.</p>;
}

function DossierSummary({reference,language,showTitle}:{reference:string;language:string;showTitle:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const {data,loading,error,retry}=useData<Summary>('reference-summary?'+new URLSearchParams({reference,lang:language}));
  if(loading&&!data)return <p className="legal-reference-summary" role="status">Loading dossier summary…</p>;
  if(!data)return <p className="legal-reference-summary">{error?<>The Legislative Observatory summary is temporarily unavailable. <button type="button" className="legal-reference-text-button" onClick={retry}>Try again</button></>:null}</p>;
  const blocks=data.summary?.blocks||[],shown=expanded?blocks:blocks.slice(0,2);
  return <section className="legal-reference-summary" aria-label={'Dossier summary '+reference}>
    {showTitle&&<p className="legal-reference-title">{data.title}</p>}
    {data.summary?<>
      <p className="legal-reference-meta">{stageName(data.summary.stage)} · {displayDate(data.summary.date,language)}{data.language!==language?' · '+(new Intl.DisplayNames([language],{type:'language'}).of(data.language)||data.language):''}{data.summary.method?' · '+data.summary.method:''}</p>
      <div lang={data.language}>{shown.map((block,index)=>block.kind==='heading'?<h4 key={index}>{block.text}</h4>:<p key={index}>{block.text}</p>)}</div>
      <div className="legal-reference-actions">{blocks.length>2&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show less':'Continue reading'}</button>}<a className="legal-reference-secondary" href={data.summary.source.url} target="_blank" rel="noreferrer">Legislative Observatory ↗</a></div>
    </>:<p className="legal-reference-meta">The Legislative Observatory publishes no summary for {reference}.</p>}
  </section>;
}

function ReferenceButton({refKey,text,evidence,className='legal-ref',label}:{refKey:string;text:string;evidence?:Evidence;className?:string;label?:string}) {
  const scope=useContext(ReferenceScopeContext)!,self=useRef<HTMLButtonElement>(null),expanded=Boolean(self.current)&&scope.open?.trigger===self.current;
  const hover=useRef<number>(0);
  return <button ref={self} type="button" className={className} aria-label={label} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded?scope.cardId:undefined}
    onClick={event=>{window.clearTimeout(hover.current);scope.show({key:refKey,text,trigger:event.currentTarget,pinned:true,evidence});}}
    onPointerEnter={event=>{if(event.pointerType!=='mouse'||!finePointer())return;const trigger=event.currentTarget;hover.current=window.setTimeout(()=>scope.show({key:refKey,text,trigger,pinned:false,evidence}),350);}}
    onPointerLeave={event=>{window.clearTimeout(hover.current);if(event.pointerType==='mouse')scope.hoverEnd();}}>{text}</button>;
}
const urlPattern=/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:)]/g;
function plain(text:string,linkify:boolean,key:string) {
  if(!linkify)return text;
  const parts:ReactNode[]=[];let cursor=0;
  for(const match of text.matchAll(urlPattern)){if(match.index>cursor)parts.push(text.slice(cursor,match.index));parts.push(<PocSourceLink key={key+'-'+match.index} url={match[0]} compact>{match[0]}</PocSourceLink>);cursor=match.index+match[0].length;}
  if(cursor<text.length)parts.push(text.slice(cursor));
  return parts;
}
// A marker opens the reference its footnote identifies, when the footnote identifies exactly one.
function NoteMark({anchor,notePrefix}:{anchor:NoteAnchor;notePrefix:string}) {
  const scope=useContext(ReferenceScopeContext),key=scope?noteIdentifies(scope,anchor.note):null;
  if(key)return <sup className="legal-note-mark"><ReferenceButton refKey={key} text={anchor.label} className="legal-ref legal-note-ref" label={'Note '+anchor.label+': '+shortLabel(scope!.references.get(key),key)} evidence={{status:'from-note',note:anchor.label,noteId:anchor.note}}/></sup>;
  return <sup className="legal-note-mark"><a href={`#${notePrefix}-note-${anchor.note}`} aria-label={'Note '+anchor.label}>{anchor.label}</a></sup>;
}
// Renders text unchanged. Document hyperlinks and resolved references become controls; footnote markers keep their exact offsets.
export function ReferenceText({text,start=0,anchors=[],links=[],final=true,notePrefix='',linkify=false}:{text:string;start?:number;anchors?:NoteAnchor[];links?:(LinkSpan|DocumentLink)[];final?:boolean;notePrefix?:string;linkify?:boolean}) {
  const scope=useContext(ReferenceScopeContext);
  const spans=links.filter(link=>link.start>=start&&link.end<=start+text.length).map(link=>({start:link.start-start,end:link.end-start,url:link.url}));
  const parts=(scope?linkedSegments(text,spans):[{text,from:0,to:text.length}]).map(part=>({...part,linked:Boolean(part.ref&&linked(scope?.references.get(part.ref.key)))}));
  // A marker inside a linked span is shown after it.
  const marks=anchors.filter(anchor=>anchor.offset>=start&&(anchor.offset<start+text.length||final&&anchor.offset===start+text.length))
    .map(anchor=>{let at=anchor.offset-start;for(const part of parts)if((part.linked||part.href)&&part.from<at&&at<part.to)at=part.to;return {anchor,at};}).sort((a,b)=>a.at-b.at);
  const evidenceFor=(part:typeof parts[number]):Evidence|undefined=>{
    if(part.ref?.via==='hyperlink')return {status:'hyperlink',url:part.ref.url||''};
    const after=marks.find(mark=>mark.at>=part.to&&/^[\s)\]’'"]*$/.test(text.slice(part.to,mark.at)));
    if(!after||!scope)return undefined;
    const found=allFound(scope,after.anchor.note),own=identity(scope,part.ref!.key);
    if(found.some(key=>identity(scope,key)===own))return {status:'confirmed',note:after.anchor.label,noteId:after.anchor.note};
    return found.length?{status:'other',note:after.anchor.label,noteId:after.anchor.note,others:found}:undefined;
  };
  const nodes:ReactNode[]=[];let next=0;
  const mark=()=>{const {anchor}=marks[next++];nodes.push(<NoteMark key={'note-'+next} anchor={anchor} notePrefix={notePrefix}/>);};
  for(const part of parts) {
    if(part.linked||part.href) {
      while(next<marks.length&&marks[next].at<=part.from)mark();
      nodes.push(part.linked?<ReferenceButton key={'ref-'+part.from} refKey={part.ref!.key} text={part.text} evidence={evidenceFor(part)}/>:<PocSourceLink key={'link-'+part.from} url={part.href!} compact>{part.text}</PocSourceLink>);
      continue;
    }
    let local=part.from;
    while(next<marks.length&&marks[next].at<part.to){const at=Math.max(marks[next].at,local);if(at>local)nodes.push(plain(text.slice(local,at),linkify,String(local)));local=at;mark();}
    if(local<part.to)nodes.push(plain(text.slice(local,part.to),linkify,String(local)));
  }
  while(next<marks.length)mark();
  return <>{nodes}</>;
}
export function DocumentNotes({notes,prefix}:{notes:DocumentNote[];prefix:string}) {
  if(!notes.length)return null;
  return <details className="legal-notes" open><summary>Notes · {notes.length}</summary><ol>{notes.map(note=><li key={note.id} id={`${prefix}-note-${note.id}`} value={/^\d+$/.test(note.label)?Number(note.label):undefined}>
    <span className="legal-note-label">{/^\d+$/.test(note.label)?null:note.label+' '}</span><ReferenceText text={note.text} links={note.linkSpans||[]} linkify/>
    {note.links.filter(link=>!note.text.includes(link)&&!(note.linkSpans||[]).some(span=>span.url===link)).map(link=><span key={link}> <PocSourceLink url={link} compact>Link ↗</PocSourceLink></span>)}
  </li>)}</ol></details>;
}
// Every text and link target in a reader, so one lookup covers the body, its notes and their hyperlinks.
export const readerTexts=(paragraphs:string[],notes:DocumentNote[]|undefined,links:DocumentLink[]|undefined)=>[...paragraphs,...(links||[]).map(link=>link.url),...(notes||[]).flatMap(note=>[note.text,...note.links])];
