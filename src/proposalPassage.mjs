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
