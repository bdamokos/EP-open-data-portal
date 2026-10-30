import {useDossierReaderState} from './dossierJourney';
import {RecordMemberAffiliation} from './components/RecordMemberAffiliation';
import {PersonName} from './PersonName';
import {Fragment,lazy,Suspense,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {selectLanguageText} from './language.mjs';
import {compareMembers} from './memberOrder.mjs';
import {useData} from './data';
import {useExplorerParam} from './explorerUrl';
import {InsightShell,insightMemberHref} from './InsightShared';
import type {InsightProps} from './InsightTypes';
import type {Amendment,AmendmentDecision,AmendmentPage,AmendmentSource,AmendmentSplit,AmendmentVariant} from './AmendmentTypes';
import {validCommitteeCode,amendmentContextSelection,amendmentDecisionKey,amendmentDecisionPart,amendmentDecisionScope,amendmentGroups,amendmentOutcomeLabel,amendmentPlanSummary,amendmentRoute,publicAmendmentSource} from './amendmentModel.mjs';
import type {Directory} from './explorerTypes';
import './Amendments.css';
import {FormattedWording} from './components/WordingFormatting';
import {WordingDiff} from './components/WordingDiff';
import {AmendmentNamedVotes} from './AmendmentNamedVotes';
import {voteMethodLabel} from './voteMethod.mjs';
import {sourcePageUrl} from './SourceLink';
import FinalTextCheck from './FinalTextCheck';

const DocumentContextReader=lazy(()=>import('./DocumentContextReader').then(module=>({default:module.DocumentContextReader})));

const outcomes=['','ADOPTED','REJECTED','LAPSED','WITHDRAWN','mixed','unavailable'] as const;
const dateLabel=(value:string|number|null|undefined,language:string)=>{
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(time)):null;
};
function LocalizedDate({value,language}:{value?:string|number|null;language:string}) {
  const text=dateLabel(value,language);
  return text?<time lang={language}>{text}</time>:null;
}
const joinMeta=(items:ReactNode[])=>items.filter(item=>item!==null&&item!==undefined&&item!==false&&item!=='').map((item,index)=><Fragment key={index}>{index?' · ':''}{item}</Fragment>);
const metadataLanguage=(item:AmendmentVariant)=>Object.hasOwn(item,'metadataSource')?item.metadataSource?.language??'':item.language??'';
const wordingLanguage=(item:AmendmentVariant)=>Object.hasOwn(item,'wordingSource')?item.wordingSource?.language??'':item.language??'';
const targetLabelLanguage=(item:AmendmentVariant)=>item.targetLabelLanguage??'';
function documentDateLabel(item:AmendmentVariant,language:string,legacySource=false) {
  const documentaryDate=dateLabel(item.documentDate,language)?item.documentDate:null;
  const listDate=item.dateBasis==='amendment-list-document'&&dateLabel(item.listDocumentDate,language)?item.listDocumentDate:null;
  const documentedBasis=['individual-amendment-document','amendment-list-document'].includes(item.dateBasis||'');
  const value=documentaryDate||listDate||(Object.hasOwn(item,'documentDate')||!documentedBasis&&!legacySource?null:item.date);
  const label='scope' in item&&item.scope==='committee'?'Document date':item.dateBasis==='individual-amendment-document'?'Amendment document date':item.dateBasis==='amendment-list-document'?'Amendment-list document date':'Document date';
  return dateLabel(value,language)?<>{label} <LocalizedDate value={value} language={language}/></>:null;
}
const onBehalfLabel=(value:AmendmentVariant['onBehalfOf'])=>(Array.isArray(value)?value.join(', '):value)?.replace(/^on behalf of\s+/i,'');
const pageRange=(offset:number,count:number,total:number,emptyLabel:string)=>!count?(total?'0 shown of '+total:emptyLabel):offset+1+'–'+Math.min(offset+count,total)+' of '+total;

function Outcome({value}:{value?:string|null}) {
  return <span className="explorer-amendment-outcome" lang="en" data-outcome={value||'unavailable'}>{amendmentOutcomeLabel(value)}</span>;
}
function Decision({item,decision,language,compact=false}:{item:Amendment;decision:AmendmentDecision;language:string;compact?:boolean}) {
  const source=decision.provenance==='unavailable'?null:sourcePageUrl(publicAmendmentSource(decision.source));
  const totals=decision.totals,positions=[['for','For'],['against','Against'],['abstaining','Abstained']] as const;
  const hasTotals=totals&&positions.some(([key])=>typeof totals[key]==='number');
  const complete=totals&&positions.every(([key])=>typeof totals[key]==='number'),total=complete?positions.reduce((sum,[key])=>sum+totals![key]!,0):null;
  const unbound=['unverified','unresolved-collective'].includes(decision.componentBinding||'');
  return <li className="explorer-amendment-decision" lang="en">
    {(!compact||unbound||item.scope==='committee')&&<div className="explorer-amendment-decision-heading"><strong>{item.scope==='committee'?((decision.stage||decision.scope)==='plenary'?'Plenary decision · ':'Committee decision · '):''}{decision.componentBinding==='unverified'?'Unverified split decision':decision.componentBinding==='unresolved-collective'?'Collective decision':amendmentDecisionScope(item,decision)}</strong><Outcome value={decision.outcome}/></div>}
    {hasTotals&&<>{complete&&total!>0&&<div className="amendment-vote-strip" aria-hidden="true">{positions.map(([key,label])=><span key={key} data-position={label} style={{flexGrow:totals![key]!}}/>)}</div>}<dl className="explorer-amendment-totals">{positions.map(([key,label])=><div key={key} data-position={label}><dt>{label.toLowerCase()}</dt><dd>{totals?.[key]!=null?<span lang={language}>{totals[key]!.toLocaleString(language)}</span>:'Unavailable'}</dd></div>)}</dl></>}
    {(total!=null||voteMethodLabel(decision.method))&&<p className="explorer-amendment-meta">{[total!=null?total.toLocaleString(language)+' votes':'',voteMethodLabel(decision.method)].filter(Boolean).join(' · ')}</p>}
    {item.scope!=='committee'&&<AmendmentNamedVotes item={item} decision={decision} language={language}/>}
    <details className="explorer-amendment-decision-record"><summary>Decision record</summary><p>{decision.date&&<>Decision date <LocalizedDate value={decision.date} language={language}/></>}</p>{source&&<a href={source} target="_blank" rel="noreferrer">Voting record ↗</a>}
      {(decision.collective||unbound||(decision.amendmentIds?.length||0)>1)&&Boolean(decision.amendmentIds?.length)&&<><p>Co-decided amendment references</p><ul className="explorer-amendment-collective-references">{decision.amendmentIds!.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></>}
      {decision.componentReferences?.length?<><p>Recorded component references</p><ul>{decision.componentReferences.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></>:null}
    </details>
  </li>;
}
function SplitDescription({description,language,sourceDescriptions,rawDescription,code}:{description?:string|null;language?:string|null;sourceDescriptions?:Record<string,string>;rawDescription?:string|null;code?:string|null}) {
  if(description?.trim())return <blockquote lang={language??''}>{description}</blockquote>;
  const available=Object.entries(sourceDescriptions||{}).filter(([,text])=>typeof text==='string'&&text.trim());
  if(!available.length&&rawDescription?.trim())available.push([language??'',rawDescription]);
  return <div className="explorer-amendment-description-fallback" lang="en">
    <p className="explorer-amendment-secondary">{code==='missing_language'&&language==='en'?'English split description unavailable.':'Readable split description unavailable.'}</p>
    {available.map(([sourceLanguage,text])=><div className="explorer-amendment-source-description" key={sourceLanguage}>
      {sourceLanguage&&sourceLanguage!=='und'&&<p className="explorer-amendment-meta"><span lang="">{sourceLanguage.toUpperCase()}</span></p>}
      <pre lang={sourceLanguage}>{text}</pre>
    </div>)}
  </div>;
}
function PlanLine({text,plan,language}:{text:string;plan?:Record<string,unknown>|null;language?:string|null}) {
  const literals=new Set<string>();
  const collect=(node:unknown,depth=0)=>{
    if(!node||typeof node!=='object'||depth>8)return;
    for(const [key,value] of Object.entries(node)){
      if(['quote','character','within'].includes(key)&&typeof value==='string')literals.add('“'+value+'”');
      else if(typeof value==='object')collect(value,depth+1);
    }
  };
  collect(plan);
  if(!literals.size)return <>{text}</>;
  const pattern=[...literals].sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  const parts:ReactNode[]=[];let offset=0;
  for(const match of text.matchAll(new RegExp(pattern,'gu'))){
    if(match.index>offset)parts.push(text.slice(offset,match.index));
    parts.push(<span key={match.index} lang={language??''}>{match[0]}</span>);offset=match.index+match[0].length;
  }
  if(offset<text.length)parts.push(text.slice(offset));
  return <>{parts}</>;
}
function GroupLabel({group,by}:{group:ReturnType<typeof amendmentGroups>[number];by:string}) {
  const item=group.items[0];
  if(by==='target')return <>{item.targetDocumentId&&<><span lang="">{item.targetDocumentId}</span> · </>}{item.targetLabel?<span lang={targetLabelLanguage(item)}>{item.targetLabel}</span>:'Target provision unavailable'}</>;
  if(by==='topic'){
    const topic=item.topics?.[0];
    if(!topic)return <>Topic unavailable</>;
    return <>{topic.basis==='target'&&item.targetDocumentId&&<><span lang="">{item.targetDocumentId}</span> · </>}<span lang={topic.language??''}>{topic.label}</span></>;
  }
  const identifier=item.procedureIds?.[0]||item.targetDocumentId;
  return identifier?<span lang="">{identifier}</span>:<>Dossier unavailable</>;
}
function SplitPart({part,item,language}:{part:AmendmentSplit;item:Amendment;language:string}) {
  const decisions=(item.decisions||[]).filter(decision=>amendmentDecisionPart(item.splitParts||[],decision)?.id===part.id);
  const plan=amendmentPlanSummary(part.plan),failed=Boolean(part.failure)||['failed','unparsed','unresolved','unsupported','failure','error'].includes(part.status||'');
  return <li className="explorer-amendment-part" lang="en"><h5>{part.number!=null?'Part '+part.number:part.id||'Unidentified split component'}</h5><SplitDescription description={part.description} language={part.language} rawDescription={part.rawDescription} sourceDescriptions={part.sourceDescriptions} code={typeof part.failure==='object'?part.failure?.code:null}/>{!failed&&plan.length>0&&<details className="explorer-amendment-selection"><summary>Recognised selection</summary><ul>{plan.map((line,index)=><li key={index}><PlanLine text={line} plan={part.plan} language={part.language}/></li>)}</ul></details>}{decisions.length?<ul className="explorer-amendment-decisions">{decisions.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language}/>)}</ul>:<p className="explorer-amendment-secondary">Outcome unavailable for this part.</p>}</li>;
}
function AmendmentWording({item}:{item:AmendmentVariant}) {
  const withheld=item.textIntegrity==='incomplete';
  const readable=!withheld&&typeof item.originalText==='string'&&typeof item.proposedText==='string';
  return <>{readable?<WordingDiff originalFormatting={item.originalFormatting} proposedFormatting={item.proposedFormatting} original={item.originalText!} proposed={item.proposedText!} language={wordingLanguage(item)} emptySemantics="insertion-deletion"/>:<div className="explorer-amendment-texts" lang="en">
    <section><h5>Original text</h5>{withheld?<p className="explorer-amendment-secondary">Unavailable.</p>:item.originalText!==null&&item.originalText!==undefined?item.originalText===''?<p>No original text (insertion).</p>:<p lang={wordingLanguage(item)}>{<FormattedWording text={item.originalText} formatting={item.originalFormatting}/>}</p>:<p className="explorer-amendment-secondary">Unavailable.</p>}</section>
    <section><h5>Proposed text</h5>{withheld?<p className="explorer-amendment-secondary">Unavailable.</p>:item.proposedText!==null&&item.proposedText!==undefined?item.proposedText===''?<p>Text deleted.</p>:<p lang={wordingLanguage(item)}>{<FormattedWording text={item.proposedText} formatting={item.proposedFormatting}/>}</p>:<p className="explorer-amendment-secondary">Unavailable.</p>}</section>
  </div>}</>;
}
function AmendmentEvidenceState({item}:{item:AmendmentVariant}) {
  if(item.textIntegrity!=='incomplete')return null;
  return <p className="explorer-amendment-secondary explorer-amendment-evidence-state" lang="en">Wording unavailable.</p>;
}
function AmendmentSources({sources,language}:{sources:AmendmentSource[];language:string}) {
  const available=sources.map(source=>({source,url:sourcePageUrl(publicAmendmentSource(source),{language:source.language||language})})).filter(entry=>entry.url);
  return available.length?<ul lang="en">{available.map(({source,url},index)=><li key={url!+index}>
    <a href={url!} target="_blank" rel="noreferrer">Document{source.language?' · '+source.language.toUpperCase():''} ↗</a>
    {source.date&&<small> · {documentDateLabel(source,language,true)}</small>}
  </li>)}</ul>:null;
}
function AmendmentAuthors({item,language,onMember}:{item:Amendment;language:string;onMember?:InsightProps['onMember']}) {
  const authors=item.authors||[],onBehalfOf=onBehalfLabel(item.onBehalfOf);
  if(item.conflicted)return null;
  if(!authors.length)return item.committeeProposer?<div className="explorer-amendment-authors"><span>Tabled by </span><strong lang={item.proposerSource?.language??''}>{item.committeeProposer}</strong>{onBehalfOf&&<p>{!/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(onBehalfOf)&&'On behalf of '}<span lang="">{onBehalfOf}</span></p>}</div>:onBehalfOf?<p className="explorer-amendment-authors">Tabled on behalf of <span lang="">{onBehalfOf}</span></p>:<p className="explorer-amendment-secondary">Proposers unavailable.</p>;
  return <div className="explorer-amendment-authors"><span>Tabled by </span>{authors.map((author,index)=>{
    const linked=Boolean(author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
    const note=({missing_date:'document date unavailable',missing_mandate:'mandate evidence unavailable',inactive:'no active mandate match',ambiguous:'multiple possible MEPs'} as Record<string,string>)[author.status||'']||'MEP link unresolved';
    return <span key={String(author.personId||author.name)+':'+index}>{index>0?', ':''}{linked?<a href={insightMemberHref(String(author.personId),language)} onClick={onMember?event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
      event.preventDefault();onMember(Number(author.personId));
    }:undefined}><span lang="" title={author.name}><PersonName id={author.personId} label={author.displayName||author.name}/></span></a>:<><span lang="">{author.name}</span>{item.scope!=='committee'&&<small> ({note})</small>}</>}<RecordMemberAffiliation id={author.personId} language={language}/></span>;
  })}{item.committeeProposer&&<p>Committee proposer: <span lang={item.proposerSource?.language??''}>{item.committeeProposer}</span></p>}{onBehalfOf&&<p>{!/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(onBehalfOf)&&'On behalf of '}<span lang="">{onBehalfOf}</span></p>}</div>;
}
function SourceVariants({item,language}:{item:Amendment;language:string}) {
  if(!item.conflicted&&!item.variants?.length)return null;
  return <div className={item.conflicted?'explorer-amendment-conflict':'explorer-amendment-source-variants'}>{item.conflicted&&<p><strong>Conflicting source versions.</strong> Wording and proposers unavailable.</p>}
    {item.variants?.length?<details className="explorer-amendment-variants"><summary>Source versions · {item.variants.length}</summary>{item.variants.map((variant,index)=><section className="explorer-amendment-variant" key={(variant.listId||'variant')+index}>
      <h5>Version {index+1}{variant.listId?' · '+variant.listId:''}</h5>
      <AmendmentEvidenceState item={variant}/>
      <p className="explorer-amendment-meta">{joinMeta([documentDateLabel(variant,language,true),variant.language?<><span lang="">{variant.language.toUpperCase()}</span></>:null])}</p>
      {variant.targetLabel&&<p lang={targetLabelLanguage(variant)}>{variant.targetLabel}</p>}
      {variant.authors?.length?<p>Tabled by {variant.authors.map((author,index)=><Fragment key={index}>{index?', ':''}<span lang="">{author.name}</span></Fragment>)}</p>:null}
      {variant.committeeProposer&&<p>Committee: <span lang={variant.proposerSource?.language??''}>{variant.committeeProposer}</span></p>}
      {onBehalfLabel(variant.onBehalfOf)&&<p>On behalf of <span lang="">{onBehalfLabel(variant.onBehalfOf)}</span></p>}
      <AmendmentWording item={variant}/><AmendmentSources sources={variant.sources||[]} language={language}/>
    </section>)}</details>:null}
  </div>;
}
export function AmendmentCard({item,language,onMember,showOutcome=true}:{item:Amendment;language:string;onMember?:InsightProps['onMember'];showOutcome?:boolean}) {
  const splitParts=[...(item.splitParts||[])].sort((a,b)=>Number.isFinite(Number(a.number))&&Number.isFinite(Number(b.number))?Number(a.number)-Number(b.number):0),decisions=item.decisions||[],whole=decisions.filter(decision=>!amendmentDecisionPart(splitParts,decision));
  const committee=item.scope==='committee',selection=amendmentContextSelection(item);
  const [contextOpen,setContextOpen]=useDossierReaderState('amendment-context:'+item.id,false),contextSummary=useRef<HTMLElement>(null);
  const title=selectLanguageText(item.titles,language,item.title||'','');
  return <article lang="en" className="explorer-amendment-card" id={'amendment-'+item.id} data-amendment-scope={item.scope||'plenary'}>
    {committee&&<p className="explorer-amendment-stage">{item.contributionKind==='draft-report'?'Draft report':item.contributionKind==='draft-opinion'?'Draft opinion':'Committee amendment'}{item.committees?.map(c=><Fragment key={c.code}> · <span lang="" title={c.name||undefined}>{c.code}</span></Fragment>)}{item.contributionKind==='tabled-amendment'&&item.committeeDocumentKind&&<> · {item.committeeDocumentKind==='draft-report'?'Draft report':'Draft opinion'}</>}</p>}
    <header><span className="explorer-amendment-number" aria-hidden="true">{item.number??'?'}</span><div><h4><span className="visually-hidden">Amendment {item.number}: </span><span className="explorer-amendment-target" lang={item.targetLabel?targetLabelLanguage(item):'en'}>{item.targetLabel||'Target provision unavailable'}</span></h4></div>{showOutcome&&(!committee||decisions.length>0)&&<Outcome value={item.outcome}/>}</header>
    {committee&&<p className="explorer-amendment-meta">{joinMeta([documentDateLabel(item,language),item.proposerDate&&item.proposerDateBasis==='tabling'?<>Tabled <LocalizedDate value={item.proposerDate} language={language}/></>:null])}</p>}
    <SourceVariants item={item} language={language}/>
    <AmendmentAuthors item={item} language={language} onMember={onMember}/>
    {(decisions.length>0||splitParts.length>0)?<div className="explorer-amendment-voting">{splitParts.length>0&&<ol className="explorer-amendment-parts">{splitParts.map((part,index)=><SplitPart key={part.id||JSON.stringify([part.componentIndex??index,part.rawDescription??part.description??null])} part={part} item={item} language={language}/>)}</ol>}{whole.length>0&&<ul className="explorer-amendment-decisions">{whole.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language} compact={decisions.length===1&&!splitParts.length}/>)}</ul>}</div>:!committee&&<p className="explorer-amendment-secondary">Outcome unavailable.</p>}
    {!item.conflicted&&<details className="explorer-amendment-wording"><summary>Compare original and proposed text</summary><AmendmentWording item={item}/></details>}
    {selection&&<details className="explorer-amendment-context" open={contextOpen} onToggle={event=>setContextOpen(event.currentTarget.open)}><summary ref={contextSummary}>Read in context</summary>{contextOpen&&<Suspense fallback={<p role="status">Loading document…</p>}><DocumentContextReader language={language} request={{...selection,onBack:()=>{setContextOpen(false);contextSummary.current?.focus({preventScroll:true});}}}/></Suspense>}</details>}
    {committee&&selection?.amendmentId&&selection.listId&&<FinalTextCheck documentId={selection.documentId} amendmentId={selection.amendmentId} listId={selection.listId} wordingLanguage={selection.wordingLanguage??null} language={language}/>}
    <details className="explorer-amendment-evidence"><summary>Sources{!committee&&item.gaps?.length?' · '+item.gaps.length+(item.gaps.length===1?' gap':' gaps'):''}</summary><AmendmentEvidenceState item={item}/>{item.title&&<p className="explorer-amendment-title" lang={title.text===item.title?title.language:''}>{title.text}</p>}{item.scope!=='committee'&&<p className="explorer-amendment-reference">{item.id}</p>}<p className="explorer-amendment-meta">{joinMeta([documentDateLabel(item,language),metadataLanguage(item)?metadataLanguage(item).toUpperCase():null])}</p>
      {item.officialIds?.length?<p className="explorer-amendment-reference">Official references: {item.officialIds.join(', ')}</p>:null}
      <AmendmentSources sources={item.sources||[]} language={language}/>
      {item.scope!=='committee'&&item.procedureIds?.length?<p>Procedures: {item.procedureIds.map((reference,index)=><Fragment key={reference}>{index?', ':''}<span lang="">{reference}</span></Fragment>)}</p>:null}
      {item.topics?.length?<ul>{item.topics.map(topic=><li key={topic.id}><span lang={topic.language??''}>{topic.label}</span> <small>· {topic.basis==='dossier'?'dossier subject':'target provision'}</small></li>)}</ul>:null}
      {item.gaps?.length?<p className="explorer-amendment-secondary">Partial coverage</p>:null}
    </details>
  </article>;
}
type AmendmentProps={language?:string;scope?:'committee'|'plenary';list?:string|null;committee?:string|null;onCommittee?:(value:string)=>void;document?:string|null;procedure?:string|null;member?:string|number|null;outcome?:string;offset?:number;onOutcome?:(value:string)=>void;onOffset?:(value:number)=>void;onMember?:InsightProps['onMember'];heading?:ReactNode};
export function Amendments({language='en',scope,list,committee:controlledCommittee,onCommittee,document,procedure,member,outcome:controlledOutcome,offset:controlledOffset,onOutcome,onOffset,onMember,heading='Amendment trail'}:AmendmentProps) {
  const [localCommittee,setLocalCommittee]=useState('');
  const committee=controlledCommittee??localCommittee;
  const [localOutcome,setLocalOutcome]=useState(''),[localOffset,setLocalOffset]=useState(0),[groupBy,setGroupBy]=useState('dossier');
  const outcome=controlledOutcome??localOutcome,offset=controlledOffset??localOffset,limit=20,headingId=useId(),headingRef=useRef<HTMLHeadingElement>(null);
  const state=useData<AmendmentPage>(amendmentRoute({scope,list,committee,document,procedure,member,outcome,offset,limit,language}));
  const committees=[...new Set([...(committee?[committee]:[]),...(state.data?.items||[]).flatMap(item=>item.committees?.map(c=>c.code)||[])])].filter(validCommitteeCode).sort();
  const groups=useMemo(()=>amendmentGroups(state.data?.items||[],groupBy),[state.data,groupBy]);
  useEffect(()=>{
    if(!state.data?.coverage.pending)return;
    const timer=window.setInterval(state.retry,10_000);
    return ()=>window.clearInterval(timer);
  },[state.data?.coverage.pending,state.retry]);
  useEffect(()=>{if(controlledOffset===undefined)setLocalOffset(0);},[scope,list,committee,document,procedure,member,language,controlledOffset]);
  function page(value:number){onOffset?onOffset(value):setLocalOffset(value);headingRef.current?.focus({preventScroll:true});headingRef.current?.scrollIntoView({block:'start',behavior:'instant'});}
  function filter(value:string){onOutcome?onOutcome(value):setLocalOutcome(value);onOffset?onOffset(0):setLocalOffset(0);}
  return <section lang="en" className="explorer-amendments" aria-labelledby={headingId} aria-busy={state.loading}><div className="explorer-amendment-section-heading"><h2 id={headingId} ref={headingRef} tabIndex={-1}>{heading}</h2><button onClick={state.retry} disabled={state.loading}>Refresh</button></div><div className="explorer-amendment-controls">{scope==='committee'&&(committees.length>1||committee)&&<label>Committee<select value={committee} onChange={event=>{onCommittee?onCommittee(event.target.value):setLocalCommittee(event.target.value);onOffset?onOffset(0):setLocalOffset(0);}}><option value="">All committees</option>{committees.map(code=><option key={code} value={code}>{code}</option>)}</select></label>}<label>Outcome<select value={outcome} onChange={event=>filter(event.target.value)}>{outcomes.map(value=><option key={value} value={value}>{value?amendmentOutcomeLabel(value):'Any outcome'}</option>)}</select></label><label>Group this page by<select value={groupBy} onChange={event=>setGroupBy(event.target.value)}><option value="dossier">Dossier / target document</option><option value="target">Target provision</option><option value="topic">Recorded topic</option></select></label></div>{state.loading&&!state.data&&<p role="status">Loading amendments…</p>}{state.error&&<div className="explorer-amendment-gap" role="alert"><p>Could not load amendments.</p><button onClick={state.retry}>Try again</button></div>}{state.data&&<><div className="explorer-amendment-coverage" role="status"><p><strong><span lang={language}>{state.data.total.toLocaleString(language)}</span> {state.data.total===1?'amendment':'amendments'}</strong>{state.data.coverage.pending?' · checking for amendments':state.data.coverage.complete?'':' · partial coverage'}</p></div>{!state.data.items.length?<p className="explorer-amendment-empty">{state.data.total?'No amendments on this page.':state.data.coverage.complete?'No matching amendments.':'Amendments unavailable.'}</p>:groups.map(group=><section className="explorer-amendment-group" key={group.id}><div className="explorer-amendment-group-heading"><h3><GroupLabel group={group} by={groupBy}/></h3><small>{group.items.length} on this page</small></div>{group.items.map(item=><AmendmentCard key={item.id} item={item} language={language} onMember={onMember}/>)}</section>)}<nav className="explorer-amendment-pagination" aria-label="Amendment pages"><button disabled={offset===0||state.loading} onClick={()=>page(Math.max(0,offset-limit))}>Previous</button><span aria-live="polite">{pageRange(offset,state.data.items.length,state.data.total,'0 amendments')}</span>{!state.data.items.length&&state.data.total>0&&offset>0&&<button onClick={()=>page(0)} disabled={state.loading}>Go to first page</button>}<button disabled={offset+state.data.items.length>=state.data.total||!state.data.items.length||state.loading} onClick={()=>page(offset+limit)}>Next</button></nav></>}</section>;
}
export function AmendmentsPage(props:InsightProps) {
  const language=props.language||'en';
  const [scope,setScope]=useExplorerParam<'plenary'|'committee'>('am-scope','plenary',['plenary','committee']);
  const [list,setList]=useExplorerParam<string>('am-list',''),[committee,setCommittee]=useExplorerParam<string>('am-committee','');
  const [document,setDocument]=useExplorerParam<string>('am-document','');
  const [procedure,setProcedure]=useExplorerParam<string>('am-procedure','');
  const [member,setMember]=useExplorerParam<string>('am-member','');
  const [outcome,setOutcome]=useExplorerParam<string>('am-outcome','',outcomes);
  const [offset,setOffset]=useExplorerParam<number>('am-offset',0);
  const [draft,setDraft]=useState({document,procedure,member,list});
  const directory=useData<Directory>('directory');
  const authors=useMemo(()=>[...(directory.data?.members||[])].sort(compareMembers),[directory.data]);
  const selectedAuthor=authors.find(person=>String(person.id)===member);
  useEffect(()=>setDraft({document,procedure,member,list}),[document,procedure,member,list]);
  return <InsightShell {...props} view="amendments" title="Amendments" description="Follow proposed changes, their authors and Parliament’s decisions.">
    <form lang="en" className="explorer-amendment-finder" onSubmit={event=>{
      event.preventDefault();setDocument(draft.document.trim());setProcedure(draft.procedure.trim());setMember(draft.member);setList(scope==='committee'?draft.list.trim():'');setOffset(0);
    }}>
      <label>Stage<select value={scope} onChange={event=>{setScope(event.target.value as typeof scope);setDocument('');setList('');setCommittee('');setOffset(0);setOutcome('');}}><option value="plenary">Plenary</option><option value="committee">Committee</option></select></label>
      {scope==='committee'&&<label>Amendment list<input value={draft.list} onChange={event=>setDraft(value=>({...value,list:event.target.value}))} placeholder="AGRI-AM-773343" autoComplete="off" spellCheck={false}/></label>}
      <label>Dossier reference<input value={draft.procedure} onChange={event=>setDraft(value=>({...value,procedure:event.target.value}))} placeholder="2025/0407(COD)" autoComplete="off" spellCheck={false}/></label>
      <label>Target document<input value={draft.document} onChange={event=>setDraft(value=>({...value,document:event.target.value}))} placeholder={scope==='committee'?'AGRI-PR-773115':'A-10-2026-0254'} autoComplete="off" spellCheck={false}/></label>
      <label>MEP author<select value={draft.member} onChange={event=>setDraft(value=>({...value,member:event.target.value}))}>
        <option value="">{directory.loading&&!authors.length?'Loading authors…':'Any author'}</option>
        {draft.member&&!authors.some(person=>String(person.id)===draft.member)&&<option value={draft.member}>MEP {draft.member} · {directory.loading?'loading name…':'name unavailable'}</option>}
        {authors.map(person=><option lang="" key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
      </select></label>
      <button type="submit">Find amendments</button>
      {(document||procedure||member||outcome||list||committee||scope!=='plenary'||offset>0)&&<button type="button" onClick={()=>{setDocument('');setProcedure('');setMember('');setOutcome('');setScope('plenary');setList('');setCommittee('');setOffset(0);}}>Clear filters</button>}
    </form>
    {directory.error&&<p lang="en" className="insight-secondary">Author choices are temporarily unavailable. <button onClick={directory.retry}>Reload authors</button></p>}
    <Amendments language={language} scope={scope} list={list} committee={committee} onCommittee={setCommittee} document={document} procedure={procedure} member={member} outcome={outcome} offset={offset} onOutcome={setOutcome} onOffset={setOffset} onMember={props.onMember} heading={member?<>Amendments by <span lang="">{selectedAuthor?[selectedAuthor.firstName,selectedAuthor.lastName].join(' '):'MEP '+member}</span></>:procedure?<>Amendments for <span lang="">{procedure}</span></>:document?<>Amendments to <span lang="">{document}</span></>:'Latest amendments'}/>
  </InsightShell>;
}
