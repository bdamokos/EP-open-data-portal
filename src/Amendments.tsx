import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
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
import {AmendmentJustification} from './components/AmendmentJustification';
import {AmendmentNamedVotes} from './AmendmentNamedVotes';
import {voteMethodLabel} from './voteMethod.mjs';
import {sourcePageUrl} from './SourceLink';
import FinalTextCheck from './FinalTextCheck';

const DocumentContextReader=lazy(()=>import('./DocumentContextReader').then(module=>({default:module.DocumentContextReader})));
import {amendmentLanguageScope} from './amendmentLanguageScope.mjs';

const outcomes=['','ADOPTED','REJECTED','LAPSED','WITHDRAWN','mixed','unavailable'] as const;
const dateLabel=(value:string|number|null|undefined,language:string)=>{
  const time=(typeof value==='number') ? value : ((typeof value==='string') ? Date.parse(value) : NaN);
  return Number.isFinite(time) ? new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(time)) : null;
};
function LocalizedDate({value,language}:{value?:string|number|null;language:string}) {
  const text=dateLabel(value,language);
  return text ? <time lang={language}>{text}</time> : null;
}
const joinMeta=(items:ReactNode[])=>items.filter(item=>item!==null&&item!==undefined&&item!==false&&item!=='').map((item,index)=><Fragment key={index}>{index ? ' · ' : ''}{item}</Fragment>);
const metadataLanguage=(item:AmendmentVariant)=>Object.hasOwn(item,'metadataSource') ? (item.metadataSource?.language??'') : (item.language??'');
const wordingLanguage=(item:AmendmentVariant)=>Object.hasOwn(item,'wordingSource') ? (item.wordingSource?.language??'') : (item.language??'');
const targetLabelLanguage=(item:AmendmentVariant)=>item.targetLabelLanguage??'';
function documentDateLabel(item:AmendmentVariant,language:string,legacySource=false, ui: import('./uiI18n.mjs').UiFormatter = defaultUi) {
  const documentaryDate=dateLabel(item.documentDate,language) ? item.documentDate : null;
  const listDate=((item.dateBasis==='amendment-list-document') && dateLabel(item.listDocumentDate,language)) ? item.listDocumentDate : null;
  const documentedBasis=['individual-amendment-document','amendment-list-document'].includes(item.dateBasis||'');
  const value=documentaryDate||listDate||((Object.hasOwn(item,'documentDate')||!documentedBasis&&!legacySource) ? null : item.date);
  const label=(('scope' in item) && (item.scope==='committee')) ? ui.t("dossieractivity.document_date") : ((item.dateBasis==='individual-amendment-document') ? ui.t("amendments.amendment_document_date.d36281") : ((item.dateBasis==='amendment-list-document') ? ui.t("amendments.amendment_list_document_date.d0ab39") : ui.t("dossieractivity.document_date")));
  return dateLabel(value,language) ? <><>{label} {<LocalizedDate value={value} language={language}/>}</></> : null;
}
const onBehalfLabel=(value:AmendmentVariant['onBehalfOf'])=>(Array.isArray(value) ? value.join(', ') : value)?.replace(/^on behalf of\s+/i,'');
const pageRange=(offset:number,count:number,total:number,emptyLabel:string,ui:import('./uiI18n.mjs').UiFormatter)=>(!count) ? (total ? ui.t('amendments.0_shown_of_total.64c9ad',{total}) : emptyLabel) : ui.t('textsearch.start_end_of_total.cc98d9',{start:offset+1,end:Math.min(offset+count,total),total});

function Outcome({value}:{value?:string|null}) {
  const ui = useUiI18n();
  return <span className="explorer-amendment-outcome" lang={ui.language} data-outcome={value||'unavailable'}>{amendmentOutcomeLabel(value, ui)}</span>;
}
function Decision({item,decision,language,compact=false,reader=false}:{item:Amendment;decision:AmendmentDecision;language:string;compact?:boolean;reader?:boolean}) {
  const ui = useUiI18n();
  const source=(decision.provenance==='unavailable') ? null : sourcePageUrl(publicAmendmentSource(decision.source));
  const totals=decision.totals,positions=[['for',ui.t("membervotespresentation.for")],['against',ui.t("membervotespresentation.against")],['abstaining',ui.t("membervotespresentation.abstained")]] as const;
  const hasTotals=totals&&positions.some(([key])=>typeof totals[key]==='number');
  const complete=totals&&positions.every(([key])=>typeof totals[key]==='number'),total=complete ? positions.reduce((sum,[key])=>sum+totals![key]!,0) : null;
  const unbound=['unverified','unresolved-collective'].includes(decision.componentBinding||'');
  return <li className="explorer-amendment-decision" lang={ui.language}>
    {(!compact||unbound||item.scope==='committee')&&<div className="explorer-amendment-decision-heading"><strong>{item.scope==='committee' ? ui.t((decision.stage||decision.scope)==='plenary'?'amendments.plenary_decision_amendmentdecisionscope.c358cd':'amendments.committee_decision_amendmentdecisionscope.2d7cc3',{scope:decision.componentBinding==='unverified'?ui.t('amendments.unverified_split_decision.8fdd97'):decision.componentBinding==='unresolved-collective'?ui.t('amendmentmodel.mjs.collective.decision'):amendmentDecisionScope(item,decision,ui)}) : (decision.componentBinding==='unverified' ? ui.t('amendments.unverified_split_decision.8fdd97') : decision.componentBinding==='unresolved-collective'?ui.t('amendmentmodel.mjs.collective.decision'):amendmentDecisionScope(item,decision,ui))}</strong><Outcome value={decision.outcome}/></div>}
    {hasTotals&&<>{complete&&total!>0&&<div className="amendment-vote-strip" aria-hidden="true">{positions.map(([key,label])=><span key={key} data-position={{for:'For',against:'Against',abstaining:'Abstained'}[key]} style={{flexGrow:totals![key]!}}/>)}</div>}<dl className="explorer-amendment-totals">{positions.map(([key,label])=><div key={key} data-position={{for:'For',against:'Against',abstaining:'Abstained'}[key]}><dt>{label}</dt><dd>{(totals?.[key]!=null) ? <span lang={language}>{totals[key]!.toLocaleString(language)}</span> : ui.t("grouplabels.ts.unavailable")}</dd></div>)}</dl></>}
    {(total!=null||voteMethodLabel(decision.method, ui))&&<p className="explorer-amendment-meta">{[(total!=null) ? ui.t("amendments.count_votes.ef5396", {count: String(total.toLocaleString(language))}) : '',voteMethodLabel(decision.method, ui)].filter(Boolean).join(' · ')}</p>}
    {(reader && (item.scope!=='committee')) ? (decision.date&&<p className="explorer-amendment-meta">{decision.sittingId?.startsWith('MTG-PL-') ? <UiMessage id="amendments.plenary_date.e709f6" values={{date:<LocalizedDate value={decision.date} language={language}/>}}/> : <LocalizedDate value={decision.date} language={language}/>}</p>) : <><>{(item.scope!=='committee'&&<AmendmentNamedVotes item={item} decision={decision} language={language}/>)} {<details className="explorer-amendment-decision-record"><summary><UiMessage id="batch5.amendments.tsx.64.1"/></summary><p>{decision.date&&<><UiMessage id="amendments.decision_date_date.cf3b23" values={{date: <LocalizedDate value={decision.date} language={language}/>}}/></>}</p>{source&&<a href={source} target="_blank" rel="noreferrer"><UiMessage id="batch5.amendments.tsx.64.2"/></a>}
      {(decision.collective||unbound||(decision.amendmentIds?.length||0)>1)&&Boolean(decision.amendmentIds?.length)&&<><p><UiMessage id="batch5.amendments.tsx.65.3"/></p><ul className="explorer-amendment-collective-references">{decision.amendmentIds!.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></>}
      {decision.componentReferences?.length ? <><p><UiMessage id="batch5.amendments.tsx.66.4"/></p><ul>{decision.componentReferences.map(reference=><li key={reference} lang="">{reference}</li>)}</ul></> : null}
    </details>}</></>}
  </li>;
}
function SplitDescription({description,language,sourceDescriptions,rawDescription,code}:{description?:string|null;language?:string|null;sourceDescriptions?:Record<string,string>;rawDescription?:string|null;code?:string|null}) {
  const ui = useUiI18n();
  if(description?.trim())return <blockquote lang={language??''}>{description}</blockquote>;
  const available=Object.entries(sourceDescriptions||{}).filter(([,text])=>typeof text==='string'&&text.trim());
  if(!available.length&&rawDescription?.trim())available.push([language??'',rawDescription]);
  return <div className="explorer-amendment-description-fallback" lang={ui.language}><>{<p className="explorer-amendment-secondary">{((code==='missing_language') && (language==='en')) ? <UiMessage id="amendments.english_split_description_unavailable.a55854"/> : <UiMessage id="amendments.readable_split_description_unavailable.405565"/>}</p>} {available.map(([sourceLanguage,text])=><div className="explorer-amendment-source-description" key={sourceLanguage}>
      {sourceLanguage&&sourceLanguage!=='und'&&<p className="explorer-amendment-meta"><span lang="">{sourceLanguage.toUpperCase()}</span></p>}
      <pre lang={sourceLanguage}>{text}</pre>
    </div>)}</></div>;
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
  const ui = useUiI18n();
  const item=group.items[0];
  if(by==='target')return <>{item.targetDocumentId&&<><span lang="">{item.targetDocumentId}</span> · </>}{item.targetLabel ? <span lang={targetLabelLanguage(item)}>{item.targetLabel}</span> : ui.t("amendmentmodel.mjs.target.provision.unavailable")}</>;
  if(by==='topic'){
    const topic=item.topics?.[0];
    if(!topic)return <><UiMessage id="amendmentmodel.mjs.topic.unavailable"/></>;
    return <>{topic.basis==='target'&&item.targetDocumentId&&<><span lang="">{item.targetDocumentId}</span> · </>}<span lang={topic.language??''}>{topic.label}</span></>;
  }
  const identifier=item.procedureIds?.[0]||item.targetDocumentId;
  return identifier ? <span lang="">{identifier}</span> : <><UiMessage id="amendmentmodel.mjs.dossier.unavailable"/></>;
}
function SplitPart({part,item,language,reader=false,availableDecisions=item.decisions||[]}:{part:AmendmentSplit;item:Amendment;language:string;reader?:boolean;availableDecisions?:AmendmentDecision[]}) {
  const ui = useUiI18n();
  const decisions=availableDecisions.filter(decision=>amendmentDecisionPart(item.splitParts||[],decision)?.id===part.id);
  const plan=amendmentPlanSummary(part.plan, ui),failed=Boolean(part.failure)||['failed','unparsed','unresolved','unsupported','failure','error'].includes(part.status||'');
  return <li className="explorer-amendment-part" lang={ui.language}><h5>{(part.number!=null) ? ui.t("membervotes.tsx.part.number", {number: String(part.number)}) : (part.id||ui.t("amendmentmodel.mjs.unidentified.split.component"))}</h5><SplitDescription description={part.description} language={part.language} rawDescription={part.rawDescription} sourceDescriptions={part.sourceDescriptions} code={(typeof part.failure==='object') ? part.failure?.code : null}/>{!failed&&plan.length>0&&<details className="explorer-amendment-selection"><summary><UiMessage id="batch5.amendments.tsx.116.5"/></summary><ul>{plan.map((line,index)=><li key={index}><PlanLine text={line} plan={part.plan} language={part.language}/></li>)}</ul></details>}{decisions.length ? <ul className="explorer-amendment-decisions">{decisions.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language} reader={reader}/>)}</ul> : ((reader && (item.decisions||[]).some(decision=>amendmentDecisionPart(item.splitParts||[],decision)?.id===part.id)) ? null : <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.116.6"/></p>)}</li>;
}
function AmendmentWording({item,reader=false}:{item:AmendmentVariant;reader?:boolean}) {
  const ui = useUiI18n();
  const withheld=item.textIntegrity==='incomplete';
  const readable=!withheld&&typeof item.originalText==='string'&&typeof item.proposedText==='string';
  if(reader){
    const scope=amendmentLanguageScope({...item,language:wordingLanguage(item)});
    return <><section className="dossier-proposed-text"><h5><UiMessage id="batch5.amendments.tsx.123.11"/></h5>{(withheld||item.proposedText==null) ? <p><UiMessage id="batch5.amendments.tsx.123.8"/></p> : (scope ? <><p><UiMessage id="batch5.amendments.tsx.123.10"/></p><p lang={scope.language}>{scope.note}</p></> : ((item.proposedText==='') ? <p><UiMessage id="batch5.amendments.tsx.123.9"/></p> : <p lang={wordingLanguage(item)}><FormattedWording text={item.proposedText} formatting={item.proposedFormatting}/></p>))}</section><details><summary><UiMessage id="batch5.amendments.tsx.123.7"/></summary><AmendmentWording item={{...item,justification:null}}/></details><AmendmentJustification record={item}/></>;
  }
  return <>{readable ? <WordingDiff originalFormatting={item.originalFormatting} proposedFormatting={item.proposedFormatting} original={item.originalText!} proposed={item.proposedText!} language={wordingLanguage(item)} emptySemantics="insertion-deletion"/> : <div className="explorer-amendment-texts" lang={ui.language}><>{<section><h5><UiMessage id="textsearch.original_text"/></h5>{withheld ? <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.126.14"/></p> : (((item.originalText!==null) && (item.originalText!==undefined)) ? ((item.originalText==='') ? <p><UiMessage id="batch5.amendments.tsx.126.13"/></p> : <p lang={wordingLanguage(item)}>{<FormattedWording text={item.originalText} formatting={item.originalFormatting}/>}</p>) : <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.126.14"/></p>)}</section>} {<section><h5><UiMessage id="batch5.amendments.tsx.123.11"/></h5>{withheld ? <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.126.14"/></p> : (((item.proposedText!==null) && (item.proposedText!==undefined)) ? ((item.proposedText==='') ? <p><UiMessage id="batch5.amendments.tsx.123.9"/></p> : <p lang={wordingLanguage(item)}>{<FormattedWording text={item.proposedText} formatting={item.proposedFormatting}/>}</p>) : <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.126.14"/></p>)}</section>}</></div>}<AmendmentJustification record={item}/></>;
}
function AmendmentEvidenceState({item}:{item:AmendmentVariant}) {
  const ui = useUiI18n();
  if(item.textIntegrity!=='incomplete')return null;
  return <p className="explorer-amendment-secondary explorer-amendment-evidence-state" lang={ui.language}><UiMessage id="batch5.amendments.tsx.123.8"/></p>;
}
function AmendmentSources({sources,language}:{sources:AmendmentSource[];language:string}) {
  const ui = useUiI18n();
  const available=sources.map(source=>({source,url:sourcePageUrl(publicAmendmentSource(source),{language:source.language||language})})).filter(entry=>entry.url);
  return available.length ? <ul lang={ui.language}>{available.map(({source,url},index)=><li key={url!+index}><>{<a href={url!} target="_blank" rel="noreferrer">{source.language ? <UiMessage id="amendments.document_language.aedd07" values={{language: source.language.toUpperCase()}}/> : <UiMessage id="amendments.document.fc29c3"/>}</a>} {(source.date&&<small> · {documentDateLabel(source,language,true, ui)}</small>)}</></li>)}</ul> : null;
}
function AmendmentAuthors({item,language,onMember,memberId}:{item:Amendment;language:string;onMember?:InsightProps['onMember'];memberId?:string}) {
  const ui = useUiI18n();
  const authors=item.authors||[],onBehalfOf=onBehalfLabel(item.onBehalfOf);
  if(item.conflicted)return null;
  if(!authors.length)return item.committeeProposer ? <div className="explorer-amendment-authors"><UiMessage id="amendments.tabled_by_proposer.0bb4e6" values={{proposer:<strong lang={item.proposerSource?.language??''}>{item.committeeProposer}</strong>}}/>{onBehalfOf&&<p>{(!/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(onBehalfOf) ? <UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group:<span lang="">{onBehalfOf}</span>}}/> : <span lang="">{onBehalfOf}</span>)}</p>}</div> : (onBehalfOf ? <p className="explorer-amendment-authors"><UiMessage id="amendments.tabled_on_behalf_of_onbehalfof.4943fa" values={{group: <span lang="">{onBehalfOf}</span>}}/></p> : <p className="explorer-amendment-secondary"><UiMessage id="batch5.amendments.tsx.144.15"/></p>);
  const selected=memberId ? authors.find(author=>String(author.personId)===memberId) : null;
  if(selected){
    const others=authors.filter(author=>String(author.personId)!==memberId),resolved=others.every(author=>author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
    return <div className="dossier-proposers"><p><UiMessage id={(!others.length) ? 'amendments.name_proposed_this.618f5f' : (resolved ? 'amendments.name_proposed_this_with_count_other_meps.6c177a' : 'amendments.name_proposed_this_with_count_other_proposers.aded25')} values={{name:<PersonName id={memberId} label={selected.displayName||selected.name}/>,count:others.length}}/></p>{onBehalfOf&&<p className="dossier-muted"><UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group: <span lang="">{onBehalfOf}</span>}}/></p>}{others.length>0&&<details><summary><UiMessage id="batch5.amendments.tsx.148.16"/></summary><AmendmentAuthors item={{...item,authors:others,onBehalfOf:null}} language={language} onMember={onMember}/></details>}</div>;
  }
  return <div className="explorer-amendment-authors"><UiMessage id="amendments.tabled_by_authors.b76b76" values={{authors:<>{authors.map((author,index)=>{
    const linked=Boolean(author.personId&&/^[1-9]\d*$/.test(String(author.personId)));
    const note=({missing_date:ui.t("amendments.document_date_unavailable.60d90d"),missing_mandate:ui.t("amendments.mandate_evidence_unavailable.683af1"),inactive:ui.t("amendments.no_active_mandate_match.77b42f"),ambiguous:ui.t("amendments.multiple_possible_meps.dff53a")} as Record<string,string>)[author.status||'']||ui.t("amendments.mep_link_unresolved.061368");
    return <span key={String(author.personId||author.name)+':'+index}>{(index>0) ? ', ' : ''}{linked ? <a href={insightMemberHref(String(author.personId),language)} onClick={onMember ? (event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
      event.preventDefault();onMember(Number(author.personId));
    }) : undefined}><span lang="" title={author.name}><PersonName id={author.personId} label={author.displayName||author.name}/></span></a> : <><span lang="">{author.name}</span>{item.scope!=='committee'&&<small> ({note})</small>}</>}<RecordMemberAffiliation id={author.personId} language={language}/></span>;
  })}</>}}/>{item.committeeProposer&&<p><UiMessage id="amendments.committee_proposer_committeeproposer.3c4d9e" values={{proposer: <span lang={item.proposerSource?.language??''}>{item.committeeProposer}</span>}}/></p>}{onBehalfOf&&<p>{(!/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(onBehalfOf) ? <UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group:<span lang="">{onBehalfOf}</span>}}/> : <span lang="">{onBehalfOf}</span>)}</p>}</div>;
}
function SourceVariants({item,language,reader=false}:{item:Amendment;language:string;reader?:boolean}) {
  const ui = useUiI18n();
  if(!item.conflicted&&!item.variants?.length)return null;
  return <div className={item.conflicted ? 'explorer-amendment-conflict' : 'explorer-amendment-source-variants'}><>{(item.conflicted&&<p><strong><UiMessage id="amendments.conflicting_source_versions.d50beb"/></strong> <UiMessage id="amendments.wording_and_proposers_unavailable.59e721"/></p>)} {(item.variants?.length ? <details className="explorer-amendment-variants"><summary><UiMessage id="amendments.source_versions_count.f53666" values={{count: item.variants.length}}/></summary>{item.variants.map((variant,index)=><section className="explorer-amendment-variant" key={(variant.listId||'variant')+index}>
      <h5>{variant.listId ? <UiMessage id="amendments.version_number_listid.b15c3d" values={{number: (index+1), listId: String(variant.listId ?? '')}}/> : <UiMessage id="membervotes.tsx.version.number" values={{number: (index+1)}}/>}</h5>
      <AmendmentEvidenceState item={variant}/>
      <p className="explorer-amendment-meta">{joinMeta([documentDateLabel(variant,language,true, ui),variant.language ? <><span lang="">{variant.language.toUpperCase()}</span></> : null])}</p>
      {variant.targetLabel&&<p lang={targetLabelLanguage(variant)}>{variant.targetLabel}</p>}
      {variant.authors?.length ? <p><UiMessage id="amendments.tabled_by_authors.b76b76" values={{authors: variant.authors.map((author,index)=><Fragment key={index}>{index ? ', ' : ''}<span lang="">{author.name}</span></Fragment>)}}/></p> : null}
      {variant.committeeProposer&&<p><UiMessage id="amendments.committee_committeeproposer.2bd2d3" values={{proposer: <span lang={variant.proposerSource?.language??''}>{variant.committeeProposer}</span>}}/></p>}
      {onBehalfLabel(variant.onBehalfOf)&&<p><UiMessage id="batch4.speechinterventions.tsx.on.behalf.of.group" values={{group: <span lang="">{onBehalfLabel(variant.onBehalfOf)}</span>}}/></p>}
      <AmendmentWording item={variant}/>{!reader&&<AmendmentSources sources={variant.sources||[]} language={language}/>}
    </section>)}</details> : null)}</></div>;
}
export function AmendmentCard({item,language,onMember,showOutcome=true,memberId,reader=false,readerDecisions,children}:{item:Amendment;language:string;onMember?:InsightProps['onMember'];showOutcome?:boolean;memberId?:string;reader?:boolean;readerDecisions?:AmendmentDecision[];children?:ReactNode}) {
  const ui = useUiI18n();
  const splitParts=[...(item.splitParts||[])].sort((a,b)=>(Number.isFinite(Number(a.number)) && Number.isFinite(Number(b.number))) ? (Number(a.number)-Number(b.number)) : 0),decisions=readerDecisions??item.decisions??[],whole=decisions.filter(decision=>!amendmentDecisionPart(splitParts,decision));
  const committee=item.scope==='committee',selection=amendmentContextSelection(item);
  const [contextOpen,setContextOpen]=useDossierReaderState('amendment-context:'+item.id,false),contextSummary=useRef<HTMLElement>(null);
  const title=selectLanguageText(item.titles,language,item.title||'','');
  return <article lang={ui.language} className="explorer-amendment-card" id={'amendment-'+item.id} data-amendment-scope={item.scope||'plenary'}>
    {committee&&<p className="explorer-amendment-stage">{(item.contributionKind==='draft-report') ? ui.t("legislation.draft_report.b4f899") : ((item.contributionKind==='draft-opinion') ? ui.t("legislation.draft_opinion.ed1618") : ui.t("amendments.committee_amendment.f106ba"))}{item.committees?.map(c=><Fragment key={c.code}> · <span lang="" title={c.name||undefined}>{c.code}</span></Fragment>)}{item.contributionKind==='tabled-amendment'&&item.committeeDocumentKind&&<> · {(item.committeeDocumentKind==='draft-report') ? ui.t("legislation.draft_report.b4f899") : ui.t("legislation.draft_opinion.ed1618")}</>}</p>}
    <header><span className="explorer-amendment-number" aria-hidden="true">{item.number??'?'}</span><div><h4><span className="visually-hidden"><UiMessage id="amendments.amendment_number.2d4119" values={{number: item.number}}/></span><span className="explorer-amendment-target" lang={item.targetLabel ? targetLabelLanguage(item) : 'en'}>{item.targetLabel||ui.t("amendmentmodel.mjs.target.provision.unavailable")}</span></h4></div>{showOutcome&&(!committee||decisions.length>0)&&<Outcome value={item.outcome}/>}</header>
    {committee&&<p className="explorer-amendment-meta">{joinMeta([documentDateLabel(item,language, undefined, ui),(item.proposerDate && (item.proposerDateBasis==='tabling')) ? <><UiMessage id="dossieractivity.tabled_date" values={{date: <LocalizedDate value={item.proposerDate} language={language}/>}}/></> : null])}</p>}
    {(!reader||item.conflicted)&&<SourceVariants item={item} language={language} reader={reader}/>}
    <AmendmentAuthors item={item} language={language} onMember={onMember} memberId={memberId}/>
    {reader&&<>{children}{!item.conflicted&&<section className="dossier-amendment-wording"><AmendmentWording item={item} reader/></section>}</>}
    {(decisions.length>0||splitParts.length>0) ? <div className="explorer-amendment-voting">{splitParts.length>0&&<ol className="explorer-amendment-parts">{splitParts.map((part,index)=><SplitPart key={part.id||JSON.stringify([part.componentIndex??index,part.rawDescription??part.description??null])} part={part} item={item} language={language} reader={reader} availableDecisions={decisions}/>)}</ol>}{whole.length>0&&<ul className="explorer-amendment-decisions">{whole.map(decision=><Decision key={amendmentDecisionKey(decision)} item={item} decision={decision} language={language} compact={!reader&&decisions.length===1&&!splitParts.length} reader={reader}/>)}</ul>}</div> : (((!reader) && (!committee)) ? <p className="explorer-amendment-secondary"><UiMessage id="amendments.outcome_unavailable.9323fe"/></p> : null)}
    {!reader&&!item.conflicted&&<details className="explorer-amendment-wording"><summary><UiMessage id="batch5.amendments.tsx.187.19"/></summary><AmendmentWording item={item}/></details>}
    {selection&&(!reader||committee)&&<details className="explorer-amendment-context" open={contextOpen} onToggle={event=>setContextOpen(event.currentTarget.open)}><summary ref={contextSummary}><UiMessage id="membervotes.tsx.read.in.context"/></summary>{contextOpen&&<Suspense fallback={<p role="status"><UiMessage id="batch5.amendments.tsx.188.20"/></p>}><DocumentContextReader language={language} request={{...selection,onBack:()=>{setContextOpen(false);contextSummary.current?.focus({preventScroll:true});}}}/></Suspense>}</details>}
    {committee&&selection?.amendmentId&&selection.listId&&<FinalTextCheck documentId={selection.documentId} amendmentId={selection.amendmentId} listId={selection.listId} wordingLanguage={selection.wordingLanguage??null} language={language}/>}
    {(!reader||committee)&&<details className="explorer-amendment-evidence"><summary>{!committee&&item.gaps?.length?<UiMessage id="amendments.sources_count_gaps.2b2613" values={{count:item.gaps.length}}/>:<UiMessage id="amendments.sources.2eb56b"/>}</summary><AmendmentEvidenceState item={item}/>{item.title&&<p className="explorer-amendment-title" lang={(title.text===item.title) ? title.language : ''}>{title.text}</p>}{!committee&&<p className="explorer-amendment-reference">{item.id}</p>}<p className="explorer-amendment-meta">{joinMeta([documentDateLabel(item,language, undefined, ui),metadataLanguage(item) ? metadataLanguage(item).toUpperCase() : null])}</p>
      {item.officialIds?.length ? <p className="explorer-amendment-reference"><UiMessage id="amendments.official_references_references.3f6cd6" values={{references: item.officialIds.join(', ')}}/></p> : null}
      <AmendmentSources sources={item.sources||[]} language={language}/>
      {((item.scope!=='committee') && item.procedureIds?.length) ? <p><UiMessage id="amendments.procedures_references.54e0fa" values={{references: item.procedureIds.map((reference,index)=><Fragment key={reference}>{index ? ', ' : ''}<span lang="">{reference}</span></Fragment>)}}/></p> : null}
      {item.topics?.length ? <ul>{item.topics.map(topic=><li key={topic.id}><>{<span lang={topic.language??''}>{topic.label}</span>} {<small>· {(topic.basis==='dossier') ? ui.t("amendments.dossier_subject.d03afd") : ui.t("amendments.target_provision.5a9506")}</small>}</></li>)}</ul> : null}
    </details>}
  </article>;
}
type AmendmentProps={language?:string;scope?:'committee'|'plenary';list?:string|null;committee?:string|null;onCommittee?:(value:string)=>void;document?:string|null;procedure?:string|null;member?:string|number|null;outcome?:string;offset?:number;onOutcome?:(value:string)=>void;onOffset?:(value:number)=>void;onMember?:InsightProps['onMember'];heading?:ReactNode};
export function Amendments({language='en',scope,list,committee:controlledCommittee,onCommittee,document,procedure,member,outcome:controlledOutcome,offset:controlledOffset,onOutcome,onOffset,onMember,heading: headingProp}:AmendmentProps) {
  const ui = useUiI18n();
const heading = headingProp ?? ui.t("amendments.amendment_trail.83497e");

  const [localCommittee,setLocalCommittee]=useState('');
  const committee=controlledCommittee??localCommittee;
  const [localOutcome,setLocalOutcome]=useState(''),[localOffset,setLocalOffset]=useState(0),[groupBy,setGroupBy]=useState('dossier');
  const outcome=controlledOutcome??localOutcome,offset=controlledOffset??localOffset,limit=20,headingId=useId(),headingRef=useRef<HTMLHeadingElement>(null);
  const state=useData<AmendmentPage>(amendmentRoute({scope,list,committee,document,procedure,member,outcome,offset,limit,language}));
  const committees=[...new Set([...(committee ? ([committee]) : ([])),...(state.data?.items||[]).flatMap(item=>item.committees?.map(c=>c.code)||[])])].filter(validCommitteeCode).sort();
  const groups=useMemo(()=>amendmentGroups(state.data?.items||[],groupBy, ui),[state.data,groupBy]);
  useEffect(()=>{
    if(!state.data?.coverage.pending)return;
    const timer=window.setInterval(state.retry,10_000);
    return ()=>window.clearInterval(timer);
  },[state.data?.coverage.pending,state.retry]);
  useEffect(()=>{if(controlledOffset===undefined)setLocalOffset(0);},[scope,list,committee,document,procedure,member,language,controlledOffset]);
  function page(value:number){onOffset ? onOffset(value) : setLocalOffset(value);headingRef.current?.focus({preventScroll:true});headingRef.current?.scrollIntoView({block:'start',behavior:'instant'});}
  function filter(value:string){onOutcome ? onOutcome(value) : setLocalOutcome(value);onOffset ? onOffset(0) : setLocalOffset(0);}
  return <section lang={ui.language} className="explorer-amendments" aria-labelledby={headingId} aria-busy={state.loading}><div className="explorer-amendment-section-heading"><h2 id={headingId} ref={headingRef} tabIndex={-1}>{heading}</h2><button onClick={state.retry} disabled={state.loading}><UiMessage id="batch5.amendments.tsx.216.27"/></button></div><div className="explorer-amendment-controls">{scope==='committee'&&(committees.length>1||committee)&&<label><UiMessage id="dossieractivity.committee"/><select value={committee} onChange={event=>{onCommittee ? onCommittee(event.target.value) : setLocalCommittee(event.target.value);onOffset ? onOffset(0) : setLocalOffset(0);}}><option value=""><UiMessage id="dossieractivity.all_committees"/></option>{committees.map(code=><option key={code} value={code}>{code}</option>)}</select></label>}<label><UiMessage id="batch5.amendments.tsx.216.31"/><select value={outcome} onChange={event=>filter(event.target.value)}>{outcomes.map(value=><option key={value} value={value}>{value ? amendmentOutcomeLabel(value, ui) : ui.t("amendments.any_outcome.e39a36")}</option>)}</select></label><label><UiMessage id="batch5.amendments.tsx.216.34"/><select value={groupBy} onChange={event=>setGroupBy(event.target.value)}><option value="dossier"><UiMessage id="batch5.amendments.tsx.216.26"/></option><option value="target"><UiMessage id="amendmentmodel.mjs.target.provision"/></option><option value="topic"><UiMessage id="batch5.amendments.tsx.216.32"/></option></select></label></div>{state.loading&&!state.data&&<p role="status"><UiMessage id="legislation.loading_amendments.0d4c10"/></p>}{state.error&&<div className="explorer-amendment-gap" role="alert"><p><UiMessage id="dossieractivity.could_not_load_amendments"/></p><button onClick={state.retry}><UiMessage id="commissionfollowups.try_again"/></button></div>}{state.data&&<><div className="explorer-amendment-coverage" role="status"><p><UiMessage id={state.data.coverage.pending?'amendments.total_amendments_checking_for_amendments.f0602d':state.data.coverage.complete?'amendments.total_amendments.162421':'amendments.total_amendments_partial_coverage.9ca533'} values={{total:<strong><span lang={language}>{state.data.total.toLocaleString(language)}</span></strong>}} counts={{total:state.data.total}}/></p></div>{(!state.data.items.length) ? <p className="explorer-amendment-empty">{state.data.total ? ui.t("amendments.no_amendments_on_this_page.3a7234") : (state.data.coverage.complete ? ui.t("dossieractivity.no_matching_amendments") : ui.t("amendments.amendments_unavailable.f6c5b9"))}</p> : groups.map(group=><section className="explorer-amendment-group" key={group.id}><div className="explorer-amendment-group-heading"><h3><GroupLabel group={group} by={groupBy}/></h3><small><UiMessage id="amendments.count_on_this_page.a4539b" values={{count: group.items.length}}/></small></div>{group.items.map(item=><AmendmentCard key={item.id} item={item} language={language} onMember={onMember}/>)}</section>)}<nav className="explorer-amendment-pagination" aria-label={ui.t("batch5.amendments.tsx.216.36")}><button disabled={offset===0||state.loading} onClick={()=>page(Math.max(0,offset-limit))}><UiMessage id="textsearch.previous"/></button><span aria-live="polite">{pageRange(offset,state.data.items.length,state.data.total,ui.t("amendments.0_amendments.5b3050"),ui)}</span>{!state.data.items.length&&state.data.total>0&&offset>0&&<button onClick={()=>page(0)} disabled={state.loading}><UiMessage id="batch5.amendments.tsx.216.25"/></button>}<button disabled={offset+state.data.items.length>=state.data.total||!state.data.items.length||state.loading} onClick={()=>page(offset+limit)}><UiMessage id="textsearch.next"/></button></nav></>}</section>;
}
export function AmendmentsPage(props:InsightProps) {
  const ui = useUiI18n();
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
  return <InsightShell {...props} view="amendments" title={ui.t("legislation.amendments.900866")} description={ui.t("batch5.amendments.tsx.232.39")}>
    <form lang={ui.language} className="explorer-amendment-finder" onSubmit={event=>{
      event.preventDefault();setDocument(draft.document.trim());setProcedure(draft.procedure.trim());setMember(draft.member);setList((scope==='committee') ? draft.list.trim() : '');setOffset(0);
    }}>
      <label><UiMessage id="dossieractivity.stage"/><select value={scope} onChange={event=>{setScope(event.target.value as typeof scope);setDocument('');setList('');setCommittee('');setOffset(0);setOutcome('');}}><option value="plenary"><UiMessage id="dossieractivity.plenary"/></option><option value="committee"><UiMessage id="dossieractivity.committee"/></option></select></label>
      {scope==='committee'&&<label><UiMessage id="dossierCard.event.4"/><input value={draft.list} onChange={event=>setDraft(value=>({...value,list:event.target.value}))} placeholder="AGRI-AM-773343" autoComplete="off" spellCheck={false}/></label>}
      <label><UiMessage id="batch5.amendments.tsx.238.43"/><input value={draft.procedure} onChange={event=>setDraft(value=>({...value,procedure:event.target.value}))} placeholder="2025/0407(COD)" autoComplete="off" spellCheck={false}/></label>
      <label><UiMessage id="amendmentmodel.mjs.target.document"/><input value={draft.document} onChange={event=>setDraft(value=>({...value,document:event.target.value}))} placeholder={(scope==='committee') ? 'AGRI-PR-773115' : 'A-10-2026-0254'} autoComplete="off" spellCheck={false}/></label>
      <label><UiMessage id="batch5.amendments.tsx.240.44"/><select value={draft.member} onChange={event=>setDraft(value=>({...value,member:event.target.value}))}>
        <option value="">{(directory.loading && (!authors.length)) ? <UiMessage id="amendments.loading_authors.c87f57"/> : <UiMessage id="amendments.any_author.310e5a"/>}</option>
        {draft.member&&!authors.some(person=>String(person.id)===draft.member)&&<option value={draft.member}>{directory.loading ? <UiMessage id="amendments.mep_member_loading_name.d3a9e1" values={{member: String(draft.member ?? '')}}/> : <UiMessage id="amendments.mep_member_name_unavailable.f5ff8c" values={{member: String(draft.member ?? '')}}/>}</option>}
        {authors.map(person=><option lang="" key={person.id} value={person.id}><>{person.firstName} {person.lastName}</></option>)}
      </select></label>
      <button type="submit"><UiMessage id="batch5.amendments.tsx.245.45"/></button>
      {(document||procedure||member||outcome||list||committee||scope!=='plenary'||offset>0)&&<button type="button" onClick={()=>{setDocument('');setProcedure('');setMember('');setOutcome('');setScope('plenary');setList('');setCommittee('');setOffset(0);}}><UiMessage id="batch5.amendments.tsx.246.46"/></button>}
    </form>
    {directory.error&&<p lang={ui.language} className="insight-secondary"><UiMessage id="batch5.amendments.tsx.248.47"/> <button onClick={directory.retry}><UiMessage id="batch5.amendments.tsx.248.48"/></button></p>}
    <Amendments language={language} scope={scope} list={list} committee={committee} onCommittee={setCommittee} document={document} procedure={procedure} member={member} outcome={outcome} offset={offset} onOutcome={setOutcome} onOffset={setOffset} onMember={props.onMember} heading={member ? <><UiMessage id="amendments.amendments_by_items.300185" values={{name: <span lang="">{selectedAuthor ? [selectedAuthor.firstName,selectedAuthor.lastName].join(' ') : ui.t("amendments.mep_member.722ac9", {member: String(member)})}</span>}}/></> : (procedure ? <><UiMessage id="amendments.amendments_for_procedure.3b038c" values={{procedure: <span lang="">{procedure}</span>}}/></> : (document ? <><UiMessage id="amendments.amendments_to_document.41bde3" values={{document: <span lang="">{document}</span>}}/></> : ui.t("amendments.latest_amendments.30edb8")))}/>
  </InsightShell>;
}
