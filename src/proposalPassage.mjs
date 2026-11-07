// A passage is a continuous run of source paragraphs, so headings between
// provisions stay in place and the rendering code stays the same.
const wrappers=new Set(['preamble','body','chapter','section','annex','memorandum','financial-statement']);
const furniture=new Set(['frontmatter','signature','title','subheading','enacting-formula']);
const provisions=units=>units.flatMap(unit=>wrappers.has(unit.kind)&&unit.children.length?provisions(unit.children):furniture.has(unit.kind)||unit.extent.end<=unit.extent.start?[]:[unit]);
// The memorandum and financial statement surround the act: they are nobody's neighbours.
const apart=new Set(['memorandum','financial-statement']);
const neighbours=(units,index)=>{
  const own=units.find(unit=>apart.has(unit.kind)&&unit.extent.start<=index&&index<unit.extent.end);
  return provisions(own?[own]:units.filter(unit=>!apart.has(unit.kind)));
};
const topTables=units=>units.flatMap(unit=>unit.kind==='table'&&unit.table?[unit.table]:topTables(unit.children));
const coverRanges=(range,ranges)=>{
  let {start,end}=range,changed=true;
  while(changed){
    changed=false;
    for(const [first,last] of ranges)if(first<end&&last>start&&(first<start||last>end)){start=Math.min(start,first);end=Math.max(end,last);changed=true;}
  }
  return {start,end};
};
function targetParagraphs(placement) {
  if(placement?.operation==='insert')return Number.isInteger(placement.insertAfter)?{first:placement.insertAfter,last:placement.insertAfter}:null;
  const first=placement?.span?.start??placement?.splice?.start.paragraph,last=placement?.span?.end??placement?.splice?.end.paragraph;
  return Number.isInteger(first)&&Number.isInteger(last)?{first,last}:null;
}
export function proposalPassage(proposal,placement,around=2) {
  const target=targetParagraphs(placement);
  if(!target)return null;
  const list=neighbours(proposal.units,target.first),holds=index=>unit=>unit.extent.start<=index&&index<unit.extent.end;
  let from=list.findIndex(holds(target.first)),to=list.findIndex(holds(target.last));
  // New text after a provision sits between two provisions, not inside one.
  const between=placement.operation==='insert'&&from>=0&&list[from].extent.end-1===target.first;
  if(from<0)from=list.findLastIndex(unit=>unit.extent.end<=target.first);
  if(to<0)to=list.findIndex(unit=>unit.extent.start>target.last)-1;
  const count=proposal.paragraphs.length;
  if(from<0||to<0||!list.length)return coverRanges({start:Math.max(0,target.first-around),end:Math.min(count,target.last+around+1)},tableRanges(proposal));
  const low=Math.max(0,from-(between?around-1:around)),high=Math.min(list.length-1,to+around);
  return coverRanges({start:list[low].extent.start,end:Math.min(count,list[high].extent.end)},tableRanges(proposal));
}
const tableRanges=proposal=>topTables(proposal.units).filter(table=>table.paragraphs.length).map(table=>[Math.min(...table.paragraphs),Math.max(...table.paragraphs)+1]);
// The rows of In its place: the amended provision with the provision before and after it. Inside an
// article a neighbour is the next paragraph or point, not the whole neighbouring article; between
// top-level provisions it is the same kind of provision, so a recital never borders a citation or an article.
const headings=new Set(['title','subheading']);
const containers=new Set(['article','annex','chapter','section']);
const numberPrefix=/^[^\t]{0,12}\t/u;
const prefixOf=text=>numberPrefix.exec(text)?.[0].trim()||null;
const withoutPrefix=text=>text.replace(numberPrefix,'');
const labelOf=(unit,fallback)=>unit.label?.kind?{kind:unit.label.kind,value:String(unit.label.value??''),prefix:unit.label.prefix?.trim()||null}:fallback;
// Reading order inside a provision: every unit with its own words. An article's own paragraph is its number.
const leaves=(unit,inherited=null)=>{
  const label=labelOf(unit,inherited),own=containers.has(unit.kind)||headings.has(unit.kind)||!unit.content?.length?[]:[{unit,label,paragraphs:unit.content}];
  return [...own,...unit.children.flatMap(child=>leaves(child,label))];
};
const leafText=(texts,paragraphs,keepPrefix=false)=>paragraphs.map((index,offset)=>offset||keepPrefix?texts[index].replace('\t',' '):withoutPrefix(texts[index])).join('\n');
const inTable=(ranges,start,end)=>ranges.some(([first,last])=>first<end&&last>start);
function rowFromUnit(unit,texts,ranges) {
  if(inTable(ranges,unit.extent.start,unit.extent.end))return null;
  const parts=leaves(unit);
  return parts.length?{label:labelOf(unit,null),text:parts.map((part,index)=>leafText(texts,part.paragraphs,index>0)).join('\n')}:null;
}
function rowFromLeaf(leaf,texts,ranges) {
  const first=leaf?.paragraphs[0],last=leaf?.paragraphs.at(-1);
  if(!leaf||inTable(ranges,first,last+1))return null;
  return {label:leaf.label,text:leafText(texts,leaf.paragraphs)};
}
function originalRow(placement,target,texts,label) {
  if(placement.operation==='insert')return null;
  const text=typeof placement.originalText==='string'?placement.originalText:Array.from({length:target.last-target.first+1},(_,offset)=>texts[target.first+offset]).join('\n');
  return {label,text:withoutPrefix(text)};
}
export function proposalPassageRows(proposal,placement) {
  const target=targetParagraphs(placement);
  if(!target)return null;
  const texts=proposal.paragraphs.map(paragraph=>paragraph.text),ranges=tableRanges(proposal);
  const insert=placement.operation==='insert',list=neighbours(proposal.units,target.first);
  const holds=index=>unit=>unit.extent.start<=index&&index<unit.extent.end;
  const from=list.findIndex(holds(target.first)),to=list.findIndex(holds(target.last));
  if(from<0||from!==to)return {before:null,original:originalRow(placement,target,texts,null),after:null};
  const holder=list[from],parts=leaves(holder),own=parts.filter(part=>part.paragraphs.some(index=>index>=target.first&&index<=target.last));
  // The placement names the unit it placed against, which tells a new article after Article 1 from a
  // new point at its end. Without that, new text at the end of a structured provision stays inside it.
  const anchor=placement.evidence?.find(item=>typeof item?.anchor==='string')?.anchor,deeper=Boolean(anchor&&holder.id&&anchor.startsWith(holder.id+'/'));
  // Whole provisions: the amended text covers all its words and starts at its number, or is placed against it.
  const named=anchor===holder.id;
  const whole=!deeper&&(insert?holder.extent.end-1===target.last&&(named||parts.length<=1):parts.every(part=>own.includes(part))&&(named||target.first===holder.extent.start));
  if(whole) {
    const side=unit=>unit?.kind===holder.kind?rowFromUnit(unit,texts,ranges):null;
    return {before:insert?rowFromUnit(holder,texts,ranges):side(list[from-1]),original:originalRow(placement,target,texts,labelOf(holder,null)),after:side(list[from+1])};
  }
  const before=parts.filter(part=>part.paragraphs.at(-1)<target.first||insert&&part.paragraphs.includes(target.first)).at(-1);
  const after=parts.find(part=>part.paragraphs[0]>target.last);
  return {before:rowFromLeaf(before,texts,ranges),original:originalRow(placement,target,texts,own[0]?.label??labelOf(holder,null)),after:rowFromLeaf(after,texts,ranges)};
}
// Published reports and motions have no provision tree: a paragraph is the unit, its number the label.
// An unnumbered line there is a heading or a continuation, so it borders nothing.
export function paragraphPassageRows(placement,{paragraphs,tables=[]}) {
  const target=targetParagraphs(placement);
  if(!target)return null;
  const ranges=tables.map(table=>table.rows.flat().filter(cell=>cell.end>cell.start)).filter(cells=>cells.length).map(cells=>[Math.min(...cells.map(cell=>cell.start)),Math.max(...cells.map(cell=>cell.end))]);
  const row=index=>{
    const text=paragraphs[index],prefix=typeof text==='string'&&withoutPrefix(text).trim()?prefixOf(text):null;
    return prefix&&!inTable(ranges,index,index+1)?{label:{kind:null,value:null,prefix},text:withoutPrefix(text)}:null;
  };
  const insert=placement.operation==='insert';
  return {before:row(target.first-(insert?0:1)),original:originalRow(placement,target,paragraphs,row(target.first)?.label??null),after:row(target.last+1)};
}
// Published reports and motions have no provision tree: a paragraph is the unit there.
export function paragraphPassage(placement,{start=0,count,tables=[]},around=2) {
  const target=targetParagraphs(placement);
  if(!target)return null;
  const ranges=tables.map(table=>table.rows.flat().filter(cell=>cell.end>cell.start)).filter(cells=>cells.length).map(cells=>[Math.min(...cells.map(cell=>cell.start)),Math.max(...cells.map(cell=>cell.end))]);
  return coverRanges({start:Math.max(start,target.first-around),end:Math.min(count,target.last+around+1)},ranges);
}
// Contents come only from the headings the source text records; a document without any has none.
export function documentContents(paragraphs,formats,start=0) {
  return paragraphs.flatMap((text,offset)=>{
    const level=formats[start+offset]?.heading,label=level?text.replace(/\s+/gu,' ').trim():'';
    return label?[{paragraph:start+offset,level,label}]:[];
  });
}
export const inPassage=(range,index)=>!range||index>=range.start&&index<range.end;
// Notes follow the text on screen, so a passage lists only the notes it cites.
export function passageNotes(notes,anchors,range) {
  if(!range)return notes;
  const cited=new Set(anchors.filter(anchor=>inPassage(range,anchor.paragraph)).map(anchor=>anchor.note));
  return notes.filter(note=>cited.has(note.id));
}
