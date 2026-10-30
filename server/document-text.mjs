import {publishDocumentImages} from './document-image-store.mjs';
import {docxImages} from './docx-images.mjs';
import {languagePreference} from './language-order.mjs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {writeCacheFile} from './cache-publication.mjs';
import path from 'node:path';
import https from 'node:https';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import { boundedUpstream, upstreamResponseError } from './odp.mjs';
import {retryAfterSeconds} from './upstream-queue.mjs';
import { documentFiles,array,tail } from './activity-index-model.mjs';
import { languageCode } from './ep-links.mjs';
import {sharedRequest,waitForRequest,requestSignal,isLocalRequestFailure} from './request-budget.mjs';
import {numberingLabels} from './docx-numbering.mjs';
import {noteNumbering} from './docx-note-numbering.mjs';
import {userAgent} from './user-agent.mjs';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {config} from './config.mjs';
import {sourceIndex,OBJECT_REPLACEMENT,symbolText,skippedCounterRisk,documentStructure,DOCX_EXTRACTION_VERSION as EXTRACTION_VERSION} from './docx-source-structure.mjs';
import {styleFormatting,paragraphFormat,tableLayout,documentFormatting,DOCX_FORMATTING_VERSION as FORMATTING_VERSION} from './docx-formatting.mjs';
import {documentAuthorIdentities} from './document-authors.mjs';
import {adoptedTextXmlSources} from './adopted-text-xml.mjs';
export const DOCUMENT_TEXT_VERSION=3;
export {documentStructure} from './docx-source-structure.mjs';
export {documentFormatting} from './docx-formatting.mjs';

// A-10-2026-0105 has an 8,602,381-byte main XML part in a 0.8 MiB archive.
// Bound the aggregate inflated parts independently of the download size.
const MAX_FILE=8*1024*1024,MAX_XML=12*1024*1024,DAY=86400000;
const NOTE_LIMITS=Object.freeze({notes:500,text:4000,links:10,documentLinks:500});
let memoryBytes=0;
const memorySizes=new Map();
function remember(key,record){const size=Buffer.byteLength(JSON.stringify(record));memoryBytes-=memorySizes.get(key)||0;memory.delete(key);memorySizes.delete(key);if(size>64*1024*1024)return;memory.set(key,record);memorySizes.set(key,size);memoryBytes+=size;while(memory.size>100||memoryBytes>64*1024*1024){const first=memory.keys().next().value;memoryBytes-=memorySizes.get(first)||0;memory.delete(first);memorySizes.delete(first);}}
const memory=new Map(),pending=new Map(),failures=new Map(),reformatted=new Set();
// Published DOCX files carry no HTTP validators. Recent texts are re-read weekly;
// a text retrieved 60 or more days after publication is treated as settled, and a
// changed size or issue time in the API's file listing marks a re-publication.
const RECENT_REFRESH_MS=7*DAY,SETTLED_AFTER_MS=60*DAY;
const budgets=new Map();
function diskBudget(directory){
  const folder=path.join(directory,'document-text-v1');
  if(!budgets.has(folder))budgets.set(folder,new CacheDiskBudget(folder,{maxBytes:config.documentTextMaxDiskBytes,maxEntries:20000,pattern:/^[0-9a-f]{64}\.json$/}));
  return budgets.get(folder);
}
function fileDescriptor(work,url){
  for(const e of array(work.is_realized_by))for(const m of array(e.is_embodied_by)){
    let href=null;try{href=new URL(m.is_exemplified_by,'https://data.europarl.europa.eu/').href;}catch{}
    if(href===url)return {byteSize:m.byteSize!=null&&m.byteSize!==''&&Number.isFinite(Number(m.byteSize))?Number(m.byteSize):null,issued:typeof m.issued==='string'&&Number.isFinite(Date.parse(m.issued))?m.issued:null};
  }
  return {byteSize:null,issued:null};
}
export function documentNeedsRefresh(saved,work,descriptor,now){
  if(['byteSize','issued'].some(k=>descriptor[k]!=null&&saved.source?.[k]!=null&&descriptor[k]!==saved.source[k]))return true;
  const published=Date.parse(work.document_date||descriptor.issued||''),fetched=Date.parse(saved.fetchedAt);
  if(Number.isFinite(published)&&fetched-published>=SETTLED_AFTER_MS)return false;
  return now-fetched>=RECENT_REFRESH_MS;
}
const DOCX_PARTS=['word/document.xml','word/styles.xml','word/numbering.xml','word/settings.xml','word/_rels/document.xml.rels','word/footnotes.xml','word/_rels/footnotes.xml.rels','word/endnotes.xml','word/_rels/endnotes.xml.rels'];
// Read only standard text, style, numbering, note and relationship parts. No archive paths are written to disk.
export function docxParts(buffer,{packageMetadata=false}={}) {
  if(buffer.length>MAX_FILE || buffer.length<22)throw new Error('DOCX size is unsupported.');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Invalid DOCX archive.');
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('Multipart DOCX is unsupported.');
  const count=buffer.readUInt16LE(end+10);let cursor=buffer.readUInt32LE(end+16),total=0;
  const parts=new Map();
  if(count>2000)throw new Error('DOCX contains too many entries.');
  for(let i=0;i<count;i++) {
    if(cursor+46>buffer.length || buffer.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid DOCX directory.');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    cursor+=46+nameLength+extra+comment;
    if(!DOCX_PARTS.includes(name)&&!(packageMetadata&&['[Content_Types].xml','_rels/.rels'].includes(name)))continue;
    const partLimit=name==='word/document.xml'?MAX_XML:4*1024*1024;
    total+=size;
    if(parts.has(name) || flags&1 || total>MAX_XML || size>partLimit || compressed>MAX_FILE || offset+30>buffer.length || buffer.readUInt32LE(offset)!==0x04034b50)throw new Error('Unsupported DOCX document entry.');
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    if(start+compressed>buffer.length)throw new Error('Truncated DOCX entry.');
    const bytes=buffer.subarray(start,start+compressed);
    const decoded=method===0?bytes:method===8?inflateRawSync(bytes,{maxOutputLength:partLimit}):null;
    if(!decoded || decoded.length!==size)throw new Error('Invalid DOCX compression.');
    const xml=decoded.toString('utf8');
    if(!xml || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)throw new Error('Invalid DOCX document XML.');
    parts.set(name,xml);
  }
  if(!parts.has('word/document.xml'))throw new Error('Invalid DOCX document XML.');
  return parts;
}
const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const rawAttribute=(node,name)=>node?.[':@']?.['@_'+name];
const property=(nodes,key)=>attribute(child(nodes,key),'val');
export function hiddenValue(properties,key='vanish') {
  const node=child(properties,'w:'+key);
  return node ? !['0','false','off'].includes(String(attribute(node,'val')).toLowerCase()) : undefined;
}
const parser=()=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const noteMarks=['w:footnoteReference','w:footnoteRef','w:endnoteReference','w:endnoteRef'];
function externalLinks(xml) {
  const links=new Map();if(!xml)return links;
  for(const node of children(parser().parse(xml),'Relationships')||[])if(node.Relationship) {
    const id=rawAttribute(node,'Id'),target=rawAttribute(node,'Target');
    if(rawAttribute(node,'TargetMode')==='External'&&typeof target==='string'&&target.length<=500&&/^https?:\/\//i.test(target))links.set(id,target);
  }
  return links;
}
export function styleVisibility(stylesXml) {
  const styles=children(stylesXml?parser().parse(stylesXml):[],'w:styles') || [];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{
    parent:property(node['w:style'],'w:basedOn'),toggle:hiddenValue(children(node['w:style'],'w:rPr'))===true,
    webHidden:hiddenValue(children(node['w:style'],'w:rPr'),'webHidden'),
  }]));
  const defaultStyle=type=>attribute(styles.find(node=>node['w:style'] && attribute(node,'type')===type && ['1','true','on'].includes(String(attribute(node,'default')))),'styleId');
  const defaultParagraph=defaultStyle('paragraph'),defaultCharacter=defaultStyle('character'),styleToggles=new Map();
  const defaultProperties=children(children(children(styles,'w:docDefaults'),'w:rPrDefault'),'w:rPr');
  const defaults={vanish:hiddenValue(defaultProperties)??false,webHidden:hiddenValue(defaultProperties,'webHidden')??false};
  function styledHidden(id,inherited) {
    const apply=style=>({vanish:inherited.vanish!==style.toggle,webHidden:style.webHidden??inherited.webHidden});
    if(styleToggles.has(id))return apply(styleToggles.get(id));
    if(!byId.has(id))return inherited;
    const chain=[],seen=new Set();
    while(byId.has(id) && !styleToggles.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    // In styles, vanish toggles the inherited value. webHidden is ordinary
    // on/off cascading (ECMA-376 17.7.3), and direct run overrides are absolute.
    let resolved=styleToggles.get(id)??{toggle:false,webHidden:undefined};
    for(const styleId of chain.reverse()) {const style=byId.get(styleId);resolved={toggle:resolved.toggle!==style.toggle,webHidden:style.webHidden??resolved.webHidden};styleToggles.set(styleId,resolved);}
    return apply(resolved);
  }
  return {styledHidden,defaultParagraph,defaultCharacter,defaults};
}
// Footnote markers are recorded at their position instead of gluing their number to the text;
// hyperlinks keep the exact span they cover, so the document itself identifies what a link names.
const inlineContainers=new Set(['w:ins','w:moveTo','w:sdt','w:sdtContent','w:customXml','w:smartTag','w:fldSimple','w:dir','w:bdo']);
const nonText=new Set(['w:del','w:moveFrom','w:instrText','w:delText','w:delInstrText','w:pPr','w:rPr','w:sdtPr','w:sdtEndPr','w:customXmlPr',
  'w:bookmarkStart','w:bookmarkEnd','w:commentRangeStart','w:commentRangeEnd','w:commentReference','w:proofErr','w:permStart','w:permEnd',
  'w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd','w:fldChar','w:lastRenderedPageBreak',...noteMarks]);
function counterGap(node,context) {
  const risk=skippedCounterRisk([node]);
  for(const key of ['lists','notes'])context.counterGaps[key] ||= risk[key];
}
// Reuse the wording walker's final-revision/style rules for pictures inside
// compatibility branches. Suppressed branches cannot be revived by a fallback.
function pictureVisibility(nodes,context) {
  const visible={text:'',marks:[],spans:[],objects:[]};
  inline(nodes,{vanish:false,webHidden:false},visible,{...context,images:null,warnings:new Set(),counterGaps:{...context.counterGaps}});
  const paths=new Set(visible.objects.filter(object=>object.kind==='drawing').map(object=>object.path)),pictures=[];
  function visit(entries){for(const entry of entries||[])for(const [key,value] of Object.entries(entry)){
    if(['w:drawing','w:pict'].includes(key))pictures.push(context.sourceIndex.get(entry)?.path);
    else if(key!==':@'&&Array.isArray(value))visit(value);
  }}visit(nodes);
  return !pictures.length?'none':pictures.every(path=>paths.has(path))?'visible':'hidden';
}
function objectText(node,key,out,context) {
  const kind=key==='w:sym'?'symbol':['w:drawing','w:pict'].includes(key)?'drawing':key==='w:object'?'object':key.startsWith('m:')?'math':'unsupported';
  const font=attribute(node,'font'),code=attribute(node,'char');
  const mapped=kind==='symbol'?symbolText(font,code):null,replacement=mapped??OBJECT_REPLACEMENT,status=mapped?'mapped':'unresolved';
  const resolved=kind==='drawing'||key==='mc:AlternateContent'?context.images?.resolve(node,context.sourcePart,nodes=>pictureVisibility(nodes,context)):null,image=resolved?.id?resolved:null;
  out.objects.push({...(image?{image}:{}),...(resolved?.reason?{imageUnavailableReason:resolved.reason}:{}),offset:out.text.length,path:context.sourceIndex.get(node).path,kind,status,replacement,role:mapped&&!out.text.trim()?'leading-marker':'content',
    ...(kind==='symbol'?{font:font??'',code:code??''}:{})});
  out.text+=replacement;
  if(!mapped)counterGap(node,context);
  if(!mapped)context.warnings.add(kind==='symbol'?'An unmapped symbol is shown as an object placeholder; the surrounding text is retained.':'A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.');
}
function inline(nodes,hidden,out,context) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key===':@')continue;
    if(key==='w:r') {
      const properties=children(value,'w:rPr');
      const styled=context.style.styledHidden(property(properties,'w:rStyle') || context.style.defaultCharacter,hidden);
      const visibility={vanish:hiddenValue(properties)??styled.vanish,webHidden:hiddenValue(properties,'webHidden')??styled.webHidden};
      if(visibility.vanish||visibility.webHidden)continue;
      const runStart=out.text.length,format=out.runs&&context.formatting?.run(context.paragraphStyle,properties);
      const recordRun=()=>{if(format&&out.text.length>runStart)out.runs.push({start:runStart,end:out.text.length,...format});};
      if(!value.some(item=>noteMarks.some(mark=>mark in item))){inline(value,visibility,out,context);recordRun();continue;}
      // Children keep their order. Only the text that immediately follows a custom-marked reference is its label.
      let pending=null;
      for(const item of value) {
        const kind=noteMarks.find(name=>name in item);
        if(kind){pending={kind,id:String(attribute(item,'id')??''),label:'',custom:['1','true','on'].includes(String(attribute(item,'customMarkFollows'))),offset:out.text.length,numberingUnknown:context.counterGaps.notes};out.marks.push(pending);if(!pending.custom)pending=null;continue;}
        if(pending&&'w:t' in item){const label={text:'',marks:[],spans:[],objects:[]};inline([item],visibility,label,context);pending.label=label.text.trim();pending=null;continue;}
        inline([item],visibility,out,context);
      }
      recordRun();
    }
    else if(key==='w:t'&&!hidden.vanish&&!hidden.webHidden)out.text+=(value||[]).filter(item=>'#text' in item).map(item=>String(item['#text'])).join('');
    else if(key==='w:tab'||key==='w:ptab')out.text+='\t';
    else if(key==='w:br'||key==='w:cr')out.text+='\n';
    else if(key==='w:noBreakHyphen')out.text+='‑';
    else if(key==='w:softHyphen')out.text+='­';
    else if(key==='w:hyperlink'&&Array.isArray(value)){const target=context.links.get(rawAttribute(node,'r:id')),start=out.text.length;inline(value,hidden,out,context);if(target&&out.text.length>start)out.spans.push({start,end:out.text.length,url:target});}
    else if(inlineContainers.has(key)&&Array.isArray(value))inline(value,hidden,out,context);
    else if(key!=='#text'&&!nonText.has(key)&&!hidden.vanish&&!hidden.webHidden)objectText(node,key,out,context);
  }
}
const blockContainers=new Set(['w:document','w:body','w:tbl','w:tr','w:tc',...inlineContainers]);
const blockProperties=new Set(['w:tblPr','w:tblPrEx','w:tblGrid','w:trPr','w:tcPr','w:sectPr']);
// EP template tags are hidden text. Use them only to locate a byline; the
// names themselves must still come from the ordinary visible extraction.
function templateText(nodes) {
  return (nodes || []).flatMap(node=>Object.entries(node).flatMap(([key,value])=>
    key==='w:t' ? value.map(item=>item['#text'] || '').join('') : Array.isArray(value)&&!['w:del','w:moveFrom'].includes(key) ? templateText(value) : [])).join('');
}
function paragraphsOf(nodes,context) {
  context.sourceIndex??=sourceIndex(nodes);context.counterGaps??={lists:false,notes:false};const result=[];let segment=0;
  function visit(nodes,boundary={container:'other',containerPath:'/'}) {
  for(const node of nodes || [])for(const [key,value] of Object.entries(node)) {
    if(key==='w:p'){
      const out={text:'',marks:[],spans:[],objects:[],...(context.formatting?{runs:[]}:{})},counterGaps={...context.counterGaps};
      context.paragraphStyle=property(children(value,'w:pPr'),'w:pStyle');
      inline(value,context.style.styledHidden(property(children(value,'w:pPr'),'w:pStyle') || context.style.defaultParagraph,context.style.defaults),out,context);
      const properties=children(value,'w:pPr'),number=context.numberLabel?.(properties),unknownList=!!number?.label&&counterGaps.lists,
        label=unknownList?'?':number?.label,section=context.paragraphSections?.get(node);
      if(unknownList)context.warnings.add('Some automatic list labels are unknown after skipped document content.');
      if(label&&out.text.trim()){const prefix=label+'\t';out.text=prefix+out.text;for(const mark of out.marks)mark.offset+=prefix.length;for(const object of out.objects)object.offset+=prefix.length;for(const span of out.spans){span.start+=prefix.length;span.end+=prefix.length;}for(const run of out.runs||[]){run.start+=prefix.length;run.end+=prefix.length;}}
      const text=out.text.trim(),lead=out.text.length-out.text.trimStart().length,at=offset=>Math.max(0,Math.min(text.length,offset-lead));
      if(text||out.marks.some(mark=>['w:footnoteReference','w:endnoteReference'].includes(mark.kind)))result.push({text,section,paragraphStyle:context.paragraphStyle,authorMarker:/<Depute>/.test(templateText(value)),
        properties:{styleId:property(properties,'w:pStyle')||context.style.defaultParagraph||null,numberingLabel:label||'',numberingComplete:!unknownList&&!number?.incomplete,notesComplete:!out.marks.some(mark=>mark.numberingUnknown&&!mark.label)},
        source:{...context.sourceIndex.get(node),...boundary,segment,complete:!unknownList&&!number?.incomplete&&out.objects.every(object=>object.status==='mapped')&&!out.marks.some(mark=>mark.numberingUnknown&&!mark.label)},
        objects:out.objects.map(object=>({...object,offset:at(object.offset)})),
        marks:out.marks.map(mark=>({...mark,offset:at(mark.offset)})),spans:out.spans.map(span=>({start:at(span.start),end:at(span.end),url:span.url})).filter(span=>span.end>span.start),
        ...(context.formatting?{format:paragraphFormat(context.formatting.paragraph(properties),out.runs.map(run=>({...run,start:at(run.start),end:at(run.end)})),context.formatting.baseSize,text.length)}:{})});
      else segment++;
    }
    else if(blockContainers.has(key)&&Array.isArray(value)) {
      const separated=['w:tbl','w:tc'].includes(key);if(separated)segment++;
      const tables=context.tables,layout=tables?.layout;
      // Only the outermost table is laid out; nested tables stay inside their cell.
      if(tables&&key==='w:tbl'&&!layout){tables.layout={rows:[],bordered:context.formatting.tableBordered(children(value,'w:tblPr'))};}
      else if(tables&&key==='w:tr'&&layout&&tables.depth===1){const trPr=children(value,'w:trPr');layout.rows.push({gridBefore:Number(property(trPr,'w:gridBefore'))||0,cells:[]});}
      else if(tables&&key==='w:tc'&&layout&&tables.depth===1&&layout.rows.length){const tcPr=children(value,'w:tcPr'),merge=child(tcPr,'w:vMerge');
        tables.cell={start:result.length,colSpan:Number(property(tcPr,'w:gridSpan'))||1,vMerge:merge?attribute(merge,'val')==='restart'?'restart':'continue':undefined,borders:context.formatting.cellBorders(tcPr)};}
      const cell=tables&&key==='w:tc'&&tables.depth===1?tables.cell:null;
      if(tables&&key==='w:tbl')tables.depth++;
      visit(value,key==='w:body'?{container:'body',containerPath:context.sourceIndex.get(node).path}:key==='w:tc'?{container:'table-cell',containerPath:context.sourceIndex.get(node).path}:boundary);
      if(separated)segment++;
      if(cell){cell.end=result.length;tables.layout.rows.at(-1).cells.push(cell);tables.cell=null;}
      if(tables&&key==='w:tbl'&&--tables.depth===0){const done=tables.layout;tables.layout=null;if(done.rows.some(row=>row.cells.some(cell=>cell.end>cell.start)))tables.found.push(tableLayout(done));}
    }
    else if(key!==':@'&&key!=='#text'&&!key.startsWith('?')&&!nonText.has(key)&&!blockProperties.has(key)) {
      counterGap(node,context);
      segment++;context.warnings.add('Some document blocks could not be read; paragraph source boundaries retain the gap.');
    }
    else if(['w:del','w:moveFrom'].includes(key))segment++;
  }
  }
  visit(nodes);
  return result;
}
// Paragraphs stay plain strings. Footnotes and links are returned separately with exact positions.
export function docxContent(buffer,{includeParagraphProperties=false,includeNoteObjects=false,numbering=numberingLabels}={}) {
  const parts=docxParts(buffer),images=docxImages(buffer,parts),style=styleVisibility(parts.get('word/styles.xml')),warnings=new Set(),extractionGaps=[];
  let incompleteNumber=false;
  const label=numbering(parts.get('word/numbering.xml'),parts.get('word/styles.xml'),{add(message){incompleteNumber=true;warnings.add(message);}});
  const numberLabel=properties=>{incompleteNumber=false;const value=label(properties);return {label:value,incomplete:incompleteNumber};};
  const document=parser().parse(parts.get('word/document.xml')),paragraphSections=new WeakMap(),noteLabel=noteNumbering(document,parts.get('word/settings.xml'),warnings,paragraphSections);
  const formatting=styleFormatting(children(parts.has('word/styles.xml')?parser().parse(parts.get('word/styles.xml')):[],'w:styles')),tables={depth:0,layout:null,cell:null,found:[]};
  const body=paragraphsOf(document,{style,numberLabel,warnings,paragraphSections,formatting,tables,images,links:externalLinks(parts.get('word/_rels/document.xml.rels'))});
  if(!body.length || body.length>20000 || body.map(p=>p.text).join('\n').length>2*1024*1024)throw new Error('DOCX text is empty or exceeds the supported size.');
  const supplied=new Map();
  for(const kind of ['footnote','endnote'])if(parts.has('word/'+kind+'s.xml')) {
    const sourcePart='word/'+kind+'s.xml',document=parser().parse(parts.get(sourcePart)),index=sourceIndex(document);
    const context={style,numberLabel,warnings,images,sourcePart,links:externalLinks(parts.get('word/_rels/'+kind+'s.xml.rels'))};
    for(const node of children(document,'w:'+kind+'s')||[]) {
      if(!node['w:'+kind]||!['normal',undefined].includes(attribute(node,'type')))continue;
      // Use the whole note part's index for unambiguous source paths. Ordinary
      // extraction keeps its existing note projection unless objects are asked for.
      const noteWarnings=includeNoteObjects?new Set():warnings;context.warnings=noteWarnings;
      context.sourceIndex=includeNoteObjects?index:undefined;
      const paragraphs=paragraphsOf(node['w:'+kind],context),spans=[],objects=[];let offset=0;
      for(const [paragraph,part] of paragraphs.entries()){
        spans.push(...part.spans.map(span=>({...span,start:span.start+offset,end:span.end+offset})));
        objects.push(...part.objects.map(object=>({...object,paragraph,paragraphOffset:object.offset,offset:object.offset+offset,sourcePart})));
        offset+=part.text.length+1;
      }
      for(const warning of noteWarnings)warnings.add(warning);
      const text=paragraphs.map(p=>p.text).join('\n').slice(0,NOTE_LIMITS.text);
      const key=(kind==='endnote'?'endnote:':'')+String(attribute(node,'id'));
      const availableSpans=spans.filter(span=>span.end<=text.length),truncated=offset-1>NOTE_LIMITS.text,linksTruncated=availableSpans.length>NOTE_LIMITS.links;
      supplied.set(key,{text,truncated,spans:availableSpans.slice(0,NOTE_LIMITS.links),
        ...(includeNoteObjects?{source:{part:sourcePart,path:index.get(node).path},objects:objects.filter(object=>object.offset+object.replacement.length<=text.length),
          gaps:[...(truncated?[{code:'note-text-truncated',limit:NOTE_LIMITS.text,retained:text.length,total:offset-1,message:'A source note exceeds the retained text limit.'}]:[]),
            ...(linksTruncated?[{code:'note-links-truncated',limit:NOTE_LIMITS.links,retained:NOTE_LIMITS.links,total:availableSpans.length,message:'A source note exceeds the retained hyperlink limit.'}]:[])],
          extractionComplete:!truncated&&!linksTruncated&&paragraphs.every(part=>part.properties.numberingComplete&&part.properties.notesComplete)&&![...noteWarnings].some(warning=>/blocks could not be read/iu.test(warning))}:{})});
    }
  }
  const notes=[],anchors=[],labels=new Map();
  body.forEach((paragraph,index)=>{for(const mark of paragraph.marks) {
    if(!['w:footnoteReference','w:endnoteReference'].includes(mark.kind))continue;
    const id=(mark.kind==='w:endnoteReference'?'endnote:':'')+mark.id;
    if(!labels.has(id)){
      if(mark.numberingUnknown&&!mark.label)warnings.add('Some automatic note labels are unknown after skipped document content.');
      labels.set(id,mark.label||(mark.numberingUnknown?'?':noteLabel(mark.kind,paragraph.section,mark.custom)));
    }
    if(!supplied.has(id)){warnings.add('A referenced footnote or endnote is missing.');if(includeNoteObjects)paragraph.properties.notesComplete=false;continue;}
    let note=notes.find(n=>n.id===id);
    if(!note){
      if(notes.length>=NOTE_LIMITS.notes){
        warnings.add('The referenced notes exceed the supported note count.');
        if(includeNoteObjects){
          paragraph.properties.notesComplete=false;
          const source=supplied.get(id).source;
          extractionGaps.push({code:'note-count-truncated',note:id,paragraph:index,offset:mark.offset,sourcePart:source.part,sourcePath:source.path,
            limit:NOTE_LIMITS.notes,message:'A referenced source note exceeds the retained note count.'});
        }
        continue;
      }
      const label=labels.get(id),source=supplied.get(id);
      if(includeNoteObjects)extractionGaps.push(...source.gaps.map(gap=>({...gap,note:id,sourcePart:source.source.part,sourcePath:source.source.path})));
      if(source.truncated)warnings.add('A referenced note exceeds the supported text size.');
      if(!source.text)warnings.add('A referenced footnote or endnote is empty.');
      // A custom mark repeats its label as ordinary footnote text; automatic numbering does not.
      const text=mark.custom&&mark.label&&source.text.startsWith(label)&&/^[\s.)]/.test(source.text.slice(label.length))?source.text.slice(label.length).replace(/^[\s.)]+/,''):source.text,removed=source.text.length-text.length;
      const linkSpans=source.spans.map(span=>({...span,start:span.start-removed,end:span.end-removed})).filter(span=>span.start>=0);
      note={id,label,text,links:[...new Set(source.spans.map(span=>span.url))],linkSpans,
        ...(includeNoteObjects?{source:source.source,extractionComplete:source.extractionComplete&&!source.truncated&&!!source.text,
          objects:source.objects.map(object=>({...object,note:id,offset:object.offset-removed})).filter(object=>object.offset>=0)}:{})};notes.push(note);
    }
    anchors.push({paragraph:index,offset:mark.offset,note:note.id,label:note.label});
  }});
  const documentLinks=body.flatMap((paragraph,index)=>paragraph.spans.map(span=>({paragraph:index,...span}))),links=documentLinks.slice(0,NOTE_LIMITS.documentLinks);
  if(includeNoteObjects){
    const omitted=new Map();
    for(const link of documentLinks.slice(NOTE_LIMITS.documentLinks))omitted.set(link.paragraph,(omitted.get(link.paragraph)??0)+1);
    for(const [paragraph,count] of omitted){
      body[paragraph].properties.annotationsComplete=false;body[paragraph].source.complete=false;
      extractionGaps.push({code:'document-links-truncated',paragraph,sourcePart:'word/document.xml',sourcePath:body[paragraph].source.path,
        limit:NOTE_LIMITS.documentLinks,omitted:count,message:'Source paragraph hyperlinks exceed the retained document hyperlink limit.'});
    }
  }
  const subject=body.findIndex(paragraph=>paragraph.paragraphStyle==='QuestionSubject');
  const authorBylineParagraphs=subject>0 ? body.slice(0,subject).map(paragraph=>paragraph.text) : body.filter(paragraph=>paragraph.authorMarker).map(paragraph=>paragraph.text);
  return {sourceHash:createHash('sha256').update(buffer).digest('hex'),imageAssets:images.assets,paragraphs:body.map(p=>p.text),notes,anchors,links,structureStatus:'extracted',paragraphSources:body.map(p=>p.source),
    ...(includeParagraphProperties?{paragraphProperties:body.map(p=>p.properties)}:{}),
    ...(includeNoteObjects?{extractionGaps}:{}),
    authorBylineParagraphs,
    documentObjects:body.flatMap((p,paragraph)=>p.objects.map(object=>({paragraph,...object}))),extractionWarnings:[...warnings],
    formattingVersion:FORMATTING_VERSION,paragraphFormats:body.map(p=>p.format),tables:tables.found};
}
export const docxParagraphs=buffer=>docxContent(buffer).paragraphs;

export function allowedDownload(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && !u.search &&
    ((u.hostname==='data.europarl.europa.eu' && u.pathname.startsWith('/distribution/')) || (u.hostname==='redmapl3.europarl.europa.eu' && u.pathname.startsWith('/RedmapFront/media/')))
    && u.pathname.endsWith('.docx');}catch{return false;}
}
export async function downloadDocxBuffer(sourceUrl,{signal=requestSignal(),expectedByteSize=null}={}) {
  let url=sourceUrl;
  for(let hop=0;hop<4;hop++) {
    signal?.throwIfAborted();
    if(!allowedDownload(url))throw new Error('Unapproved official document download URL.');
    // This published distribution route returns 500 to Node fetch but a normal
    // 302 to Node HTTPS/Python. Use standard HTTPS without browser impersonation.
    const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'*/*','User-Agent':userAgent('document text')},signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[])])},resolve).on('error',reject));
    const limited=upstreamResponseError(response,{source:'documents'});
    if(limited){response.resume();throw limited;}
    if([301,302,303,307,308].includes(response.statusCode)){const target=response.headers.location;response.resume();if(!target)throw new Error('Invalid document redirect.');url=new URL(target,url).href;continue;}
    if(response.statusCode!==200){response.resume();const hint=response.headers['retry-after'];throw Object.assign(new Error(`Official document download unavailable (${response.statusCode}).`),{status:response.statusCode,retryAfter:hint?retryAfterSeconds(hint):0});}
    if(!/(?:officedocument.wordprocessingml|octet-stream)/i.test(response.headers['content-type'] || '')){response.destroy();throw new Error('Unexpected document download format.');}
    const chunks=[];let size=0;
    for await(const chunk of response){size+=chunk.length;if(size>MAX_FILE){response.destroy();throw new Error('Official document exceeds 8 MiB.');}chunks.push(chunk);}
    if(Number.isSafeInteger(expectedByteSize)&&expectedByteSize>=0&&size!==expectedByteSize)throw new Error('Official document size does not match the selected edition.');
    return {buffer:Buffer.concat(chunks),resolvedSourceUrl:url};
  }
  throw new Error('Too many document download redirects.');
}
export async function downloadDocx(sourceUrl,options={}) {
  const {buffer,resolvedSourceUrl}=await downloadDocxBuffer(sourceUrl,options);
  return {...docxContent(buffer,{includeNoteObjects:true}),resolvedSourceUrl};
}

const validSpan=(span,text)=>Number.isInteger(span?.start)&&Number.isInteger(span.end)&&span.start>=0&&span.end>span.start&&span.end<=text.length&&typeof span.url==='string'&&/^https?:\/\//i.test(span.url);
export function documentNotes(record) {
  const paragraphs=record?.paragraphs||[];
  const valid=Array.isArray(record?.notes)&&Array.isArray(record.anchors)&&Array.isArray(record.links)
    &&record.notes.every(n=>typeof n?.id==='string'&&typeof n.label==='string'&&typeof n.text==='string'&&Array.isArray(n.links)&&Array.isArray(n.linkSpans)&&n.linkSpans.every(span=>validSpan(span,n.text)))
    &&record.anchors.every(a=>Number.isInteger(a?.paragraph)&&a.paragraph>=0&&a.paragraph<paragraphs.length&&Number.isInteger(a.offset)&&a.offset>=0&&a.offset<=paragraphs[a.paragraph].length&&record.notes.some(n=>n.id===a.note))
    &&record.links.every(link=>Number.isInteger(link?.paragraph)&&link.paragraph>=0&&link.paragraph<paragraphs.length&&validSpan(link,paragraphs[link.paragraph]));
  return valid?{notesStatus:'extracted',notes:record.notes,noteAnchors:record.anchors,documentLinks:record.links}:{notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[]};
}
export async function documentText(work,language,{directory=process.env.ODP_CACHE_DIR,download=downloadDocx,clock=Date.now,cacheOnly=false}={}) {
  requestSignal()?.throwIfAborted();
  const files=documentFiles(work).filter(f=>f.format==='DOCX' && allowedDownload(f.url));
  const languages=languagePreference(files.map(f=>f.language).filter(Boolean),language);
  const originals=array(work.originalLanguage).map(languageCode);
  const chosen=files.find(f=>f.language===languages[0]) || files[0];
  const adoptedTextXml=adoptedTextXmlSources(work,chosen?.language??language);
  const base={status:'unavailable',paragraphs:[],authorBylineParagraphs:[],extractionWarnings:[],notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[],
    structureStatus:'not-extracted',paragraphSources:[],documentObjects:[],formatStatus:'not-extracted',paragraphFormats:[],tables:[],extractionVersion:null,sourceVersion:null,
    textLanguage:chosen?.language || null,requestedLanguage:language,availableTextLanguages:languages,translationType:chosen?originals.includes(chosen.language)?'original':'unspecified':null,sourceFormat:chosen?'DOCX':null,sourceUrl:chosen?.url || null,fetchedAt:null,stale:false,refreshInProgress:false,refreshError:null,nextRetryAt:null,reason:null,extraction:chosen?'official-docx-paragraphs':null,
    ...(adoptedTextXml?{adoptedTextXml}:{})};
  if(!chosen)return {...base,reason:'No supported DOCX text file is supplied for this publication.'};
  const key=chosen.url,name=createHash('sha256').update(key).digest('hex')+'.json',file=directory && path.join(directory,'document-text-v1',name);
  const budget=directory?diskBudget(directory):null,descriptor=fileDescriptor(work,key);
  let saved=memory.get(key);
  if(saved)budget?.used(name);
  if(!saved && file)try{const record=JSON.parse(await readFile(file,'utf8'));requestSignal()?.throwIfAborted();if(record.schemaVersion===1 && record.extractionVersion===EXTRACTION_VERSION && record.sourceUrl===key && Number.isFinite(Date.parse(record.fetchedAt)) && Array.isArray(record.paragraphs) && record.paragraphs.every(p=>typeof p==='string')){saved=record;remember(key,record);budget.used(name);}}catch{}
  requestSignal()?.throwIfAborted();
  const refresh=priority=> {
    if(pending.has(key))return pending.get(key);
    const job=sharedRequest(signal=>boundedUpstream(async()=>{
      const result=await download(key,{signal});signal.throwIfAborted();const record={schemaVersion:1,extractionVersion:EXTRACTION_VERSION,sourceId:work.identifier || tail(work.id),sourceUrl:key,source:descriptor,fetchedAt:new Date(clock()).toISOString(),...result};
      const serialized=JSON.stringify(record);
      if(file&&await writeCacheFile(file,serialized,{signal}))void budget.saved(name,Buffer.byteLength(serialized));
      signal.throwIfAborted();
      remember(key,record);failures.delete(key);return record;
    },{source:'documents',priority,signal})).catch(error=>{if(!isLocalRequestFailure(error))failures.set(key,{source:descriptor,retryAt:clock()+30000,message:String(error.message).slice(0,250)});throw error;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
  // The URL can be reused for a republished edition. Its predecessor's failed
  // download must not suppress a newly declared issue time or size.
  const previousFailure=failures.get(key);
  const changedEdition=previousFailure&&['byteSize','issued'].some(field=>descriptor[field]!==null&&descriptor[field]!==previousFailure.source?.[field]);
  const failure=changedEdition?null:previousFailure;
  const present=async record=>({...base,status:'available',paragraphs:record.paragraphs,authorBylineParagraphs:record.authorBylineParagraphs || [],...documentNotes(record),...documentStructure(record),...documentFormatting(record),imageAssets:await publishDocumentImages(record,{directory}),sourceHash:record.sourceHash||null,
    extractionVersion:record.extractionVersion,sourceVersion:record.source||null,extractionWarnings:record.extractionWarnings || [],fetchedAt:record.fetchedAt});
  if(cacheOnly)return saved?present(saved):{...base,reason:'No saved document text is available.'};
  // Keep saved text readable while a background read adds formatting/byline metadata.
  if(saved){const stale=documentNeedsRefresh(saved,work,descriptor,clock()),bylineUpgrade=documentAuthorIdentities(work).length>1&&!Array.isArray(saved.authorBylineParagraphs),reformat=(saved.formattingVersion!==FORMATTING_VERSION||bylineUpgrade)&&!reformatted.has(key);
    if((stale||reformat) && (!failure || failure.retryAt<=clock())){
      if(reformat){if(reformatted.size>=5000)reformatted.clear();reformatted.add(key);}
      void refresh('background').catch(()=>{if(reformat)reformatted.delete(key);});
    }return {...await present(saved),stale,refreshInProgress:pending.has(key),refreshError:failure?.message || null};}
  if(failure?.retryAt>clock())return {...base,status:'error',reason:failure.message,refreshError:failure.message,nextRetryAt:new Date(failure.retryAt).toISOString()};
  try {const record=await waitForRequest(refresh('interactive'));return present(record);}
  catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;return {...base,status:'error',reason:String(error.message).slice(0,250),refreshError:String(error.message).slice(0,250),nextRetryAt:new Date(error.retryAt||failures.get(key)?.retryAt||clock()+(error.retryAfter||30)*1000).toISOString()};}
}
