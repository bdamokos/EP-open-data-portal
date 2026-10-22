import {PersonName} from './PersonName';
import {Fragment,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {selectLanguageText} from './language.mjs';
import {useData} from './data';
import {useExplorerParam} from './explorerUrl';
import {InsightShell,insightMemberHref} from './InsightShared';
import type {InsightProps} from './InsightTypes';
import type {Amendment,AmendmentDecision,AmendmentFailurePage,AmendmentPage,AmendmentSource,AmendmentSplit,AmendmentVariant} from './AmendmentTypes';
import {amendmentDecisionKey,amendmentDecisionPart,amendmentDecisionScope,amendmentGroups,amendmentFailureKey,amendmentFailureLabel,amendmentOutcomeLabel,amendmentPlanSummary,amendmentRoute,publicAmendmentSource} from './amendmentModel.mjs';
import type {Directory} from './explorerTypes';
import './Amendments.css';
import {WordingDiff} from './components/WordingDiff';

const outcomes=['','ADOPTED','REJECTED','LAPSED','WITHDRAWN','mixed','unavailable'] as const;
const methods:Record<string,string>={VOTE_HAND:'Show of hands',VOTE_ELECTRONIC_ROLLCALL:'Roll-call vote',VOTE_ELECTRONIC:'Electronic vote',VOTE_SECRET_BALLOT:'Secret ballot'};
const dateLabel=(value:string|number|null|undefined,language:string)=>{
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(time)):null;
};
function LocalizedDate({value,language}:{value?:string|number|null;language:string}) {
  const text=dateLabel(value,language);
  return text?<time lang={language}>{text}</time>:<span lang="en">date unavailable</span>;
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
  const label=item.dateBasis==='individual-amendment-document'?'Amendment document date':item.dateBasis==='amendment-list-document'?'Amendment-list document date':'Document date';
  return dateLabel(value,language)?<>{label} <LocalizedDate value={value} language={language}/></>:null;
}
const onBehalfLabel=(value:AmendmentVariant['onBehalfOf'])=>(Array.isArray(value)?value.join(', '):value)?.replace(/^on behalf of\s+/i,'');
const gapLabel=(value:unknown):string=>typeof value==='string'?value:typeof value==='object'&&value!==null?String((value as Record<string,unknown>).message||(value as Record<string,unknown>).reason||(value as Record<string,unknown>).code||'A source record is unavailable.'):'A source record is unavailable.';
const pageRange=(offset:number,count:number,total:number,emptyLabel:string)=>!count?(total?'0 shown of '+total:emptyLabel):offset+1+'–'+Math.min(offset+count,total)+' of '+total;
const proposerDateBases:Record<string,string>={'individual-amendment-document':'individual amendment document','amendment-list-document':'amendment-list document','amendment-list-metadata':'amendment-list metadata'};
const authorMatchMethods:Record<string,string>={exact_full_name_active_mandate:'Exact full name with an active mandate',official_voting_alias_active_mandate:'Official voting-record alias with an active mandate'};

function Outcome({value}:{value?:string|null}) {
  return <span className="explorer-amendment-outcome" lang="en" data-outcome={value||'unavailable'}>{amendmentOutcomeLabel(value)}</span>;
}
function Decision({item,decision,language}:{item:Amendment;decision:AmendmentDecision;language:string}) {
  const source=decision.provenance==='unavailable'?null:publicAmendmentSource(decision.source),hasTotals=decision.totals&&['for','against','abstaining'].some(key=>typeof decision.totals?.[key as keyof NonNullable<AmendmentDecision['totals']>]==='number');
  return <li className="explorer-amendment-decision" lang="en"><div className="explorer-amendment-decision-heading"><strong>{decision.componentBinding==='unverified'?'Unverified split-component decision':decision.componentBinding==='unresolved-collective'?'Collective decision':amendmentDecisionScope(item,decision)}</strong><Outcome value={decision.outcome}/></div><p className="explorer-amendment-meta">{joinMeta([decision.date?<>Decision date <LocalizedDate value={decision.date} language={language}/></>:null,methods[decision.method||'']||decision.method&&<span lang="">{decision.method}</span>])}</p>{decision.componentBinding==='unresolved-collective'&&<p className="explorer-amendment-secondary">This collective outcome is not bound to an individual amendment’s split part.</p>}{decision.componentBinding==='unverified'&&<p className="explorer-amendment-secondary">The split-component binding is unverified. This is not a verified outcome for an individual part.</p>}{(decision.collective||decision.componentBinding==='unresolved-collective'||(decision.amendmentIds?.length||0)>1)&&Boolean(decision.amendmentIds?.length)&&<details className="explorer-amendment-collective-references"><summary>Co-decided amendment references · {decision.amendmentIds!.length}</summary><ul>{decision.amendmentIds!.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></details>}{decision.componentReferences?.length?<details><summary>Recorded component references · {decision.componentReferences.length}</summary><ul>{decision.componentReferences.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></details>:null}{hasTotals&&<dl className="explorer-amendment-totals">{([['for','For'],['against','Against'],['abstaining','Abstentions']] as const).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{decision.totals?.[key]!=null?<span lang={language}>{decision.totals[key]!.toLocaleString(language)}</span>:'Unavailable'}</dd></div>)}</dl>}{source&&<a href={source} target="_blank" rel="noreferrer">Official decision data ↗</a>}{!source&&(decision.provenance==='unavailable'||Boolean(decision.sourceCandidates?.length))&&<p className="explorer-amendment-secondary">Exact decision source page unavailable.</p>}</li>;
}
function SplitDescription({description,language,sourceDescriptions,rawDescription,code}:{description?:string|null;language?:string|null;sourceDescriptions?:Record<string,string>;rawDescription?:string|null;code?:string|null}) {
  if(description?.trim())return <blockquote lang={language??''}>{description}</blockquote>;
  const available=Object.entries(sourceDescriptions||{}).filter(([,text])=>typeof text==='string'&&text.trim());
  if(!available.length&&rawDescription?.trim())available.push([language??'',rawDescription]);
  return <div className="explorer-amendment-description-fallback" lang="en">
    <p className="explorer-amendment-secondary">{code==='missing_language'&&language==='en'?'English split description unavailable.':'Readable split description unavailable.'}</p>
    {available.map(([sourceLanguage,text])=><div className="explorer-amendment-source-description" key={sourceLanguage}>
      <p className="explorer-amendment-meta">{!sourceLanguage||sourceLanguage==='und'?'Source language unavailable':<><span lang="">{sourceLanguage.toUpperCase()}</span> · source description</>} · original fragment</p>
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
  return <li className="explorer-amendment-part" lang="en"><h5>{part.number!=null?'Part '+part.number:part.id||'Unidentified split component'}</h5><SplitDescription description={part.description} language={part.language} rawDescription={part.rawDescription} sourceDescriptions={part.sourceDescriptions} code={typeof part.failure==='object'?part.failure?.code:null}/>{failed?<p className="explorer-amendment-gap">This split description could not be parsed automatically. The source description is retained for future parser updates.{part.failure&&<> <span>{typeof part.failure==='string'?part.failure:part.failure.message||part.failure.code}</span></>}</p>:plan.length?<div className="explorer-amendment-selection"><strong>Recognised selection</strong><ul>{plan.map((line,index)=><li key={index}><PlanLine text={line} plan={part.plan} language={part.language}/></li>)}</ul><small>This describes the split; it does not reconstruct the final adopted text.</small></div>:<p className="explorer-amendment-secondary">A readable selection plan is unavailable.</p>}{decisions.length?<ul className="explorer-amendment-decisions">{decisions.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language}/>)}</ul>:<p className="explorer-amendment-secondary">Outcome unavailable for this part.</p>}</li>;
}
function AmendmentWording({item}:{item:AmendmentVariant}) {
  const withheld=item.textIntegrity==='incomplete';
  const readable=!withheld&&typeof item.originalText==='string'&&typeof item.proposedText==='string';
  return <>{item.wordingRetained&&!withheld&&<p className="explorer-amendment-secondary">Showing previously indexed wording. Proposer information and document metadata have separate source records.</p>}{readable?<WordingDiff original={item.originalText!} proposed={item.proposedText!} language={wordingLanguage(item)} emptySemantics="insertion-deletion"/>:<div className="explorer-amendment-texts" lang="en">
    <section><h5>Original text</h5>{withheld?<p className="explorer-amendment-secondary">Original wording withheld pending extraction or verification.</p>:item.originalText!==null&&item.originalText!==undefined?item.originalText===''?<p>No original text (insertion).</p>:<p lang={wordingLanguage(item)}>{item.originalText}</p>:<p className="explorer-amendment-secondary">Original text unavailable in the extracted document.</p>}</section>
    <section><h5>Proposed text</h5>{withheld?<p className="explorer-amendment-secondary">Proposed wording withheld pending extraction or verification.</p>:item.proposedText!==null&&item.proposedText!==undefined?item.proposedText===''?<p>Text deleted.</p>:<p lang={wordingLanguage(item)}>{item.proposedText}</p>:<p className="explorer-amendment-secondary">Proposed text unavailable in the extracted document.</p>}</section>
  </div>}</>;
}
function AmendmentEvidenceState({item}:{item:AmendmentVariant}) {
  if(item.textIntegrity!=='incomplete'&&!['absent-current-relationship','unverified'].includes(item.listRelationship||'')&&!item.recordRetained)return null;
  return <div className="explorer-amendment-evidence-state" lang="en">{item.textIntegrity==='incomplete'&&<p className="explorer-amendment-secondary">Original and proposed wording are withheld because extraction or verification is incomplete.</p>}{item.listRelationship==='absent-current-relationship'&&<p className="explorer-amendment-secondary">The source amendment list is absent from the current recorded document relationship.</p>}{item.listRelationship==='unverified'&&<p className="explorer-amendment-secondary">The current relationship to this amendment list is unverified.</p>}{item.recordRetained&&<p className="explorer-amendment-secondary">This amendment record is retained from an earlier indexed source.</p>}</div>;
}
function AmendmentSources({sources,language}:{sources:AmendmentSource[];language:string}) {
  const available=sources.filter(source=>publicAmendmentSource(source));
  return available.length?<ul lang="en">{available.map((source,index)=><li key={source.url+index}>
    <a href={publicAmendmentSource(source)!} target="_blank" rel="noreferrer">Official source{source.language?' · '+source.language.toUpperCase():''} ↗</a>
    {source.fetchedAt!==undefined&&source.fetchedAt!==null&&<small> · retrieved <LocalizedDate value={source.fetchedAt} language={language}/></small>}
    {source.date&&<small> · {documentDateLabel(source,language,true)}</small>}
  </li>)}</ul>:<p>Official source link unavailable.</p>;
}
function ComponentSource({source,label,language}:{source?:AmendmentSource|null;label:string;language:string}) {
  const url=publicAmendmentSource(source);
  if(!source)return null;
  return <p className="explorer-amendment-meta" lang="en">{label}: {url?<a href={url} target="_blank" rel="noreferrer">official document{source.language?' · '+source.language.toUpperCase():''} ↗</a>:'link unavailable'}{source.fetchedAt!=null?<> · retrieved <LocalizedDate value={source.fetchedAt} language={language}/></>:''}</p>;
}
function ComponentSources({item,language}:{item:AmendmentVariant;language:string}) {
  return <><ComponentSource source={item.wordingSource} label={item.wordingRetained?'Retained wording source':'Wording source'} language={language}/><ComponentSource source={item.proposerSource} label={item.proposerRetained?'Retained proposer source':'Proposer source'} language={language}/><ComponentSource source={item.metadataSource} label="Document metadata source" language={language}/><ComponentSource source={item.targetLabelSource} label="Target label source" language={language}/></>;
}
function AuthorEvidence({item,language}:{item:AmendmentVariant;language:string}) {
  const linked=(item.authors||[]).filter(author=>author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
  if(!linked.length)return null;
  const basis=proposerDateBases[item.proposerDateBasis||''],hasDate=Boolean(basis&&dateLabel(item.proposerDate,language));
  return <div className="explorer-amendment-author-evidence" lang="en"><p>Recorded author matches</p><ul>{linked.map((author,index)=><li key={String(author.personId)+':'+index}><span lang="">{author.name}</span>: {authorMatchMethods[author.method||'']|| (author.method?<>Recorded method <span lang="">{author.method}</span></>:'Match method unavailable')}{hasDate?<> · proposer date <LocalizedDate value={item.proposerDate} language={language}/> ({basis})</>:' · supported proposer date unavailable'}</li>)}</ul></div>;
}
function AmendmentAuthors({item,language,onMember}:{item:Amendment;language:string;onMember?:InsightProps['onMember']}) {
  const authors=item.authors||[],onBehalfOf=onBehalfLabel(item.onBehalfOf);
  if(item.conflicted)return null;
  if(!authors.length)return item.committeeProposer?<div className="explorer-amendment-authors"><span>Tabled by </span><strong lang={item.proposerSource?.language??''}>{item.committeeProposer}</strong>{onBehalfOf&&<p>On behalf of <span lang="">{onBehalfOf}</span></p>}</div>:onBehalfOf?<p className="explorer-amendment-authors">Tabled on behalf of <span lang="">{onBehalfOf}</span></p>:<p className="explorer-amendment-secondary">Proposers unavailable.</p>;
  return <div className="explorer-amendment-authors"><span>Tabled by </span>{authors.map((author,index)=>{
    const linked=Boolean(author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
    const note=({missing_date:'document date unavailable',missing_mandate:'mandate evidence unavailable',inactive:'no active mandate match',ambiguous:'multiple possible MEPs'} as Record<string,string>)[author.status||'']||'MEP link unresolved';
    return <span key={String(author.personId||author.name)+':'+index}>{index>0?', ':''}{linked?<a href={insightMemberHref(String(author.personId),language)} title={author.method?'Matched using '+author.method.replaceAll('-',' ').replaceAll('_',' '):undefined} onClick={onMember?event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
      event.preventDefault();onMember(Number(author.personId));
    }:undefined}><PersonName id={author.personId} label={author.name}/></a>:<><span lang="">{author.name}</span><small> ({note})</small></>}</span>;
  })}{item.committeeProposer&&<p>Committee proposer: <span lang={item.proposerSource?.language??''}>{item.committeeProposer}</span></p>}{onBehalfOf&&<p>On behalf of <span lang="">{onBehalfOf}</span></p>}</div>;
}
function SourceVariants({item,language}:{item:Amendment;language:string}) {
  const matchedVariant=Boolean(item.authorMatch&&['variant','aggregate-and-variant'].includes(item.authorMatch.basis));
  if(!item.conflicted&&!item.variants?.length&&!matchedVariant)return null;
  return <div className={item.conflicted?'explorer-amendment-conflict':'explorer-amendment-source-variants'}>{item.conflicted&&<p><strong>Conflicting source variants.</strong> Wording and proposer attribution are withheld because precedence between the amendment lists has not been established.</p>}
    {matchedVariant&&<p className="explorer-amendment-secondary">This result matches the author filter through supported source-variant evidence.{item.conflicted?' Combined proposer attribution remains withheld.':''}</p>}
    {item.variants?.length?<details className="explorer-amendment-variants"><summary>Inspect source variants · {item.variants.length}</summary>{item.variants.map((variant,index)=><section className="explorer-amendment-variant" key={(variant.listId||'variant')+index}>
      <h5>Source variant {index+1}{variant.listId?' · '+variant.listId:''}</h5>
      <AmendmentEvidenceState item={variant}/>
      {variant.listId&&item.authorMatch?.variantListIds?.includes(variant.listId)&&<p className="explorer-amendment-secondary">Matches the selected MEP author through this source variant.</p>}
      <p className="explorer-amendment-meta">{joinMeta([documentDateLabel(variant,language,true),variant.language?<><span lang="">{variant.language.toUpperCase()}</span> · source language</>:'Source language unavailable'])}</p>
      {variant.targetLabel&&<p lang={targetLabelLanguage(variant)}>{variant.targetLabel}</p>}
      {variant.authors?.length?<p>Named in this source: {variant.authors.map((author,index)=><Fragment key={index}>{index?', ':''}<span lang="">{author.name}</span></Fragment>)}</p>:null}
      {variant.committeeProposer&&<p>Committee proposer in this source: <span lang={variant.proposerSource?.language??''}>{variant.committeeProposer}</span></p>}
      {onBehalfLabel(variant.onBehalfOf)&&<p>On behalf of <span lang="">{onBehalfLabel(variant.onBehalfOf)}</span></p>}
      <AuthorEvidence item={variant} language={language}/><AmendmentWording item={variant}/><ComponentSources item={variant} language={language}/><AmendmentSources sources={variant.sources||[]} language={language}/>
    </section>)}</details>:null}
  </div>;
}
function AmendmentCard({item,language,onMember}:{item:Amendment;language:string;onMember?:InsightProps['onMember']}) {
  const splitParts=item.splitParts||[],decisions=item.decisions||[],whole=decisions.filter(decision=>!amendmentDecisionPart(splitParts,decision));
  const authors=item.authors||[];
  const title=selectLanguageText(item.titles,language,item.title||'','');
  return <article lang="en" className="explorer-amendment-card" id={'amendment-'+item.id}>
    <header><div><p className="explorer-amendment-reference">{item.targetDocumentId||'Target document unavailable'}{item.listId&&<span> · {item.listId}</span>}</p><h4>Amendment {item.number??item.id}</h4>{item.title&&<p className="explorer-amendment-title" lang={title.text===item.title?title.language:''}>{item.title}</p>}</div><Outcome value={item.outcome}/></header>
    <AmendmentEvidenceState item={item}/>
    {!item.conflicted&&<><p className="explorer-amendment-target" lang={item.targetLabel?targetLabelLanguage(item):'en'}>{item.targetLabel||'Target provision unavailable'}</p><p className="explorer-amendment-meta">{joinMeta([documentDateLabel(item,language),metadataLanguage(item)?<><span lang="">{metadataLanguage(item).toUpperCase()}</span> · document language</>:'Document language unavailable',splitParts.length?'Split amendment · '+splitParts.length+' parts':null])}</p></>}
    <SourceVariants item={item} language={language}/>
    <AmendmentAuthors item={item} language={language} onMember={onMember}/>
    {!item.conflicted&&item.proposerRetained&&<p className="explorer-amendment-secondary">Proposer information is retained from an earlier indexed source.</p>}
    {!item.conflicted&&<details className="explorer-amendment-wording"><summary>Compare original and proposed text</summary><AmendmentWording item={item}/></details>}
    {item.splitCoverageComplete===false&&<p className="explorer-amendment-secondary">Split-request coverage is incomplete. A complete amendment outcome cannot be established from these component bindings.</p>}
    {(decisions.length>0||splitParts.length>0)?<details className="explorer-amendment-voting"><summary>Decisions{splitParts.length?' and split parts':''} · {decisions.length} recorded</summary>{splitParts.length>0&&<ol className="explorer-amendment-parts">{splitParts.map((part,index)=><SplitPart key={part.id||JSON.stringify([part.componentIndex??index,part.rawDescription??part.description??null])} part={part} item={item} language={language}/>)}</ol>}{whole.length>0&&<ul className="explorer-amendment-decisions">{whole.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language}/>)}</ul>}</details>:<p className="explorer-amendment-secondary">No outcome is recorded in the available sources.</p>}
    <details className="explorer-amendment-evidence"><summary>Sources and coverage{item.gaps?.length?' · '+item.gaps.length+' gaps':''}</summary><p className="explorer-amendment-reference">{item.id}</p>
      {item.identifierBasis==='derived-from-exact-target-and-number'&&<p>Dataset key derived from the exact target document and amendment number.</p>}
      {item.officialIds?.length?<p className="explorer-amendment-reference">Official references: {item.officialIds.join(', ')}</p>:null}
      {!item.conflicted&&<ComponentSources item={item} language={language}/>}
      {!item.conflicted&&<AuthorEvidence item={item} language={language}/>}
      <AmendmentSources sources={item.sources||[]} language={language}/>
      {item.procedureIds?.length?<p>Recorded procedure references: {item.procedureIds.map((reference,index)=><Fragment key={reference}>{index?', ':''}<span lang="">{reference}</span></Fragment>)}</p>:null}
      {item.splitCoverage?.length?<details><summary>Observed split-request coverage · {item.splitCoverage.length}</summary><ul>{item.splitCoverage.map((request,index)=><li key={request.registryRequestKey||request.requestId||index}>{request.requestId?<span lang="">{request.requestId}</span>:'Official request identifier unavailable'}: {request.componentCount??'unknown number of'} source components · {request.recordedComponentCount} recorded references · {request.boundComponentCount} verified bindings{request.complete?' · complete':' · incomplete'}</li>)}</ul><p>Unbound components from a source request are not assigned to this amendment.</p></details>:null}
      {item.topics?.length?<ul>{item.topics.map(topic=><li key={topic.id}><span lang={topic.language??''}>{topic.label}</span> <small>· {topic.basis==='dossier'?'dossier subject':'target provision'}</small></li>)}</ul>:null}
      {item.gaps?.length?<ul className="explorer-amendment-gap">{item.gaps.map((gap,index)=><li key={index}>{gapLabel(gap)}</li>)}</ul>:null}
      {!item.conflicted&&authors.some(author=>author.personId)&&<p className="explorer-amendment-secondary">Author links are derived from public names, dated mandates and voting identities where available.</p>}
    </details>
  </article>;
}
function ParsingFailures({language,total,unresolved,capacityReached}:{language:string;total?:number;unresolved?:number;capacityReached?:boolean}) {
  const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),summaryRef=useRef<HTMLElement>(null),limit=10;
  const state=useData<AmendmentFailurePage>(open?'amendments/failures?'+new URLSearchParams({lang:language,limit:String(limit),offset:String(offset)}):null);
  const atCapacity=Boolean(capacityReached||state.data?.capacityReached);
  function page(value:number){setOffset(value);summaryRef.current?.focus({preventScroll:true});}
  function retry(){summaryRef.current?.focus({preventScroll:true});state.retry();}
  return <details lang="en" className="explorer-amendment-failures" onToggle={event=>setOpen(event.currentTarget.open)}><summary ref={summaryRef} tabIndex={0}>Split descriptions needing parser updates{unresolved!==undefined?' · '+unresolved+' unresolved':''}{atCapacity?' · registry capacity reached':''}</summary>{atCapacity&&<p className="explorer-amendment-gap" role="status">Parser failure registry capacity reached. Some additional parser failures could not be retained.</p>}<p>Recorded across the amendment index. Original descriptions and parser errors are retained for future updates.{total!==undefined?' '+total+' failure records.':''}</p>{state.loading&&<p role="status">Loading recorded parser failures…</p>}{state.error&&<p role="alert">Could not load parser failures. <button onClick={retry}>Try again</button></p>}{state.data&&<>{!state.data.items.length?<p>{state.data.total?'No parser failures are shown on this page.':'No parser failures recorded.'}</p>:<ol className="explorer-amendment-failure-list">{state.data.items.map(failure=><li key={amendmentFailureKey(failure)}><strong>{amendmentFailureLabel(failure)}</strong>{failure.requestId?<p className="explorer-amendment-meta">Request: {failure.requestId}</p>:<p className="explorer-amendment-meta">Official request identifier unavailable.</p>}<SplitDescription description={failure.description} language={failure.language} rawDescription={failure.rawDescription} sourceDescriptions={failure.sourceDescriptions} code={failure.code}/><p>{failure.message||failure.reason||failure.code||'Description not recognised.'}</p><p className="explorer-amendment-meta">{joinMeta([failure.status,failure.parserVersion?'Parser '+failure.parserVersion:null,(failure.occurrences??failure.count)!==undefined?(failure.occurrences??failure.count)+' recorded occurrences':null,(failure.lastSeen||failure.lastOccurrence)?<>Last seen <LocalizedDate value={failure.lastSeen||failure.lastOccurrence} language={language}/></>:null])}</p>{publicAmendmentSource(failure.sourceUrl)&&<a href={publicAmendmentSource(failure.sourceUrl)!} target="_blank" rel="noreferrer">Official source ↗</a>}</li>)}</ol>}<nav className="explorer-amendment-pagination" aria-label="Parser failure pages"><button disabled={offset===0||state.loading} onClick={()=>page(Math.max(0,offset-limit))}>Previous</button><span aria-live="polite">{pageRange(offset,state.data.items.length,state.data.total,'0 records')}</span>{!state.data.items.length&&state.data.total>0&&offset>0&&<button onClick={()=>page(0)} disabled={state.loading}>Go to first page</button>}<button disabled={offset+limit>=state.data.total||state.loading} onClick={()=>page(offset+limit)}>Next</button></nav></>}</details>;
}
type AmendmentProps={language?:string;document?:string|null;procedure?:string|null;member?:string|number|null;outcome?:string;offset?:number;onOutcome?:(value:string)=>void;onOffset?:(value:number)=>void;onMember?:InsightProps['onMember'];heading?:ReactNode;showFailures?:boolean};
export function Amendments({language='en',document,procedure,member,outcome:controlledOutcome,offset:controlledOffset,onOutcome,onOffset,onMember,heading='Amendment trail',showFailures=true}:AmendmentProps) {
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
  return <section lang="en" className="explorer-amendments" aria-labelledby={headingId} aria-busy={state.loading}><div className="explorer-amendment-section-heading"><h2 id={headingId} ref={headingRef} tabIndex={-1}>{heading}</h2><button onClick={state.retry} disabled={state.loading}>Refresh</button></div><div className="explorer-amendment-controls"><label>Outcome<select value={outcome} onChange={event=>filter(event.target.value)}>{outcomes.map(value=><option key={value} value={value}>{value?amendmentOutcomeLabel(value):'Any outcome'}</option>)}</select></label><label>Group this page by<select value={groupBy} onChange={event=>setGroupBy(event.target.value)}><option value="dossier">Dossier / target document</option><option value="target">Target provision</option><option value="topic">Recorded topic</option></select></label></div>{groupBy!=='target'&&<p className="explorer-amendment-secondary">Each amendment appears once under its first recorded {groupBy==='topic'?'topic':'procedure reference, or its target document if no procedure is recorded'}. All recorded associations are listed in Sources and coverage.</p>}{state.loading&&!state.data&&<p role="status">Loading amendments…</p>}{state.error&&<div className="explorer-amendment-gap" role="alert"><p>Amendments could not be loaded. {state.error}</p><button onClick={state.retry}>Try again</button></div>}{state.data&&<><div className="explorer-amendment-coverage" role="status"><p><strong><span lang={language}>{state.data.total.toLocaleString(language)}</span> indexed {state.data.total===1?'amendment':'amendments'}</strong>{state.data.coverage.pending?' · indexing in progress':state.data.coverage.complete?'':' · partial coverage'}</p><p>This trail covers available plenary amendment documents and recorded decisions. Missing outcomes remain unavailable.{state.data.coverage.lastUpdated?<> Updated <LocalizedDate value={state.data.coverage.lastUpdated} language={language}/>.</>:''}</p>{Boolean(state.data.coverage.gaps?.length)&&<details><summary>Coverage gaps · {state.data.coverage.gaps!.length}</summary><ul>{state.data.coverage.gaps!.map((gap,index)=><li key={index}>{gapLabel(gap)}</li>)}</ul></details>}</div>{!state.data.items.length?<p className="explorer-amendment-empty">{state.data.total?'No amendments are shown on this page.':state.data.coverage.pending?'No matching amendments are indexed yet. The index is still being updated.':state.data.coverage.complete?'No indexed amendments match these filters.':'No indexed amendments match these filters. Coverage is incomplete.'}</p>:groups.map(group=><section className="explorer-amendment-group" key={group.id}><div className="explorer-amendment-group-heading"><h3><GroupLabel group={group} by={groupBy}/></h3><small>{groupBy==='dossier'&&group.items[0].procedureIds?.length?'First recorded procedure reference':groupBy==='topic'?'First recorded topic · '+group.basis:group.basis} · {group.items.length} on this page</small></div>{group.items.map(item=><AmendmentCard key={item.id} item={item} language={language} onMember={onMember}/>)}</section>)}<nav className="explorer-amendment-pagination" aria-label="Amendment pages"><button disabled={offset===0||state.loading} onClick={()=>page(Math.max(0,offset-limit))}>Previous</button><span aria-live="polite">{pageRange(offset,state.data.items.length,state.data.total,'0 amendments')}</span>{!state.data.items.length&&state.data.total>0&&offset>0&&<button onClick={()=>page(0)} disabled={state.loading}>Go to first page</button>}<button disabled={offset+state.data.items.length>=state.data.total||!state.data.items.length||state.loading} onClick={()=>page(offset+limit)}>Next</button></nav>{showFailures&&<ParsingFailures language={language} total={state.data.failures?.total} unresolved={state.data.failures?.unresolved} capacityReached={state.data.failures?.capacityReached}/>}</>}</section>;
}
export function AmendmentsPage(props:InsightProps) {
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
    <form lang="en" className="explorer-amendment-finder" onSubmit={event=>{
      event.preventDefault();setDocument(draft.document.trim());setProcedure(draft.procedure.trim());setMember(draft.member);setOffset(0);
    }}>
      <label>Dossier reference<input value={draft.procedure} onChange={event=>setDraft(value=>({...value,procedure:event.target.value}))} placeholder="2025/0407(COD)" autoComplete="off" spellCheck={false}/></label>
      <label>Target document<input value={draft.document} onChange={event=>setDraft(value=>({...value,document:event.target.value}))} placeholder="A-10-2026-0254" autoComplete="off" spellCheck={false}/></label>
      <label>MEP author<select value={draft.member} onChange={event=>setDraft(value=>({...value,member:event.target.value}))}>
        <option value="">{directory.loading&&!authors.length?'Loading authors…':'Any author'}</option>
        {draft.member&&!authors.some(person=>String(person.id)===draft.member)&&<option value={draft.member}>MEP {draft.member} · {directory.loading?'loading name…':'name unavailable'}</option>}
        {authors.map(person=><option lang="" key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
      </select></label>
      <button type="submit">Find amendments</button>
      {(document||procedure||member||outcome||offset>0)&&<button type="button" onClick={()=>{setDocument('');setProcedure('');setMember('');setOutcome('');setOffset(0);}}>Clear filters</button>}
    </form>
    <p lang="en" className="insight-secondary">The author picker lists the current MEP roster. Author filters match supported indexed MEP links, including source variants; unresolved names are not included.</p>
    {directory.error&&<p lang="en" className="insight-secondary">Author choices are temporarily unavailable. <button onClick={directory.retry}>Reload authors</button></p>}
    <Amendments language={language} document={document} procedure={procedure} member={member} outcome={outcome} offset={offset} onOutcome={setOutcome} onOffset={setOffset} onMember={props.onMember} heading={member?<>Amendments by <span lang="">{selectedAuthor?[selectedAuthor.firstName,selectedAuthor.lastName].join(' '):'MEP '+member}</span></>:procedure?<>Amendments for <span lang="">{procedure}</span></>:document?<>Amendments to <span lang="">{document}</span></>:'Latest indexed amendments'}/>
  </InsightShell>;
}
