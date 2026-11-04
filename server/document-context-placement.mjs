export {amendmentProvisional} from './amendment-provisional.mjs';
import {hasCouncilQuotation} from './report-council-quotation.mjs';
import {amendmentAlternative} from './amendment-alternative.mjs';
import {amendmentRejection} from './amendment-rejection.mjs';
import {amendmentLanguageScope,amendmentMixedLanguageScope} from '../src/amendmentLanguageScope.mjs';
import {resolveAmendmentPlacement,amendmentOperation,resolutionReference,resolveTableInsertion} from './document-context-model.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {resolveExistingLawPlacement} from './existing-law-placement.mjs';
import {parseTargetLabel} from './proposal-labels.mjs';

// A present-text amendment that adds a new amending instruction is located by
// the proposal's instruction label; building the consolidated law is separate.
// The proposed column must open with that instruction's own printed number.
export function proposalInstructionTarget(chosen) {
  if(chosen?.baseline!=='present-text'||!chosen.proposedText||typeof chosen.language!=='string')return null;
  const paths=chosen.targetPath?.proposal;
  if(paths?.length>1||(chosen.targetPath?.language??chosen.targetLabelLanguage)!==chosen.language)return null;
  // Lists often print the proposal line only as the label's first line.
  const raw=paths?.length?paths[0].raw:typeof chosen.targetLabel==='string'?chosen.targetLabel.split('\n')[0].trim():'';
  if(!raw||raw.includes(' — ')||(chosen.targetPath?.underlying||[]).some(path=>path.raw===raw))return null;
  let target;try{target=parseTargetLabel(raw,chosen.language);}catch{return null;}
  const label=target.segments.at(-1);
  if(!target.complete||target.segments[0]?.kind!=='article'||!label||!['point','article'].includes(label.kind)||!(label.isNew||label.negative))return null;
  // Outer-level instructions only: a new article, or a new point directly
  // under the amending paragraph. Nested points stay withheld.
  const [article,paragraph]=target.segments;
  if(!(target.segments.length===1&&label.kind==='article'||target.segments.length===3&&article.kind==='article'&&paragraph.kind==='paragraph'&&label.kind==='point'))return null;
  const printed=label.kind==='article'?new RegExp(`^(?:Article|Artykuł)\\s+${label.value.replace(/^(\d+)([a-z]+)$/u,'$1\\s*$2')}(?![ \\t]*[\\p{L}\\p{N}])`,'u')
    :new RegExp(`^\\(?${label.value.replace(/^(-?\d+)([a-z]+)$/u,'$1\\s*$2')}\\)`,'u');
  return printed.test(chosen.proposedText.trim())?{raw,label}:null;
}
function proposalInstructionPlacement(items,chosen) {
  const target=proposalInstructionTarget(chosen);
  if(!target||!items?.length)return null;
  const placement=resolveProposalPlacement(items,{...chosen,originalText:'',originalFormatting:undefined,targetLabel:target.raw,targetPath:{...chosen.targetPath,proposal:[{raw:target.raw}],underlying:[]}});
  if(placement.status!=='placed'||placement.operation!=='insert')return null;
  return {...placement,frame:'commission-proposal',evidence:[{basis:'proposal-instruction-frame',label:target.raw},...placement.evidence]};
}

/** Pure final placement selection shared by the endpoint and offline consumers.
 * Source acquisition, identity checks and proposal parsing belong to the caller. */
export function documentContextPlacement({chosen,text,items,baseline,proposalItems=null,referenceTexts=[],resolutionDocument=false,includeBody=true,amendmentRequested=true,nativeProposalInputs,amendmentNumber}={}) {
  if(!includeBody)return null;
  if(hasCouncilQuotation(chosen)&&baseline?.evidence?.some(e=>e.kind==='report-council-draft')&&items?.some(i=>i.proposal?.sourceKind==='pdf'))chosen={...chosen,baseline:'council-position',baselineSource:{...chosen.baselineSource,category:'council-position'}};
  const unresolved=reason=>({operation:amendmentOperation(chosen||{}),status:'unresolved',reason,evidence:[]});
  if(!chosen)return amendmentRequested?unresolved(referenceTexts.length>1?'conflicting_target_evidence':'amendment_wording_unavailable'):null;
  const alternative=amendmentAlternative(chosen);
  if(alternative)return alternative;
  const rejection=amendmentRejection(chosen);
  if(rejection)return rejection;
  const mixedScope=amendmentMixedLanguageScope(chosen),scope=amendmentLanguageScope(chosen);
  if(scope&&text?.paragraphs?.length&&text.textLanguage&&scope.language!==text.textLanguage)return unresolved('different_text_languages');
  if(mixedScope)return {operation:null,status:'unresolved',reason:'language_scope_mixed',evidence:[{basis:'published-language-scope',...mixedScope}]};
  if(scope)return {operation:null,status:'not-applicable',reason:'language_version_unaffected',evidence:[{basis:'published-language-scope',...scope}]};
  if(chosen.baselineSource?.conflicted===true)return unresolved('conflicting_baselines');
  if(chosen.baseline==='present-text'&&chosen.baselineSource?.category==='present-text'&&chosen.baselineSource.conflicted===false) {
    const existing=items?.length||baseline?resolveExistingLawPlacement(items||[],chosen,baseline):null;
    if(existing?.status==='placed')return existing;
    // Only when the consolidated law cannot place it, and only in the proposal.
    const framed=proposalInstructionPlacement(proposalItems,chosen);
    if(framed)return framed;
    if(existing)return existing;
  }
  const council=chosen.baseline==='council-position';
  const proposalKind=['commission-proposal','council-position'].includes(chosen.baseline)&&chosen.baselineSource?.category===chosen.baseline&&chosen.baselineSource.conflicted===false;
  const consultation=chosen.baseline==='commission-proposal'&&(chosen.documentReferences||[]).some(r=>(r.field==='DocRef'||/^DocAmend\d?$/.test(r.field))&&/\b\d{4}\/\d{4}\s*\(CNS\)/u.test(r.raw||''));
  const nle=chosen.baseline==='commission-proposal'&&baseline?.evidence?.some(e=>e.kind==='native-procedure'&&e.status==='verified'&&/\(NLE\)$/u.test(e.procedure));
  const pdfCouncil=council&&baseline?.evidence?.some(e=>e.kind==='report-council-draft')&&items?.length===1&&items[0].proposal?.sourceKind==='pdf';
  const detachedNotes=proposalKind&&[chosen.originalText,chosen.proposedText].some(text=>typeof text==='string'&&/(?:^|\n)_{3,}[ \t]*(?:\n|$)/u.test(text));
  if(detachedNotes&&(!items?.length||council&&items.some(item=>item.proposal?.sourceKind==='pdf')&&!pdfCouncil))return unresolved('proposal_note_scope_unavailable');
  if(proposalKind&&nle&&baseline.evidence.some(e=>e.kind==='native-nle-annex-part'&&e.ordinal===null&&e.legalPlacement===false)&&/\bAnnex\b/iu.test(chosen.targetLabel||''))return unresolved('proposal_annex_ordinal_unverified');
  let selected=chosen;
  if(proposalKind&&nle&&chosen.language==='en'&&/^Annex I(?= [–-])/u.test(chosen.targetLabel||'')) {
    const annexes=(items||[]).filter(item=>item.kind==='annex'),proof=baseline.evidence.find(e=>e.kind==='native-nle-annex-part'&&e.status==='verified'&&e.legalPlacement===true&&e.basis==='sole-annex-adopted-by-native-act');
    if(annexes.length===1&&proof?.sha256===annexes[0].proposal.sourceHash) {
      const alias=raw=>raw.replace(/^Annex I(?= [–-])/u,'Annex');
      selected={...chosen,targetLabel:alias(chosen.targetLabel),...(chosen.targetPath?{targetPath:{...chosen.targetPath,proposal:chosen.targetPath.proposal?.map(path=>({...path,raw:alias(path.raw)}))}}:{})};
    }
  }
  if(proposalKind){
    if(/^Annex – table – .+ \(new\)$/u.test(chosen.targetLabel??'')&&referenceTexts.some(ref=>/\b(?:before|after|following|preceding|point|paragraph)\b|\btable\s+\d/iu.test(ref)))return unresolved('insertion_reference_unavailable');
    if(!items?.length||!chosen.language||(chosen.targetPath?.language??chosen.targetLabelLanguage)!==chosen.language)return unresolved(items?.length?'different_text_languages':council?'council_position_unavailable':'proposal_baseline_unavailable');
    // Preserve established exact body/note rules outside the guarded CNS/NLE
    // templates. The new column-scope proof is a recovery for unresolved rows.
    if(detachedNotes&&!consultation&&!nle&&!pdfCouncil){
      const established=resolveProposalPlacement(items,{...selected,number:selected.number??amendmentNumber},{nativeProposalInputs});
      if(established.status==='placed')return established;
    }
    return detachedNotes?(pdfCouncil?resolveCouncilPdfNoteScope(items,selected):resolveProposalNoteScope(items,selected)):resolveProposalPlacement(items,{...selected,number:selected.number??amendmentNumber},{nativeProposalInputs});
  }
  // Only parsed, same-language vote references are location evidence; the rest stay in provenance.
  const comparable=referenceTexts.filter(reference=>resolutionReference(reference,chosen.language));
  const labelled=chosen.targetLabelLanguage===chosen.language&&Boolean(resolutionReference(chosen.targetLabel,chosen.language));
  let placement=['present-text','council-position'].includes(chosen.baseline)
    ?unresolved(chosen.baseline==='present-text'?'amends_existing_law':'council_position_unavailable')
    :resolveAmendmentPlacement(text,{...chosen,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined,referenceText:labelled?undefined:comparable[0],numberingReferenceTexts:referenceTexts,resolutionDocument});
  if(placement.reason==='source_passage_incomplete')placement=resolveTableInsertion(text,{...chosen,targetLabel:chosen.targetLabelLanguage===chosen.language?chosen.targetLabel:undefined})??placement;
  // Vote lists can rearrange provisions. The published amendment label owns
  // this view; retain disagreement only as a final-text check for the reader.
  if(!labelled&&comparable.length>1){placement={...placement,status:'unresolved',reason:'conflicting_target_evidence'};delete placement.span;delete placement.insertAfter;delete placement.insertBefore;}
  if(placement.status==='placed'&&labelled&&comparable.some(reference=>
    resolveAmendmentPlacement(text,{...chosen,referenceText:reference,resolutionDocument}).reason==='conflicting_target_evidence')) {
    placement={...placement,finalPlacementCheck:{adoptedTextUrl:null}};
  }
  return placement;
}

export {amendmentAlternative,amendmentRejection};

// Only a complete comparison template can separate provision text from notes.
// Keep the published columns unchanged; the cuts also drive the reader.
function comparisonColumn(value,formatting) {
  if(typeof value!=='string'||value.length>64*1024)return null;
  const lines=value.split('\n');let offset=0,separator;
  for(const line of lines){if(/^_{3,}[ \t]*$/u.test(line)){if(separator||offset===0)return null;separator={start:offset-1,end:offset+line.length+1};}offset+=line.length+1;}
  if(!separator)return {body:value,end:value.length,notes:[],references:[],clean:value};
  const body=value.slice(0,separator.start),notes=[];
  for(const line of value.slice(separator.end).split('\n')){
    if(!line.trim())continue;
    const match=/^\s*([1-9]\d*[a-z]{0,3})\.?\s+(.+)$/u.exec(line);
    if(match){if(notes.some(n=>n.label===match[1]))return null;notes.push({label:match[1],text:match[2]});}
    else {if(!notes.length)return null;notes.at(-1).text+='\n'+line;}
  }
  if(!notes.length)return {body,end:separator.start,notes:[],references:[],clean:body};
  const references=[];let clean='',cursor=0;
  for(const mark of (formatting||[]).filter(mark=>mark.kind==='superscript'&&mark.start<body.length).sort((a,b)=>a.start-b.start)){
    if(!Number.isSafeInteger(mark.start)||!Number.isSafeInteger(mark.end)||mark.start<cursor||mark.end<=mark.start||mark.end>body.length)return null;
    const label=/^([1-9]\d*[a-z]{0,3})(?:\.|\+)?$/u.exec(body.slice(mark.start,mark.end))?.[1];
    if(!label||references.some(ref=>ref.label===label))return null;
    clean+=body.slice(cursor,mark.start);references.push({label,prefix:clean});cursor=mark.end;
  }
  clean+=body.slice(cursor);
  if(!references.length||references.some(ref=>!notes.some(note=>note.label===ref.label))||notes.filter(note=>references.some(ref=>ref.label===note.label)).some((note,index)=>note.label!==references[index].label))return null;
  return {body,end:separator.start,notes,references,clean};
}
const textKey=value=>value.normalize('NFC').replace(/\s+/gu,'');

function samePdfCitation(left,right) {
  const protectedUrls=value=>value.match(/https?:\/\/[^\s)]+/giu)??[];
  if(JSON.stringify(protectedUrls(left))!==JSON.stringify(protectedUrls(right)))return false;
  const plain=value=>textKey(value.replace(/https?:\/\/[^\s)]+/giu,'§')),a=plain(left),b=plain(right);
  if(a===b)return true;
  if(Math.abs(a.length-b.length)!==1)return false;
  const short=a.length<b.length?a:b,long=a.length>b.length?a:b;
  return [...long.matchAll(/[.,;]/gu)].some(m=>!( /\d/u.test(long[m.index-1]??'')&&/\d/u.test(long[m.index+1]??''))&&long.slice(0,m.index)+long.slice(m.index+1)===short);
}
// Bound omission to one whole reference also printed in this exact body.
// Nothing else, including URL punctuation or another identifier, is repaired.
function omittedPdfCitationIdentifier(native,reported,body) {
  const pattern=/(?<![\p{L}\p{N}])([A-Z]{1,4})\s*\(\s*(\d{4})\s*\)\s*(\d{1,6})(?![\p{L}\p{N}])/gu;
  const urls=s=>s.match(/https?:\/\/[^\s)]+/giu)??[];
  if(JSON.stringify(urls(native))!==JSON.stringify(urls(reported)))return false;
  const inBody=[...body.matchAll(pattern)].map(m=>textKey(m[0])),refs=[...native.matchAll(pattern)];
  if(refs.length>8)return false;
  let matches=0;
  for(const ref of refs)if(inBody.filter(id=>id===textKey(ref[0])).length===1&&textKey(native.slice(0,ref.index)+native.slice(ref.index+ref[0].length))===textKey(reported))matches++;
  return matches===1;
}
// A bounded PDF note comparison reuses the ordinary body resolver. Neither the
// native note nor the report's detached payload becomes provision body text.
function resolveCouncilPdfNoteScope(items,chosen) {
  const withheld=reason=>({operation:'replace',status:'unresolved',reason:reason??'proposal_note_scope_unavailable',evidence:[]});
  const old=comparisonColumn(chosen.originalText,chosen.originalFormatting),next=comparisonColumn(chosen.proposedText,chosen.proposedFormatting);
  if(!old||!next||old.notes.length!==1||old.references.length!==1||next.notes.length!==1||next.references.length!==1||old.notes[0].label!==next.notes[0].label)return withheld();
  const placement=resolveProposalPlacement(items,{...chosen,originalText:old.clean,originalFormatting:[],proposedText:next.body,proposedFormatting:(chosen.proposedFormatting??[]).filter(mark=>mark.end<=next.end)});
  if(placement.status!=='placed')return placement;
  const proposal=items[placement.itemIndex]?.proposal,{span,splice}=placement;
  if(proposal?.sourceKind!=='pdf'||placement.operation!=='replace'||!span||span.start!==span.end||!splice||splice.start.paragraph!==span.start||splice.end.paragraph!==span.start||splice.start.offset!==0)return withheld();
  const row=proposal.paragraphs[span.start],anchors=(proposal.anchors??[]).filter(a=>a.paragraph===span.start);
  if(!row?.complete||row.source?.complete!==true||row.source.role!=='/P'||row.source.pages?.length!==1||row.properties?.notesComplete!==true||!row.properties.annotationsComplete||row.objects.length||splice.end.offset!==row.text.length||textKey(row.text)!==textKey(old.clean)||anchors.length!==1)return withheld();
  const anchor=anchors[0],notes=(proposal.notes??[]).filter(n=>n.id===anchor.note),note=notes[0],page=row.source.pages[0];
  if(notes.length!==1||!note.complete||note.objects?.length||JSON.stringify(note.source?.pages)!==JSON.stringify([page])||(proposal.notes??[]).filter(n=>n.source?.pages?.includes(page)).length!==1||(proposal.anchors??[]).filter(a=>a.note===note.id).length!==1||anchor.label!==old.references[0].label||note.label!==old.notes[0].label||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>row.text.length||row.text.slice(0,anchor.offset).trimEnd().length!==anchor.offset||textKey(row.text.slice(0,anchor.offset))!==textKey(old.references[0].prefix))return withheld();
  const omitted=!samePdfCitation(note.text,old.notes[0].text);
  if(omitted&&!omittedPdfCitationIdentifier(note.text,old.notes[0].text,row.text))return withheld('council_pdf_note_text_mismatch');
  return {...placement,...(omitted?{originalDifference:'omitted-citation-identifier'}:{}),noteScope:{kind:'pdf-footnotes',originalBodyEnd:old.end,proposedBodyEnd:next.end,sourceNotes:[{id:note.id,label:anchor.label}],proposedLabels:[next.notes[0].label],unreferencedLabels:[]}};
}

function initialRecital(items,chosen) {
  if(chosen.targetLabel!=='Recital -1 (new)'||chosen.originalText!==''||!/^\(-1\)\s+\S/u.test(chosen.proposedText))return null;
  const matches=[];
  for(const [itemIndex,item] of items.entries()){
    const p=item.proposal;if(item.kind!=='act'||p.sourceKind!=='docx')continue;
    const heads=p.paragraphs.filter(row=>row.text.trim()==='Whereas:'),tails=p.paragraphs.filter(row=>row.text.trim()==='HAS ADOPTED THIS DECISION:');
    if(heads.length!==1||tails.length!==1)continue;
    const rows=p.paragraphs.filter(row=>row.index>heads[0].index&&row.index<tails[0].index),block=[heads[0],...rows,tails[0]];
    if(rows.length<2||rows.some((row,i)=>Number(/^\((\d+)\)\s+\S/u.exec(row.text)?.[1])!==i+1)||block.some((row,i)=>!row.complete||row.source?.complete!==true||row.source.container!=='body'||i<block.length-1&&i>0&&(row.source.ordinal!==block[i-1].source.ordinal+1||row.source.segment!==block[i-1].source.segment)))continue;
    matches.push({operation:'insert',status:'placed',itemIndex,insertBefore:rows[0].index,insertAfter:rows[0].index-1,evidence:[{basis:'native-whereas-first-recital'}]});
  }
  return matches.length===1?matches[0]:null;
}
function resolveProposalNoteScope(items,chosen) {
  const withheld=()=>({operation:chosen.originalText?.trim()?'replace':'insert',status:'unresolved',reason:'proposal_note_scope_unavailable',evidence:[]});
  if(chosen.language!=='en')return withheld();
  const original=comparisonColumn(chosen.originalText,chosen.originalFormatting),proposed=comparisonColumn(chosen.proposedText,chosen.proposedFormatting);
  if(!original||!proposed||!(original.notes.length||proposed.notes.length)||original.notes.length!==original.references.length)return withheld();
  // Word anchors have no text characters. Removing their comparison markers
  // can leave whitespace inside empty parentheses; the source proof below
  // still requires the complete paragraph and every original note.
  const body={...chosen,originalText:original.clean.replace(/\(\s+\)/gu,'()'),proposedText:proposed.body,originalFormatting:[],proposedFormatting:(chosen.proposedFormatting||[]).filter(mark=>mark.end<=proposed.body.length)};
  const usual=resolveProposalPlacement(items,body),placement=usual.status==='placed'?usual:initialRecital(items,body)||usual;
  if(placement.status!=='placed')return placement;
  const proposal=items[placement.itemIndex]?.proposal;
  if(proposal?.sourceKind!=='docx')return withheld();
  const sourceNotes=[];
  if(placement.operation==='insert'){
    if(original.body.trim()||original.notes.length)return withheld();
  }else{
    const {span,splice}=placement;
    if(!span||!splice||splice.start.paragraph!==span.start||splice.end.paragraph!==span.end||splice.start.offset!==0)return withheld();
    const rows=proposal.paragraphs.filter(row=>row.index>=span.start&&row.index<=span.end);
    if(!rows.length||rows[0].index!==span.start||rows.at(-1).index!==span.end||splice.end.offset!==rows.at(-1).text.length||rows.some(row=>!row.complete||row.source?.complete!==true)||textKey(rows.map(row=>row.text).join('\n'))!==textKey(original.clean))return withheld();
    const anchors=(proposal.anchors||[]).filter(a=>a.paragraph>=span.start&&a.paragraph<=span.end).sort((a,b)=>a.paragraph-b.paragraph||a.offset-b.offset);
    if(anchors.length!==original.references.length)return withheld();
    for(const [index,anchor] of anchors.entries()){
      const note=proposal.notes?.find(note=>note.id===anchor.note),reference=original.references[index],payload=original.notes[index],row=rows.find(row=>row.index===anchor.paragraph);
      const prefix=rows.filter(row=>row.index<anchor.paragraph).map(row=>row.text).join('\n')+'\n'+row.text.slice(0,anchor.offset);
      if(!note?.complete||anchor.label!==reference.label||payload.label!==reference.label||textKey(note.text)!==textKey(payload.text)||textKey(prefix)!==textKey(reference.prefix))return withheld();
      sourceNotes.push({id:note.id,label:reference.label});
    }
  }
  const unreferencedLabels=[];
  for(const note of proposed.notes)if(!proposed.references.some(ref=>ref.label===note.label)){
    const previous=original.notes.find(old=>old.label===note.label);
    if(!previous||!sourceNotes.some(source=>source.label===note.label)||textKey(previous.text)!==textKey(note.text))return withheld();
    unreferencedLabels.push(note.label);
  }
  return {...placement,noteScope:{kind:'word-footnotes',originalBodyEnd:original.end,proposedBodyEnd:proposed.end,sourceNotes,proposedLabels:proposed.notes.map(note=>note.label),unreferencedLabels}};
}
