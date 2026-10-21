// Presentation recorded beside the plain paragraph text: alignment, indentation,
// outline level, relative size, character emphasis and table layout. Text and
// offsets are unchanged, so references, notes and links keep their positions.
export const DOCX_FORMATTING_VERSION=1;

const child=(nodes,key)=>nodes?.find(node=>Object.hasOwn(node,key));
const children=(nodes,key)=>child(nodes,key)?.[key];
const attribute=(node,key)=>node?.[':@']?.['@_w:'+key];
const property=(nodes,key)=>attribute(child(nodes,key),'val');
const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;};
const on=node=>node?!['0','false','off'].includes(String(attribute(node,'val')??'true').toLowerCase()):undefined;

export const MARK_KINDS=Object.freeze(['bold','italic','underline','strike','superscript','subscript']);
const TOGGLES={bold:'w:b',italic:'w:i',strike:'w:strike'};

// Character properties. Toggles are kept as explicit true/false; absent means inherited.
function characterProperties(rPr) {
  const result={};
  for(const [name,key] of Object.entries(TOGGLES)){const value=on(child(rPr,key));if(value!==undefined)result[name]=value;}
  const dstrike=on(child(rPr,'w:dstrike'));if(dstrike)result.strike=true;
  const underline=property(rPr,'w:u');if(underline!==undefined||child(rPr,'w:u'))result.underline=!['none','0','false'].includes(String(underline??'single'));
  const vertical=property(rPr,'w:vertAlign');if(vertical!==undefined)result.vertical=['superscript','subscript'].includes(vertical)?vertical:'baseline';
  const size=number(property(rPr,'w:sz'));if(size>0)result.size=size;
  return result;
}
function paragraphProperties(pPr) {
  const result={},jc=property(pPr,'w:jc'),ind=child(pPr,'w:ind'),outline=number(property(pPr,'w:outlineLvl'));
  if(jc!==undefined)result.align=jc==='center'?'center':['right','end'].includes(jc)?'right':['both','distribute','thaiDistribute'].includes(jc)?'justify':'start';
  if(ind){
    const left=number(attribute(ind,'start')??attribute(ind,'left')),hanging=number(attribute(ind,'hanging')),firstLine=number(attribute(ind,'firstLine'));
    if(left!==undefined)result.left=left;
    if(hanging!==undefined)result.first=-hanging;else if(firstLine!==undefined)result.first=firstLine;
  }
  if(outline!==undefined)result.outline=outline;
  return result;
}

export function styleFormatting(styleNodes) {
  const styles=styleNodes||[];
  const byId=new Map(styles.filter(node=>node['w:style']).map(node=>[attribute(node,'styleId'),{
    parent:property(node['w:style'],'w:basedOn'),run:characterProperties(children(node['w:style'],'w:rPr')),paragraph:paragraphProperties(children(node['w:style'],'w:pPr')),
    borders:visibleBorders(children(children(node['w:style'],'w:tblPr'),'w:tblBorders')),
  }]));
  const defaultRun=characterProperties(children(children(children(styles,'w:docDefaults'),'w:rPrDefault'),'w:rPr'));
  const defaultParagraphProps=paragraphProperties(children(children(children(styles,'w:docDefaults'),'w:pPrDefault'),'w:pPr'));
  const resolved=new Map();
  // Within one basedOn chain the nearest style wins; cycles resolve to no style formatting.
  function style(id) {
    if(!id||!byId.has(id))return {run:{},paragraph:{}};
    if(resolved.has(id))return resolved.get(id);
    resolved.set(id,{run:{},paragraph:{}});
    const own=byId.get(id),parent=style(own.parent);
    const value={run:{...parent.run,...own.run},paragraph:{...parent.paragraph,...own.paragraph},borders:own.borders??parent.borders};
    resolved.set(id,value);return value;
  }
  const defaultParagraph=attribute(styles.find(node=>node['w:style']&&attribute(node,'type')==='paragraph'&&['1','true','on'].includes(String(attribute(node,'default')))),'styleId');
  const baseSize=style(defaultParagraph).run.size??defaultRun.size??20;
  // Toggles combine across the paragraph and character style hierarchies; direct run formatting is absolute.
  function run(paragraphStyle,rPr) {
    const paragraph=style(paragraphStyle||defaultParagraph).run,character=style(property(rPr,'w:rStyle')).run,direct=characterProperties(rPr),result={};
    for(const name of [...Object.keys(TOGGLES)])result[name]=direct[name]??(Boolean(defaultRun[name])!==Boolean(paragraph[name])!==Boolean(character[name]));
    result.underline=direct.underline??character.underline??paragraph.underline??defaultRun.underline??false;
    const vertical=direct.vertical??character.vertical??paragraph.vertical??defaultRun.vertical;
    result.superscript=vertical==='superscript';result.subscript=vertical==='subscript';
    result.size=direct.size??character.size??paragraph.size??defaultRun.size??baseSize;
    return result;
  }
  function paragraph(pPr) {
    const id=property(pPr,'w:pStyle')||defaultParagraph;
    return {...defaultParagraphProps,...style(id).paragraph,...paragraphProperties(pPr)};
  }
  // A table is drawn with rules when its own properties or its style give it visible borders.
  function tableBordered(tblPr) {
    return visibleBorders(children(tblPr,'w:tblBorders'))??style(property(tblPr,'w:tblStyle')).borders??false;
  }
  return {run,paragraph,tableBordered,cellBorderless,baseSize};
}
// A cell clears its table's rules when all four of its sides are set to none.
function cellBorderless(tcPr) {
  const borders=children(tcPr,'w:tcBorders');
  return Boolean(borders)&&['top','left','bottom','right'].every(side=>{const node=child(borders,'w:'+side)??child(borders,'w:'+({left:'start',right:'end'}[side]||side));return node&&['none','nil'].includes(String(attribute(node,'val')));});
}
function visibleBorders(borders) {
  if(!borders)return undefined;
  return borders.some(node=>Object.keys(node).some(key=>key.startsWith('w:')&&!['none','nil'].includes(String(attribute(node,'val')??'none'))));
}

// Twentieths of a point to em at the document's base size, bounded for small screens.
const em=(twips,baseSize)=>Math.round(Math.max(-20,Math.min(20,twips/(baseSize*10)))*100)/100;
export function paragraphFormat(properties,runs,baseSize,textLength) {
  const format={};
  if(properties.align&&properties.align!=='start')format.align=properties.align;
  if(properties.left>0)format.indent=em(properties.left,baseSize);
  if(properties.first<0)format.hanging=Math.min(format.indent??0,em(-properties.first,baseSize))||undefined;
  else if(properties.first>0)format.firstLine=em(properties.first,baseSize);
  if(format.hanging===undefined)delete format.hanging;
  if(Number.isInteger(properties.outline)&&properties.outline>=0&&properties.outline<=8)format.heading=Math.min(properties.outline+1,6);
  // The size covering most visible characters describes the paragraph.
  const sizes=new Map();for(const run of runs)sizes.set(run.size,(sizes.get(run.size)||0)+run.end-run.start);
  const size=[...sizes].sort((a,b)=>b[1]-a[1])[0]?.[0],ratio=size/baseSize;
  if(textLength&&Number.isFinite(ratio))format.size=ratio>=1.6?'xl':ratio>=1.2?'lg':ratio<=0.88?'sm':undefined;
  if(format.size===undefined)delete format.size;
  const marks=[];
  for(const kind of MARK_KINDS) {
    let open=null;
    for(const run of [...runs].sort((a,b)=>a.start-b.start)) {
      if(run.end<=run.start)continue;
      if(run[kind]){if(open&&open.end>=run.start)open.end=Math.max(open.end,run.end);else{open={start:run.start,end:run.end,kind};marks.push(open);}}
    }
  }
  if(marks.length)format.marks=marks.sort((a,b)=>a.start-b.start||MARK_KINDS.indexOf(a.kind)-MARK_KINDS.indexOf(b.kind));
  return format;
}

// Cells cover exact paragraph ranges. Vertically merged continuation cells are folded into the cell above.
export function tableLayout(table) {
  const rows=[],active=new Map();
  for(const row of table.rows) {
    const cells=[];let column=row.gridBefore||0;
    for(const cell of row.cells) {
      const span=Math.max(1,cell.colSpan||1),above=active.get(column);
      if(cell.vMerge==='continue'&&above&&above.span===span&&cell.start===cell.end){above.cell.rowSpan=(above.cell.rowSpan||1)+1;column+=span;continue;}
      const output={start:cell.start,end:cell.end,...(span>1?{colSpan:span}:{})};
      cells.push(output);
      if(cell.vMerge==='restart')active.set(column,{cell:output,span});else active.delete(column);
      column+=span;
    }
    rows.push(cells);
  }
  const bordered=table.bordered&&table.rows.some(row=>row.cells.some(cell=>!cell.borderless));
  return {rows,...(bordered?{bordered:true}:{})};
}

const ALIGN=new Set(['center','right','justify']),SIZES=new Set(['xl','lg','sm']);
const bounded=value=>value===undefined||(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=20);
export function documentFormatting(record) {
  const unknown={formatStatus:'not-extracted',paragraphFormats:[],tables:[]};
  const paragraphs=record?.paragraphs;
  if(record?.formattingVersion!==DOCX_FORMATTING_VERSION||!Array.isArray(paragraphs)||!Array.isArray(record.paragraphFormats)||record.paragraphFormats.length!==paragraphs.length||!Array.isArray(record.tables))return unknown;
  for(const [index,format] of record.paragraphFormats.entries()) {
    if(!format||typeof format!=='object'||Array.isArray(format))return unknown;
    if(format.align!==undefined&&!ALIGN.has(format.align)||format.size!==undefined&&!SIZES.has(format.size)||![format.indent,format.hanging,format.firstLine].every(bounded)
      ||format.heading!==undefined&&!(Number.isInteger(format.heading)&&format.heading>=1&&format.heading<=6))return unknown;
    if(format.marks!==undefined&&(!Array.isArray(format.marks)||!format.marks.every(mark=>MARK_KINDS.includes(mark?.kind)&&Number.isInteger(mark.start)&&Number.isInteger(mark.end)&&mark.start>=0&&mark.end>mark.start&&mark.end<=paragraphs[index].length)))return unknown;
  }
  let previous=0;
  for(const table of record.tables) {
    if(!Array.isArray(table?.rows)||!table.rows.length||table.bordered!==undefined&&table.bordered!==true)return unknown;
    for(const row of table.rows) {
      if(!Array.isArray(row))return unknown;
      for(const cell of row) {
        if(!Number.isInteger(cell?.start)||!Number.isInteger(cell.end)||cell.start<previous||cell.end<cell.start||cell.end>paragraphs.length
          ||cell.colSpan!==undefined&&!(Number.isInteger(cell.colSpan)&&cell.colSpan>1&&cell.colSpan<=64)||cell.rowSpan!==undefined&&!(Number.isInteger(cell.rowSpan)&&cell.rowSpan>1&&cell.rowSpan<=1000))return unknown;
        previous=cell.end;
      }
    }
  }
  return {formatStatus:'extracted',paragraphFormats:record.paragraphFormats,tables:record.tables};
}
