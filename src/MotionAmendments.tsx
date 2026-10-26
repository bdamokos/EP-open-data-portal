import {knownVoteMethodLabel} from './voteMethod.mjs';
import {PersonName} from './PersonName';
import type {DocumentContextRequest} from './DocumentContextTypes';
import {ActivityVote,type ActivityVoteSnapshot} from './ActivityVote';
import {useCallback,useEffect,useId,useRef,useState,type ReactNode,type RefObject} from 'react';
import {api} from './data';
import {Status} from './Status';
import {amendmentDecisionKey,amendmentDecisionPart,publicAmendmentSource} from './amendmentModel.mjs';
import type {MotionAmendment,MotionAmendmentDecision,MotionAmendmentVariant,MotionAmendmentsPage,MotionAmendmentsScope} from './MotionAmendmentsTypes';
import './MotionAmendments.css';
import {WordingDiff} from './components/WordingDiff';

export const MOTION_AMENDMENTS_PAGE_SIZE=20;
export type MotionAmendmentsState={
  open:boolean;scope:MotionAmendmentsScope;offset:number;amendmentId:string|null;variantListId:string|null;
  view:'amendments'|'context';contextView:'document'|'adopted';contextTarget:'text'|'amendment';
  wordingLanguage?:string|null;
};
export function createMotionAmendmentsState():MotionAmendmentsState {
  return {open:false,scope:'member',offset:0,amendmentId:null,variantListId:null,view:'amendments',contextView:'document',contextTarget:'text'};
}
export type MotionAmendmentsContextRequest=DocumentContextRequest;
export type MotionAmendmentsChangeReason='toggle'|'scope'|'page'|'amendment'|'variant'|'context'|'back-context';
export type MotionAmendmentsProps={
  documentId:string;memberId:string|number;memberName?:string;language:string;state:MotionAmendmentsState;
  onStateChange:(state:MotionAmendmentsState,intent?:{reason:MotionAmendmentsChangeReason})=>void;
  renderContext:(request:MotionAmendmentsContextRequest)=>ReactNode;
};

const outcomeLabels:Record<string,string>={ADOPTED:'Adopted',REJECTED:'Rejected',LAPSED:'Lapsed',WITHDRAWN:'Withdrawn',mixed:'Vote records disagree',unavailable:'Outcome unavailable'};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exactMotion=(value:string)=>/^(?:B|RC)-10-\d{4}-\d{4,6}$/.test(value);
function amendmentIdentity(value:unknown) {
  if(typeof value!=='string')return null;
  const id=value.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'').replace(/^eli\/dl\/doc\//,'');
  const match=id.match(/^((?:B|RC)-10-\d{4}-\d{4,6})-AM-(\d{1,5})$/);
  return match&&Number(match[2])>0?{id,documentId:match[1]}:null;
}
function identifies(item:MotionAmendment,requestedId:string) {
  const identity=amendmentIdentity(requestedId);
  return Boolean(identity&&(item.id===identity.id||item.officialIds?.some(alias=>amendmentIdentity(alias)?.id===identity.id)));
}
const safeMember=(value:string)=>/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value));
const nonnegative=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const title=(item:MotionAmendment)=>item.number!=null?`Amendment ${item.number}`:'Amendment';
const checked=(record:MotionAmendment|MotionAmendmentVariant,member:string)=>record.memberMatch?.memberId===member&&record.memberMatch.status==='recorded'&&record.memberMatch.matched===true;
const sourceLanguage=(value:string|null|undefined)=>value||'';
const languageLabel=(value:string|null|undefined)=>value?value.toUpperCase():'—';

function validMotionState(state:MotionAmendmentsState) {
  return typeof state.open==='boolean'&&['member','all'].includes(state.scope)&&nonnegative(state.offset)&&state.offset<=1_000_000&&
    ['amendments','context'].includes(state.view)&&['document','adopted'].includes(state.contextView)&&['text','amendment'].includes(state.contextTarget)&&
    !(state.view==='context'&&!state.open);
}
function validState(state:MotionAmendmentsState) {
  return validMotionState(state)&&
    (state.amendmentId===null||typeof state.amendmentId==='string'&&state.amendmentId.length>0&&state.amendmentId.length<=512)&&
    (state.variantListId===null||typeof state.variantListId==='string'&&state.variantListId.length>0&&state.variantListId.length<=512)&&
    !(state.variantListId&&!state.amendmentId);
}
function validWordingLanguage(state:MotionAmendmentsState,documentId:string) {
  if(!Object.hasOwn(state,'wordingLanguage')||state.wordingLanguage===undefined)return true;
  const list=typeof state.variantListId==='string'?state.variantListId.match(new RegExp('^'+documentId+'-AM-([0-9]{1,5})-([0-9]{1,5})$')):null;
  return (state.wordingLanguage===null||typeof state.wordingLanguage==='string'&&/^[a-z]{2}$/.test(state.wordingLanguage))&&
    state.contextTarget==='amendment'&&state.contextView==='document'&&
    amendmentIdentity(state.amendmentId)?.documentId===documentId&&amendmentIdentity(state.amendmentId)?.id===state.amendmentId&&
    Boolean(list&&Number(list[1])>0&&Number(list[2])>=Number(list[1]));
}
function matchesPage(value:unknown,documentId:string,member:string,language:string,state:MotionAmendmentsState,requestedId:string|null):value is MotionAmendmentsPage {
  if(!object(value)||value.schemaVersion!==1||!object(value.text)||value.text.id!==documentId||!object(value.scope)||
    value.scope.documentId!==documentId||value.scope.memberId!==member||value.scope.results!==state.scope||value.scope.requestedLanguage!==language||
    value.offset!==state.offset||value.limit!==MOTION_AMENDMENTS_PAGE_SIZE||!nonnegative(value.total)||!Array.isArray(value.items)||
    value.items.length>MOTION_AMENDMENTS_PAGE_SIZE||!object(value.totals)||!nonnegative(value.totals.allIndexed)||
    !(value.totals.memberMatched===null||nonnegative(value.totals.memberMatched))||!object(value.relations)||!Array.isArray(value.relations.adoptedTexts)||
    !object(value.coverage)||!object(value.snapshots)||!nonnegative(value.snapshots.amendments)||
    !(value.snapshots.text===null||nonnegative(value.snapshots.text))||!object(value.selection)||value.selection.requestedId!==requestedId)return false;
  const validItem=(item:unknown)=>object(item)&&typeof item.id==='string'&&amendmentIdentity(item.id)?.id===item.id&&amendmentIdentity(item.id)?.documentId===documentId&&item.targetDocumentId===documentId&&
    object(item.wording)&&item.wording.requestedLanguage===language&&object(item.memberMatch)&&item.memberMatch.memberId===member&&
    Array.isArray(item.decisions)&&Array.isArray(item.splitParts);
  if(!value.items.every(validItem))return false;
  if(requestedId===null)return value.selection.status==='not-requested'&&value.selection.item===null;
  return value.selection.status==='available'?validItem(value.selection.item)&&identifies(value.selection.item as MotionAmendment,requestedId)&&typeof value.selection.inPage==='boolean'&&typeof value.selection.inRequestedScope==='boolean':
    value.selection.status==='unavailable'&&value.selection.item===null;
}
function route(documentId:string,member:string,language:string,state:MotionAmendmentsState,amendment?:string) {
  const query=new URLSearchParams({member,scope:state.scope,lang:language,offset:String(state.offset),limit:String(MOTION_AMENDMENTS_PAGE_SIZE)});
  if(amendment)query.set('amendment',amendment);
  return `motion-amendments/${encodeURIComponent(documentId)}?${query}`;
}
type ReaderPage={base:MotionAmendmentsPage|null;exact:MotionAmendmentsPage|null;page:MotionAmendmentsPage|null;order:number};
function canReplacePage(candidate:MotionAmendmentsPage,current:MotionAmendmentsPage|null) {
  return !current||candidate.snapshots.amendments>=current.snapshots.amendments&&
    (candidate.snapshots.text===null||current.snapshots.text===null||candidate.snapshots.text>=current.snapshots.text);
}
function useMotionAmendmentsRead(route:string|null,nextOrder:()=>number) {
  const [result,setResult]=useState<{route:string|null;attempt:number;data:MotionAmendmentsPage|null;error:string|null;loading:boolean;order:number}>({route:null,attempt:0,data:null,error:null,loading:false,order:0});
  const [attempt,setAttempt]=useState(0);
  const retry=useCallback(()=>setAttempt(value=>value+1),[]);
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    const order=route?nextOrder():0;
    setResult({route,attempt,data:null,error:null,loading:Boolean(route),order});
    // Working generations can change in place. Request order applies to both
    // list and exact reads, independently of their response completion order.
    if(route)api<MotionAmendmentsPage>(route,controller.signal).then(data=>{
      if(active)setResult({route,attempt,data,error:null,loading:false,order});
    }).catch(error=>{
      if(active)setResult({route,attempt,data:null,error:error.message,loading:false,order});
    });
    return ()=>{active=false;controller.abort();};
  },[route,attempt,nextOrder]);
  return {...(result.route===route&&result.attempt===attempt?result:{route,attempt,data:null,error:null,loading:Boolean(route),order:0}),retry};
}
function formatNumber(value:number,language:string) {try{return value.toLocaleString(language);}catch{return String(value);}}
function dateLabel(value:string|null|undefined,language:string) {
  if(!value||!Number.isFinite(Date.parse(value)))return null;
  try{return new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));}catch{return value.slice(0,10);}
}
function outcomeValue(value:string|null|undefined) {
  const normalized=value==='mixed'||value==='unavailable'?value:value?.toUpperCase();
  return normalized&&Object.hasOwn(outcomeLabels,normalized)?normalized:'unavailable';
}
function Outcome({value,split=false}:{value?:string|null;split?:boolean}) {
  const outcome=outcomeValue(value);
  return <span className="motion-amendments__outcome" data-outcome={outcome}>{outcome==='unavailable'&&split?'Voted in parts':outcomeLabels[outcome]}</span>;
}
function hasVerifiedSplits(item:MotionAmendment) {
  return item.decisions.some(decision=>decision.scope==='split-part'&&decision.provenance!=='unavailable'&&decision.componentBinding!=='unverified'&&decision.componentBinding!=='unresolved-collective');
}
function wordingRecords(item:MotionAmendment):(MotionAmendment|MotionAmendmentVariant)[] {
  return item.variants?.length?item.variants:[item];
}
function chosenRecord(item:MotionAmendment,listId:string|null) {
  const records=wordingRecords(item);
  if(listId){const matches=records.filter(record=>record.listId===listId);return matches.length===1?matches[0]:null;}
  return !item.conflicted&&records.length===1?records[0]:null;
}
function wordingSource(record:MotionAmendment|MotionAmendmentVariant) {
  const candidates=[record.wordingSource,record.fieldSources?.proposedText,record.fieldSources?.originalText,
    ...(record.sources||[]).filter(source=>/\.(docx|pdf)(?:[?#]|$)/i.test(source.url))];
  for(const candidate of candidates){
    const url=publicAmendmentSource(candidate);
    if(!url)continue;
    const parsed=new URL(url);
    if(!parsed.username&&!parsed.password&&(parsed.hostname==='europarl.europa.eu'||parsed.hostname.endsWith('.europarl.europa.eu')))return url;
  }
  return null;
}
function Wording({record,kind}:{record:MotionAmendment|MotionAmendmentVariant;kind:'original'|'proposed'}) {
  const status=record.wording?.[kind==='original'?'originalStatus':'proposedStatus'];
  const text=kind==='original'?record.originalText:record.proposedText;
  const available=status==='available'&&typeof text==='string';
  return <section className={'motion-amendments__wording motion-amendments__wording--'+kind}>
    <h5>{kind==='original'?'Original wording quoted in the amendment':'Proposed wording'}</h5>
    {available?<p className="motion-amendments__passage" lang={sourceLanguage(record.wording?.language)}>{text||' '}</p>:
      <p className="motion-amendments__muted">{status==='withheld'?'This wording could not be read reliably.':kind==='original'?'Original wording is unavailable.':'Proposed wording is unavailable.'}</p>}
    {available&&text===''&&<p className="motion-amendments__muted">No {kind==='original'?'original':'proposed'} wording supplied.</p>}
  </section>;
}
function Proposers({record}:{record:MotionAmendment|MotionAmendmentVariant}) {
  const authors=record.authors||[],groups=Array.isArray(record.onBehalfOf)?record.onBehalfOf:record.onBehalfOf?[record.onBehalfOf]:[];
  return <div className="motion-amendments__proposers">
    {authors.length?<p>Proposed by <span lang="">{authors.map((author,index)=><span key={index}>{index?', ':''}<PersonName id={author.personId} label={author.name}/></span>)}</span></p>:
      !record.committeeProposer&&!groups.length&&<p>Proposers unavailable.</p>}
    {record.committeeProposer&&<p>Committee proposer: <span lang={sourceLanguage(record.proposerSource?.language)}>{record.committeeProposer}</span></p>}
    {groups.length>0&&<p>On behalf of <span lang="">{groups.map(group=>group.replace(/^on behalf of\s+/i,'')).join(', ')}</span></p>}
  </div>;
}
function Totals({decision,language}:{decision:MotionAmendmentDecision;language:string}) {
  const totals=decision.totals,keys=['for','against','abstaining'] as const,labels=['For','Against','Abstentions'];
  if(!totals||!keys.some(key=>typeof totals[key]==='number'&&Number.isFinite(totals[key])))return null;
  const complete=keys.every(key=>typeof totals[key]==='number'&&Number.isFinite(totals[key])&&totals[key]!>=0);
  const sum=complete?keys.reduce((value,key)=>value+totals[key]!,0):0;
  return <div className="motion-amendments__totals">
    {sum>0&&<div className="motion-amendments__bar" aria-hidden="true">{keys.map(key=><span className={'motion-amendments__bar--'+key} key={key} style={{width:100*totals[key]!/sum+'%'}}/>)}</div>}
    <dl>{keys.map((key,index)=><div key={key}><dt>{labels[index]}</dt><dd lang={language}>{typeof totals[key]==='number'&&Number.isFinite(totals[key])&&totals[key]!>=0?formatNumber(totals[key]!,language):'—'}</dd></div>)}</dl>
  </div>;
}
function Decision({item,decision,language,member,memberName,context=false,snapshots}:{item:MotionAmendment;decision:MotionAmendmentDecision;language:string;member:string;memberName?:string;context?:boolean;snapshots:Map<string,ActivityVoteSnapshot>}) {
  const snapshotKey=JSON.stringify([member,language,decision]);
  const part=amendmentDecisionPart(item.splitParts,decision),split=decision.scope!=='whole-amendment';
  const partNumber=part?.number??decision.partNumber;
  const heading=decision.scope==='unresolved-split'?'Collective or unresolved split decision':split?partNumber!=null?`Part ${partNumber}`:'Split decision':'Whole amendment';
  const date=dateLabel(decision.date,language),method=knownVoteMethodLabel(decision.method);
  return <li className={context?"motion-amendments__decision member-votes-context-vote":"motion-amendments__decision"}>
    <div className={context?"member-votes-context-label":"motion-amendments__decision-head"}><strong>{context?title(item)+' · ':''}{heading}</strong></div>
    {part?.description&&<p className="motion-amendments__split-description" lang={sourceLanguage(part.language)}>{part.description}</p>}
    {!context&&part?.description&&<p className="motion-amendments__muted">Published split description.</p>}
    {decision.scope==='unresolved-split'&&<p className="motion-amendments__muted">This decision cannot be assigned to an individual part.</p>}
    <ActivityVote context={context} snapshot={context?snapshots.get(snapshotKey):undefined} onSnapshot={context?undefined:snapshot=>{
      snapshots.set(snapshotKey,snapshot);
      while(snapshots.size>120)snapshots.delete(snapshots.keys().next().value!);
    }} indexed={decision} decisionId={decision.id} memberId={member} memberName={memberName} language={language}>
      <Outcome value={decision.outcome}/>
      {(date||method)&&<p className="motion-amendments__muted">{date&&<span lang={language}>{date}</span>}{date&&method?' · ':''}{method}</p>}
      <Totals decision={decision} language={language}/>
      {decision.method==='VOTE_HAND'&&<p className="motion-amendments__muted">Individual positions are not recorded for this voting method.</p>}
    </ActivityVote>
  </li>;
}
function AmendmentDetail({item,member,memberName,language,listId,onVariant,onContext,contextButton,snapshots}:{item:MotionAmendment;member:string;memberName?:string;language:string;listId:string|null;onVariant:(id:string|null)=>void;onContext:()=>void;contextButton:RefObject<HTMLButtonElement|null>;snapshots:Map<string,ActivityVoteSnapshot>}) {
  const records=wordingRecords(item),record=chosenRecord(item,listId),needsChoice=item.conflicted||records.length>1;
  const selectable=records.filter(candidate=>candidate.listId&&records.filter(record=>record.listId===candidate.listId).length===1);
  const url=record?wordingSource(record):null;
  const unavailableVersion=Boolean(listId&&!record);
  return <article className="motion-amendments__detail" aria-label={title(item)}>
    <h4>{title(item)}</h4>
    {(needsChoice||listId)&&<label className="motion-amendments__version">Wording version
      <select value={listId||''} onChange={event=>onVariant(event.target.value||null)}>
        <option value="">Choose a version</option>
        {unavailableVersion&&<option value={listId!}>Unavailable version</option>}
        {selectable.map(candidate=><option value={candidate.listId!} key={candidate.listId}>{candidate.listId}{candidate.wording?.language?' · '+candidate.wording.language.toUpperCase():''}</option>)}
        {records.filter(candidate=>!selectable.includes(candidate)).map((candidate,index)=><option key={'unavailable-'+index} disabled>Version without a unique source reference{candidate.wording?.language?' · '+candidate.wording.language.toUpperCase():''}</option>)}
      </select>
    </label>}
    {unavailableVersion?<p className="motion-amendments__notice">That version is no longer available.</p>:
      !record&&<p className="motion-amendments__notice">{selectable.length?'Choose a wording version to read this proposal.':'Wording unavailable: the published versions conflict.'}</p>}
    {record&&<>
      {record.targetLabel&&<p className="motion-amendments__target" lang={sourceLanguage(record.targetLabelLanguage)}>{record.targetLabel}</p>}
      <Proposers record={record}/>
      {checked(record,member)&&<p className="motion-amendments__member-tag">Selected MEP’s proposal</p>}
      {(record.wording?.language||record.listDocumentDate)&&<p className="motion-amendments__muted">{record.wording?.language?(record.wording.languageFallback?
        <>Showing <span lang="">{languageLabel(record.wording.language)}</span> (requested <span lang="">{language.toUpperCase()}</span>)</>:
        <>Wording language: <span lang="">{languageLabel(record.wording.language)}</span></>):null}
        {record.listDocumentDate&&<>{record.wording?.language?' · ':''}<span lang={language}>{dateLabel(record.listDocumentDate,language)}</span></>}
      </p>}
      
      {record.wording?.originalStatus==='available'&&record.wording.proposedStatus==='available'&&typeof record.originalText==='string'&&record.originalText!==''&&typeof record.proposedText==='string'&&record.proposedText!==''?
        <WordingDiff key={JSON.stringify(record)} original={record.originalText} proposed={record.proposedText} language={sourceLanguage(record.wording.language)} emptySemantics="not-supplied" labels={{original:'Original wording quoted in the amendment',proposed:'Proposed wording'}}/>:
        <div className="motion-amendments__wording-grid"><Wording record={record} kind="original"/><Wording record={record} kind="proposed"/></div>}
      {url&&<p className="motion-amendments__source"><a href={url} target="_blank" rel="noreferrer">Official amendment wording ↗</a></p>}
    </>}
    <div className="motion-amendments__detail-actions"><button type="button" ref={contextButton} onClick={onContext} disabled={!record?.listId}>Read in context</button></div>
    <section className="motion-amendments__decisions" aria-label="Amendment decisions">
      {!(item.decisions.length===1&&item.decisions[0].scope==='whole-amendment')&&<div className="motion-amendments__decision-head"><h5>Whole amendment</h5><Outcome value={item.wholeAmendmentOutcome} split={hasVerifiedSplits(item)}/></div>}
      {item.decisions.length>0?<ul>{item.decisions.map((decision,index)=><Decision snapshots={snapshots} item={item} decision={decision} language={language} member={member} memberName={memberName} key={amendmentDecisionKey(decision)+':'+index}/>)}</ul>:
        <p className="motion-amendments__muted">No decision is available for this amendment.</p>}
    </section>
  </article>;
}
function emptyMessage(page:MotionAmendmentsPage) {
  if(page.coverage.resultState==='observed-empty')return 'No published amendment lists are recorded for this motion.';
  if(page.coverage.resultState==='no-indexed-member-matches')return page.coverage.complete?'No matching amendments':'No matches in available amendments';
  if(page.coverage.resultState==='not-indexed'||page.coverage.resultState==='unavailable')return 'Amendment information is unavailable for this motion';
  return page.total?'No amendments are available on this page.':page.coverage.complete?'No matching amendments':'No matches in available amendments';
}

/** The surrounding activity owns URL, history and scroll restoration. No catalogue or source writer is opened here. */
export function MotionAmendments({documentId,memberId,memberName,language,state,onStateChange,renderContext}:MotionAmendmentsProps) {
  const member=String(memberId),headingRef=useRef<HTMLHeadingElement>(null),id=useId(),panelId='motion-amendments-'+id;
  const motionButton=useRef<HTMLButtonElement>(null),adoptedButton=useRef<HTMLButtonElement>(null),amendmentButton=useRef<HTMLButtonElement>(null);
  const contextRef=useRef<HTMLDivElement>(null),voteSnapshots=useRef(new Map<string,ActivityVoteSnapshot>());
  const requestOrder=useRef(0),nextOrder=useCallback(()=>++requestOrder.current,[]);
  const previousView=useRef<{documentId:string;view:MotionAmendmentsState['view'];contextView:MotionAmendmentsState['contextView'];contextTarget:MotionAmendmentsState['contextTarget']}|null>(null);
  useEffect(()=>{
    const previous=previousView.current;
    previousView.current={documentId,view:state.view,contextView:state.contextView,contextTarget:state.contextTarget};
    if(state.view==='context'&&state.open&&(!previous||previous.documentId!==documentId||previous.view!=='context'||previous.contextView!==state.contextView||previous.contextTarget!==state.contextTarget)) {
      if(!contextRef.current?.contains(document.activeElement))contextRef.current?.focus({preventScroll:true});
      return;
    }
    if(previous?.documentId!==documentId||previous.view!=='context'||state.view!=='amendments'||!state.open)return;
    const button=state.contextTarget==='amendment'?amendmentButton.current:state.contextView==='adopted'?adoptedButton.current:motionButton.current;
    (button&&!button.disabled?button:headingRef.current)?.focus({preventScroll:true});
  },[documentId,state.view,state.open,state.contextTarget,state.contextView]);
  const motionAllowed=exactMotion(documentId)&&safeMember(member)&&validMotionState(state);
  const allowed=motionAllowed&&validState(state)&&validWordingLanguage(state,documentId)&&(!state.amendmentId||amendmentIdentity(state.amendmentId)?.documentId===documentId&&amendmentIdentity(state.amendmentId)?.id===state.amendmentId);
  const listRoute=allowed&&state.open?route(documentId,member,language,state):null;
  const list=useMotionAmendmentsRead(listRoute,nextOrder);
  const basePage=list.data&&matchesPage(list.data,documentId,member,language,state,null)?list.data:null;
  const [savedPages,setSavedPages]=useState<Map<string,ReaderPage>>(()=>new Map());
  const previousPage:ReaderPage=listRoute&&savedPages.get(listRoute)||{base:null,exact:null,page:null,order:0};
  const newBase=basePage&&basePage!==previousPage.base;
  const acceptBase=newBase&&list.order>=previousPage.order&&canReplacePage(basePage,previousPage.page);
  const currentPage=acceptBase?basePage:previousPage.page;
  const currentOrder=acceptBase?list.order:previousPage.order;
  const badPage=Boolean(list.data&&!basePage);
  // A primary row ID is exact. An official alias must be resolved by the API:
  // a second row carrying the same alias may be outside the displayed page.
  const localItem=state.amendmentId&&currentPage?.items.find(item=>item.id===state.amendmentId)||null;
  const selectedRoute=listRoute&&currentPage&&state.amendmentId&&!localItem?route(documentId,member,language,state,state.amendmentId):null;
  const exact=useMotionAmendmentsRead(selectedRoute,nextOrder);
  const exactPage=selectedRoute&&exact.data&&exact.order>=currentOrder&&matchesPage(exact.data,documentId,member,language,state,state.amendmentId)&&canReplacePage(exact.data,currentPage)?exact.data:null;
  const badSelection=Boolean(selectedRoute&&exact.data&&!exactPage);
  // The exact response includes this same page. Publish its page, counts and
  // selected record together and retain them through subsequent local choices.
  const newExact=exactPage&&exactPage!==previousPage.exact;
  const page=newExact?exactPage:currentPage;
  if(listRoute&&(newBase||newExact))setSavedPages(previous=>{
    const next=new Map(previous);
    next.delete(listRoute);
    next.set(listRoute,{base:basePage,exact:exactPage||previousPage.exact,page,order:newExact?exact.order:currentOrder});
    // Bound retained views. Closing or visiting another query must not
    // restore a response superseded by a later read of that query.
    while(next.size>60)next.delete(next.keys().next().value!);
    return next;
  });
  const selection=selectedRoute?exactPage?.selection:null;
  const selected=selectedRoute?selection?.item||null:state.amendmentId&&page?.items.find(item=>item.id===state.amendmentId)||null;
  const inPage=Boolean(selected&&page?.items.some(item=>item.id===selected.id));
  const selectedRecord=selected?chosenRecord(selected,state.variantListId):null;
  const selectedPending=Boolean(selectedRoute&&exact.loading);
  const change=(patch:Partial<MotionAmendmentsState>,reason:MotionAmendmentsChangeReason)=>{
    const next={...state,...patch};
    const changedIdentity=(['amendmentId','variantListId'] as const).some(key=>Object.hasOwn(patch,key)&&patch[key]!==state[key]);
    if(changedIdentity&&!Object.hasOwn(patch,'wordingLanguage')||patch.contextTarget==='text')delete next.wordingLanguage;
    onStateChange(next,{reason});
  };
  const focusHeading=()=>headingRef.current?.focus({preventScroll:true});
  const backContext=()=>change({view:'amendments'},'back-context');
  const openContext=(view:'document'|'adopted',contextTarget:'text'|'amendment')=>change({open:true,view:'context',contextView:view,contextTarget},'context');
  const openAmendmentContext=(item:MotionAmendment)=>{
    const record=chosenRecord(item,state.variantListId);
    if(!record?.listId)return;
    const wordingLanguage=record.wording?.language;
    change({open:true,view:'context',contextView:'document',contextTarget:'amendment',variantListId:record.listId,
      wordingLanguage:typeof wordingLanguage==='string'&&/^[a-z]{2}$/.test(wordingLanguage)?wordingLanguage:null},'context');
  };
  const detail=(item:MotionAmendment)=><AmendmentDetail item={item} member={member} memberName={memberName} language={language} listId={state.variantListId}
    onVariant={value=>change({variantListId:value},'variant')} onContext={()=>openAmendmentContext(item)} contextButton={amendmentButton} snapshots={voteSnapshots.current}/>;
  const selectionUnavailable=Boolean(state.amendmentId&&selection?.status==='unavailable');
  const readingText=state.view==='context'&&state.contextTarget==='text';
  const message=!motionAllowed?'This motion reader selection is unavailable.':!allowed&&!readingText?'The linked amendment is unavailable for this motion.':badPage||badSelection?'Amendment information could not be loaded.':
    list.error||selectedRoute&&exact.error?'Amendment information could not be loaded.':selectionUnavailable?'The requested amendment is unavailable.':
    page?state.amendmentId&&selected?`${title(selected)} loaded.`:page.items.length?`${page.items.length} amendments loaded.`:emptyMessage(page):null;
  const contextReady=state.contextTarget==='text'||Boolean(page&&selected&&selectedRecord?.listId);
  const adoptedAvailable=Boolean(page?.relations.adoptedTexts.length);
  const hasIndexedRecords=Boolean(page&&page.totals.allIndexed>0);
  const pending=state.open&&allowed&&(!page&&list.loading||Boolean(selectedRoute&&!selection&&exact.loading));
  return <section className="motion-amendments" lang="en" aria-labelledby={panelId+'-heading'} aria-busy={state.open&&(list.loading||selectedPending)} data-motion-pending={pending?'true':undefined}>
    <Status scope={listRoute+':'+state.amendmentId+':'+state.variantListId+':'+state.view+':'+state.contextTarget} pending={list.loading||selectedPending} message={message}/>
    <header className="motion-amendments__header">
      <div><p className="motion-amendments__reference" lang="">{documentId}</p><h3 id={panelId+'-heading'} ref={headingRef} tabIndex={-1}>Proposed changes</h3></div>
      <div className="motion-amendments__text-actions">
        <button type="button" ref={motionButton} onClick={()=>openContext('document','text')} disabled={!motionAllowed}>Read motion</button>
        <button type="button" ref={adoptedButton} onClick={()=>openContext('adopted','text')} disabled={!motionAllowed}>{adoptedAvailable?'Read adopted text':'Find the adopted text'}</button>
      </div>
    </header>
    {!motionAllowed?<p className="motion-amendments__notice">This motion reader selection is unavailable.</p>:<>
      {!allowed&&!readingText&&<div className="motion-amendments__notice"><p>The linked amendment is unavailable for this motion.</p><button type="button" onClick={()=>{focusHeading();change({amendmentId:null,variantListId:null,view:'amendments',contextTarget:'text'},'amendment');}}>Clear selection</button></div>}
      <button type="button" className="motion-amendments__disclosure" aria-expanded={state.open} aria-controls={panelId} onClick={()=>change({open:!state.open,view:'amendments'},'toggle')}>
        <span>Amendments{page&&hasIndexedRecords?` · ${formatNumber(page.totals.allIndexed,language)} available`:''}</span><span aria-hidden="true">{state.open?'−':'+'}</span>
      </button>
      {state.open&&<div id={panelId} className="motion-amendments__panel">
        {state.view==='context'?<div ref={contextRef} className="motion-amendments__context" role="region" tabIndex={-1} aria-label={state.contextView==='adopted'?'Adopted text context':state.contextTarget==='amendment'?'Amendment in context':'Motion text'}>
          {contextReady?renderContext({documentId,...(state.contextTarget==='amendment'?{amendmentId:selected!.id,listId:selectedRecord!.listId!,
            ...(Object.hasOwn(state,'wordingLanguage')&&state.wordingLanguage!==undefined?{wordingLanguage:state.wordingLanguage}:{})}:{}),view:state.contextView,onBack:backContext,backLabel:'Back to amendments',
            ...(state.contextTarget==='amendment'?{summary:<section aria-label="Votes on this amendment"><ul className="motion-amendments__context-votes">{selected!.decisions.map((decision,index)=><Decision context snapshots={voteSnapshots.current} item={selected!} decision={decision} language={language} member={member} memberName={memberName} key={amendmentDecisionKey(decision)+':'+index}/>)}</ul>{!selected!.decisions.length&&<p>Vote unavailable</p>}</section>}:{})}):
            <div className="motion-amendments__context-gap"><button type="button" onClick={backContext}>Back to amendments</button>
              <p>{state.amendmentId&&selected&&!selectedRecord?.listId?'Choose an available wording version before opening context.':list.loading||selectedPending?'Loading amendment information…':'The requested context is unavailable.'}</p>
              {(list.error||badPage||selectedRoute&&(exact.error||badSelection))&&<button type="button" onClick={()=>{focusHeading();if(selectedRoute&&(exact.error||badSelection))exact.retry();else list.retry();}}>Try again</button>}
            </div>}
        </div>:!allowed?null:<>
          <div className="motion-amendments__scope" role="group" aria-label="Amendment scope">
            <button type="button" aria-pressed={state.scope==='member'} onClick={()=>change({scope:'member',offset:0},'scope')}>{memberName?`${memberName}’s proposals`:'This MEP’s proposals'}{hasIndexedRecords&&page?.totals.memberMatched!=null&&page.totals.memberMatched>0?` · ${formatNumber(page.totals.memberMatched,language)}`:''}</button>
            <button type="button" aria-pressed={state.scope==='all'} onClick={()=>change({scope:'all',offset:0},'scope')}>All available amendments{page&&hasIndexedRecords?` · ${formatNumber(page.totals.allIndexed,language)}`:''}</button>
          </div>
          {page&&!page.coverage.complete&&page.items.length>0&&<p className="motion-amendments__coverage">Some amendment records are unavailable.</p>}
          {list.loading&&!page&&<p className="motion-amendments__notice">Loading amendments…</p>}
          {(list.error||badPage)&&<div className="motion-amendments__notice"><p>Amendment information could not be loaded.</p><button type="button" onClick={()=>{focusHeading();list.retry();}}>Try again</button></div>}
          {selectedPending&&<p className="motion-amendments__notice">Loading the selected amendment…</p>}
          {selectedRoute&&(exact.error||badSelection)&&<div className="motion-amendments__notice"><p>The selected amendment could not be loaded.</p><button type="button" onClick={()=>{focusHeading();exact.retry();}}>Try again</button></div>}
          {selectionUnavailable&&<p className="motion-amendments__notice">Amendment unavailable.</p>}
          {selected&&!inPage&&<div className="motion-amendments__selected"><p className="motion-amendments__outside">{selection?.inRequestedScope===false?'Selected amendment · outside this filter':'Selected amendment · outside this page'}</p>{detail(selected)}</div>}
          {page&&<>
            {!page.items.length&&<p className="motion-amendments__notice">{emptyMessage(page)}</p>}
            {page.items.length>0&&<ul className="motion-amendments__list">{page.items.map(item=>{
              const active=selected?.id===item.id,partVote=hasVerifiedSplits(item),records=wordingRecords(item);
              const aggregateMatched=checked(item,member)&&item.memberMatch.aggregateMatched;
              const matchedVersions=records.filter(record=>checked(record,member)).length;
              const target=!item.conflicted?item.targetLabel:null;
              return <li key={item.id} className="motion-amendments__row">
                <button type="button" className="motion-amendments__row-button" aria-expanded={active} onClick={()=>change({amendmentId:active?null:item.id,variantListId:null,view:'amendments'},'amendment')}>
                  <span className="motion-amendments__row-title"><strong>{title(item)}</strong>{target&&<span className="motion-amendments__target" lang={sourceLanguage(item.targetLabelLanguage)}>{target}</span>}{(aggregateMatched||matchedVersions>0)&&<span className="motion-amendments__member-tag">{aggregateMatched?'Selected MEP’s proposal':matchedVersions===1?'Selected MEP’s proposal in one version':'Selected MEP’s proposal in multiple versions'}</span>}</span>
                  <span className="motion-amendments__row-end"><Outcome value={item.wholeAmendmentOutcome} split={partVote}/><span aria-hidden="true">{active?'−':'+'}</span></span>
                </button>
                {active&&detail(item)}
              </li>;
            })}</ul>}
            {(page.total>0||state.offset>0)&&<nav className="motion-amendments__pages" aria-label="Motion amendment pages">
              <button type="button" disabled={state.offset===0||list.loading} onClick={()=>{focusHeading();change({offset:Math.max(0,state.offset-MOTION_AMENDMENTS_PAGE_SIZE)},'page');}}>Previous</button>
              <span>{page.items.length?`${formatNumber(state.offset+1,language)}–${formatNumber(state.offset+page.items.length,language)} of ${formatNumber(page.total,language)}`:'No rows on this page'}</span>
              <button type="button" disabled={list.loading||state.offset+page.items.length>=page.total||!page.items.length} onClick={()=>{focusHeading();change({offset:state.offset+MOTION_AMENDMENTS_PAGE_SIZE},'page');}}>Next</button>
              {!page.items.length&&state.offset>0&&<button type="button" onClick={()=>{focusHeading();change({offset:0},'page');}}>First page</button>}
            </nav>}
          </>}
        </>}
      </div>}
    </>}
  </section>;
}
