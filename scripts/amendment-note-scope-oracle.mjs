import {nativeNoteRows} from './amendment-native-note-oracle.mjs';
// Independent note assertion: no production split/normalizer/placer imports.
const compact=text=>text.normalize('NFC').replace(/\s/gu,'');
function column(text,formatting=[]) {
 if(typeof text!=='string')return null;
 const cuts=[...text.matchAll(/\n_{3,}[ \t]*\n/gu)];
 if(!cuts.length)return {body:text,bodyEnd:text.length,notes:[],markers:[],detached:false};
 if(cuts.length!==1)return null;
 const cut=cuts[0],body=text.slice(0,cut.index),payload=text.slice(cut.index+cut[0].length);
 const markers=formatting.filter(f=>f.kind==='superscript'&&f.start<body.length).sort((a,b)=>a.start-b.start);
 let previous=0;const labels=[];
 for(const mark of markers){
  if(!Number.isSafeInteger(mark.start)||!Number.isSafeInteger(mark.end)||mark.start<previous||mark.end<=mark.start||mark.end>body.length)return null;
  const label=/^(\d+[a-z]{0,3})\.?$/u.exec(body.slice(mark.start,mark.end))?.[1];
  if(!label||labels.includes(label))return null;labels.push(label);previous=mark.end;
 }
 if(!labels.length)return null;
 const notes=[];
 for(const line of payload.split(/\n/u)){
  if(!line.trim())continue;
  const header=/^\s*(\d+[a-z]{0,3})\.?\s+(.+)$/u.exec(line);
  if(header){if(notes.some(note=>note.label===header[1]))return null;notes.push({label:header[1],text:header[2]});}
  else {if(!notes.length||/^\s*\+\s*OJ:/iu.test(line))return null;notes.at(-1).text+='\n'+line;}
 }
 if(labels.some(label=>!notes.some(note=>note.label===label))||notes.filter(note=>labels.includes(note.label)).map(note=>note.label).join('|')!==labels.join('|'))return null;
 return {body,bodyEnd:cut.index,notes,markers,detached:true};
}
export function inspectNativeNoteScope({proposal,wording,placement,nativeQuoted}) {
 const unknown=()=>({status:'unverified',reason:'oracle-native-note-scope-unavailable'});
 const fail=()=>({status:'failed',reason:'oracle-native-note-scope-mismatch'});
 if(wording.language!=='en'||proposal?.sourceKind!=='docx')return unknown();
 let native;try{native=nativeNoteRows(nativeQuoted?.proposalBuffer);}catch{return unknown();}
 const old=column(wording.originalText,wording.originalFormatting),next=column(wording.proposedText,wording.proposedFormatting);
 if(!old||!next||!next.detached||old.notes.length!==old.markers.length)return unknown();
 let sourceNotes=[],sourceText='';
 if(placement.operation==='insert'){if(old.body.trim()||old.notes.length)return fail();}
 else {
  const {span,splice}=placement;
  if(!span||!splice||splice.start.paragraph!==span.start||splice.end.paragraph!==span.end||splice.start.offset!==0)return fail();
  const rows=proposal.paragraphs.filter(row=>row.index>=span.start&&row.index<=span.end);
  if(!rows.length||rows[0].index!==span.start||rows.at(-1).index!==span.end||splice.end.offset!==rows.at(-1).text.length||rows.some(row=>!row.complete||row.source?.complete!==true))return fail();
  sourceText=rows.map(row=>row.text).join('\n');
  const raw=rows.map(row=>native.find(n=>n.path===row.source.path));
  if(raw.some((n,i)=>!n?.safe||compact(n.text)!==compact(rows[i].text)))return fail();
  const anchors=raw.flatMap((n,i)=>n.refs.map(ref=>({...ref,paragraph:rows[i].index})));
  const projected=(proposal.anchors||[]).filter(a=>a.paragraph>=span.start&&a.paragraph<=span.end);
  if(projected.length!==anchors.length||anchors.some(a=>!projected.some(p=>p.paragraph===a.paragraph&&p.offset===a.offset&&p.note===a.id&&p.label===a.label)))return fail();
  if(anchors.length!==old.notes.length)return fail();
  let clean='',cursor=0;const positions=[];
  for(const marker of old.markers){clean+=old.body.slice(cursor,marker.start);positions.push(compact(clean).length);cursor=marker.end;}
  clean+=old.body.slice(cursor);
  if(compact(sourceText)!==compact(clean))return fail();
  for(let i=0;i<anchors.length;i++){
   const anchor=anchors[i],note=anchor.note,row=rows.find(row=>row.index===anchor.paragraph);
   if(!note?.safe||anchor.label!==old.notes[i].label||compact(note.text)!==compact(old.notes[i].text))return fail();
   const prefix=rows.filter(row=>row.index<anchor.paragraph).map(row=>row.text).join('\n')+'\n'+row.text.slice(0,anchor.offset);
   if(compact(prefix).length!==positions[i])return fail();
   const projectedNote=proposal.notes?.find(n=>n.id===note.id);
   if(!projectedNote?.complete||compact(projectedNote.text)!==compact(note.text))return fail();
   sourceNotes.push({id:note.id,label:old.notes[i].label});
  }
 }
 const referenced=next.markers.map(mark=>next.body.slice(mark.start,mark.end).replace(/\.$/u,''));
 const unreferencedLabels=next.notes.filter(note=>!referenced.includes(note.label)).map(note=>note.label);
 for(const label of unreferencedLabels){const previous=old.notes.find(note=>note.label===label),retained=next.notes.find(note=>note.label===label);if(!previous||compact(previous.text)!==compact(retained.text)||!sourceNotes.some(note=>note.label===label))return fail();}
 const noteScope={kind:'word-footnotes',originalBodyEnd:old.bodyEnd,proposedBodyEnd:next.bodyEnd,sourceNotes,proposedLabels:next.notes.map(note=>note.label),unreferencedLabels};
 if(placement.noteScope&&Object.entries(noteScope).some(([key,value])=>JSON.stringify(placement.noteScope[key])!==JSON.stringify(value)))return fail();
 return {status:'verified',reason:'oracle-native-note-scope',bodyWording:{...wording,originalText:sourceText,originalFormatting:[],proposedText:next.body,proposedFormatting:(wording.proposedFormatting||[]).filter(mark=>mark.end<=next.body.length)},noteScope};
}
