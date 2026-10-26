import {selectLanguageText} from './language.mjs';
import {TextLanguagePicker,TextLanguageFallback} from './TextLanguagePicker';
import {Fragment,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {useData} from './data';
import {CommissionFollowups} from './CommissionFollowups';
import type {DocumentContextRequest,DocumentContextResponse} from './DocumentContextTypes';
import type {PublicationDocument,NoteAnchor,DocumentLink} from './explorerTypes';
import {publicationBody,publicationHasMissingContent} from './publication-body.mjs';
import {reportAmendmentHeading} from './reportAmendmentHeading.mjs';
import {displayVoteTitle} from './memberVotesPresentation.mjs';
import {DocumentNotes,ReferenceScope,ReferenceText,readerTexts} from './References';
import {InsightQuestionReader} from './InsightReaders';
import {mapContextAnnotations} from './contextAnnotations.mjs';
import {WordingDiff} from './components/WordingDiff';
import {FindInText} from './TextSearch';
import {ProposalContextText,proposalPlacementReasons} from './ProposalContextText';
import {DocumentParagraphs,usableFormatting,type FormatMark} from './DocumentFormatting';
import './DocumentContextReader.css';

export type DocumentContextReaderProps={
  request:DocumentContextRequest;
  language:string;
  selectedDocumentId?:string|null;
  onSelectedDocumentIdChange?:(id:string|null)=>void;
};

type InlineObject={paragraph:number;offset:number;kind:string;status:string};
type DocumentText=NonNullable<PublicationDocument['selectedText']>&{documentObjects?:InlineObject[]};
type Title={text:string;language:string};
const safeHref=(value:string|null|undefined)=>{try{const url=new URL(value||'');return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const languageName=(code:string)=>{try{return new Intl.DisplayNames(['en'],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const titleOf=(document:Pick<PublicationDocument,'titles'>,language:string):Title=>{
  const title=selectLanguageText(document.titles,language,'Document text');
  return {...title,text:displayVoteTitle(title.text)};
};
const documentKind=(id:string)=>id.startsWith('TA-')?'Adopted text':id.startsWith('RC-')?'Joint motion':id.startsWith('B-')?'Motion':'Report';
const documentRoute=(id:string,language:string,request?:DocumentContextRequest)=>{
  const query=new URLSearchParams({lang:language});
  if(request?.amendmentId)query.set('amendment',request.amendmentId);
  if(request?.amendmentId&&request.listId)query.set('list',request.listId);
  if(request?.amendmentId&&request.listId&&request.wordingLanguage!==undefined)query.set('wording-lang',request.wordingLanguage??'unknown');
  return 'document-context/'+encodeURIComponent(id)+'?'+query;
};
const responseFor=(data:DocumentContextResponse|null,id:string,language:string,request?:DocumentContextRequest)=>data?.documentId===id&&data.requestedLanguage===language&&(request?.wordingLanguage===undefined||data.requestedWordingLanguage===request.wordingLanguage)?data:null;

const placementReasons:Record<string,string>={
  ...proposalPlacementReasons,
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
const amendmentNumber=(id:string|undefined)=>id?.match(/-AM-(\d+[a-z]*)$/i)?.[1].replace(/^0+(?=\d)/,'')||null;

// Keep source offsets when replacing an unresolved inline object with a source link.
// The surrounding text, references and note anchors remain in their original positions.
function Paragraph({text,paragraph,from=0,to=text.length,final=true,objects,sourceUrl,anchors,links,marks,notePrefix}:{text:string;paragraph:number;from?:number;to?:number;final?:boolean;objects:InlineObject[];sourceUrl:string|null;anchors:NoteAnchor[];links:DocumentLink[];marks:FormatMark[];notePrefix:string}) {
  const unresolved=new Map(objects.filter(object=>object.paragraph===paragraph&&object.status==='unresolved'&&Number.isInteger(object.offset)&&object.offset>=from&&object.offset<to&&text[object.offset]==='\uFFFC').map(object=>[object.offset,object]));
  const nodes:ReactNode[]=[];let start=from;
  // A slice ending at a replaced object owns the note anchored there; the label slice before a hanging tab does not.
  const slice=(sliceFrom:number,sliceTo:number,ownsEnd:boolean)=>{
    const spans=links.map(link=>({...link,start:Math.max(link.start,sliceFrom),end:Math.min(link.end,sliceTo)})).filter(link=>link.end>link.start);
    return <ReferenceText key={'text-'+sliceFrom} text={text.slice(sliceFrom,sliceTo)} start={sliceFrom} final={ownsEnd} anchors={anchors} links={spans} marks={marks} notePrefix={notePrefix}/>;
  };
  if(!unresolved.size)return slice(from,to,final);
  for(const [offset,object] of [...unresolved].sort(([a],[b])=>a-b)) {
    nodes.push(slice(start,offset,true));
    const label=object.kind==='drawing'?'Image in original':'See original';
    nodes.push(sourceUrl?<a key={'object-'+offset} className="document-context-object" lang="en" href={sourceUrl} target="_blank" rel="noreferrer">{label} ↗</a>:<span key={'object-'+offset} className="document-context-object" lang="en">{object.kind==='drawing'?'Image unavailable':'Content unavailable'}</span>);
    start=offset+1;
  }
  nodes.push(slice(start,to,final));
  return <>{nodes}</>;
}

function DocumentBody({id,language,interfaceLanguage,onLanguageChange,amendmentRequest}:{id:string;language:string;interfaceLanguage:string;onLanguageChange:(language:string)=>void;amendmentRequest?:DocumentContextRequest}) {
  const state=useData<DocumentContextResponse>(documentRoute(id,language,amendmentRequest));
  const data=responseFor(state.data,id,language,amendmentRequest),document=data?.document?.id===id&&(!data.document.selectedDocumentId||data.document.selectedDocumentId===id)?data.document:null;
  const text:DocumentText|undefined=document?.selectedText,reader=useRef<HTMLDivElement>(null),notePrefix='context-notes-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const target=data?.target,allParagraphs=text?.paragraphs||[],indices=target?.paragraphs||[];
  const wordingPinned=amendmentRequest?.wordingLanguage!==undefined;
  const pinnedVariants=wordingPinned?data?.amendment?.variants.filter(variant=>variant.listId===amendmentRequest?.listId&&variant.language===amendmentRequest?.wordingLanguage)||[]:[];
  const evidence=target?.evidence;
  const pinnedTargetMatches=Boolean(amendmentRequest?.listId&&typeof amendmentRequest.wordingLanguage==='string'&&pinnedVariants.length===1&&pinnedVariants[0].wordingStatus==='available'&&
    evidence?.amendmentId===amendmentRequest.amendmentId&&evidence?.listId===amendmentRequest.listId&&evidence?.wordingLanguage===amendmentRequest.wordingLanguage&&text?.textLanguage===amendmentRequest.wordingLanguage);
  const amendmentMatches=amendmentRequest?.amendmentId&&data?.amendment?.id===amendmentRequest.amendmentId&&(wordingPinned?pinnedTargetMatches:data.amendment.status==='available'&&(!amendmentRequest.listId||data.amendment.variants.length===1&&data.amendment.variants[0].listId===amendmentRequest.listId));
  const found=Boolean(!data?.placement&&amendmentMatches&&target?.status==='found'&&indices.length>0&&indices.every(index=>Number.isInteger(index)&&index>=0&&index<allParagraphs.length));
  const placement=data?.placement;
  const variants=data?.amendment?.id===amendmentRequest?.amendmentId?data?.amendment?.variants.filter(variant=>(!amendmentRequest?.listId||variant.listId===amendmentRequest.listId)&&(!wordingPinned||variant.language===amendmentRequest?.wordingLanguage))||[]:[];
  const wording=variants.length===1&&variants[0].wordingStatus==='available'?variants[0]:null;
  const reportHeading=data?.amendment?.id===amendmentRequest?.amendmentId&&data?.placement?.reason==='amendment_wording_unavailable'&&!wording?
    reportAmendmentHeading(text,id,amendmentRequest?.amendmentId,amendmentRequest?.listId):null;
  useEffect(()=>{
    if(reportHeading===null)return;
    const heading=reader.current?.querySelector<HTMLElement>('[data-report-amendment="true"]');
    heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});
  },[reportHeading]);
  const validIndex=(index:unknown):index is number=>Number.isInteger(index)&&Number(index)>=0&&Number(index)<allParagraphs.length;
  const placed=Boolean(placement?.status==='placed'&&amendmentMatches&&wording&&(
    placement.operation==='insert'?validIndex(placement.insertAfter)&&placement.insertBefore===placement.insertAfter+1:
      placement.span&&validIndex(placement.span.start)&&validIndex(placement.span.end)&&placement.span.end>=placement.span.start));
  const number=amendmentNumber(amendmentRequest?.amendmentId),amendmentHeading='amendment-'+useId().replace(/[^A-Za-z0-9_-]/g,'');
  const placementReason=placement?.reason==='different_text_languages'&&wording?.language===null?'The amendment wording language is unknown.':
    placement?.reason==='different_text_languages'&&!text?.textLanguage?'The document text language is unknown.':
      placementReasons[placement?.reason||'']||'The amendment’s location could not be determined.';
  const extracted=publicationBody(allParagraphs,id,text?.textLanguage);
  const exactBody=extracted.exact&&Number.isInteger(extracted.start)&&extracted.start>=0&&extracted.paragraphs.length===allParagraphs.length-extracted.start&&extracted.paragraphs.every((paragraph,index)=>paragraph===allParagraphs[extracted.start+index]);
  const placementStart=placed?(placement?.operation==='insert'?placement.insertAfter:placement?.span?.start):undefined;
  const body=exactBody&&(!found||indices.every(index=>index>=extracted.start))&&(!placed||placementStart!==undefined&&placementStart>=extracted.start)?extracted:{paragraphs:allParagraphs,start:0};
  const notes=text?.notes||[],anchors=text?.noteAnchors||[],links=text?.documentLinks||[],objects=text?.documentObjects||[];
  const annotatedSpan=placed&&placement?.span&&typeof wording?.originalText==='string'?mapContextAnnotations(allParagraphs,placement.span,wording.originalText,anchors,links):null;
  const renderOriginal=annotatedSpan&&typeof wording?.originalText==='string'?(value:string,start:number)=>{
    const end=start+value.length;
    const clipped=annotatedSpan.links.map(link=>({...link,start:Math.max(link.start,start),end:Math.min(link.end,end)})).filter(link=>link.end>link.start);
    return <ReferenceText text={value} start={start} anchors={annotatedSpan.anchors.filter(anchor=>anchor.offset>start&&anchor.offset<=end||start===0&&anchor.offset===0)} links={clipped} final notePrefix={notePrefix}/>;
  }:undefined;
  const amendmentBlock=(inPlace:boolean)=><section key="amendment" className="document-context-amendment" data-amendment-block="true" data-context-target={inPlace?'true':undefined} tabIndex={inPlace?-1:undefined} aria-labelledby={amendmentHeading}>
    <h4 id={amendmentHeading} lang="en">Amendment{number?' '+number:''}</h4>
    {wording&&<WordingDiff originalFormatting={wording.originalFormatting} proposedFormatting={wording.proposedFormatting} original={placement?.operation==='insert'?'':wording.originalText} proposed={placement?.operation==='delete'?'':wording.proposedText} language={wording.language} emptySemantics="insertion-deletion" presentation="context" renderOriginal={inPlace?renderOriginal:undefined}/>}
  </section>;
  const sourceUrl=safeHref(text?.sourceUrl)||safeHref(document?.files.find(file=>file.language===(text?.textLanguage||language))?.url);
  const title=document?titleOf(document,language):null,hasText=text?.status==='available'&&allParagraphs.length>0;
  const extractionError=text?.status==='error',loadError=Boolean(state.error)||extractionError;
  const incomplete=publicationHasMissingContent(text,body);
  const actual=text?.textLanguage||null;
  const availableLanguages=[...new Set([...(text?.availableTextLanguages||[]),...(actual?[actual]:[])])];
  const showPassage=()=>{const paragraph=reader.current?.querySelector<HTMLElement>('[data-context-target="true"], [data-report-amendment="true"]');paragraph?.scrollIntoView({block:'center'});paragraph?.focus({preventScroll:true});};
  const proposalEvidenceMatches=Boolean(document&&wording&&amendmentRequest?.amendmentId&&data?.amendment?.id===amendmentRequest.amendmentId&&
    evidence?.amendmentId===amendmentRequest.amendmentId&&evidence?.listId===wording.listId&&evidence?.wordingLanguage===wording.language&&
    (!amendmentRequest.listId||evidence.listId===amendmentRequest.listId)&&(!wordingPinned||evidence.wordingLanguage===amendmentRequest.wordingLanguage)&&
    typeof wording.language==='string'&&data?.baseline?.language===wording.language);
  if(data?.baseline?.kind==='commission-proposal'&&data.proposal?.items.length)return <div className="document-context-document">
    {document&&<header className="document-context-heading"><div><p className="document-context-kind">Report amendment</p><h3 lang={title?.language}>{title?.text}</h3></div></header>}
    <ProposalContextText data={proposalEvidenceMatches||data.placement?.status==='unresolved'?data:{...data,placement:{...data.placement!,status:'unresolved',reason:'client_target_unconfirmed'}}} wording={wording} amendmentId={amendmentRequest?.amendmentId} language={interfaceLanguage}/>
  </div>;
  return <div className="document-context-document" data-context-pending={state.loading&&!hasText?'true':undefined}>
    {document&&<header className="document-context-heading"><div><p className="document-context-kind">{documentKind(id)}</p><h3 lang={title?.language}>{title?.text}</h3></div><div className="document-context-tools"><TextLanguagePicker available={availableLanguages} requested={interfaceLanguage} value={actual} onChange={onLanguageChange}/>{hasText&&<FindInText key={id+':'+language} target={reader} label="Find in document"/>}</div></header>}
    {state.loading&&!data&&<p role="status">Loading document…</p>}
    {loadError&&<p className="document-context-notice" role="alert">{hasText?'Couldn’t update the document. Showing saved text.':extractionError?'Document text could not be loaded.':'Document could not be loaded.'} <button type="button" onClick={state.retry}>Try again</button></p>}
    {!state.loading&&!loadError&&!document&&<p>Document unavailable here.</p>}
    {document&&<>
      {actual&&<p className="document-context-language">{actual!==language?<TextLanguageFallback requested={language} actual={actual} interfaceLanguage={interfaceLanguage}/>:<>Text language: {languageName(actual)}</>}</p>}
      {id.startsWith('TA-')&&<CommissionFollowups id={id} language={language} interfaceLanguage={interfaceLanguage}/>}
      {hasText&&!loadError&&(text?.stale||text?.refreshError)&&<p className="document-context-notice">{text?.refreshError?'Couldn’t update the document. Showing saved text.':'Showing saved text.'}</p>}
      {hasText?<>
        {amendmentRequest?.amendmentId&&(reportHeading!==null?<div className="document-context-passage"><button type="button" onClick={showPassage}>Go to amendment</button></div>:placement?(placed?<div className="document-context-passage"><button type="button" onClick={showPassage}>Go to amendment</button></div>:<p className="document-context-notice" role="status">{placementReason}</p>):found?<div className="document-context-passage"><button type="button" onClick={showPassage}>Go to passage</button>{target?.quoteMatches===false&&<p>The published text differs from the amendment’s quotation.</p>}</div>:<p className="document-context-notice">The passage this amendment changes could not be found.</p>)}
        {incomplete&&<p className="document-context-notice">Some content is only available in the original document.</p>}
        <ReferenceScope key={id+':'+language} texts={readerTexts(body.paragraphs,notes,links)} notes={notes} notePrefix={notePrefix} language={interfaceLanguage} textLanguage={actual} renderQuestion={question=><InsightQuestionReader id={question} language={interfaceLanguage} heading="Referenced question" includeAnswers/>}>
          <div className="document-context-text" ref={reader} lang={actual||''}>{placement&&!placed&&wording&&amendmentBlock(false)}<DocumentParagraphs texts={body.paragraphs} start={body.start} formatting={usableFormatting(text,allParagraphs.length)} exactOffsets
            paragraphProps={sourceIndex=>{const selected=Boolean(found&&indices.includes(sourceIndex)),reportSelected=sourceIndex===reportHeading;return {'data-source-paragraph':String(sourceIndex),'data-context-target':selected?'true':undefined,'data-report-amendment':reportSelected?'true':undefined,className:selected?'document-context-target':undefined,tabIndex:selected||reportSelected?-1:undefined};}}
            renderParagraph={(sourceIndex,paragraph)=>{
              if(placed&&placement?.span&&sourceIndex>=placement.span.start&&sourceIndex<=placement.span.end)return sourceIndex===placement.span.start?amendmentBlock(true):null;
              return placed&&placement?.operation==='insert'&&sourceIndex===placement.insertAfter?<Fragment key={sourceIndex}>{paragraph}{amendmentBlock(true)}</Fragment>:paragraph;
            }}
            renderText={(sourceIndex,paragraph,from,to,final,marks)=><Paragraph text={paragraph} paragraph={sourceIndex} from={from} to={to} final={final} objects={objects} sourceUrl={sourceUrl} anchors={anchors.filter(anchor=>anchor.paragraph===sourceIndex)} links={links.filter(link=>link.paragraph===sourceIndex)} marks={marks} notePrefix={notePrefix}/>}/><DocumentNotes notes={notes} prefix={notePrefix}/></div>
        </ReferenceScope>
      </>:!state.loading&&!loadError&&<p>Document text unavailable here.</p>}
      {sourceUrl&&<p className="document-context-source"><a href={sourceUrl} target="_blank" rel="noreferrer">Open original document ↗</a></p>}
    </>}
  </div>;
}

function ContextSession({request,language,selectedDocumentId,onSelectedDocumentIdChange}:DocumentContextReaderProps) {
  const [selectedLanguage,setLanguage]=useState(typeof request.wordingLanguage==='string'?request.wordingLanguage:language),[localSelection,setLocalSelection]=useState<string|null>(null);
  const controlled=selectedDocumentId!==undefined,selected=controlled?selectedDocumentId:localSelection;
  const select=(id:string|null)=>{if(!controlled)setLocalSelection(id);onSelectedDocumentIdChange?.(id);};
  const related=useData<DocumentContextResponse>(request.view==='adopted'?'document-context/'+encodeURIComponent(request.documentId)+'?'+new URLSearchParams({lang:selectedLanguage,adopted:'1'}):null);
  const data=responseFor(related.data,request.documentId,selectedLanguage);
  const choices=data?.related.items.filter(item=>/^TA-10-\d{4}-\d{4,6}$/.test(item.id)&&item.relationship.field==='adopts'&&item.relationship.from===item.id&&item.relationship.to===request.documentId)||[];
  const selectedChoice=choices.find(item=>item.id===selected),partial=data?.related.status==='partial';
  const pendingRelated=request.view==='adopted'&&related.loading&&(selected?!selectedChoice:!data);
  return <section className="document-context-reader" lang="en" aria-label="Document context" data-context-pending={pendingRelated?'true':undefined}>
    <button type="button" className="document-context-back" onClick={request.onBack}>← {request.backLabel??'Back'}</button>
    {request.summary}
    {request.view==='document'?<DocumentBody key={request.documentId+':'+selectedLanguage} id={request.documentId} language={selectedLanguage} interfaceLanguage={language} onLanguageChange={setLanguage} amendmentRequest={request}/>:<>
      {selected?<>
        <button type="button" className="document-context-choices-back" onClick={()=>select(null)}>← Adopted texts</button>
        {selectedChoice?<DocumentBody key={selectedChoice.id+':'+selectedLanguage} id={selectedChoice.id} language={selectedLanguage} interfaceLanguage={language} onLanguageChange={setLanguage}/>:related.loading?<p role="status">Loading linked texts…</p>:!related.error&&<p>This adopted text is unavailable here.</p>}
      </>:<><h3>Adopted texts</h3>{related.loading&&!data&&<p role="status">Loading linked texts…</p>}{data&&!choices.length&&!related.error&&<p>Adopted text unavailable here.</p>}{choices.length>0&&<ul className="document-context-choices">{choices.map(item=>{const title=titleOf(item,selectedLanguage);return <li key={item.id}><button type="button" onClick={()=>select(item.id)}><span lang={title.language}>{title.text}</span>{item.date&&<time dateTime={item.date}>{item.date}</time>}</button></li>;})}</ul>}</>}
      {partial&&<p className="document-context-notice">Some linked texts could not be loaded.</p>}
      {related.error&&<p className="document-context-notice" role="alert">Linked texts could not be loaded. <button type="button" onClick={related.retry}>Try again</button></p>}
    </>}
  </section>;
}

export function DocumentContextReader(props:DocumentContextReaderProps) {
  const {request,language}=props;
  // A new requested document/version starts a new reading session immediately.
  return <ContextSession key={JSON.stringify([request.documentId,request.amendmentId,request.listId,request.wordingLanguage!==undefined,request.wordingLanguage,request.view,language])} {...props}/>;
}
