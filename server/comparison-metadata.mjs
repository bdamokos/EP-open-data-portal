import {createHash} from 'node:crypto';

/**
 * Metadata over bounded native observations, separate from amendment parsing.
 * The caller reads/hashes the source and supplies native layout in source order.
 * No source selection, legal address, equality policy or application lives here.
 *
 * @typedef {object} SourceObservation
 * @property {string} observationId Hash of the complete observation tuple.
 * @property {string|null} workId
 * @property {string|null} documentId
 * @property {string|null} listId
 * @property {string|null} declaredDistributionUrl
 * @property {string} resolvedResponseUrl
 * @property {string} language
 * @property {string} retrievedAt
 * @property {string} sha256 Original response bytes, not projected text.
 * @property {string} representation
 * @property {object|null} request
 * @property {'unresolved'|'conflicting'} identityStatus
 *
 * @typedef {object} NativeLocator
 * @property {string} observationId
 * @property {string} part
 * @property {string} partSha256
 * @property {string} path One-based qualified element siblings; see namespaces.
 * @property {string|null} nativeId
 * @property {'original'|'proposed'|null} tableSide
 * @property {{start:number,end:number,unit:'utf16'}|null} range
 *
 * @typedef {object} FieldSlice
 * @property {'originalText'|'proposedText'} field
 * @property {string|null} fieldSha256
 * @property {number|null} start Null when the native field cannot be mapped.
 * @property {number|null} end
 * @property {'utf16'} unit
 * @property {NativeLocator[]} source
 * @property {'exact'|'explicit-whitespace-map'|'unmapped'} mapping
 */

const METADATA_SCHEMA=1;
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const MAX_TEXT=256*1024,MAX_ROWS=2000;
const sides=['original','proposed'];
const range=(start,end)=>({start,end,unit:'utf16'});
const requireValue=(ok,message)=>{if(!ok)throw new TypeError(message);};

/** Preserve null declarations: a response URL does not establish a distribution. */
export function sourceObservation(value) {
  for(const key of ['resolvedResponseUrl','language','retrievedAt','representation'])requireValue(typeof value?.[key]==='string'&&value[key].length>0,`Missing ${key}`);
  requireValue(hash(value.sha256),'Invalid response hash');
  const tuple={};
  for(const key of ['workId','expressionId','itemId','documentId','listId','declaredDistributionUrl','responseContentType']) {
    requireValue(value[key]==null||typeof value[key]==='string',`Invalid ${key}`);tuple[key]=value[key]??null;
  }
  for(const key of ['resolvedResponseUrl','language','retrievedAt','sha256','representation'])tuple[key]=value[key];
  requireValue(value.status==null||Number.isInteger(value.status),'Invalid response status');tuple.status=value.status??null;
  // Request representation parameters are separate from the response format.
  requireValue(value.request==null||typeof value.request==='object'&&!Array.isArray(value.request)&&Object.values(value.request).every(v=>typeof v==='string'),'Invalid request representation');
  tuple.request=value.request==null?null:Object.fromEntries(Object.keys(value.request).sort().map(key=>[key,value.request[key]]));
  const identityStatus=value.identityStatus??'unresolved';
  requireValue(['unresolved','conflicting'].includes(identityStatus),'Metadata cannot verify source identity');
  return {...tuple,observationId:sha(JSON.stringify(tuple)),identityStatus};
}

function locator(source,native,path,side=null,span=null,nativeId=null) {
  requireValue(typeof path==='string'&&path.startsWith('/'),'Missing native path');
  return {observationId:source.observationId,part:native.part,partSha256:native.partSha256,path,nativeId,tableSide:side,range:span};
}
function validateNative(source,native) {
  requireValue(native?.observationId===source.observationId,'Native observation differs');
  requireValue(typeof native.part==='string'&&hash(native.partSha256),'Missing native part/hash');
  requireValue(native.pathConvention==='one-based-qualified-element-siblings'&&native.namespaces&&typeof native.namespaces==='object','Missing native path convention');
}

// Only the existing field's whitespace edits are mapped. Every omitted native
// character remains in map entries; punctuation, digits and URLs never change.
function fieldMap(raw,text) {
  if(typeof text!=='string')return null;
  const tokens=[];
  for(let i=0;i<raw.length;i++) {
    const start=i,character=raw[i];
    if(character==='\r'&&raw[i+1]==='\n')i++;
    tokens.push({rawStart:start,rawEnd:i+1,text:character==='\r'?'\n':character});
  }
  for(let i=0;i<tokens.length;i++)if(tokens[i].text==='\n')for(let j=i-1;j>=0&&/^[ \t]$/.test(tokens[j].text);j--)tokens[j].text='';
  let first=0,last=tokens.length;
  while(first<last&&/^\s*$/.test(tokens[first].text))tokens[first++].text='';
  while(last>first&&/^\s*$/.test(tokens[last-1].text))tokens[--last].text='';
  if(tokens.map(t=>t.text).join('')!==text)return null;
  const boundaries=new Array(raw.length+1),segments=[];let at=0;
  for(const token of tokens) {
    for(let i=token.rawStart;i<token.rawEnd;i++)boundaries[i]=at;
    const rawText=raw.slice(token.rawStart,token.rawEnd),start=at;at+=token.text.length;boundaries[token.rawEnd]=at;
    const mapping=rawText===token.text?'exact':'explicit-whitespace-map';
    const previous=segments.at(-1);
    if(previous?.mapping===mapping&&previous.end===start&&previous.rawEnd===token.rawStart&&Boolean(previous.text)===Boolean(token.text)) {
      previous.rawEnd=token.rawEnd;previous.end=at;previous.rawText+=rawText;previous.text+=token.text;
    } else segments.push({...token,rawText,start,end:at,mapping});
  }
  boundaries[raw.length]=at;
  return {boundaries,segments};
}
function sliceFor(field,text,map,region) {
  const start=map?.boundaries[region.rawStart]??null,end=map?.boundaries[region.rawEnd]??null;
  return {field,fieldSha256:typeof text==='string'?sha(text):null,start,end,unit:'utf16',source:[region.native],
    mapping:!map?'unmapped':region.rawText===text.slice(start,end)?'exact':'explicit-whitespace-map'};
}
function headingNumber(heading) {
  const match=heading?.text?.match(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/)
    ||heading?.text?.match(/^\s*(?:Amendment|Enmienda|Amandman)\s+([1-9]\d*)\s*$/u)
    ||(/^AmNumberTabs\d*$/i.test(heading?.style||'')&&heading?.text?.match(/^[^\d<>]+?\s*([1-9]\d*)\s*$/u));
  return match?Number(match[1]):null;
}
const vertical=run=>{
  const evidence=(run.verticalEvidence||[]).filter(e=>e.property==='vertAlign'&&e.basis==='direct');
  return ['superscript','subscript'].includes(evidence.at(-1)?.value)?evidence.at(-1).value:'unknown';
};

/**
 * native.rows contains only the selected comparison's content rows, including
 * empty cells. Paragraph/run offsets are native UTF-16, before field cleanup.
 * The source reader must attest the immediately preceding amendment heading;
 * a recital heading or an auxiliary same-number candidate is insufficient.
 */
export function comparisonMetadata({observation,native,amendment}) {
  const source=sourceObservation(observation);validateNative(source,native);
  requireValue(Array.isArray(native.rows)&&native.rows.length<=MAX_ROWS,'Unbounded comparison rows');
  const gaps=[];
  const identity=source.documentId===amendment.targetDocumentId&&source.listId===amendment.listId&&source.language===amendment.language
    &&amendment.sources?.some(s=>s.url===(source.declaredDistributionUrl??source.resolvedResponseUrl)&&s.language===source.language&&s.fetchedAt===source.retrievedAt)
    &&headingNumber(native.heading)===amendment.number&&native.number===amendment.number;
  if(!identity||source.identityStatus==='conflicting')gaps.push('unresolved-comparison-identity');
  const dividers=native.rows.filter(row=>row.cells.some(cell=>cell.paragraphs.some(p=>/^_{17,18}$/.test(p.text))));
  const divider=dividers.length===1?dividers[0].row:null;
  if(dividers.length>1)gaps.push('conflicting-divider-layout');
  const fields={};
  for(const [column,side] of sides.entries()) {
    const field=side+'Text',text=amendment[field],regions=[],paragraphs=[];let rawText='';
    for(const row of native.rows) {
      requireValue(row.cells.length===2&&row.cells[column].column===column+1,'Comparison sides are unresolved');
      const cell=row.cells[column];requireValue(cell.paragraphs.length>0,'An empty cell needs its native paragraph');
      for(const [index,p] of cell.paragraphs.entries()) {
        requireValue(typeof p.text==='string','Missing native text');
        requireValue(rawText.length+p.text.length+1<=MAX_TEXT&&paragraphs.length<4000,'Comparison text exceeds metadata limit');
        if(regions.length) {
          const start=rawText.length;rawText+='\n';
          regions.push({kind:'structural-join',rawText:'\n',rawStart:start,rawEnd:rawText.length,join:index?'paragraph-newline':'row-newline',
            native:locator(source,native,cell.path,side),between:[paragraphs.at(-1).native,locator(source,native,p.path,side,range(0,0))]});
        }
        const start=rawText.length;rawText+=p.text;
        const layoutKind=row.row===divider?'published-separator':divider!=null&&row.row>divider?'note-definition':'body-wording';
        const objects=structuredClone([...(p.unsupported||[]),...(p.objects||[])]),complete=p.complete===true&&!objects.length;
        const region={kind:complete?layoutKind:'unresolved-content',layoutKind,
          rawText:p.text,rawStart:start,rawEnd:rawText.length,native:locator(source,native,p.path,side,range(0,p.text.length)),
          roleStatus:complete?'candidate':'unresolved',explicitEmpty:p.text==='',objects,
          annotations:{fields:structuredClone(p.fields||[]),bookmarks:structuredClone(p.bookmarks||[])}};
        if(!complete)gaps.push(field+':unsupported-native-content');
        regions.push(region);paragraphs.push({...region,paragraph:p,row:row.row});
      }
    }
    const map=fieldMap(rawText,text),markers=[],definitions=[],separators=[];
    if(!map)gaps.push(field+':unmapped-field');
    for(const region of regions)region.fieldSlice=sliceFor(field,text,map,region);
    for(const p of paragraphs) {
      const complete=p.paragraph.complete===true&&!p.objects.length;
      const runs=p.paragraph.runs||[];
      for(const separator of p.paragraph.separators||[]) {
        const {startUtf16:start,endUtf16:end}=separator;
        requireValue(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=p.rawText.length
          &&p.rawText.slice(start,end)===separator.text,'Invalid native separator boundary');
        const span={rawStart:p.rawStart+start,rawEnd:p.rawStart+end,rawText:separator.text,
          native:locator(source,native,separator.path,side,range(0,separator.text.length))};
        separators.push({kind:separator.kind,rawText:separator.text,native:span.native,fieldSlice:sliceFor(field,text,map,span)});
      }
      for(const run of runs) {
        const start=run.startUtf16,end=run.endUtf16;
        requireValue(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=p.rawText.length&&p.rawText.slice(start,end)===run.text,'Invalid native run boundary');
        const presentation=vertical(run);
        if(presentation==='unknown'&&!run.nativeReferences?.length)continue;
        const span={...p,rawStart:p.rawStart+start,rawEnd:p.rawStart+end,rawText:run.text,native:locator(source,native,run.path,side,range(0,run.text.length))};
        const marker={key:sha(JSON.stringify(span.native)),kind:'unresolved-vertical-text',rawText:run.text,presentation,native:span.native,
          fieldSlice:sliceFor(field,text,map,span),nativeReferenceId:null,targetNativeId:null,definitionKeys:[],binding:'unresolved',
          evidence:[span.native],presentationEvidence:structuredClone(run.verticalEvidence||[])};
        if(run.nativeReferences?.length)marker.nativeReferences=structuredClone(run.nativeReferences);
        markers.push(marker);
      }
      if(p.layoutKind!=='note-definition')continue;
      const labels=markers.filter(m=>m.native.path.startsWith(p.native.path+'/')&&m.presentation==='superscript'&&/^\d+$/.test(m.rawText)
        &&runs.some(r=>r.path===m.native.path&&r.startUtf16===0)&&/^\s/u.test(p.rawText.slice(m.rawText.length)));
      const label=labels.length===1?labels[0]:null;
      if(label)label.kind='typed-definition-label';
      definitions.push({key:sha(JSON.stringify(p.native)),native:[p.native],text:p.rawText,textHash:sha(p.rawText),
        printedLabel:label?.rawText??null,labelKey:label?.key??null,fieldSlice:sliceFor(field,text,map,p),complete,
        explicitEmpty:p.explicitEmpty,objects:p.objects,links:(p.paragraph.hyperlinks||[]).map(link=>({
          rawText:link.text,native:locator(source,native,link.path,side,range(0,link.text.length)),
          href:link.relationship?.target??null,status:link.relationship?.target?'native-link':'unresolved',
          nativeRelationshipId:link.relationshipId??null,anchor:link.anchor??null,relationship:structuredClone(link.relationship??null)})),
        literalUrls:[...p.rawText.matchAll(/https?:\/\/[^\s]+/gu)].map(m=>({rawText:m[0],href:null,status:'literal-url-candidate',native:locator(source,native,p.native.path,side,range(m.index,m.index+m[0].length))})),
        referenceOccurrences:[],binding:'unresolved',gaps:label?[]:[p.explicitEmpty?'explicit-empty':'missing-definition-label']});
    }
    for(const definition of definitions) {
      if(!definition.printedLabel)continue;
      const duplicates=definitions.filter(d=>d.printedLabel===definition.printedLabel);
      const references=markers.filter(m=>['unresolved-vertical-text','typed-reference-candidate'].includes(m.kind)&&m.presentation==='superscript'&&m.rawText===definition.printedLabel
        &&paragraphs.some(p=>p.kind==='body-wording'&&p.paragraph.complete===true&&!p.objects.length&&m.native.path.startsWith(p.native.path+'/'))&&!m.nativeReferences?.length);
      definition.referenceOccurrences=references.map(m=>m.key);
      const candidate=identity&&source.identityStatus!=='conflicting'&&map&&definition.complete&&definition.text.length>definition.printedLabel.length&&duplicates.length===1;
      if(duplicates.length>1)definition.gaps.push('duplicate-definition-label');
      if(!references.length)definition.gaps.push('missing-body-reference');
      definition.binding=duplicates.length>1?'conflicting':candidate&&references.length?'source-layout-candidate':'unresolved';
      for(const marker of references) {
        marker.kind='typed-reference-candidate';marker.definitionKeys=duplicates.map(d=>d.key);marker.binding=definition.binding;
        marker.evidence=[marker.native,...regions.filter(r=>r.kind==='published-separator').map(r=>r.native),...duplicates.flatMap(d=>d.native)];
      }
    }
    fields[field]={text,fieldSha256:typeof text==='string'?sha(text):null,rawText,regions,markers,definitions,separators,
      mapping:map?{status:'mapped',segments:map.segments}:{status:'unmapped',segments:[]}};
  }
  return {metadataVersion:METADATA_SCHEMA,source,pathConvention:native.pathConvention,namespaces:structuredClone(native.namespaces),
    table:locator(source,native,native.tablePath),heading:native.heading?{text:native.heading.text,native:locator(source,native,native.heading.path)}:null,
    status:gaps.length?'unresolved':'candidate',fields,gaps};
}

/** Native XHTML edges stay separate from Word layout candidates. */
export function xhtmlNoteMetadata({observation,native}) {
  const source=sourceObservation(observation);validateNative(source,native);
  requireValue(Array.isArray(native.references)&&native.references.length<=500,'Unbounded XHTML references');
  const references=native.references.map(reference=>{
    const targets=reference.targets||[],id=reference.referenceAttributes?.href?.slice(1);
    const occurrences=reference.allDocumentReferencesToSameTarget||[];
    const current=occurrences.filter(item=>item.path===reference.referencePath&&item.attributes?.id===reference.referenceAttributes?.id&&item.attributes?.href===reference.referenceAttributes?.href);
    const duplicateOccurrences=new Set(occurrences.map(item=>item.path)).size!==occurrences.length;
    const exact=native.complete===true&&reference.referenceAttributes?.href?.startsWith('#')&&targets.length===1&&targets[0].labelAttributes?.id===id&&current.length===1&&!duplicateOccurrences;
    const gaps=[];
    if(!targets.length)gaps.push('missing-target');
    if(targets.length>1)gaps.push('duplicate-target');
    if(current.length!==1||duplicateOccurrences)gaps.push('conflicting-reference-occurrences');
    if(native.complete!==true)gaps.push('incomplete-source-observation');
    return {rawText:reference.referenceLabel,native:locator(source,native,reference.referencePath,null,range(0,reference.referenceLabel.length),reference.referenceAttributes?.id??null),
      attributes:structuredClone(reference.referenceAttributes),binding:targets.length>1||duplicateOccurrences?'conflicting':exact?'explicit-native-edge':'unresolved',gaps,
      occurrences:occurrences.map(item=>({rawText:item.text,attributes:structuredClone(item.attributes),
        native:locator(source,native,item.path,null,range(0,item.text.length),item.attributes?.id??null)})),
      occurrenceCoverage:native.complete===true?'complete-source-observation':'unknown',
      definitions:targets.map(target=>({text:target.text,textHash:sha(target.text),native:locator(source,native,target.path,null,range(0,target.text.length)),
        printedLabel:target.label,backlink:{rawText:target.label,native:locator(source,native,target.labelPath,null,range(0,target.label.length),target.labelAttributes?.id??null),attributes:structuredClone(target.labelAttributes),
          binding:exact&&target.labelAttributes?.href==='#'+reference.referenceAttributes?.id?'explicit-native-edge':'unresolved'},
        links:(target.anchors||[]).map(link=>({rawText:link.text,attributes:structuredClone(link.attributes),
          href:link.attributes?.href??null,native:locator(source,native,link.path,null,range(0,link.text.length),link.attributes?.id??null)})),objects:structuredClone(target.unsupported||[])}))};
  });
  const markers=(native.verticalText||[]).map(mark=>({kind:'unresolved-vertical-text',rawText:mark.text,presentation:mark.presentation,
    native:locator(source,native,mark.path,null,range(0,mark.text.length)),binding:'unresolved'}));
  return {metadataVersion:METADATA_SCHEMA,source,pathConvention:native.pathConvention,namespaces:structuredClone(native.namespaces),references,markers};
}
