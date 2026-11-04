import {assertPrintedInsertion} from './amendment-printed-insertion-oracle.mjs';
import {assertUniqueEntry} from './amendment-unique-entry-oracle.mjs';
import {unnumberedTableAddress,assertUnnumberedTable} from './amendment-unnumbered-table-oracle.mjs';
import {assertResolutionCollision} from './amendment-resolution-collision-oracle.mjs';
import {assertLocalRecitalBoundary} from './amendment-local-recital-oracle.mjs';
import {assertPlaceholderDeletion} from './amendment-placeholder-oracle.mjs';
import {assertNewParentBoundary} from './amendment-benchmark-proposal-oracle.mjs';
import {assertCaptionedComparison} from './amendment-captioned-comparison-oracle.mjs';
import {assertTableContext} from './amendment-table-context-oracle.mjs';
import {assertResolutionBoundaryInsertion} from './amendment-resolution-boundary-oracle.mjs';
import {assertCouncilDraftPlacement} from './amendment-council-draft-oracle.mjs';
import {assertClosingFormula} from './amendment-closing-formula-oracle.mjs';
import {assertFirstAnnex,assertSequentialAnnex} from './amendment-first-annex-oracle.mjs';
import {assertCompoundHeader} from './amendment-compound-header-oracle.mjs';
import {assertFormulaGap} from './amendment-formula-gap-oracle.mjs';
import {assertWordingNumbering} from './amendment-numbering-oracle.mjs';

import {assertBareAnnexInsertion,assertNumberedAnnexInsertion} from './amendment-annex-oracle.mjs';
import {assertResolutionNumberingDrift} from './amendment-numbering-drift-oracle.mjs';
import {assertResolutionPointSimilarity} from './amendment-resolution-point-similarity-oracle.mjs';
import {assertSimilarPlacement,oracleSimilarity,assertResolutionSimilarity,oracleSingleWord} from './amendment-similarity-oracle.mjs';
import {assertChapterTitle} from './amendment-chapter-title-oracle.mjs';
import {assertStandaloneQuote} from './amendment-standalone-quote-oracle.mjs';
import {assertArticleNotes} from './amendment-article-notes-oracle.mjs';
import {inspectNativeNoteScope,assertNativeFirstRecital} from './amendment-note-scope-oracle.mjs';
import {assertGuidelineAnnex} from './amendment-guideline-oracle.mjs';
import {assertQuotedSectionPoint} from './amendment-quoted-section-oracle.mjs';
import {assertBareAnnexReplacement} from './amendment-annex-replacement-oracle.mjs';
import {assertBareAnnexIndent} from './amendment-annex-indent-oracle.mjs';
import {assertWholeAnnexInstruction} from './amendment-whole-instruction-oracle.mjs';
import {assertMaintainerPrinciple} from './amendment-maintainer-oracle.mjs';
import {assertFinnishQuotedSibling,assertQuotedSibling} from './amendment-quoted-sibling-oracle.mjs';
import {assertNewQuotedOrdinal,assertQuotedSubparagraph} from './amendment-quoted-subparagraph-oracle.mjs';
import {assertElidedDeletion} from './amendment-elision-oracle.mjs';
import {assertFootnoteComparison,assertResolutionFootnotes} from './amendment-footnote-oracle.mjs';
import {oracleAddress,oracleRelative,oracleFold} from './amendment-oracle-grammar.mjs';
import {rawLetterPointAssertion} from './amendment-benchmark-letter-point-oracle.mjs';
import {rawQuotedProposalAssertion} from './amendment-benchmark-quoted-oracle.mjs';
import {rawProposalAssertion,assertImplicitParagraphLabel} from './amendment-benchmark-proposal-oracle.mjs';
import {rawResolutionUnits,rawResolutionPointUnits,nativeFinnishFirst,assertMixedRecital,assertTerminalIndent,assertSwedishRecommendation,assertResolutionLead} from './amendment-benchmark-resolution-oracle.mjs';
import {expectedOperation} from './amendment-benchmark-operation-oracle.mjs';
import {expectedLanguageScope,verifyLanguageScope} from './amendment-benchmark-scope-oracle.mjs';
import {assertRecastReading,assertNativeProposalTitle} from './amendment-recast-oracle.mjs';
import {assertRecitalCategoryRepair} from './amendment-recital-category-oracle.mjs';


// Only these affirmative observations remove a row from the denominator.
// HTTP 404/410 of the exact published DOCX proves that distribution unavailable
// at retrieval. Two empty, successfully extracted comparison columns prove no
// wording in that block. Parser failures, missing index URLs, unsupported grids,
// timeouts, language fallbacks and missing API projections NEVER prove absence.
export const SOURCE_REASONS = Object.freeze({
  'source-document-unavailable': 'The exact published DOCX returned HTTP 404 or 410.',
  'source-wording-empty': 'The extracted, supported comparison has two empty columns.',
});

export function classify(stages) {
  if(stages.S5.status==='report-quotation')return {outcome:'withheld-pipeline',reason:'council-text-as-quoted-in-report'};
  if (stages.S6.status === 'failed') return {outcome:'false-placement', reason:stages.S6.reason};
  if(stages.S1.status==='passed'&&stages.S2.status==='passed'&&stages.S5.status==='not-applicable'&&stages.S6.status==='verified')return {outcome:'not-applicable',reason:stages.S6.reason};
  for (const key of ['S1','S2','S3','S4']) {
    const stage = stages[key];
    // A parse limit does not erase a placement the actual pipeline can verify
    // through its quoted-original fallback. Still retain the failed parse stage.
    if (key === 'S3' && stages.S5.status === 'placed') continue;
    if (stage.status !== 'passed') return {outcome:stage.reason?.startsWith('acquisition-')?'acquisition-unavailable':Object.hasOwn(SOURCE_REASONS, stage.reason) ? 'withheld-source' : 'withheld-pipeline', reason:stage.reason};
  }
  if (stages.S5.status !== 'placed') return {outcome:'withheld-pipeline', reason:stages.S5.reason};
  return stages.S6.status === 'verified' ? {outcome:'correct', reason:'oracle-verified'} : {outcome:'placed-unverified', reason:stages.S6.reason};
}

// A verified operation on the whole document is a placement at document scope.
export function classifyRow(stages,documentOperation) {
  if(documentOperation?.status==='verified'&&stages.S5.status==='document-operation') {
    if(documentOperation.reason==='source-attested-rejection')return {outcome:'correct',reason:'whole-document-rejection'};
    if(documentOperation.reason==='source-attested-alternative-motion')return {outcome:'correct',reason:'whole-document-alternative-motion'};
    if(documentOperation.reason==='source-attested-provisional-agreement')return {outcome:'correct',reason:'whole-document-provisional-agreement'};
  }
  return classify(stages);
}

const flatten = units => units.flatMap(unit => [unit, ...flatten(unit.children || [])]);
const parentKey = unit => JSON.stringify(unit.path.slice(0,-1));
const pathKey = path => JSON.stringify(path.map(({kind,value}) => [kind,value]));
const suffixOrder = suffix => {
  const latin = ['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies'];
  if (!suffix) return 0;
  if (latin.includes(suffix)) return latin.indexOf(suffix)+1;
  const alphabet=/^[α-ω]+$/u.test(suffix)?'αβγδεζηθικλμνξοπρστυφχψω':/^[а-я]+$/u.test(suffix)?'абвгдежзийклмнопрстуфхцчшщъьюя':null;
  if(alphabet)return [...suffix].reduce((value,c)=>value*alphabet.length+alphabet.indexOf(c)+1,0);
  if (!/^[a-z]{1,3}$/.test(suffix)) return null;
  return [...suffix].reduce((value,c) => value*26+c.charCodeAt(0)-96,0);
};
const ordinal = value => {
  if(typeof value==='number')return value;
  const alphabet=typeof value==='string'&&/^[A-Z]+$/.test(value)?'ABCDEFGHIJKLMNOPQRSTUVWXYZ':typeof value==='string'&&/^[А-Я]+$/u.test(value)?'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ':null;
  return alphabet?[...value].reduce((n,c)=>n*alphabet.length+alphabet.indexOf(c)+1,0):null;
};
const fail = reason => ({status:'failed', reason});
const verified = reason => ({status:'verified', reason});

export function parseBenchmarkTarget(wording) {
 const table=unnumberedTableAddress(wording);
 if(table)return {raw:table.raw,language:wording.language,complete:true,segments:[{kind:'annex',value:''},{kind:'table',value:table.caption,isNew:true}],unparsed:[]};
 const paths=wording.baseline==='present-text'?wording.targetPath?.underlying:wording.targetPath?.proposal;
 const raw=paths?.length===1?paths[0].raw:wording.targetLabel||'';
 const resolution=['motion-resolution','unknown'].includes(wording.baseline);
 const relative=resolution&&oracleRelative(raw,wording.language);
 const segments=relative?[relative]:oracleAddress(raw.split('\n')[0],wording.language,{resolution});
 if(segments&&resolution&&segments.length===1&&segments[0].kind==='recital'&&segments[0].number!==null&&new RegExp('^\\s*'+segments[0].value+'[.)]\\s','u').test(wording.proposedText||''))segments[0].kind='paragraph';
 return {raw,language:wording.language,complete:Boolean(segments),segments:segments||[],unparsed:segments?[]:['unsupported-oracle-grammar']};
}

// A present-text amendment that adds a numbered amending instruction is
// asserted at the proposal address only: an insertion of that instruction,
// printed with the same number at the start of the proposed column.
export function instructionFrameWording(wording) {
 if(wording?.baseline!=='present-text'||typeof wording.proposedText!=='string')return null;
 const paths=wording.targetPath?.proposal||[];
 if(paths.length>1)return null;
 const raw=(paths.length?paths[0].raw:wording.targetLabel||'').split('\n')[0].trim();
 if(!raw||raw.includes('—'))return null;
 const segments=oracleAddress(raw,wording.language,{resolution:false}),last=segments?.at(-1);
 if(segments?.[0]?.kind!=='article'||!last||!(last.isNew||last.negative)||!['point','article'].includes(last.kind))return null;
 // Outer-level instructions only: a new article, or a point directly under
 // the amending paragraph.
 if(!(segments.length===1&&last.kind==='article'||segments.length===3&&segments[1].kind==='paragraph'&&last.kind==='point'))return null;
 const number=String(last.value).replace(/^(-?\d+)([a-z]+)$/u,'$1 ?$2');
 const printed=last.kind==='article'?new RegExp('^(?:Article|Artykuł) '+number+'(?![ \\t]*[\\p{L}\\p{N}])','u'):new RegExp('^\\('+number+'\\)\\s|^'+number+'\\)\\s','u');
 if(!printed.test(wording.proposedText.trim()))return null;
 return {...wording,baseline:'commission-proposal',originalText:'',targetLabel:raw,targetPath:{...wording.targetPath,proposal:[{raw}],underlying:[]}};
}

// Fixed oracle policy, deliberately independent of the placer's normaliser.
// Preserve case, accents, words and numbers. Strip only a published provision
// prefix, enclosing quotes, whitespace and comparison-column terminators.
export function oracleNormal(value,labels=[]) {
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const prefixes=[...new Set(labels.map(label=>label.value))].map(value=>'\\('+escape(value)+'\\)|'+escape(value)+'[.)]');
  const prefix=prefixes.length?new RegExp('^(?:'+prefixes.join('|')+')\\s*','u'):null;
  // A comparison cell can flatten several source paragraphs. Only the end
  // of the complete comparison has a terminator; internal punctuation stays.
  return value.normalize('NFC').replace(/\u00ad/g,'').replace(/[‘’‚‛ʻʼ]/g,"'").replace(/[“”„‟«»]/g,'"').replace(/[‐‑‒–—]/g,'-')
    .split(/\r?\n/).map(line=>{
      let text=line.trim().replace(/^["']\s*/, '');
      if(prefix)text=text.replace(prefix,'');
      // Published comparison columns can put a closing quote before or after
      // the same terminators. Keep the marks, with one ordering on both sides.
      return text.replace(/([.;]+)(["']+)([.;]*)$/u,'$2$1$3');
    }).join(' ').replace(/\s+/gu,' ').trim().replace(/[.;'"\s]+$/u,'');
}
// Consolidation comparisons can put several labelled list points in one cell
// paragraph. Preserve their internal labels and punctuation across line wraps.
export function existingLawOracleNormal(value,labels=[]) {
  const escape=text=>String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const prefixes=[...new Set(labels.map(label=>label.value))].flatMap(value=>['\\('+escape(value)+'\\)',escape(value)+'[.)]']);
  let key=value.normalize('NFC').replace(/\u00ad/g,'').replace(/[‘’‚‛ʻʼ]/g,"'").replace(/[“”„‟«»]/g,'"').replace(/[‐‑‒–—]/g,'-').replace(/\s+/gu,' ').trim().replace(/^["']\s*/u,'').replace(/[.;'"\s]+$/u,'');
  if(prefixes.length)key=key.replace(new RegExp('^(?:'+prefixes.join('|')+')\\s*','u'),'');
  return key.trim();
}
const occurrences=(haystack,needle)=>{
  let count=0,offset=0;if(!needle)return 0;
  while((offset=haystack.indexOf(needle,offset))>=0){count++;offset++;}return count;
};
function firstSubparagraphAddress(proposal,target){
  const at=target.segments.findIndex((segment,index)=>segment.kind==='subparagraph'&&index<target.segments.length-1);
  if(at<0)return {target};
  if(target.segments[at].value!=='1')return null;
  const parents=flatten(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.kind===target.segments[at-1]?.kind&&pathKey(unit.path)===pathKey(target.segments.slice(0,at)));
  if(parents.length!==1)return null;
  const parent=parents[0],first=proposal.paragraphs[parent.content?.at(-1)];
  if(!first?.text.trimEnd().endsWith(':')||!parent.children.some(unit=>unit.kind==='point'))return null;
  const end=parent.children.find(unit=>unit.kind==='subparagraph')?.extent.start??parent.extent.end;
  return {target:{...target,segments:target.segments.filter((_,i)=>i!==at)},bounds:{start:parent.extent.start,end}};
}
function locationOracle({proposal,text,target,wording,placement,labels}) {
  const span=placement.span;
  const source=proposal?proposal.paragraphs.map(p=>p.text).join('\n'):text.paragraphs.join('\n');
  const key=wording.baseline==='present-text'?existingLawOracleNormal:oracleNormal;
  const count=occurrences(key(source,labels),key(wording.originalText,labels));
  // An introductory part is the provision's own lead before its first child;
  // without children the lead cannot be established independently.
  const introductory=target.complete&&target.segments.at(-1)?.kind==='introductory-part';
  if(introductory)target={...target,segments:target.segments.slice(0,-1)};
  if(target.complete&&target.segments.length) {
    let candidates=[];
    if(proposal) {
      if(target.segments.some(segment=>segment.kind==='subparagraph')){
        const address=firstSubparagraphAddress(proposal,target);
        if(!address?.bounds)return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
        if(span.start<address.bounds.start||span.end>=address.bounds.end)return fail('oracle-subparagraph-span-mismatch');
        target=address.target;
      }
      candidates=flatten(proposal.units).filter(unit=>unit.scope==='proposal'&&unit.path.length>=target.segments.length&&pathKey(unit.path.slice(-target.segments.length))===pathKey(target.segments))
        .map(unit=>introductory
          ?(unit.children.length?{start:unit.extent.start,end:Math.min(...unit.children.map(child=>child.extent.start))-1,spans:unit.spans||[]}:null)
          :{start:unit.extent.start,end:unit.extent.end-1,spans:flatten([unit]).flatMap(child=>child.spans||[])});
      if(introductory&&candidates.some(unit=>!unit))return {status:'unverified',reason:'oracle-introductory-part-unavailable'};
    } else {
      const label=target.segments.at(-1),parent=target.segments.at(-2);
      if(!['paragraph','recital','citation','point'].includes(label.kind))return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
      const {units,reason}=rawResolutionUnits(text,wording.language);
      if(reason)return {status:'unverified',reason};
      candidates=units.filter(unit=>unit.kind===label.kind&&unit.label===(label.kind==='recital'?label.value.toUpperCase():label.value)&&(label.kind!=='point'||units.find(owner=>owner.start===unit.parent)?.label===parent.value));
      if(label.kind==='point'){
        const indented=rawResolutionPointUnits(text).units.filter(unit=>pathKey(unit.path)===pathKey(target.segments));
        if(indented.length)candidates=indented;
        else if(parent?.kind!=='paragraph')return {status:'unverified',reason:'oracle-address-grammar-unavailable'};
      }
      if(introductory) {
        // Repeated paragraph numbers elsewhere in a multilingual report do not
        // determine the lead boundary of the unit containing the returned span.
        candidates=candidates.filter(unit=>span.start>=unit.start&&span.end<=unit.end);
        candidates=candidates.map(unit=>{const children=units.filter(child=>child.parent===unit.start);return children.length?{...unit,end:Math.min(...children.map(child=>child.start))-1}:null;});
        if(candidates.some(unit=>!unit))return {status:'unverified',reason:'oracle-introductory-part-unavailable'};
      }
    }
    if(!candidates.length)return {status:'unverified',reason:'oracle-address-unit-unavailable'};
    const inside=unit=>{
      if(span.start<unit.start||span.end>unit.end)return false;
      if(!proposal)return true;
      const splice=placement.splice;
      // Every covered character must belong to this addressed subtree; paragraph
      // extents alone cannot distinguish inline quoted provisions in one row.
      for(let paragraph=span.start;paragraph<=span.end;paragraph++) {
        const from=paragraph===span.start?splice.start.offset:0,to=paragraph===span.end?splice.end.offset:proposal.paragraphs.find(p=>p.index===paragraph)?.text.length;
        const spans=unit.spans.filter(s=>s.paragraph===paragraph).sort((a,b)=>a.start-b.start);
        let covered=from;for(const slice of spans){if(slice.start>covered)break;if(slice.end>covered)covered=slice.end;}
        if(covered<to)return false;
      }
      return true;
    };
    if(!candidates.some(inside))return fail('oracle-address-span-mismatch');
    // Replacement coordinates need a verified addressed span, not a complete
    // trailing extent. Unknown rows already close the raw unit before them;
    // insertion still requires the independently complete subtree below.
    if(!proposal&&text.paragraphSources.slice(span.start,span.end+1).some(source=>source.complete!==true))return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(candidates.length===1)return {...verified('oracle-addressed-source-span'),originalOccurrences:count};
  }
  return count===1?{...verified('oracle-unique-original-source-span'),originalOccurrences:count}:{status:'unverified',reason:'oracle-original-not-unique',occurrences:count};
}

// Proposal preambles print unlabelled citations between the enacting
// institutions line and "Whereas:"; EP addresses count them in order.
// Raw rows only: every row in that run must be a complete body row.
function rawPreambleCitations(proposal) {
  const rows=proposal?.paragraphs??[];
  const opens=rows.filter(row=>/^THE (?:EUROPEAN PARLIAMENT AND THE )?COUNCIL OF THE EUROPEAN UNION,$/u.test(String(row.text).trim()));
  if(opens.length!==1)return null;
  const close=rows.find(row=>row.index>opens[0].index&&/^Whereas:$/u.test(String(row.text).trim()));
  if(!close)return null;
  const run=rows.filter(row=>row.index>opens[0].index&&row.index<close.index);
  if(!run.length||run.some(row=>row.complete===false||row.source?.complete!==true||row.source?.container!=='body'||!String(row.text).trim()))return null;
  // Every counted row must open a citation; continuations shift the ordinals.
  if(run.some(row=>!/^(?:Having regard to|After (?:transmission|consulting|consultation)|Acting in accordance with)\b/u.test(String(row.text).trim())))return null;
  return run;
}
function verifyPreambleCitation({proposal,wording,placement,target}) {
  const label=target.segments[0];
  if(wording.language!=='en'||target.segments.length!==1||label.kind!=='citation'||!Number.isInteger(label.number)||label.negative)return null;
  if(/^The European Parliament rejects\b/u.test(String(wording.proposedText).trim()))return {status:'unverified',reason:'oracle-operation-unavailable'};
  const run=rawPreambleCitations(proposal);
  if(!run)return {status:'unverified',reason:'oracle-preamble-unavailable'};
  const row=run[label.number-1];
  if(!row)return fail('oracle-citation-ordinal-missing');
  if(placement.operation==='insert') {
    if(!label.isNew||!label.suffix||wording.originalText!=='')return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    if(placement.insertBefore!==row.index+1||placement.insertAfter!==row.index)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-preamble-citation-boundary');
  }
  if(label.isNew||label.suffix)return {status:'unverified',reason:'oracle-operation-unavailable'};
  if(placement.span?.start!==row.index||placement.span?.end!==row.index)return fail('oracle-address-span-mismatch');
  // The spliced source itself must be the original wording.
  const splice=placement.splice,text=String(row.text);
  if(splice?.start?.paragraph!==row.index||splice?.end?.paragraph!==row.index||!(splice.start.offset>=0&&splice.start.offset<=splice.end.offset&&splice.end.offset<=text.length))return fail('oracle-invalid-span');
  const notes=assertFootnoteComparison(proposal,wording,placement);
  if(notes?.status==='failed')return notes;
  if(!notes&&oracleNormal(text.slice(splice.start.offset,splice.end.offset))!==oracleNormal(wording.originalText))return fail('oracle-original-span-mismatch');
  return verified('oracle-preamble-citation-span');
}
// Maintainer P2 for articles: a new Article -1 goes immediately after the
// enacting formula, before a printed Article 1 directly following it.
function verifyNegativeArticle({proposal,wording,placement,target}) {
  const label=target.segments[0];
  if(target.segments.length!==1||label.kind!=='article'||label.value!=='-1'||wording.language!=='en'||wording.originalText!=='')return null;
  if(!/^Article\s*[-−–‑]\s*1\b/u.test(String(wording.proposedText).trim()))return {status:'unverified',reason:'oracle-insertion-label-unverified'};
  const rows=proposal?.paragraphs??[];
  const formulas=rows.filter(row=>/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(String(row.text).trim()));
  if(formulas.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  const next=rows[formulas[0].index+1];
  if(!next||String(next.text).trim()!=='Article 1'||next.complete===false||next.source?.complete!==true||formulas[0].source?.complete!==true)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  if(placement.insertBefore!==next.index||placement.insertAfter!==next.index-1)return fail('oracle-insertion-boundary-mismatch');
  return verified('oracle-negative-article-boundary');
}

// Oracle-owned point ordinals. A sibling family is Roman when it starts at i
// and every base is a Roman numeral; lettered when it starts at a and every
// base is one letter. Anything else stays unverified.
const romanValue = value => {
  if (!/^[ivxlc]+$/u.test(value)) return null;
  const digits = {i:1,v:5,x:10,l:50,c:100};
  return [...value].reduce((sum,c,i) => sum+(digits[c] < (digits[value[i+1]] ?? 0) ? -digits[c] : digits[c]),0);
};
const pointBase = unit => {
  const value = String(unit.label?.value ?? ''), suffix = unit.label?.suffix || '';
  return suffix && value.endsWith(suffix) ? value.slice(0,-suffix.length) : value;
};
const canonicalRoman = value => /^[ivxlc]+$/u.test(value) && /^c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/u.test(value);
function pointFamilyPosition(bases, wanted) {
  const all = [...bases, wanted];
  if (bases[0] === 'a' && all.every(base => /^[a-z]$/u.test(base))) return base => base.charCodeAt(0)-96;
  if (bases[0] === 'i' && all.every(canonicalRoman) && bases.every((base,index) => romanValue(base) === index+1)) return romanValue;
  return null;
}
// Published addresses may omit an article's sole unnumbered paragraph 1
// (maintainer P1). Accept only that omission, never another parent.
function omittedSoleParagraph(all, anchor, parent) {
  const path = anchor.path.slice(0,-1), at = path.findIndex((segment,index) => index > 0 && segment.kind === 'paragraph' && path[index-1].kind === 'article');
  if (at < 0 || parent.some(segment => segment.kind === 'paragraph')) return false;
  const shortened = [...path.slice(0,at), ...path.slice(at+1)];
  if (shortened.length < parent.length || pathKey(shortened.slice(-parent.length)) !== pathKey(parent)) return false;
  const article = pathKey(path.slice(0,at)), paragraphs = all.filter(u => u.kind === 'paragraph' && pathKey(u.path.slice(0,-1)) === article);
  return paragraphs.length === 1 && paragraphs[0].implicit === true && paragraphs[0].label?.value === '1' && pathKey(paragraphs[0].path) === pathKey(path.slice(0,at+1));
}

// A negative first provision (-1, -1a, -A, point -a) goes immediately before
// the first raw sibling of its kind: paragraph 1, recital A before the
// operative paragraphs, or point (a) of the named paragraph. The printed
// label in the proposed column must carry the same negative number.
function verifyNegativeFirst(text,wording,target,placement) {
  const label=target.segments.at(-1),first={paragraph:'1',recital:'A',point:'a'}[label.kind];
  const negative=first&&new RegExp(`^-${first}([a-z]?)$`,'u').exec(label.value);
  if(!negative||wording.originalText!==''||target.segments.slice(0,-1).some(segment=>segment.isNew||segment.negative))return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const dash='[-−–‑]\\s*',suffix=negative[1];
  const printed={paragraph:new RegExp(`^${dash}1${suffix}[.)]\\s`,'u'),recital:new RegExp(`^${dash}A${suffix}[.)]\\s`,'u'),point:new RegExp(`^\\(${dash}a${suffix}\\)\\s`,'u')}[label.kind];
  if(!printed.test(oracleFold(wording.proposedText).replace(/^[-−–‑]\s+(?=\d)/u,'-')))return {status:'unverified',reason:'oracle-insertion-label-unverified'};
  const raw=rawResolutionUnits(text,wording.language);
  if(raw.reason)return {status:'unverified',reason:raw.reason};
  const paragraphs=raw.units.filter(unit=>unit.kind==='paragraph');
  let family;
  if(label.kind==='point') {
    const owners=paragraphs.filter(unit=>target.segments.length===2&&target.segments[0].kind==='paragraph'&&unit.label===target.segments[0].value);
    if(owners.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    family=raw.units.filter(unit=>unit.kind==='point'&&unit.parent===owners[0].start);
  } else family=raw.units.filter(unit=>unit.kind===label.kind);
  if(target.segments.length!==1&&label.kind!=='point')return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const anchor=family.sort((a,b)=>a.start-b.start)[0];
  if(anchor?.label!==first||family.filter(unit=>unit.label===first).length!==1||anchor.start<1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  if(label.kind==='recital'&&!(paragraphs.length&&anchor.start<Math.min(...paragraphs.map(unit=>unit.start))))return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  // Incomplete or non-body rows before the anchor can hide another first label.
  // Points also need the only printed owner paragraph from the resolution start.
  const from=raw.start,owner=label.kind==='point'?anchor.parent:null;
  const printedFirst={paragraph:/^1[.)]\s/u,recital:/^A[.)]\s/u,point:/^\(a\)\s|^a\)\s/u}[label.kind];
  const printedOwner=owner===null?null:new RegExp(`^${target.segments[0].value}[.)]\\s`,'u');
  if(!Number.isInteger(from)||owner!==null&&!(from<=owner))return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  for(let row=from;row<anchor.start;row++) {
    const source=text.paragraphSources?.[row],value=String(text.paragraphs[row]??'').trim();
    if(source?.complete!==true||source.container!=='body'||(owner===null||row>owner)&&printedFirst.test(value)||printedOwner&&row!==owner&&printedOwner.test(value))return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  }
  const before=text.paragraphSources?.[anchor.start-1],at=text.paragraphSources?.[anchor.start];
  if(!anchor.complete||before?.complete!==true||before.container!=='body'||at?.complete!==true)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
  if(placement.insertBefore!==anchor.start||placement.insertAfter!==anchor.start-1)return fail('oracle-insertion-boundary-mismatch');
  return verified('oracle-negative-first-boundary');
}


// Single Latin or Cyrillic capitals and plain numbers only. Both neighbours
// must be adjacent in source order, one ordinal either side, and the lower
// neighbour's last row must print the missing label after a terminator.
export function numberingGap(text,units,base){
  const position=value=>/^\d+$/u.test(value)?Number(value):/^[A-Z\u0410-\u042f]$/u.test(value)?value.codePointAt(0):null;
  const wanted=position(base);
  if(wanted==null||units.some(unit=>unit.label.startsWith(base)))return null;
  const ordered=[...units].sort((a,b)=>a.start-b.start),hits=[];
  for(let i=1;i<ordered.length;i++){
    const before=ordered[i-1],after=ordered[i];
    if(before.group===after.group&&position(before.label)===wanted-1&&position(after.label)===wanted+1&&after.start===before.end+1)hits.push(before);
  }
  if(hits.length!==1||ordered.filter(unit=>unit.label===hits[0].label).length!==1)return null;
  const row=text.paragraphs[hits[0].end]??'',at=row.lastIndexOf(base);
  return at>0&&/[;.:]\s*$/u.test(row.slice(0,at))&&/^[.)]\s*\S/u.test(row.slice(at+base.length))?hits[0]:null;
}
// Annex tables: rebuild logical rows from raw Word paths (a body paragraph,
// or one table row whose cells join with tabs) and require the amendment's
// original lines to match one unique contiguous run cell for cell, inside the
// annex its label names. Never consult placer units or evidence.
const tableAddress=(raw,original='')=>{const label=String(raw??'').split('\n')[0].trim();return /^Annex ([IVXLC]+)\b.*\s[–—-]\s+table(?:\s+on\s+[^–—-]+)?$/u.exec(label)||(original.includes('\t')&&original.includes('\n')?/^Annex ([IVXLC]+) – point [1-9]\d*$/u.exec(label):null);};
const rawCell=value=>String(value).normalize('NFC').replace(/\s+/gu,' ').trim();
function rawLogicalRows(proposal) {
  const rows=[];let current=null;
  for(const row of proposal?.paragraphs??[]) {
    const source=row.source??{};
    if(source.container==='table-cell') {
      const cell=/^(.*\/w:tr\[\d+\])\/w:tc\[(\d+)\]\/w:p\[(\d+)\]$/u.exec(source.path??'');
      if(!cell)return null;
      if(current?.key!==cell[1]){current={key:cell[1],cells:[],indexes:[],columns:[]};rows.push(current);}
      // Later paragraphs of one cell make that row unmatchable, not the whole item.
      current.cells.push(cell[3]==='1'?rawCell(row.text):'\u0000');current.indexes.push(row.index);
      if(cell[3]==='1')current.columns.push(Number(cell[2]));
      if(row.complete===false||source.complete!==true)current.broken=true;
    } else {
      current=null;
      rows.push({key:null,cells:[rawCell(row.text)],indexes:[row.index],broken:row.complete===false||source.complete!==true||source.container!=='body'});
    }
  }
  // Empty cells retain no paragraph. The extracted source table records every
  // cell: a row matches only when it has exactly the retained columns 1..n,
  // without spans or merges; skipped row numbers break runs.
  const cellCounts=new Map(),tables=[];
  const collect=units=>{for(const unit of units??[]){if(unit.table)tables.push(unit.table,...(unit.table.nestedTables??[]));collect(unit.children);}};
  collect(proposal?.units);
  for(const source of tables)for(const tr of source.rows??[]){
    const plain=tr.cells.every(cell=>(cell.colSpan??1)===1&&!cell.horizontalMerge&&!cell.verticalMerge);
    for(const cell of tr.cells)for(const index of cell.paragraphs??[])cellCounts.set(index,plain?tr.cells.length:-1);
  }
  const table=key=>key.replace(/\/w:tr\[\d+\]$/u,''),rowNumber=key=>Number(/\/w:tr\[(\d+)\]$/u.exec(key)[1]);
  rows.forEach((row,index)=>{
    if(!row.key)return;
    if(row.columns.some((column,at)=>column!==at+1)||cellCounts.get(row.indexes[0])!==row.columns.length)row.broken=true;
    const previous=rows[index-1];
    if(previous?.key&&table(previous.key)===table(row.key)&&rowNumber(row.key)!==rowNumber(previous.key)+1)row.gapBefore=true;
  });
  return rows;
}
// Reconstruct a whole table from cell paths inside the literal article and
// paragraph headings. This assertion never reads placer units or evidence.
function verifyArticleTable({proposal,wording,placement}) {
 const match=/^Article ([1-9]\d*) – paragraph ([1-9]\d*) – table$/u.exec(wording.targetLabel||'');
 if(!match||wording.language!=='en'||!['replace','delete'].includes(placement.operation))return null;
 const unknown={status:'unverified',reason:'oracle-article-table-unavailable'}, rows=rawLogicalRows(proposal);if(!rows)return unknown;
 const articles=rows.flatMap((row,i)=>!row.key&&row.cells[0]==='Article '+match[1]?[i]:[]);if(articles.length!==1)return unknown;
 const start=articles[0],nextArticle=rows.findIndex((row,i)=>i>start&&!row.key&&/^Article \d+[a-z]*$/u.test(row.cells[0]));
 if(nextArticle<0)return unknown;
 const owners=rows.flatMap((row,i)=>i>start&&i<nextArticle&&!row.key&&new RegExp('^'+match[2]+'[.)]\\s','u').test(row.cells[0])?[i]:[]);
 if(owners.length!==1)return unknown;
 const lines=String(wording.originalText||'').split('\n').map(line=>line.split('\t').map(rawCell)),at=owners[0]+1,run=rows.slice(at,at+lines.length);
 if(!lines.length||run.length!==lines.length||run.some((row,i)=>!row.key||row.broken||i&&row.gapBefore||row.cells.length!==lines[i].length||row.cells.some((cell,j)=>cell!==lines[i][j])))return unknown;
 const table=row=>row?.key?.replace(/\/w:tr\[\d+\]$/u,'');const key=table(run[0]);
 const end=rows.findIndex((row,i)=>i>owners[0]&&i<nextArticle&&!row.key&&/^[1-9]\d*[.)]\s/u.test(row.cells[0]));
 const limit=end<0?nextArticle:end,tableKeys=new Set(rows.slice(owners[0]+1,limit).filter(row=>row.key).map(table));
 if(tableKeys.size!==1||!tableKeys.has(key))return unknown;
 if(run.some(row=>table(row)!==key)||table(rows[at-1])===key||table(rows[at+run.length])===key||at+run.length>nextArticle)return unknown;
 const geometry=[];const scan=units=>{for(const unit of units??[]){if(unit.table)geometry.push(unit.table,...(unit.table.nestedTables??[]));scan(unit.children);}};scan(proposal.units);
 const matches=geometry.filter(value=>value.sourcePath===key),number=row=>Number(/\/w:tr\[(\d+)\]$/u.exec(row.key)?.[1]);
 if(matches.length!==1||matches[0].complete!==true||!Array.isArray(matches[0].rows)||matches[0].rows.length!==run.length||number(run[0])!==1||number(run.at(-1))!==matches[0].rows.length)return unknown;
 const first=run[0].indexes[0],last=run.at(-1).indexes.at(-1),endText=proposal.paragraphs[last]?.text??'';
 if(placement.span?.start!==first||placement.span?.end!==last||placement.splice?.start?.paragraph!==first||placement.splice.start.offset!==0||placement.splice?.end?.paragraph!==last||placement.splice.end.offset!==endText.length)return fail('oracle-article-table-boundary-mismatch');
 return verified('oracle-article-table-rows');
}
function rawCaptionDecoration(wording,items,proposal){
  if(wording.baseline!=='commission-proposal'||items?.length!==2||items.filter(item=>item.kind==='act').length!==1||items.filter(item=>item.kind==='annex'&&item.proposal===proposal).length!==1||wording.targetPath?.underlying?.length)return null;
  const path=/^Annex ([IVXLC]+) – paragraph 1 – table on ([^\r\n]+)\n(Regulation \((?:EU|EC)\) \d{4}\/\d+)\nAnnex ([IVXLC]+) – table ([^\r\n]+)$/u.exec(wording.targetLabel||''),caption=/^‘\[([^\r\n\t\[\]]+)\r?\nCN code\tGreenhouse gas\r?\n/u.exec(wording.originalText||'');
  if(!path||!caption||wording.targetPath?.proposal?.length&&((wording.targetPath.proposal.length!==1)||wording.targetPath.proposal[0].raw!==wording.targetLabel.split('\n')[0])||rawCell(path[2]).toLowerCase()!==rawCell(caption[1]).toLowerCase()||rawCell(path[5]).toLowerCase()!==rawCell(caption[1]).toLowerCase())return null;
  const act=items.find(item=>item.kind==='act').proposal;
  const leads=act.paragraphs.filter(row=>rawCell(row.text)===path[3]+' is amended as follows:');
  if(leads.length!==1||!leads[0].complete||leads[0].source?.complete!==true||leads[0].source.container!=='body')return null;
  return {inner:path[4],outer:path[1]};
}
function verifyAnnexTable({proposal,wording,placement,items}) {
  const address=tableAddress(wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel,wording.baseline==='commission-proposal'?wording.originalText:'');
  if(!address||wording.language!=='en'||!['replace','delete'].includes(placement.operation))return null;
  const rows=rawLogicalRows(proposal);
  if(!rows)return {status:'unverified',reason:'oracle-table-structure-unavailable'};
  const lines=String(wording.originalText).split('\n').map(line=>line.split('\t').map(rawCell));
  const same=(row,line)=>row.cells.length===line.length&&row.cells.every((cell,index)=>cell===line[index]);
  const starts=[];
  for(let i=0;i+lines.length<=rows.length;i++)if(lines.every((line,offset)=>same(rows[i+offset],line)))starts.push(i);
  let decoration=null;
  if(!starts.length){
    decoration=rawCaptionDecoration(wording,items,proposal);
    if(decoration){lines[0][0]=lines[0][0].slice(2);for(let i=0;i+lines.length<=rows.length;i++)if(lines.every((line,offset)=>same(rows[i+offset],line)))starts.push(i);}
  }
  let wordDifference=false;
  if(!starts.length&&!decoration)for(let i=0;i+lines.length<=rows.length;i++){
    const run=rows.slice(i,i+lines.length);
    if(!run.every((row,j)=>row.cells.length===lines[j].length))continue;
    const changed=run.flatMap((row,j)=>row.cells.flatMap((value,k)=>value===lines[j][k]?[]:[[value,lines[j][k]]]));
    if(changed.length===1&&oracleSingleWord(...changed[0])){starts.push(i);wordDifference=true;}
  }
  if(starts.length!==1)return {status:'unverified',reason:'oracle-table-rows-not-unique'};
  const run=rows.slice(starts[0],starts[0]+lines.length);
  if(run.some((row,index)=>row.broken||index&&row.gapBefore))return {status:'unverified',reason:'oracle-table-rows-incomplete'};
  const first=run[0].indexes[0],last=run.at(-1).indexes.at(-1);
  const before=rows.slice(0,starts[0]),headingAt=before.map(row=>!row.key&&/^ANNEX\s+[IVXLC]+$/u.test(row.cells[0])).lastIndexOf(true);
  if(headingAt<0||before[headingAt].cells[0]!=='ANNEX '+address[1])return {status:'unverified',reason:'oracle-annex-identity-unverified'};
  if(decoration){
    const scopeRows=before.slice(headingAt).filter(row=>!row.key),prefix=scopeRows.slice(1).map(row=>row.cells[0]),tableKey=run[1]?.key?.replace(/\/w:tr\[\d+\]$/u,'');
    if(scopeRows.some(row=>row.broken)||address[1]!==decoration.outer||run[0].key||!tableKey||run.slice(1).some(row=>!row.key||row.key.replace(/\/w:tr\[\d+\]$/u,'')!==tableKey||row.cells.length!==2)||prefix.filter(value=>/^‘ANNEX [IVXLC]+$/u.test(value)).length!==1||!prefix.includes('‘ANNEX '+decoration.inner)||prefix.filter(value=>/^The following Annex [IVXLC]+ is added:$/u.test(value)).length!==1||!prefix.includes('The following Annex '+decoration.inner+' is added:'))return {status:'unverified',reason:'oracle-table-caption-scope-unverified'};
  }
  // Subordinate addresses: only 'paragraph 1' (no other numbered paragraph
  // before the run) or 'point N' (nearest preceding numbered point is N).
  const lead=before.slice(headingAt+1).filter(row=>!row.key).map(row=>row.cells[0]);
  const sub=String(wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel).split('\n')[0].replace(/\s[–—-]\s+table(?:\s+on\s+[^–—-]+)?$/u,'').split(/\s+[–—-]\s+/u).slice(1);
  if(sub.length>1)return {status:'unverified',reason:'oracle-table-address-unsupported'};
  if(sub.length===1) {
    const paragraph=/^paragraph 1$/u.test(sub[0]),point=/^point (\d+)$/u.exec(sub[0]);
    if(paragraph&&lead.some(text=>/^(\d+)[.)]\s/u.exec(text)?.[1]&&!/^1[.)]\s/u.test(text)))return {status:'unverified',reason:'oracle-table-address-unverified'};
    if(point&&[...lead].reverse().map(text=>/^\((\d+)\)\s/u.exec(text)?.[1]).find(Boolean)!==point[1])return {status:'unverified',reason:'oracle-table-address-unverified'};
    if(!paragraph&&!point)return {status:'unverified',reason:'oracle-table-address-unsupported'};
  }
  if(placement.span?.start!==first||placement.span?.end!==last)return fail('oracle-address-span-mismatch');
  // The splice must cover those rows exactly, from offset 0 to the last row's end.
  const splice=placement.splice,lastText=String(proposal.paragraphs.find(row=>row.index===last)?.text??'');
  if(splice?.start?.paragraph!==first||splice?.end?.paragraph!==last||splice.start.offset!==0||splice.end.offset!==lastText.length)return fail('oracle-invalid-span');
  return verified(wordDifference?'oracle-annex-table-single-word':decoration?'oracle-annex-table-caption-decoration':'oracle-annex-table-rows');
}

function verifyResolutionInsertion(text,wording,target,placement) {
  const mixed=assertMixedRecital({text,wording,placement});
  if(mixed.status!=='unverified')return mixed;
  const boundary=assertResolutionBoundaryInsertion({text,wording,placement});if(boundary)return boundary;
  const label=target.segments.at(-1);
  if(label.kind==='recital'&&label.isNew&&target.segments.length===1) {
    const raw=rawResolutionUnits(text,wording.language),recitals=raw.units.filter(unit=>unit.kind==='recital');
    const first=raw.units.find(unit=>unit.kind==='paragraph');
    const ordinal=value=>/^[A-Z]+$/u.test(value)?[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0):null;
    const beyond=recitals.length&&!recitals.some(unit=>unit.label===String(label.base))&&ordinal(String(label.base))!==null&&ordinal(recitals.at(-1).label)!==null&&ordinal(String(label.base))>ordinal(recitals.at(-1).label);
    if(!raw.reason&&first?.label==='1'&&(!recitals.length&&['-A','A'].includes(label.value)||beyond)) {
      const last=recitals.at(-1),from=last?.start??raw.units[0]?.start;
      const sources=text.paragraphSources;
      const complete=Number.isInteger(from)&&sources.slice(from,first.start+1).every((row,i)=>row.complete&&row.container==='body'&&(!i||row.containerPath===sources[from+i-1].containerPath&&row.segment===sources[from+i-1].segment&&row.ordinal===sources[from+i-1].ordinal+1));
      const ordered=recitals.every((unit,i)=>unit.complete&&ordinal(unit.label)===i+1&&unit.end<first.start);
      if(!complete||!ordered||last&&last.end!==first.start-1)return {status:'unverified',reason:'oracle-recital-boundary-unverified'};
      return placement.insertBefore===first.start&&placement.insertAfter===first.start-1?verified('oracle-recital-body-boundary'):fail('oracle-insertion-boundary-mismatch');
    }
  }
  if(label.negative&&!(wording.language==='fi'&&label.kind==='paragraph'))return verifyNegativeFirst(text,wording,target,placement);
  if(label.negative) {
    // Literal Finnish published pre-first paragraph family. Derive the boundary
    // from raw resolution rows, never the returned anchor/evidence or server ref.
    const literal=wording.language==='fi'&&/^-1( [a-z])? kohta \(uusi\)$/u.exec(wording.targetLabel||'');
    if(!literal||!wording.proposedText?.startsWith('-1'+(literal[1]||'')+'.')||wording.originalText!==''||target.segments.length!==1||!label.isNew)return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    const raw=rawResolutionUnits(text,'fi');
    const numbered=raw.units.filter(unit=>unit.kind==='paragraph');
    const first=numbered[0];
    if(raw.reason||!nativeFinnishFirst(text,first)||first?.label!=='1'||numbered.filter(unit=>unit.label==='1').length!==1||first.start<1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    if(placement.insertBefore!==first.start||placement.insertAfter!==first.start-1)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-negative-first-paragraph-boundary');
  }
  if(!label.isNew)return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const raw=rawResolutionUnits(text,wording.language,{includeTables:true});
  if(raw.reason)return {status:'unverified',reason:raw.reason};
  const units=raw.units,parents=target.segments.slice(0,-1);
  const owns=unit=>{
    let at=units.find(candidate=>candidate.start===unit.parent);
    for(const wanted of [...parents].reverse()) {
      if(!at||at.kind!==wanted.kind||at.label!==wanted.value)return false;
      at=units.find(candidate=>candidate.start===at.parent);
    }
    return true;
  };
  const kind=label.after?'paragraph':label.kind;
  if(!['paragraph','recital','citation','point'].includes(kind))return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  const bases=units.filter(unit=>unit.kind===kind&&unit.label===String(label.base)&&owns(unit));
  if(wording.originalText.trim()) {
    if(target.segments.length!==1||kind!=='paragraph'||!label.suffix||bases.length!==1||!bases[0].complete)return {status:'unverified',reason:'oracle-insertion-context-unverified'};
    const base=bases[0],labels=[{value:base.label}],source=text.paragraphs.slice(base.start,base.end+1).join('\n');
    if(oracleNormal(source,labels)!==oracleNormal(wording.originalText,labels))return fail('oracle-insertion-context-mismatch');
  }

  // A new recital continuing the raw A, B, C… sequence before the operative
  // paragraphs follows the last raw recital; its printed letter must match.
  if(!bases.length&&kind==='recital'&&!label.suffix&&!label.after&&!parents.length&&/^[A-Z]$/u.test(label.value)) {
    const recitals=units.filter(unit=>unit.kind==='recital').sort((a,b)=>a.start-b.start),paragraphs=units.filter(unit=>unit.kind==='paragraph');
    const last=recitals.at(-1);
    if(!last||!recitals.every((unit,index)=>unit.label===String.fromCharCode(65+index))||label.value!==String.fromCharCode(65+recitals.length)||!paragraphs.length||last.start>Math.min(...paragraphs.map(unit=>unit.start)))return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    if(!new RegExp(`^${label.value}[.)]\\s`,'u').test(oracleFold(wording.proposedText)))return {status:'unverified',reason:'oracle-insertion-label-unverified'};
    if(!last.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(placement.insertBefore!==last.end+1||placement.insertAfter!==last.end)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-sequence-append-boundary');
  }
  if(!bases.length&&kind==='point'){
    const indented=rawResolutionPointUnits(text).units;
    const anchors=indented.filter(unit=>unit.label===label.base&&pathKey(unit.path.slice(0,-1))===pathKey(parents));
    if(anchors.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    const anchor=anchors[0],family=indented.filter(unit=>unit.parent===anchor.parent&&unit.group===anchor.group);
    if(!anchor.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(family.some(unit=>unit.label===label.value))return fail('oracle-duplicate-insertion-label');
    if(placement.insertAfter!==anchor.end||placement.insertBefore!==anchor.end+1)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-indented-point-boundary');
  }
  // A provision printed inside its predecessor's row (lost paragraph mark)
  // ends with that row, directly before the next ordinal neighbour.
  const gap=!bases.length&&!label.after&&!parents.length&&['paragraph','recital'].includes(kind)?numberingGap(text,units.filter(unit=>unit.kind===kind),String(label.base)):null;
  if(gap){
    if(!gap.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    if(placement.insertBefore!==gap.end+1||placement.insertAfter!==gap.end)return fail('oracle-insertion-boundary-mismatch');
    return verified('oracle-merged-provision-boundary');
  }
  if(bases.length!==1)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
  const base=bases[0],family=units.filter(unit=>unit.kind===kind&&unit.parent===base.parent&&unit.group===base.group);
  const before=suffix=>wording.language==='fr'?suffixOrder(suffix)<suffixOrder(label.suffix):suffix<label.suffix;
  const preceding=family.filter(unit=>unit.label===String(label.base)||!label.after&&unit.label.startsWith(String(label.base))&&/^[a-zα-ωа-я]+$/u.test(unit.label.slice(String(label.base).length))&&before(unit.label.slice(String(label.base).length)));
  const anchor=preceding.sort((a,b)=>a.start-b.start).at(-1);
  if(!anchor?.complete)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
  if(!label.after&&family.some(unit=>unit.label===label.value))return fail('oracle-duplicate-insertion-label');
  // Independently reject a predecessor that appears after a later-numbered
  // sibling, even if the placement happened to use that raw extent.
  const numeric=value=>/^(\d+|[A-ZА-Я]+)([a-zα-ωа-я]*)$/u.exec(value);
  const position=base=>/^\d+$/u.test(base)?Number(base):ordinal(base);
  const ordered=family.filter(unit=>numeric(unit.label));
  for(let i=1;i<ordered.length;i++) {
    const previous=numeric(ordered[i-1].label),current=numeric(ordered[i].label);
    if(position(previous[1])>position(current[1])
      || position(previous[1])===position(current[1])&&suffixOrder(previous[2])>=suffixOrder(current[2]))return fail('oracle-previous-sibling-order');
  }
  const next=family.find(unit=>unit.start>anchor.start),nextLabel=next&&numeric(next.label),wanted=position(String(label.base));
  if(!label.after&&nextLabel&&wanted!=null&&(position(nextLabel[1])<wanted||position(nextLabel[1])===wanted&&suffixOrder(nextLabel[2])<=suffixOrder(label.suffix)))return fail('oracle-next-sibling-order');
  if(placement.insertBefore!==anchor.end+1||placement.insertAfter!==anchor.end)return fail('oracle-insertion-boundary-mismatch');
  return verified('oracle-sibling-boundary');
}

/** Independent assertions on the returned source coordinates, never another
 * placement implementation. Unknown oracle grammars stay placed-unverified. */
export function verifyPlacement(input) {
  const captioned=assertCaptionedComparison(input);if(captioned&&captioned.status!=='verified')return captioned;
  const formula=assertFormulaGap(input);if(formula&&formula.status!=='verified')return formula;
  if(input.items?.[input.placement?.itemIndex]?.proposal?.sourceKind==='pdf')return assertCouncilDraftPlacement(input);
  const header=assertCompoundHeader(input);
  if(header&&header.status!=='verified')return header;
  const result=verifyProposalPlacement(input);
  if(result.status!=='verified')return result;
  // A recast's legal reading omits its struck deletions and markers; the
  // native Word runs must establish that reading for every touched row.
  const recast=assertRecastReading({proposal:input.items?.[input.placement.itemIndex]?.proposal,placement:input.placement,nativeQuoted:input.nativeQuoted});
  return recast&&recast.status!=='verified'?recast:result;
}

function verifyProposalPlacement(input) {
  if(input.placement?.status==='placed'&&input.placement.noteScope?.kind==='word-footnotes'){
    const proposal=input.items?.[input.placement.itemIndex]?.proposal;
    const notes=inspectNativeNoteScope({...input,proposal});
    if(notes.status!=='verified')return {status:notes.status,reason:notes.reason};
    const {noteScope,...placement}=input.placement;
    return verifyPlacement({...input,placement,wording:notes.bodyWording});
  }
  const result=verifyKnownPlacement(input);
  const proposal=input.items?.[input.placement.itemIndex]?.proposal;
  if(result.status!=='unverified'||!proposal||!['oracle-address-grammar-unavailable','oracle-address-unit-unavailable','oracle-introductory-part-unavailable','oracle-insertion-grammar-unavailable','oracle-original-not-unique'].includes(result.reason))return result;
  const raw=rawProposalAssertion({proposal,wording:input.wording,placement:input.placement});
  return raw.status==='unverified'?result:raw;
}

function verifyKnownPlacement({placement, wording, items, text, nativeQuoted, voteReferences=[], target = parseBenchmarkTarget(wording)}) {
  const scope=verifyLanguageScope(placement,expectedLanguageScope(wording));
  if(scope)return scope;
  if (placement.status !== 'placed') return {status:'not-applicable', reason:'not-placed'};
  const printedInsertion=assertPrintedInsertion({items,wording,placement,nativeQuoted});
  if(printedInsertion)return printedInsertion;
  const uniqueEntry=assertUniqueEntry({items,wording,placement,nativeQuoted});
  if(uniqueEntry)return uniqueEntry;
  const maintainer=assertMaintainerPrinciple({proposal:items?.[placement.itemIndex]?.proposal,wording,placement});
  if(maintainer.status!=='unverified'){
    const expected=maintainer.reason==='oracle-maintainer-P2'?'insert':expectedOperation(wording);
    return expected&&placement.operation===expected?maintainer:fail('oracle-operation-mismatch');
  }
  const expected = expectedOperation(wording);
  if (!expected) return {status:'unverified', reason:'oracle-operation-unavailable'};
  if (placement.operation !== expected) return {...fail('oracle-operation-mismatch'), expectedOperation:expected, actualOperation:placement.operation};
  const collision=assertResolutionCollision({text,wording,placement});
  if(collision.status!=='unverified')return collision;
  const numberedAnnex=assertNumberedAnnexInsertion(items,wording,placement,nativeQuoted);
  if(numberedAnnex)return numberedAnnex;
  if(!items?.length&&wording.language==='sv'&&/^Bilaga I – rekommendation [1-9]\d* – punkt 1$/u.test(wording.targetLabel||''))return assertSwedishRecommendation({text,wording,placement});
  if(items?.length&&wording.targetLabel==='Title 1')return assertNativeProposalTitle({proposal:items[placement.itemIndex]?.proposal,wording,placement,nativeQuoted});
  const tableContext=assertTableContext({items,wording,placement,nativeQuoted});if(tableContext)return tableContext;
  const annex=assertBareAnnexInsertion(items,wording,placement,nativeQuoted);
  if(annex)return annex;
  const proposal = items?.[placement.itemIndex]?.proposal;
  const tableEnd=assertUnnumberedTable({proposal,wording,placement,nativeQuoted,voteReferences});
  if(tableEnd.status!=='unverified')return tableEnd;
  const newParent=assertNewParentBoundary({proposal,wording,placement});if(newParent.status!=='unverified')return newParent;
  const sequence=assertSequentialAnnex({proposal,items,wording,placement,nativeQuoted});if(sequence)return sequence;
  const firstAnnex=assertFirstAnnex({proposal,items,wording,placement,nativeQuoted});
  if(firstAnnex)return firstAnnex;
  if(proposal) {
    const ordinal=verifyPreambleCitation({proposal,wording,placement,target})??(placement.operation==='insert'?verifyNegativeArticle({proposal,wording,placement,target}):null);
    if(ordinal)return ordinal;
  }
  const closing=assertClosingFormula({proposal,wording,placement});
  if(closing.status!=='unverified')return closing;
  const numbering=assertWordingNumbering({proposal,wording,placement});
  if(numbering.status!=='unverified')return numbering;

  const instruction=assertWholeAnnexInstruction({items,proposal,wording,placement,nativeQuoted});
  if(instruction)return instruction;
  const table=proposal?verifyAnnexTable({proposal,wording,placement,items}):null;
  if(table)return table;
  const articleTable=proposal?verifyArticleTable({proposal,wording,placement}):null;
  if(articleTable)return articleTable;

  if(proposal&&placement.operation==='insert'&&target.segments.at(-1)?.kind==='subparagraph')return rawProposalAssertion({proposal,wording,placement});
  const chapter=assertChapterTitle({proposal,wording,placement});
  if(chapter.status!=='unverified')return chapter;
  const standalone=assertStandaloneQuote({proposal,wording,placement,nativeQuoted});
  if(standalone.status!=='unverified')return standalone;
  const articleNotes=assertArticleNotes({proposal,wording,placement,nativeQuoted});
  if(articleNotes.status!=='unverified'||proposal&&placement.operation==='delete'&&wording.language==='en'&&/^Article \d+[a-z]*$/u.test(wording.targetLabel||'')&&/\n_{5,}\s*\n/u.test(wording.originalText||''))return articleNotes;
  const implicitLabel=assertImplicitParagraphLabel({proposal,wording,placement});
  if(implicitLabel.status!=='unverified')return implicitLabel;
  const localRecital=assertLocalRecitalBoundary({proposal,wording,placement,nativeQuoted});
  if(localRecital.status!=='unverified')return localRecital;
  const initialRecital=assertNativeFirstRecital({proposal,wording,placement,nativeQuoted});
  if(initialRecital.status!=='unverified')return initialRecital;
  const guideline=assertGuidelineAnnex({proposal,wording,placement,nativeQuoted});
  if(guideline.status!=='unverified')return guideline;
  const sectionPoint=assertQuotedSectionPoint({proposal,wording,placement,nativeQuoted});
  if(sectionPoint.status!=='unverified')return sectionPoint;
  const annexReplacement=assertBareAnnexReplacement({items,proposal,wording,placement,nativeQuoted});
  if(annexReplacement.status!=='unverified')return annexReplacement;
  const annexIndent=assertBareAnnexIndent({items,proposal,wording,placement,nativeQuoted});
  if(annexIndent.status!=='unverified')return annexIndent;
  if(!proposal){const lead=assertResolutionLead({text,wording,placement});if(lead.status!=='unverified')return lead;}
  if(!proposal){const placeholder=assertPlaceholderDeletion({text,wording,placement});if(placeholder.status!=='unverified')return placeholder;}
  if(!proposal){const pointNear=assertResolutionPointSimilarity({text,wording,placement});if(pointNear.status!=='unverified')return pointNear;}
  if(!proposal) {
    const category=assertRecitalCategoryRepair({text,wording,placement});
    if(category.status!=='unverified')return category;
  }
  // Explicit inner labels must reach the independent native assertion before
  // the generic target grammar can decline an outer non-new instruction.
  const quoted=rawQuotedProposalAssertion({proposal,wording,placement,nativeQuoted});
  if(quoted.status!=='unverified')return quoted;
  const finnishSibling=assertFinnishQuotedSibling({proposal,wording,placement,nativeQuoted});if(finnishSibling)return finnishSibling;
  const sibling=assertQuotedSibling({proposal,wording,placement,nativeQuoted});
  if(sibling.status!=='unverified')return sibling;
  const ordinalSubparagraph=assertNewQuotedOrdinal({proposal,wording,placement,nativeQuoted});if(ordinalSubparagraph)return ordinalSubparagraph;
  const subparagraph=assertQuotedSubparagraph({proposal,wording,placement,nativeQuoted});
  if(subparagraph.status!=='unverified')return subparagraph;
  const letterPoint=rawLetterPointAssertion({proposal,wording,placement,nativeQuoted});
  if(letterPoint.status!=='unverified')return letterPoint;
  if (placement.operation === 'replace' || placement.operation === 'delete') {
    if(!proposal&&Number.isInteger(placement.span?.end)) {
      const following=text?.paragraphs?.[placement.span.end+1];
      if(typeof following==='string'&&/^\s*\(Ex AM\b/u.test(following)
        &&(/[\r\n]/u.test(following)||!/^\s*\(Ex AM [1-9]\d* \(Or\. [A-Z]{2}\) of FdR [^()\r\n]+\.docx\)\s*$/u.test(following)))return {status:'unverified',reason:'oracle-editorial-boundary-unavailable'};
      // A parenthetical row after a recital may be substantive continuation,
      // regardless of whether it resembles a malformed editorial reference.
      if(typeof following==='string'&&/^\s*\(/u.test(following)&&target.segments.at(-1)?.kind==='recital') {
        const raw=rawResolutionUnits(text,wording.language),matches=raw.units.filter(unit=>unit.kind==='recital'&&unit.start===placement.span.start);
        if(raw.reason||matches.length!==1||matches[0].end!==placement.span.end)return {status:'unverified',reason:'oracle-editorial-boundary-unavailable'};
      }
    }
    const drift=!proposal&&assertResolutionNumberingDrift({text,wording,placement,voteReferences});
    if(drift)return drift;
    let source, labels = [];
    if (proposal) {
      const {splice} = placement;
      if (!splice || !placement.span || splice.start.paragraph !== placement.span.start || splice.end.paragraph !== placement.span.end) return fail('oracle-invalid-span');
      const rows = proposal.paragraphs.filter(p => p.index >= splice.start.paragraph && p.index <= splice.end.paragraph);
      if (!rows.length || rows[0].index !== splice.start.paragraph || rows.at(-1).index !== splice.end.paragraph
        || splice.start.offset < 0 || splice.end.offset < 0 || splice.start.offset > rows[0].text.length || splice.end.offset > rows.at(-1).text.length
        || rows.length === 1 && splice.end.offset < splice.start.offset) return fail('oracle-invalid-span');
      source = rows.map((p,i) => p.text.slice(i === 0 ? splice.start.offset : 0, i === rows.length-1 ? splice.end.offset : p.text.length)).join('\n');
      labels = flatten(proposal.units).filter(u => u.label?.prefix && ['paragraph','point','recital'].includes(u.kind)).map(u => u.label);
    } else {
      const span = placement.span;
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end >= (text?.paragraphs?.length || 0)) return fail('oracle-invalid-span');
      source = text.paragraphs.slice(span.start,span.end+1).join('\n');
      labels = [...rawResolutionUnits(text,wording.language).units.map(u=>({value:u.label})),...target.segments.map(segment=>({value:segment.value}))];
    }
    if (source.includes('\uFFFC') || wording.originalText.includes('\uFFFC')) return {status:'unverified',reason:'oracle-object-comparison-unavailable'};
    const key = value => wording.baseline==='present-text'?existingLawOracleNormal(value,labels):oracleNormal(value,labels);
    const left = key(source), right = key(wording.originalText);
    const footnotes=proposal?assertFootnoteComparison(proposal,wording,placement):assertResolutionFootnotes(text,wording,placement);
    if(footnotes?.status==='failed')return footnotes;
    if(!footnotes&&(!left||!right||left!==right)){
      const quotes=value=>value.normalize('NFC').replace(/[‘’‚‛ʻʼ“”„‟«»"'\s]/gu,'');
      if(proposal&&quotes(source)===quotes(wording.originalText))return locationOracle({proposal,text,target,wording,placement,labels});
      if(proposal&&placement.operation==='delete'&&/^\(\d+\)\s*\[\.\.\.\]$/u.test(wording.originalText.trim()))return assertElidedDeletion(proposal,wording,placement);
      const literalWordOriginal=value=>value.replace(/^\(?(\d+)\)?[.)]?\s+/u,(full,number)=>number===target.segments.at(-1)?.value?'':full);
      if(proposal&&placement.span.start===placement.span.end&&oracleSingleWord(literalWordOriginal(source),literalWordOriginal(wording.originalText))){
        const address=rawProposalAssertion({proposal,wording,placement}),bounds=address.rawSourceRows;
        if(address.status==='verified'&&bounds&&bounds[1]===placement.span.start&&bounds[2]===placement.span.end+1&&placement.splice.start.offset===0&&placement.splice.end.offset===source.length)return verified('oracle-single-word-addressed-unit');
      }
      if(proposal&&oracleSimilarity(source,wording.originalText)>=.95)return assertSimilarPlacement({proposal,wording,placement,address:rawProposalAssertion({proposal,wording,placement})});
      if(!proposal&&target.complete&&target.segments.length===1&&['paragraph','recital'].includes(target.segments[0].kind)) {
        const raw=rawResolutionUnits(text,wording.language),part=target.segments[0];
        const candidates=[...raw.units,...(raw.incomplete||[])].filter(unit=>unit.kind===part.kind).map(unit=>({...unit,text:oracleNormal(text.paragraphs.slice(unit.start,unit.end+1).join(' '),[...labels,{value:unit.label}])}));
        if(!raw.reason&&assertResolutionSimilarity(candidates,oracleNormal(wording.originalText,labels),placement.span))return locationOracle({proposal,text,target,wording,placement,labels});
      }
      return fail('oracle-original-span-mismatch');
    }
    return locationOracle({proposal,text,target,wording,placement,labels});
  }
  if (placement.operation !== 'insert' || !target.complete || !target.segments.length) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  if(!proposal&&target.segments.at(-1)?.kind==='indent')return assertTerminalIndent({text,wording,placement});
  if (!proposal) return verifyResolutionInsertion(text,wording,target,placement);
  // COM(2025)531 puts an instruction's semicolon in a separate Word row
  // after its closing quotation. Even an otherwise unsupported point address
  // cannot insert a sibling between that quotation and its terminator.
  const following=proposal.paragraphs[placement.insertBefore],preceding=proposal.paragraphs[placement.insertAfter];
  if(target.segments.at(-1)?.kind==='point'&&following?.text.trim()===';'
    &&/[’'”"]\s*$/u.test(preceding?.text??'')&&preceding?.source?.container==='body'&&following.source?.container==='body'
    &&preceding.source.containerPath===following.source.containerPath&&preceding.source.segment===following.source.segment
    &&following.source.ordinal===preceding.source.ordinal+1)return fail('oracle-insertion-before-instruction-terminator');
  if(target.segments.some((segment,index)=>segment.kind==='subparagraph'&&index<target.segments.length-1)){
    const address=firstSubparagraphAddress(proposal,target),label=target.segments.at(-1);
    if(!address?.bounds||label.kind!=='point'||!label.isNew||!label.base||!label.suffix)return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
    const path=address.target.segments.slice(0,-1),all=flatten(proposal.units).filter(unit=>unit.scope==='proposal');
    const family=all.filter(unit=>unit.kind==='point'&&pathKey(unit.path.slice(0,-1))===pathKey(path));
    const anchors=family.filter(unit=>unit.label?.value===label.base);
    if(anchors.length!==1||!anchors[0].complete)return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    const anchor=anchors[0],after=proposal.paragraphs[anchor.extent.end],last=proposal.paragraphs[anchor.extent.end-1];
    if(family.some(unit=>unit.label?.value===label.value))return fail('oracle-duplicate-insertion-label');
    if(placement.insertBefore!==anchor.extent.end||placement.insertAfter!==anchor.extent.end-1||placement.insertBefore>address.bounds.end)return fail('oracle-insertion-boundary-mismatch');
    if(!after?.complete||!last?.complete||after.source?.ordinal!==last.source?.ordinal+1||after.source?.containerPath!==last.source?.containerPath)return {status:'unverified',reason:'oracle-resolution-extent-unverified'};
    return verified('oracle-subparagraph-point-boundary');
  }
  let label = target.segments.at(-1);
  // A new point printed without a space (aa, ba) is a base letter plus suffix.
  // Strings that also read as Roman numerals (ii, vi, xi) stay unsplit.
  const joined = proposal && label.kind === 'point' && label.isNew && !label.suffix && label.number == null && romanValue(String(label.value)) === null && /^([a-z])([a-z]{1,2})$/u.exec(String(label.value));
  if (joined) label = {...label, base:joined[1], suffix:joined[2]};
  const rank = suffixOrder(label.suffix);
  // Lettered and Roman point bases carry no parsed number; their ordinal comes
  // from the complete sibling family below, never from the placer's order.
  const lettered = Boolean(proposal) && label.kind === 'point' && label.number == null && /^(?:[a-z]|[ivxlc]+)$/u.test(String(label.base ?? ''));
  if (!label.isNew || !rank || label.number == null && !lettered) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
  let siblings, anchor, end, wanted = label.number;
  if (proposal) {
    const all = flatten(proposal.units).filter(u => u.scope === 'proposal');
    anchor = all.find(u => u.id === placement.evidence?.find(e => e.basis === 'preceding-sibling-subtree')?.anchor);
    if (!anchor) return fail('oracle-anchor-missing');
    const parent = target.segments.slice(0,-1);
    // Heading containers may precede the published address. Compare its exact
    // suffix, as proposalCandidates does; retain the actual source parent below.
    const omitted = parent.length && pathKey(anchor.path.slice(-parent.length-1,-1)) !== pathKey(parent);
    if (omitted && !omittedSoleParagraph(all, anchor, parent)) return fail('oracle-parent-mismatch');
    siblings = all.filter(u => u.kind === label.kind && parentKey(u) === parentKey(anchor)).map(u => ({...u, number:u.label?.number, suffix:u.label?.suffix || '', start:u.extent.start}));
    anchor = {...anchor, number:anchor.label?.number, suffix:anchor.label?.suffix || '', start:anchor.extent.start};
    end = anchor.extent.end;
    // Repeated sibling labels make the address ambiguous (parser pathConflict).
    // Applies to every family reached through the new lettered or omission rules.
    const identities = siblings.map(u => String(u.label?.value ?? ''));
    if ((lettered || omitted) && (new Set(identities).size !== identities.length || siblings.some(u => u.pathConflict) || !anchor.complete)) return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
    if (lettered) {
      const bases = siblings.sort((a,b) => a.start-b.start).map(pointBase);
      // An observed malformed Roman family is ambiguous, so a different raw
      // grammar must not override this identity failure.
      if (bases[0] === 'i' && bases.some(base => /^[ivxlc]+$/u.test(base) && !canonicalRoman(base))) return {status:'unverified',reason:'oracle-anchor-identity-unverified'};
      const position = pointFamilyPosition(bases, label.base);
      if (!position) return {status:'unverified',reason:'oracle-insertion-grammar-unavailable'};
      // Ordinals alone conflate spellings (iiii, iv); the anchor's exact base must match.
      if (pointBase(anchor) !== String(label.base)) return fail('oracle-anchor-label-mismatch');
      siblings = siblings.map(u => ({...u, number:position(pointBase(u))}));
      anchor = {...anchor, number:position(pointBase(anchor))};
      wanted = position(label.base);
    }
  }
  // Recital letters are carried as value rather than number by the parser.
  if (anchor.number !== wanted || suffixOrder(anchor.suffix) == null || suffixOrder(anchor.suffix) >= rank || anchor.kind !== label.kind) return fail('oracle-anchor-label-mismatch');
  // A parser-created implicit paragraph must not swallow the publication's
  // next explicitly styled paragraph. A-10-2026-0069's unstyled article subtitle
  // otherwise makes paragraphs 1 and 2 look like children of implicit paragraph 1.
  if(proposal&&wording.language==='en'&&label.kind==='paragraph'&&anchor.implicit&&!anchor.instruction) {
    const quoted=flatten(proposal.units).filter(unit=>unit.scope==='quoted');
    for(const row of proposal.paragraphs) {
      if(row.index<=anchor.start||row.index>=placement.insertBefore||!/^(?:Manual)?NumPar1$/i.test(row.properties?.styleId||''))continue;
      if(quoted.some(unit=>row.index>=unit.extent.start&&row.index<unit.extent.end))continue;
      const number=/^\s*(\d+)([a-z]*)[.)]\s/u.exec(row.text);
      if(number&&(Number(number[1])>wanted||Number(number[1])===wanted&&suffixOrder(number[2])>=rank))return fail('oracle-published-paragraph-boundary-mismatch');
    }
  }
  if (placement.insertBefore !== end || placement.insertAfter !== end-1) return fail('oracle-insertion-boundary-mismatch');
  const ordered = siblings.sort((a,b) => a.start-b.start), at = ordered.findIndex(u => u.start === anchor.start);
  if (at < 0 || ordered.some(u => u.number === wanted && u.suffix === label.suffix)) return fail('oracle-duplicate-insertion-label');
  const previous=ordered[at-1],next = ordered[at+1],wantedOrdinal=ordinal(wanted);
  if(previous&&(ordinal(previous.number)>ordinal(anchor.number)||ordinal(previous.number)===ordinal(anchor.number)&&suffixOrder(previous.suffix)>=suffixOrder(anchor.suffix)))return fail('oracle-previous-sibling-order');
  if (next && (next.start < end || ordinal(next.number) < wantedOrdinal || ordinal(next.number) === wantedOrdinal && (suffixOrder(next.suffix) == null || suffixOrder(next.suffix) <= rank))) return fail('oracle-next-sibling-order');
  return verified('oracle-sibling-boundary');
}

export function targetPatterns(wording = {}, gaps = []) {
  const label = wording.targetLabel || '', parsed = parseBenchmarkTarget(wording), patterns = new Set();
  for (const segment of parsed.segments) {
    if (segment.suffix) patterns.add('letter-suffix');
    if (segment.kind) patterns.add(segment.kind);
    if (String(segment.value).startsWith('-')) patterns.add('negative-label');
  }
  for (const [pattern,re] of [['introductory-part',/introductory|introductif|einleitung/i],['negative-label',/(?:^|\s)[−-]\s*\d/u],['subparagraph',/subparagraph/i],['title',/^title\b/i],['underlying-act-insertion',/\n[\s\S]*\(new\)/i]]) if (re.test(label)) patterns.add(pattern);
  if (wording.targetPath?.underlying?.length) patterns.add('underlying-act');
  for (const gap of gaps) if (/vertical-text|comparison-grid/.test(gap.code || gap)) patterns.add((gap.code || gap).replace('-loss',''));
  return [...patterns].sort().length ? [...patterns].sort() : ['unparsed'];
}

const ratio = (n,d) => d ? n/d : null;
export function metrics(rows) {
  const counts = Object.fromEntries(['correct','placed-unverified','withheld-pipeline','withheld-source','acquisition-unavailable','not-placeable','not-applicable','false-placement'].map(key => [key,0]));
  const votes = new Map(), groups = new Map(),strata=new Map(),reasons=new Map();
  for(const row of rows){const key=JSON.stringify([row.documentType,row.language]);strata.set(key,(strata.get(key)||0)+1);}
  for (const row of rows) {
    counts[row.outcome]++;
    const reason=reasons.get(row.reason)||{reason:row.reason,count:0,examples:[]};reason.count++;if(reason.examples.length<3)reason.examples.push(row.id);reasons.set(row.reason,reason);
    // Variants do not multiply votes. Every referenced amendment and every
    // evaluated source variant of that amendment must be correct for a vote.
    for (const id of row.outcome==='not-placeable'?[]:row.voteIds) votes.set(id,(votes.get(id) ?? true) && row.outcome === 'correct');
    for (const pattern of row.patterns) {
      const key = JSON.stringify([row.documentType,row.language,row.reason,pattern]);
      const group = groups.get(key) || {documentType:row.documentType,language:row.language,reason:row.reason,pattern,count:0,examples:[]};
      group.count++; if (group.examples.length < 3 && !group.examples.includes(row.id)) group.examples.push(row.id); groups.set(key,group);
    }
  }
  const total = rows.length, eligible = total-counts['withheld-source']-counts['not-placeable'], correctVotes = [...votes.values()].filter(Boolean).length;
  return {total,counts,eligible,headline:ratio(counts.correct,eligible),raw:ratio(counts.correct,total),falsePlacements:counts['false-placement'],uniqueReasons:[...reasons.values()].map(r=>({...r,share:ratio(r.count,total)})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,'en')),votes:{total:votes.size,correct:correctVotes,share:ratio(correctVotes,votes.size)},taxonomy:[...groups.values()].map(group => ({...group,share:ratio(group.count,total),stratumShare:ratio(group.count,strata.get(JSON.stringify([group.documentType,group.language])))})).sort((a,b)=>b.count-a.count||JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
}

export function projectionCompatibility(rows,code) {
  const distinct=values=>[...new Set(values)].sort();
  const liveContextVersions=distinct(rows.flatMap(row=>row.acquisition.contextVersions));
  const projections=rows.flatMap(row=>row.acquisition.projectionVersions||[]);
  const liveProposalParserVersions=distinct(projections.flatMap(p=>p.proposalParsers).filter(v=>v!=null));
  const liveDocumentExtractionVersions=distinct(projections.map(p=>p.documentExtraction).filter(v=>v!=null));
  const mismatches=[];
  for(const [kind,observed,expected] of [['document-context',liveContextVersions,code.documentContextVersion],['proposal-parser',liveProposalParserVersions,code.proposalParserVersion],['document-extractor',liveDocumentExtractionVersions,code.documentExtractionVersion]])
    for(const version of observed)if(version!==expected)mismatches.push({kind,observed:version??null,expected});
  if(!liveContextVersions.length)mismatches.push({kind:'document-context',observed:null,expected:code.documentContextVersion});
  return {liveContextVersions,liveProposalParserVersions,liveDocumentExtractionVersions,checkoutDocumentContextVersion:code.documentContextVersion,checkoutProposalParserVersion:code.proposalParserVersion,checkoutDocumentExtractionVersion:code.documentExtractionVersion,mismatches,compatible:!mismatches.length};
}

export function compareBaseline(current, baseline, {placementOnly=false}={}) {
  // Refuse a changing census or input snapshot: a score difference would not
  // isolate checkout behaviour. Code identity deliberately does not participate.
  const fingerprint = value => JSON.stringify({sample:value.sample,snapshotId:value.snapshotId,inputs:value.inputs});
  if (fingerprint(current) !== fingerprint(baseline)) throw new Error('Baseline sample/input hashes differ; replay the same frozen cache and sample.');
  const warnings=[];
  for(const file of ['scripts/amendment-benchmark-sample.mjs','scripts/amendment-benchmark-model.mjs','scripts/amendment-benchmark-resolution-oracle.mjs','scripts/amendment-benchmark-proposal-oracle.mjs','scripts/amendment-benchmark-operation-oracle.mjs','scripts/amendment-benchmark.mjs'])if((current.harness?.files||current.code?.files)?.[file]!== (baseline.harness?.files||baseline.code?.files)?.[file])warnings.push('Benchmark/oracle model changed: '+file+'; review scoring-policy changes before using deltas.');
  const replay=current.projectionMode==='cached-source-replay'&&['cached-source-replay','live-projection-comparison'].includes(baseline.projectionMode);
  const scope=replay?'full-pipeline-cached-sources':placementOnly?'placement-only-frozen-projections':'full-pipeline';
  const refuse=reason=>({scope,failed:true,refused:true,warnings,reason,deltas:{},taxonomyDeltas:[],regressions:[]});
  if(current.projectionMode!==baseline.projectionMode&&!replay)return refuse('Projection modes differ; create a cached-source baseline for this snapshot.');
  if(replay) {
    if(baseline.projectionMode==='live-projection-comparison')warnings.push('Baseline is the recorded live-projection comparison; deltas include switching to cached-source replay.');
    if(placementOnly)warnings.push('--placement-only is an alias for full cached-source comparison; all producer outcomes are evaluated.');
  } else if(placementOnly) {
    const before=baseline.code?.producerFingerprint,after=current.code?.producerFingerprint;
    if(!before?.sha256||!after?.sha256||before.schemaVersion!==2||after.schemaVersion!==2||JSON.stringify(before)!==JSON.stringify(after))return refuse('Source-extraction/projection producers changed or their fingerprints are missing; placement-only comparison requires a new cached-source baseline.');
    for(const report of [baseline,current]) {
      const compatibility=report.compatibility;
      if(typeof compatibility?.compatible!=='boolean'||!Array.isArray(compatibility.mismatches)||!compatibility.compatible&&!compatibility.mismatches.length||compatibility.mismatches.some(m=>m.kind!=='document-context'||!Number.isInteger(m.observed)||m.observed<1||!Number.isInteger(m.expected)||m.expected<1))return refuse('Placement-only mode waives only a recorded document-context wrapper-version mismatch.');
    }
    warnings.push('Placement-only scope: frozen API projections; unchanged source producers; document-context wrapper-version mismatches acknowledged. Extraction/projection changes are not evaluated.');
  } else if(current.compatibility?.compatible===false||baseline.compatibility?.compatible===false)return refuse('Live projection versions differ from checkout; in-process source replay is required.');
  const now = new Map(current.rows.map(row=>[row.key,row]));
  const regressions = baseline.rows.filter(old => {
    const row = now.get(old.key);
    return !row || old.outcome === 'correct' && row.outcome !== 'correct' || old.outcome !== 'false-placement' && row.outcome === 'false-placement';
  }).map(old=>({key:old.key,id:old.id,before:old.outcome,after:now.get(old.key)?.outcome || 'missing',reason:now.get(old.key)?.reason}));
  // Keep the strict raw ratchet above intact. The batch admission lane may
  // accept the maintainer-authorized rejection denominator change separately;
  // neither a reason string alone nor a loss of paragraph coordinates proves it.
  const authorizedDenominatorTransitions=baseline.rows.flatMap(old=>{
    const row=now.get(old.key),proof=row?.documentOperation,source=proof?.source,placement=row?.stages?.S5;
    if(old.outcome!=='correct'||row?.outcome!=='not-placeable'||row.reason!=='whole-document-rejection'||proof?.status!=='verified'||proof.reason!=='source-attested-rejection'
      ||placement?.status!=='document-operation'||placement.operation!=='reject'||placement.scope!==proof.scope||!['council-position','commission-proposal'].includes(proof.scope)
      ||['span','splice','insertAfter','insertBefore'].some(key=>Object.hasOwn(placement,key))
      ||source?.assertion!=='complete-native-comparison-cells'||source.originalText!==''||!source.proposedText?.trim()||!source.amendmentPath
      ||!row.wordingSource?.url||!row.language||!/^[a-f0-9]{64}$/u.test(source.sha256)||source.sha256!==row.wordingSource.sha256)return [];
    return [{gate:{snapshotId:current.snapshotId,sample:current.sample},key:row.key,id:row.id,language:row.language,sourceUrl:row.wordingSource.url,resolvedSourceUrl:row.wordingSource.resolvedSourceUrl||row.wordingSource.url,sha256:source.sha256,rejectionScope:proof.scope,before:old.outcome,after:row.outcome,reason:row.reason,nativeVerification:proof}];
  });
  const rawLostCorrect=regressions.filter(row=>row.before==='correct'&&row.after!=='correct').length;
  const deltas = {};
  const walk = (a,b,prefix='') => {for (const key of Object.keys(a)) {const name=prefix+key;if(typeof a[key]==='number'&&typeof b?.[key]==='number')deltas[name]=a[key]-b[key];else if(a[key]&&typeof a[key]==='object'&&!Array.isArray(a[key]))walk(a[key],b?.[key],name+'.');}};
  walk(current.metrics,baseline.metrics);
  const taxonomyKey=row=>JSON.stringify([row.documentType,row.language,row.reason,row.pattern]);
  const before=new Map(baseline.metrics.taxonomy.map(row=>[taxonomyKey(row),row]));
  const after=new Map(current.metrics.taxonomy.map(row=>[taxonomyKey(row),row]));
  const taxonomyDeltas=[...new Set([...before.keys(),...after.keys()])].sort().map(key=>({key,count:(after.get(key)?.count||0)-(before.get(key)?.count||0),share:(after.get(key)?.share||0)-(before.get(key)?.share||0)}));
  return {scope,warnings,deltas,taxonomyDeltas,regressions,rawLostCorrect,authorizedDenominatorTransitions,adjustedLostCorrect:rawLostCorrect-authorizedDenominatorTransitions.length,failed:regressions.length>0||current.metrics.falsePlacements>0};
}
