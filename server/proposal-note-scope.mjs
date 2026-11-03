import {resolveProposalPlacement} from './proposal-placement.mjs';

// Only a complete comparison template can separate provision text from notes.
// Keep the published columns unchanged; the cuts also drive the reader.
function comparisonColumn(value,formatting) {
  if(typeof value!=='string'||value.length>64*1024)return null;
  const lines=value.split('\n');let offset=0,separator;
  for(const line of lines){if(/^_{3,}[ \t]*$/u.test(line)){if(separator||offset===0||offset+line.length>=value.length)return null;separator={start:offset-1,end:offset+line.length+1};}offset+=line.length+1;}
  if(!separator)return {body:value,end:value.length,notes:[],references:[],clean:value};
  const body=value.slice(0,separator.start),notes=[];
  for(const line of value.slice(separator.end).split('\n')){
    if(!line.trim())continue;
    const match=/^\s*([1-9]\d*[a-z]{0,3})\.?\s+(.+)$/u.exec(line);
    if(match){if(notes.some(n=>n.label===match[1]))return null;notes.push({label:match[1],text:match[2]});}
    else {if(!notes.length||/^\s*\+\s*OJ:/iu.test(line))return null;notes.at(-1).text+='\n'+line;}
  }
  const references=[];let clean='',cursor=0;
  for(const mark of (formatting||[]).filter(mark=>mark.kind==='superscript'&&mark.start<body.length).sort((a,b)=>a.start-b.start)){
    if(!Number.isSafeInteger(mark.start)||!Number.isSafeInteger(mark.end)||mark.start<cursor||mark.end<=mark.start||mark.end>body.length)return null;
    const label=/^([1-9]\d*[a-z]{0,3})\.?$/u.exec(body.slice(mark.start,mark.end))?.[1];
    if(!label||references.some(ref=>ref.label===label))return null;
    clean+=body.slice(cursor,mark.start);references.push({label,prefix:clean});cursor=mark.end;
  }
  clean+=body.slice(cursor);
  if(!references.length||references.some(ref=>!notes.some(note=>note.label===ref.label))||notes.filter(note=>references.some(ref=>ref.label===note.label)).some((note,index)=>note.label!==references[index].label))return null;
  return {body,end:separator.start,notes,references,clean};
}
const textKey=value=>value.normalize('NFC').replace(/\s+/gu,'');

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
export function resolveProposalNoteScope(items,chosen) {
  const withheld=()=>({operation:chosen.originalText?.trim()?'replace':'insert',status:'unresolved',reason:'proposal_note_scope_unavailable',evidence:[]});
  if(chosen.language!=='en')return withheld();
  const original=comparisonColumn(chosen.originalText,chosen.originalFormatting),proposed=comparisonColumn(chosen.proposedText,chosen.proposedFormatting);
  if(!original||!proposed||!proposed.notes.length||original.notes.length!==original.references.length)return withheld();
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
