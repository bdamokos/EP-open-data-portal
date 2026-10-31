import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {DocumentImage,type DocumentImageAssets} from './DocumentImage';
import {SourceLink} from './SourceLink';
import {Fragment,createContext,createElement,useCallback,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {linkedSegments,noteReferences,referenceKeys,type LinkSpan} from '../server/legal-reference-text.mjs';
import {useData} from './data';
import {humanDate} from './InsightCharts';
import {summaryStage} from './terms.mjs';
import type {DocumentLink,DocumentNote,NoteAnchor} from './explorerTypes';
import type {FormatMark} from './DocumentFormatting';
import './References.css';

type Source={name:string;url:string;fetchedAt:string};
export type ResolvedReference={key:string;kind:'act'|'document'|'procedure'|'question';status:'found'|'not-found'|'ambiguous'|'unavailable';stale?:boolean;
  celex?:string|null;title?:string|null;titleLanguage?:string|null;date?:string|null;inForce?:boolean|null;procedure?:string|null;eurLexUrl?:string;
  id?:string|null;answerIds?:string[];source?:Source};
type Summary={reference:string;title:string;language:string;summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string;fetchedAt:string}};source:{url:string;fetchedAt:string}};
type Footnote={label:string;href:string};
type OpenCard={key:string;text:string;trigger:HTMLElement;pinned:boolean;footnote?:Footnote};
type OpenQuestion={id:string;trigger:HTMLElement};
type Scope={references:Map<string,ResolvedReference>;noteKeys:Map<string,{linked:string[];cited:string[]}>;notePrefix:string;textLanguage:string|null;open:OpenCard|null;show:(card:OpenCard)=>void;hoverEnd:()=>void;cardId:string};
const ReferenceScopeContext=createContext<Scope|null>(null);

// The current term began on 16 July 2024. Older acts are described, not claimed as indexed activity.
const TERM_START='2024-07-16';
const actType:Record<string,string>={R:'Regulation',L:'Directive',D:'Decision',F:'Framework decision'};
export const actTypeUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof actType => ({R:ui.t("batch6.references.regulation.24"),L:ui.t("batch6.references.directive.24"),D:ui.t("membervotespresentation.decision"),F:ui.t("batch6.references.framework.decision.24")});

const documentType:Record<string,string>={PC:'Commission proposal',DC:'Commission document',SC:'Staff working document',JC:'Joint document'};
export const documentTypeUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof documentType => ({PC:ui.t("batch6.references.commission.proposal.25"),DC:ui.t("batch6.references.commission.document.25"),SC:ui.t("batch6.references.staff.working.document.25"),JC:ui.t("batch6.references.joint.document.25")});

const questionType:Record<string,string>={E:'Written question',P:'Priority question',O:'Oral question'};
export const questionTypeUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof questionType => ({E:ui.t("batch4.questiontopics.tsx.written.question"),P:ui.t("batch6.references.priority.question.26"),O:ui.t("batch4.questiontopics.tsx.oral.question")});

const displayDate=(value:string|null|undefined,language:string)=>value ? humanDate(value,language) : null;
const finePointer=()=>typeof matchMedia==='function'&&matchMedia('(hover: hover) and (pointer: fine)').matches;
function connectedFocusTarget(element:HTMLElement|null|undefined) {
  if(!element?.isConnected||element.closest('[hidden],[inert],[aria-hidden="true"]')||element.matches(':disabled'))return false;
  // A closed disclosure retains its DOM, but only its first summary stays visible.
  for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.matches('details:not([open])')&&!parent.querySelector(':scope > summary')?.contains(element))return false;
  return true;
}
function returnToReference(trigger:HTMLElement|undefined,scope:HTMLElement|null,reveal=false) {
  const heading=scope?.closest('section,article')?.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6');
  const target=[trigger,heading,scope].find(connectedFocusTarget);
  if(!target)return;
  const temporary=!target.hasAttribute('tabindex')&&!target.matches('button,a[href],input,select,textarea,summary');
  if(temporary){target.tabIndex=-1;target.addEventListener('blur',()=>target.removeAttribute('tabindex'),{once:true});}
  target.focus({preventScroll:true});
  if(reveal)target.scrollIntoView({block:'nearest'});
}

export function useReferenceLookup(texts:string[],language:string) {
  const joined=texts.join('\u0000');
  const keys=useMemo(()=>referenceKeys(texts),[joined]);
  const state=useData<{references:ResolvedReference[]}>(keys.length ? ('references?'+new URLSearchParams({keys:keys.join(','),lang:language})) : null);
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
// A footnote's own hyperlink identifies it; its text citations count only when it has no resolved link.
const noteIdentifies=(scope:Scope,noteId:string)=>{const note=scope.noteKeys.get(noteId);if(!note)return null;const links=distinctFound(scope,note.linked);const found=links.length ? links : distinctFound(scope,note.cited);return (found.length===1) ? found[0] : null;};

// Wraps one reader. Opened question readers appear below the text, so reading stays in place.
export function ReferenceScope({texts,language,textLanguage=null,children,renderQuestion,notes=[],notePrefix=''}:{texts:string[];language:string;textLanguage?:string|null;children:ReactNode;renderQuestion?:(id:string)=>ReactNode;notes?:DocumentNote[];notePrefix?:string}) {
  const ui = useUiI18n();
  const lookup=useReferenceLookup(texts,language),references=lookup.references;
  const noteKeys=useMemo(()=>new Map(notes.map(note=>[note.id,noteReferences(note)])),[notes]);
  const [open,setOpen]=useState<OpenCard|null>(null),[question,setQuestion]=useState<OpenQuestion|null>(null);
  const wrapper=useRef<HTMLDivElement>(null),card=useRef<HTMLDivElement>(null),questionReader=useRef<HTMLDivElement>(null),focusedCard=useRef<OpenCard|null>(null),timer=useRef<number>(0),cardId=useId();
  const close=useCallback((restore=false)=>{if(restore)returnToReference(open?.trigger,wrapper.current);setOpen(null);},[open]);
  const show=useCallback((next:OpenCard)=>{window.clearTimeout(timer.current);setOpen(current=>(current?.pinned && (!next.pinned)) ? current : next);},[]);
  const keepOpen=()=>{
    window.clearTimeout(timer.current);
    if(!open||open.pinned)return;
    const next={...open,pinned:true};
    // Interaction already chose its focus and reading position inside the card.
    focusedCard.current=next;setOpen(next);
  };
  const hoverEnd=useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setOpen(current=>current?.pinned ? current : null),250);},[]);
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
  const reference=open ? references.get(open.key) : undefined;
  useEffect(()=>{if(!open){focusedCard.current=null;return;}if(open.pinned&&card.current&&focusedCard.current!==open){focusedCard.current=open;card.current.focus({preventScroll:true});card.current.scrollIntoView({block:'nearest'});}},[open,position,reference]);
  useLayoutEffect(()=>{
    if(!question||!questionReader.current)return;
    questionReader.current.focus({preventScroll:true});
    questionReader.current.scrollIntoView({block:'start'});
  },[question]);
  const scope=useMemo(()=>({references,noteKeys,notePrefix,textLanguage,open,show,hoverEnd,cardId}),[references,noteKeys,notePrefix,textLanguage,open,show,hoverEnd,cardId]);
  return <ReferenceScopeContext.Provider value={scope}><div className="legal-reference-scope" ref={wrapper} role="group" aria-label={ui.t("batch6.references.document.text.and.references.103")} tabIndex={-1}>
    {children}
    {lookup.unavailable&&<p lang={ui.language} className="legal-reference-retry" role="status"><UiMessage id="batch6.references.reference.details.are.temporarily.unavailable.105"/> <button type="button" className="legal-reference-text-button" disabled={lookup.loading} onClick={lookup.retry}>{lookup.loading ? <UiMessage id="batch6.references.retrying.references.105"/> : <UiMessage id="batch6.references.retry.references.105"/>}</button></p>}
    {open&&reference&&position&&<div ref={card} id={cardId} className="legal-reference-card" lang={open.trigger.closest('[lang]')?.getAttribute('lang')??''} role="dialog" aria-label={open.text} tabIndex={-1} style={position}
      onPointerDownCapture={keepOpen} onFocusCapture={keepOpen}
      onPointerEnter={()=>window.clearTimeout(timer.current)} onPointerLeave={event=>{if(event.pointerType==='mouse')hoverEnd();}}>
      <ReferenceCard reference={reference} text={open.text} textLanguage={open.trigger.closest('[lang]')?.getAttribute('lang')??''} language={language} footnote={open.footnote} onQuestion={renderQuestion ? (id=>{setQuestion({id,trigger:open.trigger});close();}) : undefined}/>
      <button type="button" lang={ui.language} className="legal-reference-close" aria-label={ui.t("plenarylive.tsx.close")} onClick={()=>close(true)}>×</button>
    </div>}
    {question&&renderQuestion&&<div lang={ui.language} className="legal-reference-question" ref={questionReader} role="region" aria-label={ui.t("batch6.references.referenced.question.112")} tabIndex={-1}><button type="button" className="legal-reference-text-button" onClick={()=>{returnToReference(question.trigger,wrapper.current,true);setQuestion(null);}}><UiMessage id="batch6.references.close.referenced.question.112"/></button>{renderQuestion(question.id)}</div>}
  </div></ReferenceScopeContext.Provider>;
}

function ReferenceCard({reference,text,textLanguage,language,onQuestion,footnote}:{reference:ResolvedReference;text:string;textLanguage:string;language:string;onQuestion?:(id:string)=>void;footnote?:Footnote}) {
  const ui = useUiI18n();
  const procedure=(reference.kind==='procedure') ? reference.procedure : (reference.procedure||null);
  const [summaryOpen,setSummaryOpen]=useState(reference.kind==='procedure');
  useEffect(()=>setSummaryOpen(reference.kind==='procedure'),[reference.key]);
  const celex=reference.celex||'',sector=celex.slice(5,7).replace(/\d/g,'');
  const kind=(reference.kind==='question') ? questionTypeUi(ui)[reference.id?.[0]||'E'] : ((reference.kind==='procedure') ? ui.t("batch6.references.legislative.procedure.121") : (celex.startsWith('1') ? ui.t("batch6.references.eu.treaty.121") : ((reference.kind==='act') ? ui.t("batch6.references.eu.law.acttype.121", {actType: String(actTypeUi(ui)[celex[5]]||ui.t("batch6.references.act.121"))}) : (documentTypeUi(ui)[sector]||ui.t("batch6.references.eu.document.121")))));
  const status=(((reference.kind==='act') && (reference.inForce!==null)) && (reference.inForce!==undefined)) ? (reference.inForce ? ui.t("batch6.references.in.force.122") : ui.t("batch6.references.no.longer.in.force.122")) : null;
  const older=((reference.date && (reference.date<TERM_START)) && (reference.kind!=='question')) ? ui.t("batch6.references.before.the.current.term.123") : null;
  const metadata=[{text:displayDate(reference.date,language),language},{text:(procedure && (reference.kind!=='procedure')) ? ui.t("batch6.references.procedure.reference.124", {reference: String(procedure)}) : null,language:'en'},{text:older,language:'en'}].filter(item=>item.text);
  return <>
    <p lang={ui.language} className="legal-reference-kind">{[kind,status].filter(Boolean).join(' · ')}</p>
    {reference.kind!=='procedure'&&<p className="legal-reference-title" lang={reference.title ? (reference.titleLanguage??'') : textLanguage}>{reference.title||text}</p>}
    <p lang={ui.language} className="legal-reference-meta">{metadata.map((item,index)=><Fragment key={index}>{index ? ' · ' : ''}<span lang={item.language}>{item.text}</span></Fragment>)}</p>
    {reference.stale&&<p lang={ui.language} className="legal-reference-meta">{reference.source?.fetchedAt ? <UiMessage id="batch6.references.saved.description.from.date.a.newer.check.of.the.official.source..129" values={{date: <span lang={language}>{displayDate(reference.source.fetchedAt,language)}</span>}}/> : <UiMessage id="batch6.references.saved.description.a.newer.check.of.the.official.source.is.pending.129"/>}</p>}
    <div lang={ui.language} className="legal-reference-actions">
      {reference.kind==='question'&&reference.id&&onQuestion&&<button type="button" onClick={()=>onQuestion(reference.id!)}>{reference.answerIds?.length ? <UiMessage id="batch6.references.read.question.and.answer.131"/> : <UiMessage id="textsearch.read_question"/>}</button>}
      {procedure&&reference.kind!=='procedure'&&<button type="button" aria-expanded={summaryOpen} onClick={()=>setSummaryOpen(value=>!value)}>{summaryOpen ? <UiMessage id="batch6.references.hide.dossier.summary.132"/> : <UiMessage id="dossierCard.event.5"/>}</button>}
      {reference.eurLexUrl&&<a href={reference.eurLexUrl} target="_blank" rel="noreferrer"><UiMessage id="batch6.references.eur.lex.133"/></a>}
      {procedure&&<a className="legal-reference-secondary" href={'?'+new URLSearchParams({view:'legislation','pl-mode':'dossier','dossier-ref':procedure})}><UiMessage id="batch6.references.dossier.view.134"/></a>}
      {footnote&&<a className="legal-reference-secondary" href={footnote.href}><UiMessage id="batch6.references.footnote.label.135" values={{label: footnote.label}}/></a>}
    </div>
    {procedure&&summaryOpen&&<DossierSummary reference={procedure} language={language} showTitle={reference.kind==='procedure'}/>}
  </>;
}

const shortLabel=(reference:ResolvedReference|undefined,key:string)=>{const title=reference?.title||reference?.celex||key.replace(/^[a-z]+:/,'');return (title.length>90) ? (title.slice(0,88)+'…') : title;};
function DossierSummary({reference,language,showTitle}:{reference:string;language:string;showTitle:boolean}) {
  const ui = useUiI18n();
  const [expanded,setExpanded]=useState(false);
  const {data,loading,error,retry}=useData<Summary>('reference-summary?'+new URLSearchParams({reference,lang:language}));
  if(loading&&!data)return <p lang={ui.language} className="legal-reference-summary" role="status"><UiMessage id="batch6.references.loading.dossier.summary.145"/></p>;
  if(!data)return <p lang={ui.language} className="legal-reference-summary">{error ? <><UiMessage id="batch6.references.the.legislative.observatory.summary.is.temporarily.unavailable.146"/> <button type="button" className="legal-reference-text-button" onClick={retry}><UiMessage id="commissionfollowups.try_again"/></button></> : null}</p>;
  const blocks=data.summary?.blocks||[],shown=expanded ? blocks : blocks.slice(0,2);
  return <section lang={ui.language} className="legal-reference-summary" aria-label={ui.t("batch6.references.dossier.summary.reference.148", {reference: String(reference)})}>
    {showTitle&&<p className="legal-reference-title" lang={data.language??''}>{data.title}</p>}
    {data.summary ? <>
      <p className="legal-reference-meta"><span lang={summaryStage(data.summary.stage,language, ui).language}>{summaryStage(data.summary.stage,language, ui).text}</span> · <span lang={language}>{displayDate(data.summary.date,language)}</span>{(data.language!==language) ? <> · <span lang={language}>{new Intl.DisplayNames([language],{type:'language'}).of(data.language)||data.language}</span></> : ''}{data.summary.method ? (' · '+data.summary.method) : ''}</p>
      <div lang={data.language??''}>{shown.map((block,index)=>(block.kind==='heading') ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)}</div>
      <div className="legal-reference-actions">{blocks.length>2&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded ? <UiMessage id="procedurecontext.show_less.4c852b"/> : <UiMessage id="procedurecontext.continue_reading.4f4840"/>}</button>}<a className="legal-reference-secondary" href={data.summary.source.url} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.35.74"/></a></div>
    </> : <p className="legal-reference-meta"><UiMessage id="batch6.references.the.legislative.observatory.publishes.no.summary.for.reference.154" values={{reference: String(reference ?? '')}}/></p>}
  </section>;
}

function ReferenceButton({refKey,text,footnote,className='legal-ref',label}:{refKey:string;text:string;footnote?:Footnote;className?:string;label?:string}) {
  const scope=useContext(ReferenceScopeContext)!,self=useRef<HTMLButtonElement>(null),expanded=Boolean(self.current)&&scope.open?.trigger===self.current;
  const hover=useRef<number>(0);
  return <button ref={self} type="button" className={className} aria-label={label} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? scope.cardId : undefined}
    onClick={event=>{window.clearTimeout(hover.current);scope.show({key:refKey,text,trigger:event.currentTarget,pinned:true,footnote});}}
    onPointerEnter={event=>{if(event.pointerType!=='mouse'||!finePointer())return;const trigger=event.currentTarget;hover.current=window.setTimeout(()=>scope.show({key:refKey,text,trigger,pinned:false,footnote}),350);}}
    onPointerLeave={event=>{window.clearTimeout(hover.current);if(event.pointerType==='mouse')scope.hoverEnd();}}>{text}</button>;
}
const urlPattern=/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:)]/g;
function plain(text:string,linkify:boolean,key:string,language:string) {
  if(!linkify)return text;
  const parts:ReactNode[]=[];let cursor=0;
  for(const match of text.matchAll(urlPattern)){if(match.index>cursor)parts.push(text.slice(cursor,match.index));parts.push(<SourceLink key={key+'-'+match.index} url={match[0]} contentLanguage={language} compact>{match[0]}</SourceLink>);cursor=match.index+match[0].length;}
  if(cursor<text.length)parts.push(text.slice(cursor));
  return parts;
}
// A marker opens the reference its footnote identifies, when the footnote identifies exactly one.
function NoteMark({anchor,notePrefix}:{anchor:NoteAnchor;notePrefix:string}) {
  const ui = useUiI18n();
  const scope=useContext(ReferenceScopeContext),key=scope ? noteIdentifies(scope,anchor.note) : null;
  if(key)return <sup className="legal-note-mark"><ReferenceButton refKey={key} text={anchor.label} className="legal-ref legal-note-ref" footnote={{label:anchor.label,href:`#${notePrefix}-note-${anchor.note}`}} label={ui.t("batch6.references.note.label.title.177", {label: String(anchor.label), title: String(shortLabel(scope!.references.get(key),key))})}/></sup>;
  return <sup className="legal-note-mark"><a lang={ui.language} href={`#${notePrefix}-note-${anchor.note}`} aria-label={ui.t("batch6.references.note.label.178", {label: String(anchor.label)})}>{anchor.label}</a></sup>;
}
const emphasisTags={bold:'b',italic:'i',underline:'u',strike:'s',superscript:'sup',subscript:'sub'} as const;
// Source emphasis wraps the text it covers; a control takes the emphasis present at its start.
function emphasis(node:ReactNode,kinds:FormatMark['kind'][],key:string) {
  return kinds.reduceRight<ReactNode>((content,kind,index)=>createElement(emphasisTags[kind],{key:key+'-'+index},content),node);
}
// Renders text unchanged. Document hyperlinks and resolved references become controls; footnote markers keep their exact offsets.
export function ReferenceText({text,start=0,anchors=[],links=[],marks:formatMarks=[],final=true,notePrefix='',linkify=false}:{text:string;start?:number;anchors?:NoteAnchor[];links?:(LinkSpan|DocumentLink)[];marks?:FormatMark[];final?:boolean;notePrefix?:string;linkify?:boolean}) {
  const scope=useContext(ReferenceScopeContext);
  const styles=formatMarks.map(mark=>({kind:mark.kind,start:Math.max(0,mark.start-start),end:Math.min(text.length,mark.end-start)})).filter(mark=>mark.end>mark.start);
  const kindsAt=(from:number,to:number)=>styles.filter(mark=>mark.start<=from&&mark.end>=to).map(mark=>mark.kind);
  const styled=(from:number,to:number)=>{
    if(!styles.length)return plain(text.slice(from,to),linkify,String(from),scope?.textLanguage??'');
    const cuts=[...new Set([from,to,...styles.flatMap(mark=>[mark.start,mark.end]).filter(at=>at>from&&at<to)])].sort((a,b)=>a-b);
    return cuts.slice(0,-1).map((at,index)=>{const kinds=kindsAt(at,cuts[index+1]),content=plain(text.slice(at,cuts[index+1]),linkify,String(at),scope?.textLanguage??'');return kinds.length ? emphasis(content,kinds,'em-'+at) : <Fragment key={'t-'+at}>{content}</Fragment>;});
  };
  const spans=links.filter(link=>link.start>=start&&link.end<=start+text.length).map(link=>({start:link.start-start,end:link.end-start,url:link.url}));
  const parts=(scope ? linkedSegments(text,spans) : ([{text,from:0,to:text.length}])).map(part=>({...part,linked:Boolean(part.ref&&linked(scope?.references.get(part.ref.key)))}));
  // A marker inside a linked span is shown after it.
  const marks=anchors.filter(anchor=>anchor.offset>=start&&(anchor.offset<start+text.length||final&&anchor.offset===start+text.length))
    .map(anchor=>{let at=anchor.offset-start;for(const part of parts)if((part.linked||part.href)&&part.from<at&&at<part.to)at=part.to;return {anchor,at};}).sort((a,b)=>a.at-b.at);
  const nodes:ReactNode[]=[];let next=0;
  const mark=()=>{const {anchor}=marks[next++];nodes.push(<NoteMark key={'note-'+next} anchor={anchor} notePrefix={notePrefix}/>);};
  for(const part of parts) {
    if(part.linked||part.href) {
      while(next<marks.length&&marks[next].at<=part.from)mark();
      const control=part.linked ? <ReferenceButton key={'ref-'+part.from} refKey={part.ref!.key} text={part.text}/> : <SourceLink key={'link-'+part.from} url={part.href!} contentLanguage={scope?.textLanguage??''} compact>{part.text}</SourceLink>;
      nodes.push(emphasis(control,kindsAt(part.from,part.from+1),'em-'+part.from));
      continue;
    }
    let local=part.from;
    while(next<marks.length&&marks[next].at<part.to){const at=Math.max(marks[next].at,local);if(at>local)nodes.push(styled(local,at));local=at;mark();}
    if(local<part.to)nodes.push(styled(local,part.to));
  }
  while(next<marks.length)mark();
  return <>{nodes}</>;
}
function NoteContent({note,assets}:{note:DocumentNote;assets?:DocumentImageAssets}) {
  const ui=useUiI18n();
  const objects=(note.objects||[]).filter(object=>(object.image||object.kind==='drawing')&&Number.isInteger(object.offset)&&object.offset>=0&&object.replacement==='\uFFFC'&&note.text[object.offset]==='\uFFFC').sort((a,b)=>a.offset-b.offset);
  let offset=0;const text=(from:number,to:number)=><ReferenceText text={note.text.slice(from,to)} start={from} links={(note.linkSpans||[]).map(link=>({...link,start:Math.max(from,link.start),end:Math.min(to,link.end)})).filter(link=>link.end>link.start)} linkify/>;
  return <>{objects.map((object,index)=>{if(object.offset<offset)return null;const before=text(offset,object.offset);offset=object.offset+1;return <Fragment key={index}>{before}{object.image?<DocumentImage image={object.image} assets={assets}/>:<span className="document-context-object" lang={ui.language}><UiMessage id="document.object.contentOriginal"/></span>}</Fragment>;})}{text(offset,note.text.length)}</>;
}
export function DocumentNotes({notes,prefix,renderText,assets}:{notes:DocumentNote[];prefix:string;assets?:DocumentImageAssets;renderText?:(note:DocumentNote)=>ReactNode}) {
  const ui = useUiI18n();
  if(!notes.length)return null;
  return <details className="legal-notes" open><summary lang={ui.language}><UiMessage id="batch6.references.notes.count.218" values={{count: notes.length}}/></summary><ol>{notes.map(note=><li key={note.id} id={`${prefix}-note-${note.id}`} value={/^\d+$/.test(note.label) ? Number(note.label) : undefined}>
    <span className="legal-note-label">{/^\d+$/.test(note.label) ? null : (note.label+' ')}</span>{renderText ? renderText(note) : <NoteContent note={note} assets={assets}/>}
    {note.links.filter(link=>!note.text.includes(link)&&!(note.linkSpans||[]).some(span=>span.url===link)).map(link=><span key={link} lang={ui.language}> <SourceLink url={link} compact><UiMessage id="batch6.references.link.220"/></SourceLink></span>)}
  </li>)}</ol></details>;
}
// Every text and link target in a reader, so one lookup covers the body, its notes and their hyperlinks.
export const readerTexts=(paragraphs:string[],notes:DocumentNote[]|undefined,links:DocumentLink[]|undefined)=>[...paragraphs,...(links||[]).map(link=>link.url),...(notes||[]).flatMap(note=>[note.text,...note.links])];
