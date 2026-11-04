import {parseTargetLabel} from './proposal-labels.mjs';
import {alternativeMotionHeading} from './amendment-alternative.mjs';
import {committeeListId,committeeDraftId} from './committee-amendments.mjs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { docxParts } from './document-text.mjs';
import { comparisonHeading,isAmendmentHeading,baselineDescriptor,amendmentTargetPath } from './amendment-baseline.mjs';
import { numberingLabels } from './docx-numbering.mjs';
import { styleFormatting } from './docx-formatting.mjs';

export const AMENDMENT_EXTRACTION_VERSION='25';

const TEXT_LOSS_CODES=new Set(['comparison-header','comparison-columns','comparison-grid','comparison-structure','inline-content-loss','nested-table','non-text-content','structural-revision','symbol-text-loss','vertical-formatting-loss','text-unavailable','numbering-warning']);
const alternateBranch=key=>/(?:^|:)(?:AlternateContent|Choice|Fallback)$/.test(key);
const nonTextContent=key=>/(?:^|:)(?:oMath|oMathPara)$/.test(key)||['w:drawing','w:pict','w:object','w:altChunk','w:contentPart','w:subDoc'].includes(key);
const CONTENT_LOSSES={
  'inline-content-loss':'Visible ruby or unsupported inline annotation/content cannot be represented reliably as plain wording; its wording is withheld.',
  'non-text-content':'Visible mathematical, drawing or embedded content cannot be represented reliably as plain wording; its wording is withheld.',
  'structural-revision':'Current paragraph-mark revisions make text boundaries ambiguous; revision acceptance is unresolved and its wording is withheld.',
  'vertical-formatting-loss':'Vertical formatting cannot be tied to exact wording offsets; its wording is withheld.',
};
const TABLE_MARKERS=new Set(['w:bookmarkStart','w:bookmarkEnd','w:commentRangeStart','w:commentRangeEnd','w:permStart','w:permEnd','w:proofErr','w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd']);
const INLINE_CONTAINERS=new Set(['w:hyperlink','w:ins','w:moveTo','w:smartTag','w:customXml','w:sdt','w:sdtContent','w:fldSimple']);
const INLINE_IGNORED=new Set([':@','w:pPr','w:rPr','w:del','w:moveFrom','w:delText','w:instrText','w:smartTagPr','w:customXmlPr','w:sdtPr','w:sdtEndPr','w:lastRenderedPageBreak','w:commentReference','w:annotationRef','w:footnoteReference','w:endnoteReference','w:footnoteRef','w:endnoteRef','w:separator','w:continuationSeparator',...TABLE_MARKERS]);
function unsupportedChildren(nodes,allowed) {
  return (nodes||[]).some(node=>Object.entries(node).some(([key,value])=>key!==':@'&&!TABLE_MARKERS.has(key)&&!allowed.has(key)&&(key!=='#text'||String(value).trim())));
}
const TABLE_CHILDREN=new Set(['w:tblPr','w:tblGrid','w:tr']);
const ROW_CHILDREN=new Set(['w:tblPrEx','w:trPr','w:tc']);
const CELL_CHILDREN=new Set(['w:tcPr','w:p','w:tbl']);
const STRUCTURAL_REVISIONS=new Set(['w:ins','w:del','w:cellIns','w:cellDel','w:cellMerge','w:moveFrom','w:moveTo']);
const STRUCTURAL_MOVES=new Set(['w:moveFromRangeStart','w:moveFromRangeEnd','w:moveToRangeStart','w:moveToRangeEnd']);
const PROPERTY_SNAPSHOTS=new Set(['w:tblPrChange','w:tblPrExChange','w:tblGridChange','w:trPrChange','w:tcPrChange','w:pPrChange','w:rPrChange']);
function structuralRevision(nodes) {
  for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
    if(PROPERTY_SNAPSHOTS.has(key))continue;
    if(STRUCTURAL_REVISIONS.has(key)||STRUCTURAL_MOVES.has(key))return true;
    if(key!==':@'&&Array.isArray(value)&&structuralRevision(value))return true;
  }
  return false;
}
const structuralMove=nodes=>(nodes||[]).some(node=>Object.keys(node).some(key=>STRUCTURAL_MOVES.has(key)));

const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');
const parser=()=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const clean=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
// Apply the existing text cleanup and carry UTF-16 boundaries through each edit.
function rewriteWording(value,expression,replacement) {
  const offsets=new Array(value.text.length+1);let text='',cursor=0;
  for(const match of value.text.matchAll(expression)) {
    for(let i=cursor;i<=match.index;i++)offsets[i]=text.length+i-cursor;
    text+=value.text.slice(cursor,match.index);
    const start=text.length;text+=replacement;
    offsets[match.index]=start;
    for(let i=match.index+1;i<=match.index+match[0].length;i++)offsets[i]=text.length;
    cursor=match.index+match[0].length;
  }
  for(let i=cursor;i<=value.text.length;i++)offsets[i]=text.length+i-cursor;
  text+=value.text.slice(cursor);
  return {text,formatting:value.formatting.map(mark=>({...mark,start:offsets[mark.start],end:offsets[mark.end]})).filter(mark=>mark.end>mark.start)};
}
function trimWording(value) {return rewriteWording(value,/^\s+|\s+$/gu,'');}
function cleanWording(text,formatting) {
  return trimWording(rewriteWording(rewriteWording({text,formatting},/\r\n?/g,'\n'),/[ \t]+(?=\n)/g,''));
}
function joinWording(parts,separator='\n') {
  let text='';const formatting=[];
  for(const [index,part] of parts.entries()) {
    if(index)text+=separator;const offset=text.length;
    formatting.push(...part.formatting.map(mark=>({...mark,start:mark.start+offset,end:mark.end+offset})));text+=part.text;
  }
  return {text,formatting};
}
function canonicalFormatting(formatting) {
  const marks=[];
  for(const mark of formatting) {
    const previous=marks.at(-1);
    if(previous?.kind===mark.kind&&previous.end===mark.start)previous.end=mark.end;
    else marks.push({...mark});
  }
  return marks;
}
const enabled=node=>node?!['0','false','off'].includes(String(attribute(node,'val')).toLowerCase()):undefined;

// A compound heading is two printed lines in one native paragraph. Literal
// newlines, fields, wrappers and invisible metadata do not establish that form.
function compoundHeader(nodes,raw,text,styleSafe,blank=false) {
  const lines=text.split('\n').map(line=>line.trim());
  if(raw!==text)return null;
  if(blank?text.trim():lines.length!==2||!/^Proposal for a (?:regulation|directive|decision)$/u.test(lines[0])||!parseTargetLabel(lines[1],'en').complete)return null;
  if(!styleSafe(nodes))return null;
  let breaks=0;
  const properties=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||key==='w:rPr'&&properties(value)||['w:pStyle','w:rStyle','w:keepNext','w:keepLines','w:widowControl','w:spacing','w:ind','w:jc','w:b','w:bCs','w:i','w:iCs','w:lang','w:rFonts','w:sz','w:szCs','w:color','w:u','w:highlight'].includes(key)&&Array.isArray(value)&&!value.length));
  const supported=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>{
    if(key===':@')return true;
    if(['w:pPr','w:rPr'].includes(key))return properties(value);
    if(key==='w:r')return supported(value);
    if(key==='w:t')return value.every(part=>Object.keys(part).length===1&&typeof part['#text']==='string'&&!/[\r\n]/u.test(part['#text']));
    if(['w:br','w:cr'].includes(key)){breaks++;return !value.length&&[undefined,'textWrapping'].includes(node[':@']?.['@_w:type']);}
    return false;
  }));
  return supported(nodes)&&breaks===(blank?0:1)?blank?true:lines:null;
}
function compoundStyleSafety(xml) {
  const root=children(xml?parser().parse(xml):[],'w:styles')||[],styles=new Map(),defaults=[];
  let valid=true;
  for(const node of direct(root,'w:style')){const id=attribute(node,'styleId');if(styles.has(id))valid=false;styles.set(id,node['w:style']);if(['paragraph','character'].includes(attribute(node,'type'))&&enabled({':@':{'@_w:val':attribute(node,'default')}})===true&&attribute(node,'default')!==undefined)defaults.push(id);}
  const all=(nodes,key)=>(nodes||[]).flatMap(node=>Object.entries(node).flatMap(([name,value])=>name===key?[node]:Array.isArray(value)?all(value,key):[]));
  const hidden=nodes=>['w:vanish','w:webHidden'].some(key=>all(nodes,key).some(node=>enabled(node)===true));
  const visible=(id,seen=new Set())=>{if(!id)return true;if(seen.has(id)||!styles.has(id))return false;seen.add(id);const nodes=styles.get(id);return !hidden(nodes)&&all(nodes,'w:basedOn').every(node=>visible(attribute(node,'val'),seen));};
  return nodes=>valid&&!hidden(children(root,'w:docDefaults'))&&[...defaults,...all(nodes,'w:pStyle').map(node=>attribute(node,'val')),...all(nodes,'w:rStyle').map(node=>attribute(node,'val'))].every(id=>visible(id));
}

const direct=(nodes,key)=>(nodes||[]).filter(node=>Object.hasOwn(node,key));
const emptyGeometry=nodes=>!(nodes||[]).some(node=>Object.entries(node).some(([key,value])=>key!==':@'&&(key!=='#text'||String(value).trim())));
function geometryNumber(nodes,key,fallback) {
  const matches=direct(nodes,key);
  if(!matches.length)return fallback;
  if(matches.length!==1||!emptyGeometry(matches[0][key]))return null;
  const value=attribute(matches[0],'val');
  return typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
}
function declaredGridSupported(nodes,columnCount=2) {
  const grids=direct(nodes,'w:tblGrid');
  if(grids.length>1)return false;
  if(!grids.length)return true;
  const grid=grids[0]['w:tblGrid'],columns=direct(grid,'w:gridCol');
  if(unsupportedChildren(grid,new Set(['w:gridCol','w:tblGridChange'])))return false;
  // An absent/empty declaration does not establish a third column. Historical
  // tblGridChange snapshots do not describe the current comparison layout.
  if(columns.length&&columns.length!==columnCount)return false;
  return columns.every(column=>{
    const width=attribute(column,'w');
    return emptyGeometry(column['w:gridCol'])&&(width==null||typeof width==='string'&&/^\d+$/.test(width)&&Number.isSafeInteger(Number(width)));
  });
}
function currentCellGrid(nodes) {
  const properties=direct(nodes,'w:tcPr'),current=properties[0]?.['w:tcPr'];
  return {span:geometryNumber(current,'w:gridSpan',1),supported:properties.length<=1&&!direct(current,'w:hMerge').length&&!direct(current,'w:vMerge').length};
}
function currentRowGridSupported(nodes,cells,{stacked=false,columnCount=2}={}) {
  const properties=direct(nodes,'w:trPr'),current=properties[0]?.['w:trPr'];
  if(properties.length>1||geometryNumber(current,'w:gridBefore',0)!==0||geometryNumber(current,'w:gridAfter',0)!==0)return false;
  if(cells.some(cell=>!cell.grid.supported))return false;
  if(stacked)return cells.length>0&&cells.every(cell=>cell.grid.span>0)&&cells.reduce((sum,cell)=>sum+cell.grid.span,0)===columnCount;
  if(cells.length===2)return cells.every(cell=>cell.grid.span===1);
  // Public amendment DOCX files use this completely blank, two-column-spanning
  // separator. It carries no legal wording and does not shift either column.
  return cells.length===1&&cells[0].grid.span===2&&!cells[0].text&&!cells[0].raw.trim()&&!cells[0].nested&&!cells[0].hasNotes&&!cells[0].losses.length;
}

// Translation-template tags are literal text in hidden runs. Read those for
// metadata, but apply Word visibility when extracting the comparison columns.
function visibility(xml) {
  const styles=children(xml?parser().parse(xml):[],'w:styles')||[];
  const byId=new Map(styles.filter(n=>n['w:style']).map(n=>{const props=children(n['w:style'],'w:rPr');return [attribute(n,'styleId'),{parent:property(n['w:style'],'w:basedOn'),toggle:enabled(child(props,'w:vanish'))===true,vertical:property(props,'w:vertAlign'),position:property(props,'w:position')}];}));
  const defaultProps=children(children(children(styles,'w:docDefaults'),'w:rPrDefault'),'w:rPr');
  const defaults=enabled(child(defaultProps,'w:vanish'))??false;
  const defaultId=type=>attribute(styles.find(n=>n['w:style']&&attribute(n,'type')===type&&['1','true','on'].includes(String(attribute(n,'default')))),'styleId');
  const cache=new Map();
  const hidden=(id,inherited)=>{
    const chain=[],seen=new Set();
    while(byId.has(id)&&!cache.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    let toggle=cache.get(id)??false;
    for(const key of chain.reverse()){toggle=toggle!==byId.get(key).toggle;cache.set(key,toggle);}
    return inherited!==toggle;
  };
  const propertyCaches=new Map();
  const inheritedProperty=(id,key,inherited)=>{
    if(!propertyCaches.has(key))propertyCaches.set(key,new Map());
    const cache=propertyCaches.get(key),chain=[],seen=new Set();
    while(byId.has(id)&&!cache.has(id)) {
      if(seen.has(id))throw new Error('Cyclic DOCX style inheritance is unsupported.');
      seen.add(id);chain.push(id);id=byId.get(id).parent;
    }
    let value=cache.get(id);
    for(const styleId of chain.reverse()){value=byId.get(styleId)[key]??value;cache.set(styleId,value);}
    return value??inherited;
  };
  return {defaults,hidden,inheritedProperty,defaultVertical:property(defaultProps,'w:vertAlign')??'baseline',defaultPosition:property(defaultProps,'w:position')??'0',paragraph:defaultId('paragraph'),character:defaultId('character')};
}
function inline(nodes,style,hidden,raw=false,losses=new Set(),format={vertical:'baseline',position:'0'},formatting=[]) {
  let out='';
  for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
    if(key==='w:r') {
      const props=children(value,'w:rPr');
      const omit=enabled(child(props,'w:vanish'))??style.hidden(property(props,'w:rStyle')||style.character,hidden);
      if(raw||!omit) {
        const id=property(props,'w:rStyle')||style.character;
        const vertical=property(props,'w:vertAlign')??style.inheritedProperty(id,'vertical',format.vertical);
        const position=property(props,'w:position')??style.inheritedProperty(id,'position',format.position);
        const marks=[],text=inline(value,style,false,raw,losses,{...format,vertical,position},marks),start=out.length;
        if(!raw&&text.length) {
          if(style.formatting?.run(format.paragraphStyle,props).bold)marks.push({start:0,end:text.length,kind:'bold'});
          const shifted=Number(position),valid=['baseline','superscript','subscript'].includes(vertical)&&Number.isFinite(shifted);
          if(!valid)losses.add('vertical-formatting-loss');
          else {
            // An explicit vertical alignment takes precedence over a baseline shift.
            const kind=vertical!=='baseline'?vertical:shifted>0?'superscript':shifted<0?'subscript':null;
            if(kind)marks.push({start:0,end:text.length,kind});
          }
        }
        formatting.push(...marks.map(mark=>({...mark,start:start+mark.start,end:start+mark.end})));out+=text;
      }
    } else if(alternateBranch(key)) {
      if(!raw)losses.add('comparison-structure');
      // Choice and fallback are mutually exclusive; the extractor does not
      // implement the compatibility feature negotiation needed to select one.
    } else if(key==='w:sym') {
      // A legacy font character (e.g. Symbol/F061) is not a Unicode code point.
      // Omitting it would change the legal text; no font mapping is guessed.
      if(!raw)losses.add('symbol-text-loss');
    } else if(nonTextContent(key)) {
      if(!raw)losses.add('non-text-content');
    } else if(key==='w:t') {
      for(const part of value||[])for(const [tag,text] of Object.entries(part)) {
        if(tag==='#text')out+=String(text);
        else if(tag!==':@'&&!raw)losses.add('inline-content-loss');
      }
    }
    else if(key==='w:tab'||key==='w:ptab')out+='\t';
    else if(key==='w:br'||key==='w:cr')out+='\n';
    else if(key==='w:noBreakHyphen')out+='‑';
    else if(key==='w:softHyphen')out+='­';
    else if(INLINE_CONTAINERS.has(key)&&Array.isArray(value)) {
      const marks=[],text=inline(value,style,hidden,raw,losses,format,marks),start=out.length;
      formatting.push(...marks.map(mark=>({...mark,start:start+mark.start,end:start+mark.end})));out+=text;
    }
    // Cached field-result runs remain visible; empty field delimiters and
    // source properties are not text. Opaque field/form content is not guessed.
    else if(key==='w:fldChar'){if(value?.length&&!raw)losses.add('inline-content-loss');}
    else if(!INLINE_IGNORED.has(key)&&(key!=='#text'||String(value).trim())&&!raw)losses.add('inline-content-loss');
  }
  return out;
}
function documentBlocks(parts,warnings,language) {
  const style=visibility(parts.get('word/styles.xml'));
  const documentXml=parts.get('word/document.xml'),documentTree=parser().parse(documentXml),stylesXml=parts.get('word/styles.xml');
  const nativeBindings=nodes=>nodes.every(node=>(node[':@']?.['@_xmlns:w']===undefined||node[':@']['@_xmlns:w']==='http://schemas.openxmlformats.org/wordprocessingml/2006/main')&&Object.values(node).every(value=>!Array.isArray(value)||nativeBindings(value)));
  const nativeHeader=language==='en'&&!/<!DOCTYPE|<!ENTITY/u.test(documentXml)&&XMLValidator.validate(documentXml)===true&&child(documentTree,'w:document')?.[':@']?.['@_xmlns:w']==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'&&nativeBindings(documentTree)&&(!stylesXml||!/<!DOCTYPE|<!ENTITY/u.test(stylesXml)&&XMLValidator.validate(stylesXml)===true&&nativeBindings(parser().parse(stylesXml)));
  const compoundVisible=nativeHeader?compoundStyleSafety(stylesXml):null;
  const mathURI='http://schemas.openxmlformats.org/officeDocument/2006/math';
  const mathBindings=nodes=>nodes.every(node=>Object.entries(node[':@']||{}).every(([key,value])=>key==='@_xmlns:m'?value===mathURI:!key.startsWith('@_xmlns')||value!==mathURI)&&Object.values(node).every(value=>!Array.isArray(value)||mathBindings(value)));
  const formulaNative=Boolean(nativeHeader&&child(documentTree,'w:document')?.[':@']?.['@_xmlns:m']===mathURI&&mathBindings(documentTree));
  const formulaParagraph=nodes=>{
    let count=0;
    const math=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>key===':@'||key==='#text'&&typeof value==='string'||Array.isArray(value)&&(key.startsWith('m:')?math(value):key==='w:rPr'?math(value):['w:rFonts','w:b','w:bCs','w:i','w:iCs','w:sz','w:szCs','w:lang','w:color'].includes(key)&&!value.length)));
    const plain=nodes=>nodes.every(node=>Object.entries(node).every(([key,value])=>{
      if(key===':@')return true;
      if(key==='m:oMathPara'||key==='m:oMath'){
        const total=key==='m:oMath'?1:(JSON.stringify(value).match(/"m:oMath":/gu)||[]).length;
        count++;return total===1&&math(value);
      }
      if(['w:pPr','w:rPr'].includes(key))return !/"w:(?:numPr|vanish|webHidden|ins|del|moveFrom|moveTo|rPrChange|pPrChange)"/u.test(JSON.stringify(value));
      if(key==='w:r'||key==='w:hyperlink')return plain(value);
      if(key==='w:t')return value.every(part=>Object.keys(part).length===1&&typeof part['#text']==='string');
      if(['w:br','w:cr'].includes(key))return !value.length&&[undefined,'textWrapping'].includes(node[':@']?.['@_w:type']);
      return ['w:tab','w:noBreakHyphen','w:softHyphen','w:lastRenderedPageBreak','w:bookmarkStart','w:bookmarkEnd','w:proofErr'].includes(key)&&!value.length;
    }));
    return {formulaCount:count,formulaSafe:false,...(formulaNative&&compoundVisible(nodes)&&plain(nodes)?{formulaCount:count,formulaSafe:true}:{})};
  };
  const annexPlain=(nodes,mode='paragraph')=>{
    const properties={paragraph:['w:pStyle','w:keepNext','w:keepLines','w:widowControl','w:spacing','w:ind','w:jc'],run:['w:spacing','w:rStyle','w:noProof','w:b','w:bCs','w:i','w:iCs','w:lang','w:rFonts','w:sz','w:szCs','w:color','w:u','w:highlight','w:shd','w:kern','w14:ligatures']};
    const seen=new Set();
    return nodes.every(node=>Object.entries(node).every(([key,value])=>{
      if(key===':@')return true;
      if(['paragraph-properties','run-properties'].includes(mode)||['w:pPr','w:rPr'].includes(key)){if(seen.has(key))return false;seen.add(key);}
      if(key==='w:pPr')return mode==='paragraph'&&annexPlain(value,'paragraph-properties');
      if(key==='w:rPr')return ['run','paragraph-properties'].includes(mode)&&annexPlain(value,'run-properties');
      if(key==='w:r')return mode==='paragraph'&&annexPlain(value,'run');
      if(key==='w:hyperlink')return mode==='paragraph'&&annexPlain(value,'paragraph');
      if(key==='w:t')return mode==='run'&&value.every(part=>Object.keys(part).length===1&&typeof part['#text']==='string');
      const allowed=mode==='paragraph-properties'?properties.paragraph:mode==='run-properties'?properties.run:mode==='paragraph'?['w:bookmarkStart','w:bookmarkEnd','w:proofErr']:['w:lastRenderedPageBreak','w:tab','w:br','w:cr','w:noBreakHyphen','w:softHyphen'];
      return allowed.includes(key)&&Array.isArray(value)&&!value.length;
    }));
  };
  const w14='http://schemas.microsoft.com/office/word/2010/wordml',annexBindings=nodes=>nodes.every(node=>(node[':@']?.['@_xmlns:w14']===undefined||node[':@']['@_xmlns:w14']===w14)&&Object.values(node).every(value=>!Array.isArray(value)||annexBindings(value)));
  const annexNative=Boolean(nativeHeader&&annexBindings(documentTree)&&(!documentXml.includes('w14:ligatures')||child(documentTree,'w:document')?.[':@']?.['@_xmlns:w14']===w14));
  if(language==='hr')style.formatting=styleFormatting(children(parser().parse(parts.get('word/styles.xml')||''),'w:styles'));
  const label=numberingLabels(parts.get('word/numbering.xml'),parts.get('word/styles.xml'),warnings);
  let count=0,size=0;
  const paragraph=nodes=>{
    const props=children(nodes,'w:pPr'),hidden=style.hidden(property(props,'w:pStyle')||style.paragraph,style.defaults);
    const id=property(props,'w:pStyle')||style.paragraph;
    const format={paragraphStyle:id,vertical:style.inheritedProperty(id,'vertical',style.defaultVertical),position:style.inheritedProperty(id,'position',style.defaultPosition)};
    const raw=clean(inline(nodes,style,hidden,true,new Set(),format));
    const losses=new Set();
    if(structuralRevision(props))losses.add('structural-revision');
    const marks=[],wording=cleanWording(inline(nodes,style,hidden,false,losses,format,marks),marks);
    let {text,formatting}=wording;
    const boldMarks=formatting.filter(mark=>mark.kind==='bold');
    const visibleLength=value=>value.replace(/\s/gu,'').length;
    const bold=Boolean(text.trim())&&boldMarks.reduce((length,mark)=>length+visibleLength(text.slice(mark.start,mark.end)),0)===visibleLength(text);
    formatting=formatting.filter(mark=>mark.kind!=='bold');
    const prefix=label(props);if(prefix&&text){const offset=prefix.length+1;text=prefix+'\t'+text;formatting=formatting.map(mark=>({...mark,start:mark.start+offset,end:mark.end+offset}));}
    size+=raw.length+text.length;
    if(++count>20000||size>4*1024*1024)throw new Error('Amendment document text exceeds the supported size.');
    const structure=JSON.stringify(nodes);
    const captionSafe=Boolean(compoundVisible?.(nodes)&&raw===text&&!/"w:(?:del|moveFrom|numPr|footnoteReference|endnoteReference|fldSimple|instrText)"/u.test(structure));
    return {raw,text,formatting,bold,captionSafe,annexSafe:Boolean(annexNative&&compoundVisible(nodes)&&annexPlain(nodes)&&raw===text&&!losses.size),...formulaParagraph(nodes),...(compoundVisible?{compound:compoundHeader(nodes,raw,text,compoundVisible),compoundBlank:compoundHeader(nodes,raw,text,compoundVisible,true)===true}:{}),paragraphStyle:id||null,hasNotes:/"w:(?:footnote|endnote)Reference"/.test(structure),losses:[...losses],symbolLoss:losses.has('symbol-text-loss'),unsupportedBody:losses.has('comparison-structure')};
  };
  const blocks=[];
  const summary=content=>({
    ...joinWording(content.filter(part=>part.text)),raw:content.map(part=>part.raw).join('\n'),
    formulaCount:content.reduce((count,part)=>count+(part.formulaCount||0),0),formulaSafe:content.every(part=>part.kind==='paragraph'&&part.formulaSafe),
    annexSafe:content.every(part=>part.kind==='paragraph'&&part.annexSafe),
    hasNotes:content.some(part=>part.hasNotes),losses:[...new Set(content.flatMap(part=>part.losses))],
    symbolLoss:content.some(part=>part.symbolLoss),unsupportedBody:content.some(part=>part.unsupportedBody),captionSafe:content.every(part=>part.kind==='paragraph'&&part.captionSafe),
  });
  const tableOf=nodes=>{
    let unsupported=unsupportedChildren(nodes,TABLE_CHILDREN),revised=structuralRevision(children(nodes,'w:tblPr'))||structuralMove(nodes);
    const gridColumns=direct(children(nodes,'w:tblGrid'),'w:gridCol').length||2;
    const rows=direct(nodes,'w:tr').map(row=>{
      const rowNodes=row['w:tr'];
      unsupported ||= unsupportedChildren(rowNodes,ROW_CHILDREN);
      revised ||= structuralRevision(children(rowNodes,'w:trPr'))||structuralRevision(children(rowNodes,'w:tblPrEx'))||structuralMove(rowNodes);
      const cells=direct(rowNodes,'w:tc').map(cell=>{
        const cellNodes=cell['w:tc'],content=[];
        unsupported ||= unsupportedChildren(cellNodes,CELL_CHILDREN);
        revised ||= structuralRevision(children(cellNodes,'w:tcPr'))||structuralMove(cellNodes);
        for(const node of cellNodes) {
          if(node['w:p'])content.push({kind:'paragraph',...paragraph(node['w:p'])});
          else if(node['w:tbl'])content.push(tableOf(node['w:tbl']));
        }
        const value=summary(content);
        unsupported ||= value.unsupportedBody;
        return {...value,content,grid:currentCellGrid(cellNodes),nested:content.some(part=>part.nestedUnsupported),revised:content.some(part=>part.revised)};
      });
      cells.gridNodes=rowNodes;
      revised ||= cells.some(cell=>cell.revised);
      return cells;
    });
    const legalGridSupported=gridColumns>0&&declaredGridSupported(nodes,gridColumns)&&rows.every(cells=>currentRowGridSupported(cells.gridNodes,cells,{stacked:true,columnCount:gridColumns}));
    const value=summary(rows.map(cells=>({...joinWording(cells,'\t'),raw:cells.map(cell=>cell.raw).join('\t'),hasNotes:cells.some(cell=>cell.hasNotes),losses:cells.flatMap(cell=>cell.losses),symbolLoss:cells.some(cell=>cell.symbolLoss),unsupportedBody:cells.some(cell=>cell.unsupportedBody)})));
    return {kind:'table',...value,rows,unsupported,revised,gridColumns,gridNodes:nodes,legalGridSupported,
      gridUnsupported:!declaredGridSupported(nodes)||rows.some(cells=>!currentRowGridSupported(cells.gridNodes,cells)),
      nestedUnsupported:unsupported||revised||!legalGridSupported||rows.some(cells=>cells.some(cell=>cell.nested))};
  };
  const walk=nodes=>{
    for(const node of nodes||[])for(const [key,value] of Object.entries(node)) {
      if(['w:del','w:moveFrom','w:instrText','w:rPr','w:pPr'].includes(key))continue;
      if(alternateBranch(key))blocks.push({kind:'unsupported',code:'comparison-structure',message:'Alternative document branches cannot be selected reliably; their content and any amendment identities inside them are unavailable.'});
      else if(nonTextContent(key))blocks.push({kind:'unsupported',code:'non-text-content',message:CONTENT_LOSSES['non-text-content']});
      else if(key==='w:p')blocks.push({kind:'paragraph',...paragraph(value)});
      else if(key==='w:tbl')blocks.push(tableOf(value));
      else if(key!==':@'&&Array.isArray(value))walk(value);
    }
  };
  walk(documentTree);
  return blocks;
}
const field=(raw,tag)=>[...raw.matchAll(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','g'))].map(m=>clean(m[1]));
const metadata=value=>clean(value).replace(/^\{[^{}]*\}/,'').trim();
// Published committee-list class lines are metadata, not legal addresses.
const DOCUMENT_CLASSES={en:['Proposal for a regulation','Proposal for a directive','Proposal for a decision'],fr:'Proposition de règlement',hu:'Rendeletre irányuló javaslat',ro:'Propunere de regulament'};
const classKey=value=>clean(value).normalize('NFC').replace(/\s+/gu,' ').toLowerCase();
const documentClass=(text,language)=>[DOCUMENT_CLASSES[language]??[]].flat().some(value=>classKey(text)===classKey(value));
function documentDate(raw) {
  const dates=new Set();
  for(const source of field(raw,'Date'))for(const match of source.matchAll(/(?:\{)?(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\})?/g)) {
    const [,day,month,year]=match,date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;
    dates.add(date);
  }
  return dates.size===1?[...dates][0]:null;
}
const numberIn=(raw,paragraphStyle,language)=>{
  const match=raw.match(/<NumAm>\s*([1-9]\d*)(?:\/rev)?\s*<\/NumAm>/)||raw.match(/^\s*Amendment\s*([1-9]\d*)\b/iu)||(/^AmNumberTabs\d*$/i.test(paragraphStyle||'')&&raw.match(/^[^\d<>]+?\s*([1-9]\d*)\s*$/u));
  const localized=language==='hr'&&raw.match(/^\s*Amandman\s*([1-9]\d*)\s*$/iu);
  const number=Number((match||localized)?.[1]);return Number.isSafeInteger(number)?number:null;
};
const legacyHeading=text=>/^(?:Amendment|Amendement|Änderungsantrag|Ændringsforslag|Módosítás|Enmienda|Emendamento|Alteração|Amendament|Poprawka|Wijziging|Τροπολογία|Pozmeňujúci návrh|Pozměňovací návrh)$/iu.test(text);
const groupNumber=(group,language)=>group?.filter(b=>b.kind==='paragraph').map(b=>numberIn(b.raw,b.paragraphStyle,language)).find(Boolean)||null;

// Annex comparisons publish two vertical sections, sometimes in separate
// tables. Only a full-width, exact heading establishes the side; the cells
// below it are columns of that legal table, not original/proposed columns.
function sectionHeading(cells,table,language) {
  if(cells.length!==1||cells[0].grid.span!==table.gridColumns||cells[0].nested)return null;
  const text=cells[0].text,heading=comparisonHeading(text,language);
  if(isAmendmentHeading(text,language))return {side:'proposed',heading};
  return !['unknown','other'].includes(heading.category)?{side:'original',heading}:null;
}
// A full-width layout cell cannot switch wording sides by horizontal position.
// Keep its paragraphs and nested rows in order, with each inner table's own
// grid. Paired comparison cells instead retain the whole nested table on their
// already established side.
function sectionRows(table) {
  return table.rows.flatMap(cells=>cells.length===1&&cells[0].grid.span===table.gridColumns&&!cells[0].nested?
    cells[0].content.flatMap(part=>part.kind==='table'?sectionRows(part):[{table,cells:[{...part,grid:cells[0].grid,nested:false}]}]):[{table,cells}]);
}

/** Extract individual amendments without flattening the original/proposed columns. */
export function extractAmendments(buffer,{listId,targetDocumentId,language=null,sourceUrl=null,fetchedAt=null,reportId=null,scope='plenary',sourceKind=null}={}) {
  if(scope==='committee'&&!(sourceKind==='amendment-list'&&committeeListId(listId)||['draft-report','draft-opinion'].includes(sourceKind)&&committeeDraftId(listId)))throw new Error('Invalid typed committee amendment source.');
  const warnings=new Set();let blocks=documentBlocks(docxParts(buffer),warnings,language);const groups=[],gaps=[];
  const gap=(code,number,message,details={})=>gaps.push({code,...(number==null?{}:{number}),message,sourceUrl,...details});
  if(reportId) {
    const range=String(listId||'').match(/^(A-(?:9|10)-\d{4}-\d{4,6})-AM-(\d+)-(\d+)$/);
    const start=blocks.findIndex(block=>block.kind==='paragraph'&&/<RepeatBlock-Amend>/.test(block.raw));
    const end=blocks.findIndex((block,index)=>index>=start&&block.kind==='paragraph'&&/<\/RepeatBlock-Amend>/.test(block.raw));
    const cover=blocks.slice(0,start).filter(block=>block.kind==='paragraph').map(block=>block.raw).join('\n');
    const coverIds=field(cover,'NoDocSe').map(value=>value.replace(/\u2011/gu,'-').match(/^A(\d+)-(\d+)\/(\d{4})$/)).filter(Boolean).map(([,term,number,year])=>'A-'+term+'-'+year+'-'+number.padStart(4,'0'));
    const main=blocks.slice(start,end+1),numbers=main.filter(block=>block.kind==='paragraph').flatMap(block=>[...block.raw.matchAll(/<NumAm>\s*([1-9]\d*)(?:\/rev)?\s*<\/NumAm>/g)].map(match=>Number(match[1])));
    if(reportId!==targetDocumentId||range?.[1]!==reportId||coverIds.length!==1||coverIds[0]!==reportId||start<0||end<start||numbers.length!==Number(range[3])-Number(range[2])+1||numbers.some((number,index)=>number!==Number(range[2])+index)) {
      gap('report-amendment-identity',null,'The report cover and main amendment block do not establish the exact published list range.');return {amendments:[],gaps,reportId};
    }
    // Opinion sections can repeat amendment numbers. Only the report's first
    // complete template block supplies the published main-list identity.
    blocks=blocks.slice(0,end+1);
  }
  let active=null,tagged=false;const cover=[];
  const finish=()=>{if(active?.length)groups.push(active);active=null;tagged=false;};
  for(const block of blocks) {
    if(block.kind==='paragraph') {
      const explicit=/<Amend>/.test(block.raw),number=numberIn(block.raw,block.paragraphStyle,language);
      const existing=groupNumber(active,language);
      if(explicit||(!tagged&&number&&existing&&number!==existing))finish();
      if(explicit||(!active&&number)){active=[];tagged=explicit;}
      if(active)active.push(block);
      else {
        if(!groups.length)cover.push(block);
        for(const code of block.losses||[])if(CONTENT_LOSSES[code])gap(code,null,CONTENT_LOSSES[code],{scope:'document'});
      }
      if(/<\/Amend>/.test(block.raw))finish();
    } else if(active)active.push(block);
    else if(block.kind==='unsupported')gap(block.code,null,block.message,{scope:'document'});
  }
  finish();
  const coverRaw=cover.map(b=>b.raw).join('\n');
  // This separately published committee-list format identifies the proposer
  // institution on its cover; Chairman/Rapporteur names are never authors.
  const committee=field(coverRaw,'Committee').map(metadata).filter(Boolean).join('; ')||null;
  const coverDate=documentDate(coverRaw);
  const publishedRanges=scope==='committee'?field(coverRaw,'RangeAM').map(value=>metadata(value).match(/^([1-9]\d*)\s*[-–—]\s*([1-9]\d*)$/)).filter(Boolean):[];
  const committeeRange=publishedRanges.length===1&&Number(publishedRanges[0][1])<=Number(publishedRanges[0][2])?publishedRanges[0]:null;
  if(scope==='committee'&&sourceKind==='amendment-list'&&!committeeRange)gap('list-range-unavailable',null,'The published amendment-list range is unavailable or conflicting.');
  const byNumber=new Map();
  for(const group of groups) {
    const raw=group.filter(b=>b.kind==='paragraph').map(b=>b.raw).join('\n');
    const number=groupNumber(group,language);
    if(!number){gap('number-unavailable',null,'An amendment block has no supported individual amendment number.');continue;}
    const numbers=new Set([...raw.matchAll(/<NumAm>\s*([1-9]\d*)(?:\/rev)?\s*<\/NumAm>/g)].map(match=>Number(match[1])));
    if(numbers.size>1){gap('number-conflict',number,'The amendment block contains conflicting individual amendment numbers; its content is withheld.');continue;}
    for(const unsupported of group.filter(block=>block.kind==='unsupported'))gap(unsupported.code,number,unsupported.message);
    for(const block of group.filter(block=>block.kind==='paragraph'))for(const code of block.losses||[])if(CONTENT_LOSSES[code])gap(code,number,CONTENT_LOSSES[code]);
    const authors=[...new Set(field(raw,'Members').flatMap(names=>names.split(/[,;\n]+/).map(clean).filter(Boolean)))];
    const onBehalfOf=field(raw,'AuNomDe').map(metadata).filter(Boolean).join('; ')||null;
    const documentReferences=['DocRef','DocAmend','Article','DocAmend2','Article2','DocAmend3','Article3','DocAmend4','Article4'].flatMap(tag=>field(raw,tag).map(value=>({field:tag,raw:metadata(value),sourceRaw:value,scope:'amendment'})));
    for(const value of field(coverRaw,'DocRef'))documentReferences.push({field:'DocRef',raw:metadata(value),sourceRaw:value,scope:'document'});
    const comparisonHeadings=[];
    const targetParts=field(raw,'Article');
    for(let i=2;i<=4;i++)for(const article of field(raw,'Article'+i))targetParts.push([field(raw,'DocAmend'+i)[0],article].filter(Boolean).join(' — '));
    if(language==='en'&&!targetParts.length) {
      const tableAt=group.findIndex(block=>block.kind==='table');
      const paragraphs=group.slice(0,tableAt<0?0:tableAt).filter(block=>block.kind==='paragraph'&&!numberIn(block.raw,block.paragraphStyle,language)),header=paragraphs.filter(block=>block.text.trim());
      if(header.length===1&&header[0].compound&&!header[0].losses.length&&paragraphs.every(block=>block===header[0]||block.compoundBlank)) {
        const [documentClass,target]=header[0].compound;targetParts.push(target);
        for(const [field,raw] of [['DocumentClass',documentClass],['Article',target]])documentReferences.push({field,raw,sourceRaw:header[0].raw,scope:'amendment',basis:'native-line-break'});
      }
    }
    if(!targetParts.length&&committee) {
      const procedure=field(coverRaw,'Procedure').map(metadata);let classRecorded=false;
      for(const block of group) {
        if(block.kind==='table')break;
        if(block.kind!=='paragraph'||!block.text||numberIn(block.raw,block.paragraphStyle,language))continue;
        const targetStyle=/^NormalBold(?:\d+b?)?$/i.test(block.paragraphStyle||'')||language==='hr'&&block.bold;
        if(!targetParts.length&&targetStyle&&documentClass(block.text,language)) {
          documentReferences.push({field:'DocumentClass',raw:metadata(block.text),sourceRaw:block.raw,scope:'amendment'});
          classRecorded=true;continue;
        }
        // Between a recorded class line and the comparison table only label
        // lines remain; A-10-2026-0230 prints its first one unstyled.
        if(!procedure.includes(block.text)&&(targetStyle||classRecorded||language==='hr'&&targetParts.length))targetParts.push(block.text);
      }
    }
    // Some published lists omit template fields and styles on the amended-act
    // line. Recover only the complete two-line tail before the comparison table.
    if(['en','cs'].includes(language)&&targetParts.length===1&&!field(raw,'Article2').length&&!field(raw,'DocAmend2').length) {
      const tableAt=group.findIndex(block=>block.kind==='table');
      const header=group.slice(0,tableAt<0?0:tableAt).filter(block=>block.kind==='paragraph'&&block.text.trim());
      const at=header.findIndex(block=>metadata(field(block.raw,'Article')[0]??block.text)===metadata(targetParts[0]));
      const tail=at<0?[]:header.slice(at+1);
      const actShape=language==='cs'?/^(?:Nařízení|Směrnice) \((?:EU|ES|EHS)\) \d{4}\/\d+$/u:/^(?:Regulation|Directive) (?:\((?:EU|EC|EEC)\) )?\d{4}\/\d+(?:\/(?:EC|EU|EEC))?$/u;
      if(tail.length===2&&tail.every(block=>!block.losses?.length)&&actShape.test(tail[0].text.trim())) {
        const inner=parseTargetLabel(tail[1].text.trim(),language);
        if(inner.complete&&inner.segments[0]?.kind==='article'&&inner.segments.length>1) {
          const act=tail[0].text.trim(),address=tail[1].text.trim();
          if(!documentReferences.some(r=>r.field==='Article'))documentReferences.push({field:'Article',raw:metadata(targetParts[0]),scope:'amendment',basis:'published-heading'});
          targetParts.push(act+' — '+address);
          documentReferences.push({field:'DocAmend2',raw:act,sourceRaw:tail[0].raw,scope:'amendment',basis:'published-heading'},{field:'Article2',raw:address,sourceRaw:tail[1].raw,scope:'amendment',basis:'published-heading'});
        }
      }
    }
    const targetLabel=targetParts.map(metadata).filter(Boolean).join('\n')||null;
    const before=[],after=[],tables=group.filter(b=>b.kind==='table');let comparableRows=0,hasTable=false;
    const rows=tables.flatMap(sectionRows),first=rows.find(row=>row.cells.some(cell=>cell.text));
    // A full-width table caption may precede the original-side heading.
    // The proposed side must repeat it immediately after its own heading.
    const visible=rows.filter(row=>row.cells.some(cell=>cell.text)),tableCaption=language==='en'&&/^Annex(?: [IVXLCDM]+)? [–—-] table [–—-] (.+)$/u.exec(targetLabel??'')?.[1];
    const fullCaption=(row,value)=>row?.cells.length===1&&row.cells[0].grid.span===row.table.gridColumns&&row.cells[0].text===value&&row.cells[0].raw===value&&!row.cells[0].hasNotes&&!row.cells[0].losses.length;
    const proposedHeaders=visible.flatMap((row,i)=>sectionHeading(row.cells,row.table,language)?.side==='proposed'?[i]:[]),proposedHeader=proposedHeaders[0];
    const captionClasses=documentReferences.filter(ref=>['DocumentClass','DocAmend'].includes(ref.field)&&/^Proposal for a (?:regulation|directive|decision)$/u.test(ref.raw));
    const captionGrids=tables.length===1?direct(tables[0].gridNodes,'w:tblGrid'):[];
    const explicitCaptionGrid=captionGrids.length===1&&direct(captionGrids[0]['w:tblGrid'],'w:gridCol').length===2;
    const captionPrefix=Boolean(explicitCaptionGrid&&tableCaption&&captionClasses.length===1&&tables.length===1&&rows.every(row=>row.cells.every(cell=>cell.captionSafe))&&tables[0].legalGridSupported&&fullCaption(visible[0],tableCaption)&&sectionHeading(visible[1]?.cells??[],visible[1]?.table,language)?.side==='original'&&proposedHeaders.length===1&&proposedHeader>2&&fullCaption(visible[proposedHeader+1],tableCaption)&&proposedHeader+2<visible.length&&visible.slice(2,proposedHeader).concat(visible.slice(proposedHeader+2)).every(row=>row.cells.length===2&&row.cells.every(cell=>cell.grid.span===1&&!['Text proposed by the Commission','Amendment'].includes(cell.text))));
    const stacked=captionPrefix||first&&sectionHeading(first.cells,first.table,language)?.side==='original';
    if(captionPrefix)documentReferences.push({field:'ComparisonCaption',raw:tableCaption,sourceRaw:visible[0].cells[0].raw,scope:'amendment',basis:'caption-before-original-heading'});
    let pendingCaption=captionPrefix;
    const formulaTarget=/^Article [1-9]\d* – paragraph ([1-9]\d*) ?([a-z]) \(new\)$/u.exec(targetLabel??'');
    const formulaRows=tables[0]?.rows.filter(cells=>cells.some(cell=>cell.text||cell.formulaCount))??[];
    let formulaSource=false;try{const url=new URL(sourceUrl);formulaSource=url.protocol==='https:'&&!url.username&&!url.password;}catch{}
    const formulaRecovery=Boolean(formulaSource&&language==='en'&&formulaTarget&&tables.length===1&&!tables[0].unsupported&&!tables[0].revised&&!tables[0].gridUnsupported&&direct(tables[0].gridNodes,'w:tblGrid').length===1&&direct(children(tables[0].gridNodes,'w:tblGrid'),'w:gridCol').length===2&&documentReferences.filter(ref=>ref.field==='DocAmend'&&/^Proposal for a (?:regulation|directive|decision)$/u.test(ref.raw)).length===1&&!documentReferences.some(ref=>/^(?:Article|DocAmend)[2-4]$/u.test(ref.field))&&tables[0].rows.every(cells=>cells.every(cell=>cell.formulaSafe))&&formulaRows.length>1&&formulaRows.every(cells=>cells.length===2)&&formulaRows[0][0].text==='Text proposed by the Commission'&&formulaRows[0][1].text==='Amendment'&&formulaRows[0].every(cell=>!cell.formulaCount)&&formulaRows.slice(1).every(cells=>!cells[0].text&&!cells[0].formulaCount)&&formulaRows.slice(1).reduce((count,cells)=>count+cells[1].formulaCount,0)===1&&formulaRows[1][1].text.startsWith(formulaTarget[1]+formulaTarget[2]+'.\t'));
    if(formulaRecovery)gap('formula-not-shown',number,'Formula not shown.');
    const sections=[];let section=null;
    for(const table of tables) {
      hasTable=true;
      const gridUnsupported=stacked?!table.legalGridSupported:table.gridUnsupported;
      if(gridUnsupported)gap('comparison-grid',number,'The comparison grid contains unsupported column counts, spans, offsets or merges; both wording columns are withheld.');
      if(table.unsupported)gap('comparison-structure',number,'The comparison contains unsupported wrapped or embedded row/cell content; its wording is withheld.');
      if(table.revised)gap('structural-revision',number,'The comparison contains tracked structural insertion, deletion, merge or move markers; revision acceptance is unresolved and its wording is withheld.');
      let headerConfirmed=false;
      const comparisonRows=stacked?sectionRows(table):table.rows.map(cells=>({table,cells}));
      for(const {table:rowTable,cells} of comparisonRows) {
        if(cells.some(c=>c.nested)){gap('nested-table',number,'A nested comparison table is unsupported.');continue;}
        if(cells.some(c=>c.symbolLoss))gap('symbol-text-loss',number,'A visible font-encoded symbol cannot be decoded reliably; comparison wording is withheld.');
        for(const code of Object.keys(CONTENT_LOSSES))if(!(formulaRecovery&&code==='non-text-content')&&cells.some(cell=>cell.losses.includes(code)))gap(code,number,CONTENT_LOSSES[code]);
        if(cells.every(c=>!c.text))continue;
        if(stacked) {
          if(pendingCaption){before.push(joinWording(cells,'\t'));pendingCaption=false;continue;}
          const heading=sectionHeading(cells,rowTable,language);
          if(heading){section=heading;sections.push(heading);continue;}
          if(!section){gap('comparison-header',number,'A stacked comparison section has no explicit heading.');continue;}
          if(cells.some(c=>c.hasNotes))gap('notes-unavailable',number,'The comparison contains footnote or endnote references whose note text is not included in this extraction.');
          comparableRows++;(section.side==='original'?before:after).push(joinWording(cells,'\t'));continue;
        }
        if(!headerConfirmed) {
          if(cells.length===2&&(isAmendmentHeading(cells[1].text,language)||legacyHeading(cells[1].text))){headerConfirmed=true;comparisonHeadings.push({left:comparisonHeading(cells[0].text,language),right:comparisonHeading(cells[1].text,language)});continue;}
          gap('comparison-header',number,'The comparison column headings could not be identified.');break;
        }
        if(cells.length!==2){gap('comparison-columns',number,'A comparison row does not contain exactly two columns.');continue;}
        if(cells.some(c=>c.hasNotes))gap('notes-unavailable',number,'The comparison contains footnote or endnote references whose note text is not included in this extraction.');
        comparableRows++;before.push(cells[0]);after.push(cells[1]);
      }
    }
    if(stacked) {
      if(sections.length!==2||sections[0].side!=='original'||sections[1].side!=='proposed')gap('comparison-header',number,'The stacked comparison does not supply exactly one original section followed by one proposed section.');
      else comparisonHeadings.push({left:sections[0].heading,right:sections[1].heading});
    }
    // Alternative motions have a single body outside the comparison tables.
    // Read only the bounded native template body; metadata and justification
    // stay outside it, and ordinary table-less amendments remain unavailable.
    if(!hasTable&&alternativeMotionHeading(documentReferences,targetDocumentId,language)) {
      const titles=group.flatMap((block,i)=>block.kind==='paragraph'&&/<Article>/.test(block.raw)?[i]:[]);
      const tails=group.flatMap((block,i)=>block.kind==='paragraph'&&/<Original>/.test(block.raw)?[i]:[]);
      if(titles.length===1&&tails.length===1&&tails[0]>titles[0]+1) {
        const body=group.slice(titles[0]+1,tails[0]);
        if(body.every(block=>block.kind==='paragraph'&&!/<[^>]+>/u.test(block.text))) {
          comparableRows=body.filter(block=>block.text).length;
          after.push(...body);
          if(body.some(block=>block.hasNotes))gap('notes-unavailable',number,'The motion contains note references whose note text is not included in this extraction.');
        }
      }
    }
    const ownDate=documentDate(raw),date=ownDate||(!field(raw,'Date').length&&(committee||scope==='committee')?coverDate:null);
    const dateBasis=ownDate?'individual-amendment-document':date?'amendment-list-document':null;
    let justification=null,inJustification=false;const justificationParts=[];
    for(const block of group)if(block.kind==='paragraph') {
      const title=/^Justification\s*$/iu.test(block.text)||/<TitreJust>/.test(block.raw)||block.paragraphStyle==='AmJustTitle';
      if(title||/<Justification>/.test(block.raw))inJustification=true;
      if(inJustification&&!title&&!/^Or\.\s/iu.test(block.text))justificationParts.push(metadata(block.text).replace(/<\/?Justification>/g,''));
      if(/<\/Justification>|<\/Amend>|<Original>/.test(block.raw))inJustification=false;
    }
    if(justificationParts.some(Boolean))justification=justificationParts.filter(Boolean).join('\n');
    const baselineSource={...baselineDescriptor(comparisonHeadings),language,sourceUrl,fetchedAt},baseline=baselineSource.category;
    // Committee lists publish inner-law coordinates as consecutive heading
    // paragraphs even when the translation-template tags are absent.
    if(baseline==='present-text'&&!documentReferences.some(r=>/^Article[2-4]$/.test(r.field))) {
      const headings=[];
      for(const block of group){if(block.kind==='table')break;if(block.kind==='paragraph'&&block.text)headings.push(block.text);}
      for(let i=0;i<headings.length-1;i++)if(/^(?:Regulation|Directive|Decision|Dyrektywa)\b/u.test(headings[i])&&/\d{4}\s*\/\s*\d+|\d+\s*\/\s*\d{4}/u.test(headings[i])) {
        documentReferences.push({field:'DocAmend2',raw:headings[i],scope:'amendment',basis:'published-heading'},{field:'Article2',raw:headings[i+1],scope:'amendment',basis:'published-heading'});
      }
    }
    // Explicit dated CELEX citations can occur outside the hidden tags (AM104).
    if(baseline==='present-text')for(const value of new Set([...raw.matchAll(/0(?:19|20)\d{2}[RLD]\d{4}-\d{8}\b/g)].map(m=>m[0])))documentReferences.push({field:'Consolidation',raw:value,scope:'amendment'});
    const targetPath={...amendmentTargetPath(documentReferences),language,sourceUrl,fetchedAt};
    if(baselineSource.conflicted)gap('baseline-conflict',number,'Comparison tables name different baseline categories.');
    const original=trimWording(joinWording(before)),proposed=trimWording(joinWording(after));
    const record={...(scope==='committee'?{numberPublished:field(raw,'NumAm')[0]||String(number),proposerDateConflict:Boolean(field(raw,'Date').length&&!ownDate||!ownDate&&field(coverRaw,'Date').length&&!coverDate)}:{}),baselineSource,documentReferences,targetPath,number,listId:listId??null,targetDocumentId:targetDocumentId??null,date,documentDate:date,dateBasis,authors,committeeProposer:committee,onBehalfOf,baseline,targetLabel,originalText:comparableRows?original.text:null,proposedText:comparableRows?proposed.text:null,originalFormatting:comparableRows?canonicalFormatting(original.formatting):[],proposedFormatting:comparableRows?canonicalFormatting(proposed.formatting):[],justification,language,sources:[{url:sourceUrl,fetchedAt,date,dateBasis,language,format:'DOCX'}]};
    if(!authors.length)gap('authors-unavailable',number,'No explicit amendment proposer names were found in this document block.');
    if(!date)gap('date-unavailable',number,'The amendment document does not supply a supported document date.');
    if(!targetLabel)gap('target-unavailable',number,'The amendment target location was not recorded.');
    if(!comparableRows)gap('text-unavailable',number,'No supported original/proposed comparison rows were found.');
    if(byNumber.has(number)) {
      byNumber.set(number,null);gap('duplicate-amendment',number,'The list repeats this amendment number; its extracted content is withheld.');
    } else byNumber.set(number,record);
  }
  let amendments=[...byNumber.values()].filter(Boolean).sort((a,b)=>a.number-b.number);
  const range=scope==='committee'?committeeRange:String(listId||'').match(/-AM-(\d+)-(\d+)$/);
  if(range&&Number(range[2])-Number(range[1])<1000) {
    const missing=[];
    for(let n=Number(range[1]);n<=Number(range[2]);n++)if(!byNumber.get(n))missing.push(n);
    if(missing.length)gap('list-coverage',null,'Individual amendment text is unavailable for numbers '+missing.join(', ')+'.');
    amendments=amendments.filter(record=>{
      if(record.number>=Number(range[1])&&record.number<=Number(range[2]))return true;
      gap('number-outside-list',record.number,'The amendment number falls outside the source list identifier range; its content is withheld.');return false;
    });
  }
  if(!groups.length)gap('amendments-unavailable',null,'No supported individual amendment blocks were found.');
  for(const message of warnings)gap('numbering-warning',null,message);
  for(const amendment of amendments) {
    amendment.gaps=gaps.filter(item=>item.number===amendment.number||item.code==='numbering-warning').map(item=>item.number==null?{...item,number:amendment.number,scope:'document'}:{...item});
    // Losing even one comparison row leaves both legal columns incomplete.
    // Keep the exact identity and its missing-evidence labels, never a shortened
    // body that could be mistaken for the whole amendment. Empty supported
    // cells remain valid; notes and missing author/date metadata are separate.
    if(amendment.gaps.some(item=>TEXT_LOSS_CODES.has(item.code))) {
      amendment.originalText=null;
      amendment.proposedText=null;
      amendment.originalFormatting=[];amendment.proposedFormatting=[];
    }
  }
  // The second annex's frame can be printed outside its one-column comparison
  // headings. Keep it only with native layout and preceding-amendment proof.
  const order=groups.map(group=>groupNumber(group,language));
  const safeTable=(table,count)=>table&&!table.unsupported&&!table.revised&&table.legalGridSupported&&direct(table.gridNodes,'w:tblGrid').length===1&&direct(children(table.gridNodes,'w:tblGrid'),'w:gridCol').length===count&&table.rows.every(cells=>cells.every(cell=>cell.annexSafe&&!cell.hasNotes&&!cell.nested));
  const classes=row=>row.documentReferences.filter(ref=>ref.field==='DocumentClass'&&ref.scope==='amendment');
  for(const current of amendments) {
    if(language!=='en'||!/^Annex (?:2|II)(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(current.targetLabel??'')||current.originalText!==''||current.baseline!=='commission-proposal'||classes(current).length!==1||classes(current)[0].raw!=='Proposal for a regulation'||current.targetPath.underlying.length||current.gaps.some(gap=>TEXT_LOSS_CODES.has(gap.code)||gap.code==='notes-unavailable'))continue;
    const at=order.indexOf(current.number),previous=amendments.find(row=>row.number===order[at-1]);
    if(at<1||order.lastIndexOf(current.number)!==at||!previous||previous.number!==current.number-1||order.indexOf(previous.number)!==at-1||previous.language!=='en'||previous.baseline!=='commission-proposal'||previous.originalText!==''||!/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] [^\n\t]+)?$/u.test(previous.targetLabel??'')||classes(previous).length!==1||classes(previous)[0].raw!=='Proposal for a regulation'||previous.targetPath.underlying.length||previous.gaps.some(gap=>TEXT_LOSS_CODES.has(gap.code)||gap.code==='notes-unavailable')||!/^ANNEX(?: (?:1|I))?\n[^\n]+\n/u.test(previous.proposedText??'')||/[\u2026]|\.{3}|\uFFFC/u.test(previous.proposedText))continue;
    const old=groups[at-1],group=groups[at],tables=group.filter(block=>block.kind==='table'),oldTables=old.filter(block=>block.kind==='table');
    const oldLines=previous.proposedText.split('\n'),oldCaption=/^Annex(?: (?:1|I))?(?: \(new\))?(?: [–-] ([^\n\t]+))?$/u.exec(previous.targetLabel)?.[1];
    if(oldLines.some(line=>!line.trim())||oldLines.slice(1).some(line=>/^ANNEX\b/u.test(line))||oldCaption&&oldCaption.normalize('NFC').replace(/\s+/gu,' ').trim().toUpperCase()!==oldLines[1].normalize('NFC').replace(/\s+/gu,' ').trim().toUpperCase())continue;
    if(oldTables.length!==1||!safeTable(oldTables[0],2)||old.some(block=>block.kind==='paragraph'&&!block.annexSafe)||tables.length!==2||!safeTable(tables[0],1)||!safeTable(tables[1],tables[1].gridColumns)||group.some(block=>block.kind==='paragraph'&&!block.annexSafe))continue;
    const oldRows=oldTables[0].rows,oldHeader=old.filter(block=>block.kind==='paragraph'&&block.text);
    if(oldHeader.map(block=>block.text).join('\n')!==`Amendment\t\t${previous.number}\nProposal for a regulation\n${previous.targetLabel}`||oldRows.length!==3||oldRows[0].length!==1||oldRows[0][0].grid.span!==2||oldRows[0][0].text||oldRows.slice(1).some(cells=>cells.length!==2||cells.some(cell=>cell.grid.span!==1))||oldRows[1][0].text!=='Text proposed by the Commission'||oldRows[1][1].text!=='Amendment'||oldRows[2][0].text||oldRows[2][1].text!==previous.proposedText)continue;
    const first=group.indexOf(tables[0]),last=group.indexOf(tables[1]),header=group.slice(0,first).filter(block=>block.kind==='paragraph'&&block.text),prefix=group.slice(first+1,last).filter(block=>block.kind==='paragraph'&&block.text);
    if(header.map(block=>block.text).join('\n')!==`Amendment\t\t${current.number}\nProposal for a regulation\n${current.targetLabel}`||prefix.length!==2||!/^ANNEX(?: (?:2|II))?$/u.test(prefix[0].text)||!/[.:]$/u.test(prefix[1].text)||group.slice(last+1).some(block=>block.kind!=='paragraph'||block.text)||tables[0].rows.length!==2||tables[0].rows.some(cells=>cells.length!==1||cells[0].grid.span!==1)||tables[0].rows[0][0].text!=='Text proposed by the Commission'||tables[0].rows[1][0].text!=='Amendment')continue;
    const grid=tables[1],count=grid.gridColumns;if(count<2||count>20||grid.rows.length<2||grid.rows.some(cells=>cells.length!==count||cells.some(cell=>cell.grid.span!==1)||!cells.some(cell=>cell.text))||grid.rows[0].some(cell=>!cell.text))continue;
    const literal=grid.rows.map(cells=>cells.map(cell=>cell.text).join('\t')).join('\n');if(current.proposedText!==literal)continue;
    const nativePrefix=prefix.map(block=>block.text).join('\n')+'\n',offset=nativePrefix.length;
    current.proposedText=nativePrefix+current.proposedText;current.proposedFormatting=current.proposedFormatting.map(mark=>({...mark,start:mark.start+offset,end:mark.end+offset}));
    current.documentReferences.push({field:'PrecedingAnnex',raw:String(previous.number),sourceRaw:previous.targetLabel,scope:'amendment',basis:'native-annex-order'});
  }
  return {amendments,gaps,...(reportId?{reportId}:{})};
}
