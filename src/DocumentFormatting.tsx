import type {CSSProperties,HTMLAttributes,ReactNode} from 'react';
import './DocumentFormatting.css';

export type FormatMark={start:number;end:number;kind:'bold'|'italic'|'underline'|'strike'|'superscript'|'subscript'};
export type ParagraphFormat={align?:'center'|'right'|'justify';indent?:number;hanging?:number;firstLine?:number;heading?:number;size?:'xl'|'lg'|'sm';marks?:FormatMark[]};
export type DocumentTableCell={start:number;end:number;colSpan?:number;rowSpan?:number;gap?:boolean};
export type DocumentTable={rows:DocumentTableCell[][];bordered?:boolean};
export type DocumentFormatting={formatStatus?:'extracted'|'not-extracted';paragraphFormats?:ParagraphFormat[];tables?:DocumentTable[]};
type ParagraphProps=HTMLAttributes<HTMLParagraphElement>&{[data:`data-${string}`]:string|undefined};

// A link crossing a hanging-label split keeps its visible part in each fragment.
export function clipLinks<T extends {start:number;end:number}>(links:T[],from:number,to:number) {
  return links.map(link=>({...link,start:Math.max(link.start,from),end:Math.min(link.end,to)})).filter(link=>link.end>link.start);
}
// Formatting applies only when the server recorded it for exactly these source paragraphs.
export function usableFormatting(formatting:DocumentFormatting|null|undefined,paragraphCount:number) {
  return formatting?.formatStatus==='extracted'&&formatting.paragraphFormats?.length===paragraphCount?{formats:formatting.paragraphFormats,tables:formatting.tables||[]}:{formats:[],tables:[]};
}

const tableRange=(table:DocumentTable)=>{
  const cells=table.rows.flat().filter(cell=>cell.end>cell.start);
  return cells.length?{first:Math.min(...cells.map(cell=>cell.start)),end:Math.max(...cells.map(cell=>cell.end))}:null;
};
// A short label before the first tab sits in the hanging indent, as in the source document.
function hangingLabel(text:string,format:ParagraphFormat|undefined) {
  if(!format?.hanging)return null;
  const tab=text.indexOf('\t');
  return tab>0&&tab<=16&&text.slice(0,tab).trim()&&!text.slice(0,tab).includes('\n')?tab+1:null;
}
// Matches the font sizes in DocumentFormatting.css.
const fontScale={xl:1.4,lg:1.15,sm:.9};
function paragraphAttributes(format:ParagraphFormat|undefined,headingLevel:number):{className:string;style?:CSSProperties;role?:string;'aria-level'?:number} {
  if(!format)return {className:''};
  const classes=[format.align&&'doc-align-'+format.align,format.size&&'doc-size-'+format.size,format.indent&&'doc-indent',format.hanging&&'doc-hanging',format.firstLine&&'doc-first-line',format.heading&&'doc-heading'].filter(Boolean);
  // Indents are measured at the body text size, so enlarged or reduced text keeps the source position.
  const scale=format.size?fontScale[format.size]:1,length=(value:number)=>Math.round(value/scale*100)/100+'em';
  const style={...(format.indent?{'--doc-indent':length(format.indent)}:{}),...(format.hanging?{'--doc-hanging':length(format.hanging)}:{}),...(format.firstLine?{'--doc-first':length(format.firstLine)}:{})} as CSSProperties;
  return {className:classes.join(' '),...(Object.keys(style).length?{style}:{}),...(format.heading?{role:'heading','aria-level':Math.min(6,headingLevel+format.heading-1)}:{})};
}

// Renders reader paragraphs with their recorded paragraph styles, emphasis and tables.
// renderText receives offsets within the displayed paragraph and the emphasis marks for them.
export function DocumentParagraphs({texts,start,formatting,exactOffsets,headingLevel=4,paragraphProps,renderParagraph,renderText}:{
  texts:string[];start:number;formatting:{formats:ParagraphFormat[];tables:DocumentTable[]};exactOffsets:boolean;headingLevel?:number;
  paragraphProps?:(sourceIndex:number)=>ParagraphProps;
  renderParagraph?:(sourceIndex:number,paragraph:ReactNode)=>ReactNode;
  renderText:(sourceIndex:number,text:string,from:number,to:number,final:boolean,marks:FormatMark[])=>ReactNode;
}) {
  const end=start+texts.length;
  const paragraph=(sourceIndex:number)=>{
    const text=texts[sourceIndex-start],format=formatting.formats[sourceIndex],own=paragraphProps?.(sourceIndex)||{};
    const attributes=paragraphAttributes(format,headingLevel),marks=exactOffsets?format?.marks||[]:[],label=hangingLabel(text,format);
    const className=[own.className,attributes.className].filter(Boolean).join(' ')||undefined;
    const node=<p key={sourceIndex} {...attributes} {...own} className={className} style={{...attributes.style,...own.style}}>
      {label?<><span className="doc-label">{renderText(sourceIndex,text,0,label,false,marks)}</span>{renderText(sourceIndex,text,label,text.length,true,marks)}</>:renderText(sourceIndex,text,0,text.length,true,marks)}
    </p>;
    return renderParagraph?renderParagraph(sourceIndex,node):node;
  };
  const tables=new Map<number,{table:DocumentTable;end:number}>();
  for(const table of formatting.tables){const range=tableRange(table);if(range&&range.first>=start&&range.end<=end)tables.set(range.first,{table,end:range.end});}
  const nodes:ReactNode[]=[];
  for(let index=start;index<end;) {
    const found=tables.get(index);
    if(!found){nodes.push(paragraph(index));index++;continue;}
    nodes.push(<table key={'table-'+index} className={'doc-table'+(found.table.bordered?' doc-table-bordered':'')}><tbody>{found.table.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,cellIndex)=>
      <td key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={cell.gap?'doc-table-gap':undefined}>{Array.from({length:cell.end-cell.start},(_,offset)=>paragraph(cell.start+offset))}</td>)}</tr>)}</tbody></table>);
    index=found.end;
  }
  return <>{nodes}</>;
}
