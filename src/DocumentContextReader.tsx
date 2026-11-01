import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {DocumentObjectText} from './DocumentObjectText';
import {type DocumentImageReference} from './DocumentImage';
import {DocumentPages} from './DocumentPages';
import {selectLanguageText} from './language.mjs';
import {TextLanguagePicker,TextLanguageFallback} from './TextLanguagePicker';
import {Fragment,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {useData} from './data';
import {CommissionFollowups} from './CommissionFollowups';
import type {DocumentContextRequest,DocumentContextResponse} from './DocumentContextTypes';
import type {PublicationDocument,NoteAnchor,DocumentLink} from './explorerTypes';
import {publicationBody,publicationHasMissingContent,publicationCoverLogo} from './publication-body.mjs';
import {reportAmendmentHeading} from './reportAmendmentHeading.mjs';
import {displayVoteTitle} from './memberVotesPresentation.mjs';
import {DocumentNotes,ReferenceScope,ReferenceText,readerTexts} from './References';
import {InsightQuestionReader} from './InsightReaders';
import {mapContextAnnotations} from './contextAnnotations.mjs';
import {WordingDiff} from './components/WordingDiff';
import {AmendmentJustification} from './components/AmendmentJustification';
import {amendmentLanguageScope} from './amendmentLanguageScope.mjs';
import {FindInText} from './TextSearch';
import {ProposalContextText,proposalPlacementReasons, proposalPlacementReasonsUi} from './ProposalContextText';
import {DocumentParagraphs,usableFormatting,type FormatMark} from './DocumentFormatting';
import './DocumentContextReader.css';

export type DocumentContextReaderProps={
  request:DocumentContextRequest;
  language:string;
  showOriginalLink?:boolean;
  showBackButton?:boolean;
  selectedDocumentId?:string|null;
  onSelectedDocumentIdChange?:(id:string|null)=>void;
};

type InlineObject={paragraph:number;offset:number;kind:string;status:string;image?:DocumentImageReference};
type DocumentText=NonNullable<PublicationDocument['selectedText']>&{documentObjects?:InlineObject[]};
type Title={text:string;language:string};
const safeHref=(value:string|null|undefined)=>{try{const url=new URL(value||'');return ((['https:','http:'].includes(url.protocol) && (!url.username)) && (!url.password)) ? url.href : null;}catch{return null;}};
const languageName=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const titleOf=(document:Pick<PublicationDocument,'titles'>,language:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi):Title=>{
  const title=selectLanguageText(document.titles,language,ui.t("batch6.documentcontextreader.document.text.37"), ui.messageLocale("batch6.documentcontextreader.document.text.37"));
  return {...title,text:displayVoteTitle(title.text)};
};
const documentKind=(id:string, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>id.startsWith('TA-') ? ui.t("batch6.documentcontextreader.adopted.text.40") : (id.includes('-PR-') ? ui.t("legislation.draft_report.b4f899") : (id.includes('-PA-') ? ui.t("legislation.draft_opinion.ed1618") : (id.includes('-AM-') ? ui.t("legislation.committee_amendments.bf18f4") : (id.startsWith('RC-') ? ui.t("batch6.documentcontextreader.joint.motion.40") : (id.startsWith('B-') ? ui.t("batch6.documentcontextreader.motion.40") : ui.t("batch6.documentcontextreader.report.40"))))));
const documentRoute=(id:string,language:string,request?:DocumentContextRequest)=>{
  const query=new URLSearchParams({lang:language});
  if(request?.amendmentId)query.set('amendment',request.amendmentId);
  if(request?.scope==='committee')query.set('scope','committee');
  if(request?.amendmentId&&request.listId)query.set('list',request.listId);
  if(request?.amendmentId&&request.listId&&request.wordingLanguage!==undefined)query.set('wording-lang',request.wordingLanguage??'unknown');
  return 'document-context/'+encodeURIComponent(id)+'?'+query;
};
const responseFor=(data:DocumentContextResponse|null,id:string,language:string,request?:DocumentContextRequest)=>(((data?.documentId===id) && (data.requestedLanguage===language)) && (request?.wordingLanguage===undefined||data.requestedWordingLanguage===request.wordingLanguage)) ? data : null;

const placementReasons:Record<string,string>={
  ...proposalPlacementReasons,
  rejects_proposal:'Rejects the proposal',
  rejects_council_position:'Rejects the Council position',
  resolution_extent_uncertain:'The boundaries of this passage could not be determined.',
  resolution_end_unavailable:'The end of the resolution could not be determined.',
  baseline_unavailable:'The text this amendment changes is not included in this document.',
  conflicting_baselines:'Conflicting comparison texts.',
  different_text_languages:'The document and amendment wording are in different languages.',
  duplicate_target_label:'A provision with the proposed label already exists.',
  conflicting_target_evidence:'The published location and wording do not agree.',
  insertion_reference_unavailable:'The insertion location is not specified clearly enough.',
  relative_target_not_found:'The preceding provision could not be found.',
  multiple_published_targets:'The published location matches more than one passage.',
  multiple_quoted_targets:'The quoted wording appears more than once.',
  target_not_found:'The passage this amendment changes could not be found.',
  source_passage_incomplete:'The source passage is incomplete.',
  source_structure_unavailable:'The document structure is unavailable.',
  matching_budget:'The amendment’s location could not be determined.',
  amendment_wording_unavailable:'The amendment wording is unavailable.',
};
export const placementReasonsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof placementReasons => ({
  ...proposalPlacementReasonsUi(ui),
  rejects_proposal:ui.t("amendment.rejects_proposal"),
  rejects_council_position:ui.t("amendment.rejects_council_position"),
  resolution_extent_uncertain:ui.t("batch6.documentcontextreader.the.boundaries.of.this.passage.could.not.be.determined.53"),
  resolution_end_unavailable:ui.t("batch6.documentcontextreader.the.end.of.the.resolution.could.not.be.determined.54"),
  baseline_unavailable:ui.t("batch6.documentcontextreader.the.text.this.amendment.changes.is.not.included.in.this.document.55"),
  conflicting_baselines:ui.t("batch6.documentcontextreader.conflicting.comparison.texts.56"),
  different_text_languages:ui.t("batch6.documentcontextreader.the.document.and.amendment.wording.are.in.different.languages.57"),
  duplicate_target_label:ui.t("batch6.documentcontextreader.a.provision.with.the.proposed.label.already.exists.58"),
  conflicting_target_evidence:ui.t("batch6.documentcontextreader.the.published.location.and.wording.do.not.agree.59"),
  insertion_reference_unavailable:ui.t("batch6.documentcontextreader.the.insertion.location.is.not.specified.clearly.enough.60"),
  relative_target_not_found:ui.t("batch6.documentcontextreader.the.preceding.provision.could.not.be.found.61"),
  multiple_published_targets:ui.t("batch6.documentcontextreader.the.published.location.matches.more.than.one.passage.62"),
  multiple_quoted_targets:ui.t("batch6.documentcontextreader.the.quoted.wording.appears.more.than.once.63"),
  target_not_found:ui.t("batch6.documentcontextreader.the.passage.this.amendment.changes.could.not.be.found.64"),
  source_passage_incomplete:ui.t("batch6.documentcontextreader.the.source.passage.is.incomplete.65"),
  source_structure_unavailable:ui.t("batch6.documentcontextreader.the.document.structure.is.unavailable.66"),
  matching_budget:ui.t("batch6.documentcontextreader.the.amendment.s.location.could.not.be.determined.67"),
  amendment_wording_unavailable:ui.t("batch6.documentcontextreader.the.amendment.wording.is.unavailable.68"),
});

const amendmentNumber=(id:string|undefined)=>id?.match(/(?:-AM-|:)(\d+[a-z]*)$/i)?.[1].replace(/^0+(?=\d)/,'')||null;


function DocumentBody({id,language,interfaceLanguage,onLanguageChange,amendmentRequest,showOriginalLink=true}:{id:string;showOriginalLink?:boolean;language:string;interfaceLanguage:string;onLanguageChange:(language:string)=>void;amendmentRequest?:DocumentContextRequest}) {
  const ui = useUiI18n();
  const state=useData<DocumentContextResponse>(documentRoute(id,language,amendmentRequest));
  const data=responseFor(state.data,id,language,amendmentRequest),document=((data?.document?.id===id) && (!data.document.selectedDocumentId||data.document.selectedDocumentId===id)) ? data.document : null;
  const text:DocumentText|undefined=document?.selectedText,reader=useRef<HTMLDivElement>(null),notePrefix='context-notes-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const target=data?.target,allParagraphs=text?.paragraphs||[],indices=target?.paragraphs||[];
  const wordingPinned=amendmentRequest?.wordingLanguage!==undefined;
  const fallback=data?.wordingLanguageFallback;
  const fallbackMatches=Boolean(fallback&&fallback.listId===amendmentRequest?.listId&&fallback.requestedLanguage===amendmentRequest?.wordingLanguage&&
    text?.availableTextLanguages?.length&&!text.availableTextLanguages.includes(fallback.requestedLanguage)&&text.availableTextLanguages.includes(fallback.language)&&text.textLanguage===fallback.language);
  const selectedWordingLanguage=fallbackMatches ? fallback!.language : amendmentRequest?.wordingLanguage;
  const pinnedVariants=wordingPinned ? (data?.amendment?.variants.filter(variant=>variant.listId===amendmentRequest?.listId&&variant.language===selectedWordingLanguage)||[]) : ([]);
  const evidence=target?.evidence;
  const pinnedTargetMatches=Boolean(amendmentRequest?.listId&&typeof amendmentRequest.wordingLanguage==='string'&&pinnedVariants.length===1&&pinnedVariants[0].wordingStatus==='available'&&
    evidence?.amendmentId===amendmentRequest.amendmentId&&evidence?.listId===amendmentRequest.listId&&evidence?.wordingLanguage===selectedWordingLanguage&&text?.textLanguage===selectedWordingLanguage);
  const variantLists=new Set(data?.amendment?.variants.map(variant=>variant.listId));
  const variants=(data?.amendment?.id===amendmentRequest?.amendmentId) ? (data?.amendment?.variants.filter(variant=>(!amendmentRequest?.listId||variant.listId===amendmentRequest.listId)&&
    (wordingPinned ? (variant.language===selectedWordingLanguage) : (((variantLists.size===1) && evidence) ? (variant.language===evidence.wordingLanguage) : true)))||[]) : ([]);
  const amendmentMatches=amendmentRequest?.amendmentId&&data?.amendment?.id===amendmentRequest.amendmentId&&(wordingPinned ? pinnedTargetMatches : (evidence ? (variants.length===1&&variants[0].wordingStatus==='available'&&
    evidence.amendmentId===amendmentRequest.amendmentId&&evidence.listId===variants[0].listId&&evidence.wordingLanguage===variants[0].language&&text?.textLanguage===variants[0].language) : (data.amendment.status==='available'&&(!amendmentRequest.listId||data.amendment.variants.length===1&&data.amendment.variants[0].listId===amendmentRequest.listId))));
  const found=Boolean(!data?.placement&&amendmentMatches&&target?.status==='found'&&indices.length>0&&indices.every(index=>Number.isInteger(index)&&index>=0&&index<allParagraphs.length));
  const placement=data?.placement;
  const selectedVariant=(variants.length===1) ? variants[0] : null;
  const wording=(selectedVariant?.wordingStatus==='available') ? selectedVariant : null;
  const scopeLanguageMismatch=Boolean(allParagraphs.length&&wording&&amendmentLanguageScope(wording)&&text?.textLanguage&&text.textLanguage!==wording.language);
  const reportHeading=(((data?.amendment?.id===amendmentRequest?.amendmentId) && (data?.placement?.reason==='amendment_wording_unavailable')) && (!wording)) ? reportAmendmentHeading(text,id,amendmentRequest?.amendmentId,amendmentRequest?.listId) : null;
  useEffect(()=>{
    if(reportHeading===null)return;
    const heading=reader.current?.querySelector<HTMLElement>('[data-report-amendment="true"]');
    heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});
  },[reportHeading]);
  const validIndex=(index:unknown):index is number=>Number.isInteger(index)&&Number(index)>=0&&Number(index)<allParagraphs.length;
  const placed=Boolean(placement?.status==='placed'&&amendmentMatches&&wording&&((placement.operation==='insert') ? (validIndex(placement.insertAfter)&&placement.insertBefore===placement.insertAfter+1) : (placement.span&&validIndex(placement.span.start)&&validIndex(placement.span.end)&&placement.span.end>=placement.span.start)));
  const number=amendmentNumber(amendmentRequest?.amendmentId),amendmentHeading='amendment-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const rejection=Boolean(wording&&placement?.status==='document-operation'&&placement.operation==='reject'&&data?.amendment?.id===amendmentRequest?.amendmentId&&evidence?.amendmentId===amendmentRequest?.amendmentId&&evidence?.listId===wording.listId&&evidence?.wordingLanguage===wording.language);
  const placementReason=placement?.status==='document-operation'&&!rejection ? ui.t("batch6.documentcontextreader.the.amendment.s.location.could.not.be.determined.67") : ((placement?.reason==='different_text_languages') && (wording?.language===null)) ? ui.t("batch6.documentcontextreader.the.amendment.wording.language.is.unknown.131") : (((placement?.reason==='different_text_languages') && (!text?.textLanguage)) ? ui.t("batch6.documentcontextreader.the.document.text.language.is.unknown.132") : (placementReasonsUi(ui)[placement?.reason||'']||ui.t("batch6.documentcontextreader.the.amendment.s.location.could.not.be.determined.67")));
  const extracted=publicationBody(allParagraphs,id,text?.textLanguage);
  const exactBody=extracted.exact&&Number.isInteger(extracted.start)&&extracted.start>=0&&extracted.paragraphs.length===allParagraphs.length-extracted.start&&extracted.paragraphs.every((paragraph,index)=>paragraph===allParagraphs[extracted.start+index]);
  const placementStart=placed ? ((placement?.operation==='insert') ? placement.insertAfter : placement?.span?.start) : undefined;
  const body=((exactBody && (!found||indices.every(index=>index>=extracted.start))) && (!placed||placementStart!==undefined&&placementStart>=extracted.start)) ? extracted : ({paragraphs:allParagraphs,start:0});
  const notes=text?.notes||[],anchors=text?.noteAnchors||[],links=text?.documentLinks||[],objects=text?.documentObjects||[];
  const annotatedSpan=((placed && placement?.span) && (typeof wording?.originalText==='string')) ? mapContextAnnotations(allParagraphs,placement.span,wording.originalText,anchors,links) : null;
  const renderOriginal=(annotatedSpan && (typeof wording?.originalText==='string')) ? ((value:string,start:number)=>{
    const end=start+value.length;
    const clipped=annotatedSpan.links.map(link=>({...link,start:Math.max(link.start,start),end:Math.min(link.end,end)})).filter(link=>link.end>link.start);
    return <ReferenceText text={value} start={start} anchors={annotatedSpan.anchors.filter(anchor=>anchor.offset>start&&anchor.offset<=end||start===0&&anchor.offset===0)} links={clipped} final notePrefix={notePrefix}/>;
  }) : undefined;
  const amendmentBlock=(inPlace:boolean)=><section key="amendment" className="document-context-amendment" data-amendment-block="true" data-context-target={inPlace ? 'true' : undefined} tabIndex={inPlace ? (-1) : undefined} aria-labelledby={amendmentHeading}>
    <h4 id={amendmentHeading} lang={ui.language}>{number ? <UiMessage id="membervotes.tsx.amendment.number" values={{number: number}}/> : <UiMessage id="motionamendments.amendment.664ccf"/>}</h4>
    {wording&&<WordingDiff originalFormatting={wording.originalFormatting} proposedFormatting={wording.proposedFormatting} original={(placement?.operation==='insert') ? '' : wording.originalText} proposed={(placement?.operation==='delete') ? '' : wording.proposedText} language={wording.language} emptySemantics={rejection ? "not-supplied" : "insertion-deletion"} highlightChanges={!rejection} presentation="context" renderOriginal={inPlace ? renderOriginal : undefined}/>}
    <AmendmentJustification record={wording}/>
  </section>;
  const sourceUrl=safeHref(text?.sourceUrl)||safeHref(document?.files.find(file=>file.language===(text?.textLanguage||language))?.url);
  const title=document ? titleOf(document,language, ui) : null,hasText=text?.status==='available'&&allParagraphs.length>0;
  const extractionError=text?.status==='error',loadError=Boolean(state.error)||extractionError;
  const logo=publicationCoverLogo(text,id,text?.textLanguage);
  const incomplete=publicationHasMissingContent(text,body,logo);
  const actual=text?.textLanguage||null;
  const availableLanguages=[...new Set([...(text?.availableTextLanguages||[]),...(actual ? ([actual]) : ([]))])];
  const showPassage=()=>{const paragraph=reader.current?.querySelector<HTMLElement>('[data-context-target="true"], [data-report-amendment="true"]');paragraph?.scrollIntoView({block:'center'});paragraph?.focus({preventScroll:true});};
  const proposalEvidenceMatches=Boolean(document&&wording&&amendmentRequest?.amendmentId&&data?.amendment?.id===amendmentRequest.amendmentId&&
    evidence?.amendmentId===amendmentRequest.amendmentId&&evidence?.listId===wording.listId&&evidence?.wordingLanguage===wording.language&&
    (!amendmentRequest.listId||evidence.listId===amendmentRequest.listId)&&(!wordingPinned||evidence.wordingLanguage===amendmentRequest.wordingLanguage)&&
    typeof wording.language==='string'&&data?.baseline?.language===wording.language);
  if(['commission-proposal','council-position','existing-act'].includes(data?.baseline?.kind||'')&&data?.proposal?.items.length)return <div className="document-context-document">
    {document&&<header className="document-context-heading"><div><p className="document-context-kind"><UiMessage id="batch6.documentcontextreader.report.amendment.163"/></p><h3 lang={title?.language}>{title?.text}</h3></div></header>}
    {!wording&&<AmendmentJustification record={selectedVariant}/>}
    <ProposalContextText data={(proposalEvidenceMatches||data.placement?.status==='unresolved') ? data : ({...data,placement:{...data.placement!,status:'unresolved',reason:'client_target_unconfirmed'}})} wording={wording} amendmentId={amendmentRequest?.amendmentId} language={interfaceLanguage} showOriginalLink={showOriginalLink}/>
  </div>;
  return <div className="document-context-document" data-context-pending={(state.loading && (!hasText)) ? 'true' : undefined}>
    {document&&<header className="document-context-heading"><div><p className="document-context-kind">{documentKind(id, ui)}</p><h3 lang={title?.language}>{title?.text}</h3></div><div className="document-context-tools"><TextLanguagePicker available={availableLanguages} requested={interfaceLanguage} value={actual} onChange={onLanguageChange}/>{hasText&&<FindInText key={id+':'+language} target={reader} label={ui.t("batch6.documentcontextreader.find.in.document.168")}/>}</div></header>}
    {state.loading&&!data&&<p role="status"><UiMessage id="batch5.amendments.tsx.188.20"/></p>}
    {loadError&&<p className="document-context-notice" role="alert">{hasText ? ui.t("batch6.documentcontextreader.couldn.t.update.the.document.showing.saved.text.170") : (extractionError ? ui.t("batch6.documentcontextreader.document.text.could.not.be.loaded.170") : ui.t("batch6.documentcontextreader.document.could.not.be.loaded.170"))} <button type="button" onClick={state.retry}><UiMessage id="commissionfollowups.try_again"/></button></p>}
    {!state.loading&&!loadError&&!document&&<p><UiMessage id="batch6.documentcontextreader.document.unavailable.here.171"/></p>}
    {(!wording||hasText&&(!placement||scopeLanguageMismatch))&&<AmendmentJustification record={selectedVariant}/>}
    {rejection&&!hasText&&<p className="document-context-notice" role="status">{placementReason}</p>}
    {wording&&!hasText&&<div className="document-context-text">{amendmentBlock(false)}</div>}
    {document&&<>
      {actual&&<p className="document-context-language">{(actual!==language) ? <TextLanguageFallback requested={language} actual={actual} interfaceLanguage={interfaceLanguage}/> : <><UiMessage id="membervotes.tsx.text.language.language" values={{language: languageName(actual,ui.locale)}}/></>}</p>}
      {id.startsWith('TA-')&&<CommissionFollowups id={id} language={language} interfaceLanguage={interfaceLanguage}/>}
      {hasText&&!loadError&&(text?.stale||text?.refreshError)&&<p className="document-context-notice">{text?.refreshError ? <UiMessage id="batch6.documentcontextreader.couldn.t.update.the.document.showing.saved.text.170"/> : <UiMessage id="batch6.documentcontextreader.showing.saved.text.177"/>}</p>}
      {hasText ? <>
        {amendmentRequest?.amendmentId&&((reportHeading!==null) ? <div className="document-context-passage"><button type="button" onClick={showPassage}><UiMessage id="batch6.documentcontextreader.go.to.amendment.179"/></button></div> : (placement ? ((placement.status==='not-applicable') ? null : (placed ? <div className="document-context-passage"><button type="button" onClick={showPassage}><UiMessage id="batch6.documentcontextreader.go.to.amendment.179"/></button></div> : <p className="document-context-notice" role="status">{placementReason}</p>)) : (found ? <div className="document-context-passage"><button type="button" onClick={showPassage}><UiMessage id="batch6.documentcontextreader.go.to.passage.179"/></button>{target?.quoteMatches===false&&<p><UiMessage id="batch6.documentcontextreader.the.published.text.differs.from.the.amendment.s.quotation.179"/></p>}</div> : <p className="document-context-notice"><UiMessage id="batch6.documentcontextreader.the.passage.this.amendment.changes.could.not.be.found.64"/></p>)))}
        {incomplete&&<p className="document-context-notice"><UiMessage id="batch6.documentcontextreader.some.content.is.only.available.in.the.original.document.180"/></p>}
        <ReferenceScope key={id+':'+language} texts={readerTexts(body.paragraphs,notes,links)} notes={notes} notePrefix={notePrefix} language={interfaceLanguage} textLanguage={actual} renderQuestion={question=><InsightQuestionReader id={question} language={interfaceLanguage} heading={ui.t("batch6.references.referenced.question.112")} includeAnswers/>}>
          <div className="document-context-text" ref={reader} lang={actual||''}>{placement&&!placed&&wording&&!scopeLanguageMismatch&&amendmentBlock(false)}<DocumentParagraphs texts={body.paragraphs} start={body.start} formatting={usableFormatting(text,allParagraphs.length)} exactOffsets
            paragraphProps={sourceIndex=>{const selected=Boolean(found&&indices.includes(sourceIndex)),reportSelected=sourceIndex===reportHeading;return {'data-source-paragraph':String(sourceIndex),'data-context-target':selected ? 'true' : undefined,'data-report-amendment':reportSelected ? 'true' : undefined,className:selected ? 'document-context-target' : undefined,tabIndex:(selected||reportSelected) ? (-1) : undefined};}}
            renderParagraph={(sourceIndex,paragraph)=>{
              if(placed&&placement?.span&&sourceIndex>=placement.span.start&&sourceIndex<=placement.span.end)return (sourceIndex===placement.span.start) ? amendmentBlock(true) : null;
              return ((placed && (placement?.operation==='insert')) && (sourceIndex===placement.insertAfter)) ? <Fragment key={sourceIndex}>{paragraph}{amendmentBlock(true)}</Fragment> : paragraph;
            }}
            renderText={(sourceIndex,paragraph,from,to,final,marks)=><DocumentObjectText assets={text?.imageAssets} text={paragraph} paragraph={sourceIndex} from={from} to={to} final={final} objects={objects} logo={logo} sourceUrl={sourceUrl} anchors={anchors.filter(anchor=>anchor.paragraph===sourceIndex)} links={links.filter(link=>link.paragraph===sourceIndex)} marks={marks} notePrefix={notePrefix}/>}/><DocumentNotes assets={text?.imageAssets} notes={notes} prefix={notePrefix}/></div>
        </ReferenceScope>
      </> : (!state.loading&&!loadError&&<p><UiMessage id="batch6.documentcontextreader.document.text.unavailable.here.190"/></p>)}
      <DocumentPages documentId={id} language={actual||language}/>{showOriginalLink&&sourceUrl&&<p className="document-context-source"><a href={sourceUrl} target="_blank" rel="noreferrer"><UiMessage id="batch6.documentcontextreader.open.original.document.191"/></a></p>}
    </>}
  </div>;
}

function ContextSession({request,language,selectedDocumentId,onSelectedDocumentIdChange,showOriginalLink=true,showBackButton=true}:DocumentContextReaderProps) {
  const ui = useUiI18n();
  const [selectedLanguage,setLanguage]=useState((typeof request.wordingLanguage==='string') ? request.wordingLanguage : language),[localSelection,setLocalSelection]=useState<string|null>(null);
  const controlled=selectedDocumentId!==undefined,selected=controlled ? selectedDocumentId : localSelection;
  const select=(id:string|null)=>{if(!controlled)setLocalSelection(id);onSelectedDocumentIdChange?.(id);};
  const related=useData<DocumentContextResponse>((request.view==='adopted') ? ('document-context/'+encodeURIComponent(request.documentId)+'?'+new URLSearchParams({lang:selectedLanguage,adopted:'1'})) : null);
  const data=responseFor(related.data,request.documentId,selectedLanguage);
  const choices=data?.related.items.filter(item=>/^TA-10-\d{4}-\d{4,6}$/.test(item.id)&&item.relationship.field==='adopts'&&item.relationship.from===item.id&&item.relationship.to===request.documentId)||[];
  const selectedChoice=choices.find(item=>item.id===selected),partial=data?.related.status==='partial';
  const pendingRelated=request.view==='adopted'&&related.loading&&(selected ? (!selectedChoice) : (!data));
  return <section className="document-context-reader" lang={ui.language} aria-label={ui.t("batch6.documentcontextreader.document.context.205")} data-context-pending={pendingRelated ? 'true' : undefined}>
    {showBackButton&&<button type="button" className="document-context-back" onClick={request.onBack}><>← {(request.backLabel??ui.t('interface.back'))}</></button>}
    {request.summary}
    {(request.view==='document') ? <DocumentBody key={request.documentId+':'+selectedLanguage} id={request.documentId} language={selectedLanguage} interfaceLanguage={language} showOriginalLink={showOriginalLink} onLanguageChange={setLanguage} amendmentRequest={request}/> : <>
      {selected ? <>
        <button type="button" className="document-context-choices-back" onClick={()=>select(null)}><UiMessage id="batch6.documentcontextreader.adopted.texts.210"/></button>
        {selectedChoice ? <DocumentBody key={selectedChoice.id+':'+selectedLanguage} id={selectedChoice.id} language={selectedLanguage} interfaceLanguage={language} showOriginalLink={showOriginalLink} onLanguageChange={setLanguage}/> : (related.loading ? <p role="status"><UiMessage id="batch6.documentcontextreader.loading.linked.texts.211"/></p> : (!related.error&&<p><UiMessage id="batch6.documentcontextreader.this.adopted.text.is.unavailable.here.211"/></p>))}
      </> : <><h3><UiMessage id="batch6.documentcontextreader.adopted.texts.212"/></h3>{related.loading&&!data&&<p role="status"><UiMessage id="batch6.documentcontextreader.loading.linked.texts.211"/></p>}{data&&!choices.length&&!related.error&&<p><UiMessage id="batch6.documentcontextreader.adopted.text.unavailable.here.212"/></p>}{choices.length>0&&<ul className="document-context-choices">{choices.map(item=>{const title=titleOf(item,selectedLanguage, ui);return <li key={item.id}><button type="button" onClick={()=>select(item.id)}><span lang={title.language}>{title.text}</span>{item.date&&<time dateTime={item.date}>{item.date}</time>}</button></li>;})}</ul>}</>}
      {partial&&<p className="document-context-notice"><UiMessage id="batch6.documentcontextreader.some.linked.texts.could.not.be.loaded.213"/></p>}
      {related.error&&<p className="document-context-notice" role="alert"><UiMessage id="batch6.documentcontextreader.linked.texts.could.not.be.loaded.214"/> <button type="button" onClick={related.retry}><UiMessage id="commissionfollowups.try_again"/></button></p>}
    </>}
  </section>;
}

export function DocumentContextReader(props:DocumentContextReaderProps) {
  const {request,language}=props;
  // A new requested document/version starts a new reading session immediately.
  return <ContextSession key={JSON.stringify([request.documentId,request.scope,request.amendmentId,request.listId,request.wordingLanguage!==undefined,request.wordingLanguage,request.view,language])} {...props}/>;
}
