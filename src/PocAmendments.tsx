import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {useData} from './pocData';
import {useExplorerParam} from './pocExplorerUrl';
import {InsightShell,insightMemberHref} from './PocInsightShared';
import type {InsightProps} from './PocInsightTypes';
import type {Amendment,AmendmentDecision,AmendmentFailurePage,AmendmentPage,AmendmentSource,AmendmentSplit,AmendmentVariant} from './PocAmendmentTypes';
import {amendmentDecisionPart,amendmentDecisionScope,amendmentGroups,amendmentOutcomeLabel,amendmentPlanSummary,amendmentRoute,publicAmendmentSource} from './pocAmendmentModel.mjs';
import type {Directory} from './pocTypes';
import './PocAmendments.css';

const outcomes=['','ADOPTED','REJECTED','LAPSED','WITHDRAWN','mixed','unavailable'] as const;
const methods:Record<string,string>={VOTE_HAND:'Show of hands',VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',VOTE_ELECTRONIC:'Electronic vote',VOTE_SECRET_BALLOT:'Secret ballot'};
const dateLabel=(value:string|number|null|undefined,language:string)=>{
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(time)):null;
};
function documentDateLabel(item:AmendmentVariant,language:string) {
  const value=Object.hasOwn(item,'documentDate')?item.documentDate:item.date;
  const label=item.dateBasis==='individual-amendment-document'?'Amendment document date':item.dateBasis==='amendment-list-document'?'Amendment-list document date':'Document date';
  return dateLabel(value,language)?label+' '+dateLabel(value,language):null;
}
const onBehalfLabel=(value:AmendmentVariant['onBehalfOf'])=>(Array.isArray(value)?value.join(', '):value)?.replace(/^on behalf of\s+/i,'');
const gapLabel=(value:unknown):string=>typeof value==='string'?value:typeof value==='object'&&value!==null?String((value as Record<string,unknown>).message||(value as Record<string,unknown>).reason||(value as Record<string,unknown>).code||'A source record is unavailable.'):'A source record is unavailable.';

function Outcome({value}:{value?:string|null}) {
  return <span className="poc-amendment-outcome" data-outcome={value||'unavailable'}>{amendmentOutcomeLabel(value)}</span>;
}
function Decision({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const source=publicAmendmentSource(decision.source),hasTotals=decision.totals&&['for','against','abstaining'].some(key=>typeof decision.totals?.[key as keyof NonNullable<AmendmentDecision['totals']>]==='number');
  return <li className="poc-amendment-decision"><div className="poc-amendment-decision-heading"><strong>{amendmentDecisionScope(item,decision)}</strong><Outcome value={decision.outcome}/></div><p className="poc-amendment-meta">{[decision.date?'Decision date '+dateLabel(decision.date,language):null,methods[decision.method||'']||decision.method].filter(Boolean).join(' · ')}</p>{hasTotals&&<dl className="poc-amendment-totals">{([['for','For'],['against','Against'],['abstaining','Abstentions']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{decision.totals?.[key]?.toLocaleString(language)??'Unavailable'}</dd></div>)}</dl>}{source&&<a href={source} target="_blank" rel="noreferrer">Official decision data ↗</a>}</li>;
}
function SplitDescription({description,language,sourceDescriptions,rawDescription,code}:{description?:string|null;language?:string|null;sourceDescriptions?:Record<string,string>;rawDescription?:string|null;code?:string|null}) {
  if(description?.trim())return <blockquote lang={language||undefined}>{description}</blockquote>;
  const available=Object.entries(sourceDescriptions||{}).filter(([,text])=>typeof text==='string'&&text.trim());
  if(!available.length&&rawDescription?.trim())available.push([language||'und',rawDescription]);
  return <div className="poc-amendment-description-fallback">
    <p className="poc-amendment-secondary">{code==='missing_language'&&language==='en'?'English split description unavailable.':'Readable split description unavailable.'}</p>
    {available.map(([sourceLanguage,text])=><div className="poc-amendment-source-description" key={sourceLanguage}>
      <p className="poc-amendment-meta">{sourceLanguage==='und'?'Source language unavailable':sourceLanguage.toUpperCase()+' · source description'} · original fragment</p>
      <pre lang={sourceLanguage==='und'?undefined:sourceLanguage}>{text}</pre>
    </div>)}
  </div>;
}
function SplitPart({part,item,language}:{part:AmendmentSplit;item:Amendment;language:string}) {
  const decisions=(item.decisions||[]).filter(decision=>amendmentDecisionPart(item.splitParts||[],decision)?.id===part.id);
  const plan=amendmentPlanSummary(part.plan),failed=Boolean(part.failure)||['failed','unparsed','unresolved','unsupported','failure','error'].includes(part.status||'');
  return <li className="poc-amendment-part"><h5>Part {part.number??part.id}</h5><SplitDescription description={part.description} language={part.language} rawDescription={part.rawDescription} sourceDescriptions={part.sourceDescriptions} code={typeof part.failure==='object'?part.failure?.code:null}/>{failed?<p className="poc-amendment-gap">This split description could not be parsed automatically. The source description is retained for future parser updates.{part.failure&&<> <span>{typeof part.failure==='string'?part.failure:part.failure.message||part.failure.code}</span></>}</p>:plan.length?<div className="poc-amendment-selection"><strong>Recognised selection</strong><ul>{plan.map((line,index)=><li key={index}>{line}</li>)}</ul><small>This describes the split; it does not reconstruct the final adopted text.</small></div>:<p className="poc-amendment-secondary">A readable selection plan is unavailable.</p>}{decisions.length?<ul className="poc-amendment-decisions">{decisions.map(decision=><Decision key={decision.id} item={item} decision={decision} language={language}/>)}</ul>:<p className="poc-amendment-secondary">Outcome unavailable for this part.</p>}</li>;
}
function AmendmentWording({item}:{item:AmendmentVariant}) {
  return <div className="poc-amendment-texts" lang={item.language||undefined}>
    <section><h5>Original text</h5>{item.originalText!==null&&item.originalText!==undefined?<p>{item.originalText===''?'No original text (insertion).':item.originalText}</p>:<p className="poc-amendment-secondary">Original text unavailable in the extracted document.</p>}</section>
    <section><h5>Proposed text</h5>{item.proposedText!==null&&item.proposedText!==undefined?<p>{item.proposedText===''?'Text deleted.':item.proposedText}</p>:<p className="poc-amendment-secondary">Proposed text unavailable in the extracted document.</p>}</section>
  </div>;
}
function AmendmentSources({sources,language}:{sources:AmendmentSource[];language:string}) {
  const available=sources.filter(source=>publicAmendmentSource(source));
  return available.length?<ul>{available.map((source,index)=><li key={source.url+index}>
    <a href={publicAmendmentSource(source)!} target="_blank" rel="noreferrer">Official source{source.language?' · '+source.language.toUpperCase():''} ↗</a>
    {source.fetchedAt!==undefined&&source.fetchedAt!==null&&<small> · retrieved {dateLabel(source.fetchedAt,language)||'date unavailable'}</small>}
    {source.date&&<small> · {documentDateLabel(source,language)}</small>}
  </li>)}</ul>:<p>Official source link unavailable.</p>;
}
function AmendmentAuthors({item,language,onMember}:{item:Amendment;language:string;onMember?:InsightProps['onMember']}) {
  const authors=item.authors||[],onBehalfOf=onBehalfLabel(item.onBehalfOf);
  if(item.conflicted)return null;
  if(!authors.length)return item.committeeProposer?<div className="poc-amendment-authors"><span>Tabled by </span><strong>{item.committeeProposer}</strong>{onBehalfOf&&<p>On behalf of {onBehalfOf}</p>}</div>:onBehalfOf?<p className="poc-amendment-authors">Tabled on behalf of {onBehalfOf}</p>:<p className="poc-amendment-secondary">Proposers unavailable.</p>;
  return <div className="poc-amendment-authors"><span>Tabled by </span>{authors.map((author,index)=>{
    const linked=Boolean(author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
    const note=({missing_date:'document date unavailable',missing_mandate:'mandate evidence unavailable',inactive:'no active mandate match',ambiguous:'multiple possible MEPs'} as Record<string,string>)[author.status||'']||'MEP link unresolved';
    return <span key={author.personId||author.name+index}>{index>0?', ':''}{linked?<a href={insightMemberHref(String(author.personId),language)} title={author.method?'Matched using '+author.method.replaceAll('-',' ').replaceAll('_',' '):undefined} onClick={onMember?event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
      event.preventDefault();onMember(Number(author.personId));
    }:undefined}>{author.name}</a>:<>{author.name}<small> ({note})</small></>}</span>;
  })}{item.committeeProposer&&<p>Committee proposer: {item.committeeProposer}</p>}{onBehalfOf&&<p>On behalf of {onBehalfOf}</p>}</div>;
}
function SourceVariants({item,language}:{item:Amendment;language:string}) {
  if(!item.conflicted)return null;
  return <div className="poc-amendment-conflict"><p><strong>Conflicting source variants.</strong> Wording and proposer attribution are withheld because precedence between the amendment lists has not been established.</p>
    {item.variants?.length?<details className="poc-amendment-variants"><summary>Inspect source variants · {item.variants.length}</summary>{item.variants.map((variant,index)=><section className="poc-amendment-variant" key={(variant.listId||'variant')+index}>
      <h5>Source variant {index+1}{variant.listId?' · '+variant.listId:''}</h5>
      <p className="poc-amendment-meta">{[documentDateLabel(variant,language),variant.language?variant.language.toUpperCase()+' · source language':'Source language unavailable'].filter(Boolean).join(' · ')}</p>
      {variant.targetLabel&&<p>{variant.targetLabel}</p>}
      {variant.authors?.length?<p>Named in this source: {variant.authors.map(author=>author.name).join(', ')}</p>:null}
      {variant.committeeProposer&&<p>Committee proposer in this source: {variant.committeeProposer}</p>}
      {onBehalfLabel(variant.onBehalfOf)&&<p>On behalf of {onBehalfLabel(variant.onBehalfOf)}</p>}
      <AmendmentWording item={variant}/><AmendmentSources sources={variant.sources||[]} language={language}/>
    </section>)}</details>:null}
  </div>;
}
function AmendmentCard({item,language,onMember}:{item:Amendment;language:string;onMember?:InsightProps['onMember']}) {
  const splitParts=item.splitParts||[],decisions=item.decisions||[],whole=decisions.filter(decision=>!amendmentDecisionPart(splitParts,decision));
  const authors=item.authors||[];
  return <article className="poc-amendment-card" id={'amendment-'+item.id}>
    <header><div><p className="poc-amendment-reference">{item.targetDocumentId||'Target document unavailable'}{item.listId&&<span> · {item.listId}</span>}</p><h4>Amendment {item.number??item.id}</h4>{item.title&&<p className="poc-amendment-title">{item.title}</p>}</div><Outcome value={item.outcome}/></header>
    {!item.conflicted&&<><p className="poc-amendment-target">{item.targetLabel||'Target provision unavailable'}</p><p className="poc-amendment-meta">{[documentDateLabel(item,language),item.language?item.language.toUpperCase()+' · source language':'Source language unavailable',splitParts.length?'Split amendment · '+splitParts.length+' parts':null].filter(Boolean).join(' · ')}</p></>}
    <SourceVariants item={item} language={language}/>
    <AmendmentAuthors item={item} language={language} onMember={onMember}/>
    {!item.conflicted&&<details className="poc-amendment-wording"><summary>Compare original and proposed text</summary><AmendmentWording item={item}/></details>}
    {(decisions.length>0||splitParts.length>0)?<details className="poc-amendment-voting"><summary>Decisions{splitParts.length?' and split parts':''} · {decisions.length} recorded</summary>{splitParts.length>0&&<ol className="poc-amendment-parts">{splitParts.map(part=><SplitPart key={part.id} part={part} item={item} language={language}/>)}</ol>}{whole.length>0&&<ul className="poc-amendment-decisions">{whole.map(decision=><Decision key={decision.id} item={item} decision={decision} language={language}/>)}</ul>}</details>:<p className="poc-amendment-secondary">No outcome is recorded in the available sources.</p>}
    <details className="poc-amendment-evidence"><summary>Sources and coverage{item.gaps?.length?' · '+item.gaps.length+' gaps':''}</summary><p className="poc-amendment-reference">{item.id}</p>
      {item.identifierBasis==='derived-from-exact-target-and-number'&&<p>Dataset key derived from the exact target document and amendment number.</p>}
      {item.officialIds?.length?<p className="poc-amendment-reference">Official references: {item.officialIds.join(', ')}</p>:null}
      <AmendmentSources sources={item.sources||[]} language={language}/>
      {item.topics?.length?<ul>{item.topics.map(topic=><li key={topic.id}>{topic.label} <small>· {topic.basis==='dossier'?'dossier subject':'target provision'}</small></li>)}</ul>:null}
      {item.gaps?.length?<ul className="poc-amendment-gap">{item.gaps.map((gap,index)=><li key={index}>{gapLabel(gap)}</li>)}</ul>:null}
      {!item.conflicted&&authors.some(author=>author.personId)&&<p className="poc-amendment-secondary">Author links are derived from public names, dated mandates and voting identities where available.</p>}
    </details>
  </article>;
}
function ParsingFailures({language,total,unresolved}:{language:string;total?:number;unresolved?:number}) {
  const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),limit=10;
  const state=useData<AmendmentFailurePage>(open?'amendments/failures?'+new URLSearchParams({lang:language,limit:String(limit),offset:String(offset)}):null);
  return <details className="poc-amendment-failures" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Split descriptions needing parser updates{unresolved!==undefined?' · '+unresolved+' unresolved':''}</summary><p>Recorded across the amendment index. Original descriptions and parser errors are retained for future updates.{total!==undefined?' '+total+' failure records.':''}</p>{state.loading&&<p role="status">Loading recorded parser failures…</p>}{state.error&&<p role="alert">Could not load parser failures. <button onClick={state.retry}>Try again</button></p>}{state.data&&<>{!state.data.items.length?<p>No parser failures recorded.</p>:<ol className="poc-amendment-failure-list">{state.data.items.map((failure,index)=><li key={failure.requestId+failure.partId+index}><strong>{failure.partId||failure.requestId}</strong><SplitDescription description={failure.description} language={failure.language} rawDescription={failure.rawDescription} sourceDescriptions={failure.sourceDescriptions} code={failure.code}/><p>{failure.message||failure.reason||failure.code||'Description not recognised.'}</p><p className="poc-amendment-meta">{[failure.status,failure.parserVersion?'Parser '+failure.parserVersion:null,(failure.occurrences??failure.count)!==undefined?(failure.occurrences??failure.count)+' recorded occurrences':null,(failure.lastSeen||failure.lastOccurrence)?'Last seen '+dateLabel(failure.lastSeen||failure.lastOccurrence,language):null].filter(Boolean).join(' · ')}</p>{publicAmendmentSource(failure.sourceUrl)&&<a href={publicAmendmentSource(failure.sourceUrl)!} target="_blank" rel="noreferrer">Official source ↗</a>}</li>)}</ol>}<nav className="poc-amendment-pagination" aria-label="Parser failure pages"><button disabled={offset===0||state.loading} onClick={()=>setOffset(value=>Math.max(0,value-limit))}>Previous</button><span>{state.data.total?offset+1+'–'+Math.min(offset+limit,state.data.total)+' of '+state.data.total:'0 records'}</span><button disabled={offset+limit>=state.data.total||state.loading} onClick={()=>setOffset(value=>value+limit)}>Next</button></nav></>}</details>;
}
type AmendmentProps={language?:string;document?:string|null;procedure?:string|null;member?:string|number|null;outcome?:string;offset?:number;onOutcome?:(value:string)=>void;onOffset?:(value:number)=>void;onMember?:InsightProps['onMember'];heading?:string;showFailures?:boolean};
export function PocAmendments({language='en',document,procedure,member,outcome:controlledOutcome,offset:controlledOffset,onOutcome,onOffset,onMember,heading='Amendment trail',showFailures=true}:AmendmentProps) {
  const [localOutcome,setLocalOutcome]=useState(''),[localOffset,setLocalOffset]=useState(0),[groupBy,setGroupBy]=useState('dossier');
  const outcome=controlledOutcome??localOutcome,offset=controlledOffset??localOffset,limit=20,headingId=useId(),headingRef=useRef<HTMLHeadingElement>(null);
  const state=useData<AmendmentPage>(amendmentRoute({document,procedure,member,outcome,offset,limit,language}));
  const groups=useMemo(()=>amendmentGroups(state.data?.items||[],groupBy),[state.data,groupBy]);
  useEffect(()=>{
    if(!state.data?.coverage.pending)return;
    const timer=window.setInterval(state.retry,10_000);
    return ()=>window.clearInterval(timer);
  },[state.data?.coverage.pending,state.retry]);
  useEffect(()=>{if(controlledOffset===undefined)setLocalOffset(0);},[document,procedure,member,language,controlledOffset]);
  function page(value:number){onOffset?onOffset(value):setLocalOffset(value);headingRef.current?.focus({preventScroll:true});headingRef.current?.scrollIntoView({block:'start',behavior:'instant'});}
  function filter(value:string){onOutcome?onOutcome(value):setLocalOutcome(value);onOffset?onOffset(0):setLocalOffset(0);}
  return <section className="poc-amendments" aria-labelledby={headingId} aria-busy={state.loading}><div className="poc-amendment-section-heading"><h2 id={headingId} ref={headingRef} tabIndex={-1}>{heading}</h2><button onClick={state.retry} disabled={state.loading}>Refresh</button></div><div className="poc-amendment-controls"><label>Outcome<select value={outcome} onChange={event=>filter(event.target.value)}>{outcomes.map(value=><option key={value} value={value}>{value?amendmentOutcomeLabel(value):'Any outcome'}</option>)}</select></label><label>Group this page by<select value={groupBy} onChange={event=>setGroupBy(event.target.value)}><option value="dossier">Dossier / target document</option><option value="target">Target provision</option><option value="topic">Recorded topic</option></select></label></div>{state.loading&&!state.data&&<p role="status">Loading amendments…</p>}{state.error&&<div className="poc-amendment-gap" role="alert"><p>Amendments could not be loaded. {state.error}</p><button onClick={state.retry}>Try again</button></div>}{state.data&&<><div className="poc-amendment-coverage" role="status"><p><strong>{state.data.total.toLocaleString(language)} indexed {state.data.total===1?'amendment':'amendments'}</strong>{state.data.coverage.pending?' · indexing in progress':state.data.coverage.complete?'':' · partial coverage'}</p><p>This trail covers available plenary amendment documents and recorded decisions. Missing outcomes remain unavailable.{state.data.coverage.lastUpdated?' Updated '+dateLabel(state.data.coverage.lastUpdated,language)+'.':''}</p>{Boolean(state.data.coverage.gaps?.length)&&<details><summary>Coverage gaps · {state.data.coverage.gaps!.length}</summary><ul>{state.data.coverage.gaps!.map((gap,index)=><li key={index}>{gapLabel(gap)}</li>)}</ul></details>}</div>{!state.data.items.length?<p className="poc-amendment-empty">{state.data.coverage.pending?'No matching amendments are indexed yet. The index is still being updated.':'No indexed amendments match these filters.'}</p>:groups.map(group=><section className="poc-amendment-group" key={group.id}><div className="poc-amendment-group-heading"><h3>{group.label}</h3><small>{group.basis} · {group.items.length} on this page</small></div>{group.items.map(item=><AmendmentCard key={item.id} item={item} language={language} onMember={onMember}/>)}</section>)}<nav className="poc-amendment-pagination" aria-label="Amendment pages"><button disabled={offset===0||state.loading} onClick={()=>page(Math.max(0,offset-limit))}>Previous</button><span aria-live="polite">{state.data.total?offset+1+'–'+Math.min(offset+state.data.items.length,state.data.total)+' of '+state.data.total:'0 amendments'}</span><button disabled={offset+state.data.items.length>=state.data.total||!state.data.items.length||state.loading} onClick={()=>page(offset+limit)}>Next</button></nav>{showFailures&&<ParsingFailures language={language} total={state.data.failures?.total} unresolved={state.data.failures?.unresolved}/>}</>}</section>;
}
export function PocAmendmentsPage(props:InsightProps) {
  const language=props.language||'en';
  const [document,setDocument]=useExplorerParam<string>('am-document','');
  const [procedure,setProcedure]=useExplorerParam<string>('am-procedure','');
  const [member,setMember]=useExplorerParam<string>('am-member','');
  const [outcome,setOutcome]=useExplorerParam<string>('am-outcome','',outcomes);
  const [offset,setOffset]=useExplorerParam<number>('am-offset',0);
  const [draft,setDraft]=useState({document,procedure,member});
  const directory=useData<Directory>('directory');
  const authors=useMemo(()=>[...(directory.data?.members||[])].sort((a,b)=>a.lastName.localeCompare(b.lastName,language)||a.firstName.localeCompare(b.firstName,language)),[directory.data,language]);
  const selectedAuthor=authors.find(person=>String(person.id)===member);
  useEffect(()=>setDraft({document,procedure,member}),[document,procedure,member]);
  return <InsightShell {...props} view="amendments" title="Amendments" description="Follow proposed changes, their authors and Parliament’s decisions.">
    <form className="poc-amendment-finder" onSubmit={event=>{
      event.preventDefault();setDocument(draft.document.trim());setProcedure(draft.procedure.trim());setMember(draft.member);setOffset(0);
    }}>
      <label>Dossier reference<input value={draft.procedure} onChange={event=>setDraft(value=>({...value,procedure:event.target.value}))} placeholder="2025/0407(COD)" autoComplete="off" spellCheck={false}/></label>
      <label>Target document<input value={draft.document} onChange={event=>setDraft(value=>({...value,document:event.target.value}))} placeholder="A-10-2026-0254" autoComplete="off" spellCheck={false}/></label>
      <label>MEP author<select value={draft.member} onChange={event=>setDraft(value=>({...value,member:event.target.value}))}>
        <option value="">{directory.loading&&!authors.length?'Loading authors…':'Any author'}</option>
        {draft.member&&!authors.some(person=>String(person.id)===draft.member)&&<option value={draft.member}>MEP {draft.member} · {directory.loading?'loading name…':'name unavailable'}</option>}
        {authors.map(person=><option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
      </select></label>
      <button type="submit">Find amendments</button>
      {(document||procedure||member)&&<button type="button" onClick={()=>{setDocument('');setProcedure('');setMember('');setOffset(0);}}>Clear filters</button>}
    </form>
    {directory.error&&<p className="insight-secondary">Author choices are temporarily unavailable. <button onClick={directory.retry}>Reload authors</button></p>}
    <PocAmendments language={language} document={document} procedure={procedure} member={member} outcome={outcome} offset={offset} onOutcome={setOutcome} onOffset={setOffset} onMember={props.onMember} heading={member?'Amendments by '+(selectedAuthor?[selectedAuthor.firstName,selectedAuthor.lastName].join(' '):'MEP '+member):procedure?'Amendments for '+procedure:document?'Amendments to '+document:'Latest indexed amendments'}/>
  </InsightShell>;
}
