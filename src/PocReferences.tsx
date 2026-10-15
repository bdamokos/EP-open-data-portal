import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {referenceKeys,referenceSegments,type FoundReference} from '../server/legal-reference-text.mjs';
import {useData} from './pocData';
import {humanDate} from './PocInsightCharts';
import type {DocumentNote,NoteAnchor} from './pocTypes';
import './PocReferences.css';

type Source={name:string;url:string;fetchedAt:string};
export type ResolvedReference={key:string;kind:'act'|'document'|'procedure'|'question';status:'found'|'not-found'|'ambiguous'|'unavailable';stale?:boolean;
  celex?:string|null;title?:string|null;titleLanguage?:string|null;date?:string|null;inForce?:boolean|null;procedure?:string|null;eurLexUrl?:string;
  id?:string|null;answerIds?:string[];source?:Source};
type Summary={reference:string;title:string;language:string;summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string;fetchedAt:string}};source:{url:string;fetchedAt:string}};
type OpenCard={key:string;text:string;trigger:HTMLElement;pinned:boolean};
type Scope={references:Map<string,ResolvedReference>;open:OpenCard|null;show:(card:OpenCard)=>void;hoverEnd:()=>void;cardId:string};
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
  const {data}=useData<{references:ResolvedReference[]}>(keys.length?'references?'+new URLSearchParams({keys:keys.join(','),lang:language}):null);
  return useMemo(()=>new Map((data?.references||[]).map(reference=>[reference.key,reference])),[data]);
}
const linked=(reference:ResolvedReference|undefined)=>reference?.status==='found';

// Wraps one reader. Opened question readers appear below the text, so reading stays in place.
export function ReferenceScope({texts,language,children,renderQuestion}:{texts:string[];language:string;children:ReactNode;renderQuestion?:(id:string)=>ReactNode}) {
  const references=useReferenceLookup(texts,language);
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
  const scope=useMemo(()=>({references,open,show,hoverEnd,cardId}),[references,open,show,hoverEnd,cardId]);
  const reference=open?references.get(open.key):undefined;
  return <ReferenceScopeContext.Provider value={scope}><div className="legal-reference-scope" ref={wrapper}>
    {children}
    {open&&reference&&position&&<div ref={card} id={cardId} className="legal-reference-card" role="dialog" aria-label={open.text} tabIndex={-1} style={position}
      onPointerEnter={()=>window.clearTimeout(timer.current)} onPointerLeave={event=>{if(event.pointerType==='mouse')hoverEnd();}}>
      <ReferenceCard reference={reference} text={open.text} language={language} onQuestion={renderQuestion?id=>{setQuestion(id);close();}:undefined}/>
      <button type="button" className="legal-reference-close" aria-label="Close" onClick={()=>close(true)}>×</button>
    </div>}
    {question&&renderQuestion&&<div className="legal-reference-question"><button type="button" className="legal-reference-text-button" onClick={()=>setQuestion(null)}>Close referenced question</button>{renderQuestion(question)}</div>}
  </div></ReferenceScopeContext.Provider>;
}

function ReferenceCard({reference,text,language,onQuestion}:{reference:ResolvedReference;text:string;language:string;onQuestion?:(id:string)=>void}) {
  const procedure=reference.kind==='procedure'?reference.procedure:reference.procedure||null;
  const [summaryOpen,setSummaryOpen]=useState(reference.kind==='procedure');
  useEffect(()=>setSummaryOpen(reference.kind==='procedure'),[reference.key]);
  const celex=reference.celex||'',sector=celex.slice(5,7).replace(/\d/g,'');
  const kind=reference.kind==='question'?questionType[reference.id?.[0]||'E']:reference.kind==='procedure'?'Legislative procedure':reference.kind==='act'?'EU law · '+(actType[celex[5]]||'Act'):documentType[sector]||'EU document';
  const status=reference.kind==='act'&&reference.inForce!==null&&reference.inForce!==undefined?(reference.inForce?'In force':'No longer in force'):null;
  const older=reference.date&&reference.date<TERM_START&&reference.kind!=='question'?'Before the current term':null;
  return <>
    <p className="legal-reference-kind">{[kind,status].filter(Boolean).join(' · ')}</p>
    {reference.kind!=='procedure'&&<p className="legal-reference-title" lang={reference.titleLanguage||undefined}>{reference.title||text}</p>}
    <p className="legal-reference-meta">{[displayDate(reference.date,language),procedure&&reference.kind!=='procedure'?'Procedure '+procedure:null,older].filter(Boolean).join(' · ')}</p>
    {reference.stale&&<p className="legal-reference-meta">Saved description; the official catalogue is temporarily unavailable.</p>}
    <div className="legal-reference-actions">
      {reference.kind==='question'&&reference.id&&onQuestion&&<button type="button" onClick={()=>onQuestion(reference.id!)}>{reference.answerIds?.length?'Read question and answer':'Read question'}</button>}
      {procedure&&reference.kind!=='procedure'&&<button type="button" aria-expanded={summaryOpen} onClick={()=>setSummaryOpen(value=>!value)}>{summaryOpen?'Hide dossier summary':'Dossier summary'}</button>}
      {reference.eurLexUrl&&<a href={reference.eurLexUrl} target="_blank" rel="noreferrer">EUR-Lex ↗</a>}
      {procedure&&<a className="legal-reference-secondary" href={'?'+new URLSearchParams({view:'legislation','pl-mode':'dossier','dossier-ref':procedure})}>Dossier view</a>}
    </div>
    {procedure&&summaryOpen&&<DossierSummary reference={procedure} language={language} showTitle={reference.kind==='procedure'}/>}
    {reference.source&&<p className="legal-reference-source">{reference.source.name}{reference.celex?' · CELEX '+reference.celex:''}</p>}
  </>;
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

function ReferenceButton({part}:{part:FoundReference}) {
  const scope=useContext(ReferenceScopeContext)!,expanded=scope.open?.key===part.key&&scope.open.text===part.text;
  const hover=useRef<number>(0);
  return <button type="button" className="legal-ref" aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded?scope.cardId:undefined}
    onClick={event=>{window.clearTimeout(hover.current);scope.show({key:part.key,text:part.text,trigger:event.currentTarget,pinned:true});}}
    onPointerEnter={event=>{if(event.pointerType!=='mouse'||!finePointer())return;const trigger=event.currentTarget;hover.current=window.setTimeout(()=>scope.show({key:part.key,text:part.text,trigger,pinned:false}),350);}}
    onPointerLeave={event=>{window.clearTimeout(hover.current);if(event.pointerType==='mouse')scope.hoverEnd();}}>{part.text}</button>;
}
const urlPattern=/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:)]/g;
function plain(text:string,linkify:boolean,key:string) {
  if(!linkify)return text;
  const parts:ReactNode[]=[];let cursor=0;
  for(const match of text.matchAll(urlPattern)){if(match.index>cursor)parts.push(text.slice(cursor,match.index));parts.push(<a key={key+'-'+match.index} href={match[0]} target="_blank" rel="noreferrer">{match[0]}</a>);cursor=match.index+match[0].length;}
  if(cursor<text.length)parts.push(text.slice(cursor));
  return parts;
}
// Renders text unchanged. Resolved references become buttons; footnote markers are placed at their exact offsets.
export function ReferenceText({text,start=0,anchors=[],final=true,notePrefix='',linkify=false}:{text:string;start?:number;anchors?:NoteAnchor[];final?:boolean;notePrefix?:string;linkify?:boolean}) {
  const scope=useContext(ReferenceScopeContext);
  let offset=0;
  const parts=(scope?referenceSegments(text):[{text}]).map(part=>{const item={...part,from:offset,to:offset+part.text.length,linked:Boolean(part.ref&&linked(scope?.references.get(part.ref.key)))};offset=item.to;return item;});
  // A marker inside a linked reference is shown after it.
  const marks=anchors.filter(anchor=>anchor.offset>=start&&(anchor.offset<start+text.length||final&&anchor.offset===start+text.length))
    .map(anchor=>{let at=anchor.offset-start;for(const part of parts)if(part.linked&&part.from<at&&at<part.to)at=part.to;return {anchor,at};}).sort((a,b)=>a.at-b.at);
  const nodes:ReactNode[]=[];let next=0;
  const mark=()=>{const {anchor}=marks[next++];nodes.push(<sup key={'note-'+next} className="legal-note-mark"><a href={`#${notePrefix}-note-${anchor.note}`} aria-label={'Note '+anchor.label}>{anchor.label}</a></sup>);};
  for(const part of parts) {
    if(part.linked){while(next<marks.length&&marks[next].at<=part.from)mark();nodes.push(<ReferenceButton key={'ref-'+part.from} part={part.ref!}/>);continue;}
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
    <span className="legal-note-label">{/^\d+$/.test(note.label)?null:note.label+' '}</span><ReferenceText text={note.text} linkify/>
    {note.links.filter(link=>!note.text.includes(link)).map(link=><span key={link}> <a href={link} target="_blank" rel="noreferrer">Link ↗</a></span>)}
  </li>)}</ol></details>;
}
export const noteTexts=(notes:DocumentNote[]|undefined)=>(notes||[]).flatMap(note=>[note.text,...note.links]);
