import { XMLParser } from 'fast-xml-parser';
import { docxParts } from './document-text.mjs';
import { comparisonHeading,isAmendmentHeading,baselineDescriptor,amendmentTargetPath } from './amendment-baseline.mjs';
import { numberingLabels } from './docx-numbering.mjs';
import { styleFormatting } from './docx-formatting.mjs';

export const AMENDMENT_EXTRACTION_VERSION='19';

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
    return {raw,text,formatting,bold,paragraphStyle:id||null,hasNotes:/"w:(?:footnote|endnote)Reference"/.test(structure),losses:[...losses],symbolLoss:losses.has('symbol-text-loss'),unsupportedBody:losses.has('comparison-structure')};
  };
  const blocks=[];
  const summary=content=>({
    ...joinWording(content.filter(part=>part.text)),raw:content.map(part=>part.raw).join('\n'),
    hasNotes:content.some(part=>part.hasNotes),losses:[...new Set(content.flatMap(part=>part.losses))],
    symbolLoss:content.some(part=>part.symbolLoss),unsupportedBody:content.some(part=>part.unsupportedBody),
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
  walk(parser().parse(parts.get('word/document.xml')));
  return blocks;
}
const field=(raw,tag)=>[...raw.matchAll(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','g'))].map(m=>clean(m[1]));
const metadata=value=>clean(value).replace(/^\{[^{}]*\}/,'').trim();
// Published committee-list class lines are metadata, not legal addresses.
const DOCUMENT_CLASSES={fr:'Proposition de règlement',hu:'Rendeletre irányuló javaslat',ro:'Propunere de regulament'};
const classKey=value=>clean(value).normalize('NFC').replace(/\s+/gu,' ').toLowerCase();
const documentClass=(text,language)=>DOCUMENT_CLASSES[language]&&classKey(text)===classKey(DOCUMENT_CLASSES[language]);
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
  const match=raw.match(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/)||raw.match(/^\s*Amendment\s*([1-9]\d*)\b/iu)||(/^AmNumberTabs\d*$/i.test(paragraphStyle||'')&&raw.match(/^[^\d<>]+?\s*([1-9]\d*)\s*$/u));
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
export function extractAmendments(buffer,{listId,targetDocumentId,language=null,sourceUrl=null,fetchedAt=null,reportId=null}={}) {
  const warnings=new Set();let blocks=documentBlocks(docxParts(buffer),warnings,language);const groups=[],gaps=[];
  const gap=(code,number,message,details={})=>gaps.push({code,...(number==null?{}:{number}),message,sourceUrl,...details});
  if(reportId) {
    const range=String(listId||'').match(/^(A-10-\d{4}-\d{4,6})-AM-(\d+)-(\d+)$/);
    const start=blocks.findIndex(block=>block.kind==='paragraph'&&/<RepeatBlock-Amend>/.test(block.raw));
    const end=blocks.findIndex((block,index)=>index>=start&&block.kind==='paragraph'&&/<\/RepeatBlock-Amend>/.test(block.raw));
    const cover=blocks.slice(0,start).filter(block=>block.kind==='paragraph').map(block=>block.raw).join('\n');
    const coverIds=field(cover,'NoDocSe').map(value=>value.match(/^A(\d+)-(\d+)\/(\d{4})$/)).filter(Boolean).map(([,term,number,year])=>'A-'+term+'-'+year+'-'+number.padStart(4,'0'));
    const main=blocks.slice(start,end+1),numbers=main.filter(block=>block.kind==='paragraph').flatMap(block=>[...block.raw.matchAll(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/g)].map(match=>Number(match[1])));
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
  const byNumber=new Map();
  for(const group of groups) {
    const raw=group.filter(b=>b.kind==='paragraph').map(b=>b.raw).join('\n');
    const number=groupNumber(group,language);
    if(!number){gap('number-unavailable',null,'An amendment block has no supported individual amendment number.');continue;}
    const numbers=new Set([...raw.matchAll(/<NumAm>\s*([1-9]\d*)\s*<\/NumAm>/g)].map(match=>Number(match[1])));
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
        if(!procedure.includes(block.text)&&(targetStyle||(classRecorded||language==='hr')&&targetParts.length))targetParts.push(block.text);
      }
    }
    const targetLabel=targetParts.map(metadata).filter(Boolean).join('\n')||null;
    const before=[],after=[],tables=group.filter(b=>b.kind==='table');let comparableRows=0,hasTable=false;
    const rows=tables.flatMap(sectionRows),first=rows.find(row=>row.cells.some(cell=>cell.text));
    const stacked=first&&sectionHeading(first.cells,first.table,language)?.side==='original';
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
        for(const code of Object.keys(CONTENT_LOSSES))if(cells.some(cell=>cell.losses.includes(code)))gap(code,number,CONTENT_LOSSES[code]);
        if(cells.every(c=>!c.text))continue;
        if(stacked) {
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
    const ownDate=documentDate(raw),date=ownDate||(!field(raw,'Date').length&&committee?coverDate:null);
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
    const record={baselineSource,documentReferences,targetPath,number,listId:listId??null,targetDocumentId:targetDocumentId??null,date,documentDate:date,dateBasis,authors,committeeProposer:committee,onBehalfOf,baseline,targetLabel,originalText:comparableRows?original.text:null,proposedText:comparableRows?proposed.text:null,originalFormatting:comparableRows?canonicalFormatting(original.formatting):[],proposedFormatting:comparableRows?canonicalFormatting(proposed.formatting):[],justification,language,sources:[{url:sourceUrl,fetchedAt,date,dateBasis,language,format:'DOCX'}]};
    if(!authors.length)gap('authors-unavailable',number,'No explicit amendment proposer names were found in this document block.');
    if(!date)gap('date-unavailable',number,'The amendment document does not supply a supported document date.');
    if(!targetLabel)gap('target-unavailable',number,'The amendment target location was not recorded.');
    if(!hasTable||!comparableRows)gap('text-unavailable',number,'No supported original/proposed comparison rows were found.');
    if(byNumber.has(number)) {
      byNumber.set(number,null);gap('duplicate-amendment',number,'The list repeats this amendment number; its extracted content is withheld.');
    } else byNumber.set(number,record);
  }
  let amendments=[...byNumber.values()].filter(Boolean).sort((a,b)=>a.number-b.number);
  const range=String(listId||'').match(/-AM-(\d+)-(\d+)$/);
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
  return {amendments,gaps,...(reportId?{reportId}:{})};
}
