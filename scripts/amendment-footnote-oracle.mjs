// Independent assertion over native source anchors and note payloads. No placer imports.
export function assertFootnoteComparison(proposal,wording,placement) {
  const cut=/\n_{5,}\s*\n/u.exec(wording.originalText);
  if(!cut)return null;
  // Asterisk notes printed in the legal body are literal comparison text,
  // rather than detached Word notes. The caller still compares their full text.
  const span=placement.span??{start:placement.splice?.start.paragraph,end:placement.splice?.end.paragraph};
  const printed=proposal.paragraphs.filter(p=>p.index>=span.start&&p.index<=span.end).map(p=>p.text).join('\n');
  if(/\n_{5,}\s*\n/u.test(printed))return null;
  const noSpace=s=>s.normalize('NFC').replace(/\s/gu,'');
  const body=wording.originalText.slice(0,cut.index),payload=wording.originalText.slice(cut.index+cut[0].length).trim().split(/\n+/u);
  const marks=(wording.originalFormatting??[]).filter(f=>f.kind==='superscript'&&f.end<=body.length).sort((a,b)=>a.start-b.start);
  const fail=()=>({status:'failed',reason:'oracle-footnote-comparison-mismatch'});
  if(!marks.length||marks.length!==payload.length)return fail();
  let clean='',cursor=0;const offsets=[],labels=[];
  for(const mark of marks){
    if(mark.start<cursor||mark.end<=mark.start)return fail();
    const printed=body.slice(mark.start,mark.end),digits=/\d+$/u.exec(printed)?.[0],ordinal=digits?printed.slice(0,-digits.length):printed;
    if(!digits||ordinal&&(!['st','nd','rd','th'].includes(ordinal)||!/[0-9]$/u.test(body.slice(0,mark.start))))return fail();
    // Word can coalesce an ordinal's superscript letters with the note number.
    // Only the numeric suffix is a note; preserve the ordinal in the body proof.
    clean+=body.slice(cursor,mark.end-digits.length);offsets.push(noSpace(clean).length);labels.push(digits);cursor=mark.end;
  }
  clean+=body.slice(cursor);
  const {splice}=placement;
  if(!splice||splice.start.offset!==0)return fail();
  const rows=proposal.paragraphs.filter(p=>p.index>=splice.start.paragraph&&p.index<=splice.end.paragraph);
  if(!rows.length||splice.end.offset!==rows.at(-1).text.length||rows.some(p=>!p.complete||p.source?.complete!==true))return fail();
  const source=rows.map(p=>p.text).join('\n');
  if(noSpace(source)!==noSpace(clean))return fail();
  const anchors=(proposal.anchors??[]).filter(a=>a.paragraph>=rows[0].index&&a.paragraph<=rows.at(-1).index);
  if(anchors.length!==marks.length)return fail();
  for(let i=0;i<marks.length;i++){
    const a=anchors[i],row=rows.find(p=>p.index===a.paragraph),note=proposal.notes?.find(n=>n.id===a.note);
    const line=/^(\d+)\s+([\s\S]+)$/u.exec(payload[i]);
    const prefix=rows.filter(p=>p.index<a.paragraph).map(p=>p.text).join('\n')+'\n'+row.text.slice(0,a.offset);
    if(!line||line[1]!==labels[i]||!note?.complete||noSpace(line[2])!==noSpace(note.text)||noSpace(prefix).length!==offsets[i])return fail();
  }
  return {status:'verified',reason:'oracle-native-footnotes-and-positions'};
}

// The same assertion for a resolution body: compare the cleaned amendment body,
// each superscript's position and its payload with the source text's own notes.
// A custom mark can print its label twice in the amendment payload.
export function assertResolutionFootnotes(text,wording,placement) {
  let cut=/\n_{5,}\s*\n/u.exec(wording.originalText??'');
  if(!cut){const lines=(wording.originalText??'').split('\n');let index=0;for(const line of lines){if(index>0&&/^\s*[1-9]\d*\.\s+\S/u.test(line)){cut=Object.assign(['\n'],{index:index-1});break;}index+=line.length+1;}}
  if(!cut||!placement.span||!Array.isArray(text?.paragraphs))return null;
  const {start,end}=placement.span,rows=text.paragraphs.slice(start,end+1);
  if(/\n_{5,}\s*\n/u.test(rows.join('\n')))return null;
  const noSpace=s=>s.normalize('NFC').replace(/\s/gu,'');
  const fail=()=>({status:'failed',reason:'oracle-footnote-comparison-mismatch'});
  const body=wording.originalText.slice(0,cut.index),payload=wording.originalText.slice(cut.index+cut[0].length).split(/\n+/u).filter(line=>line.trim());
  const marks=(wording.originalFormatting??[]).filter(f=>f.kind==='superscript'&&f.end<=body.length).sort((a,b)=>a.start-b.start);
  if(text.notesStatus!=='extracted'||!marks.length||marks.length!==payload.length)return fail();
  let clean='',cursor=0;const offsets=[];
  for(const mark of marks){
    if(mark.start<cursor||mark.end<=mark.start||!/^\d+$/u.test(body.slice(mark.start,mark.end)))return fail();
    clean+=body.slice(cursor,mark.start);offsets.push(noSpace(clean).length);cursor=mark.end;
  }
  clean+=body.slice(cursor);
  if(!rows.length||(text.paragraphSources??[]).slice(start,end+1).some(source=>source?.complete!==true))return fail();
  if(noSpace(rows.join('\n'))!==noSpace(clean))return fail();
  const anchors=(text.noteAnchors??[]).filter(a=>a.paragraph>=start&&a.paragraph<=end).sort((a,b)=>a.paragraph-b.paragraph||a.offset-b.offset);
  if(anchors.length!==marks.length)return fail();
  for(let i=0;i<marks.length;i++){
    const a=anchors[i],note=text.notes?.find(n=>n.id===a.note),digits=body.slice(marks[i].start,marks[i].end);
    const line=/^\s*(\d+)\.?\s+([\s\S]+)$/u.exec(payload[i]);
    const prefix=text.paragraphs.slice(start,a.paragraph).join('\n')+'\n'+text.paragraphs[a.paragraph].slice(0,a.offset);
    const repeated=line&&line[2].startsWith(line[1])&&/^\s/u.test(line[2].slice(line[1].length))?line[2].slice(line[1].length):null;
    if(!line||line[1]!==digits||typeof note?.text!=='string'||!note.text.trim()
      ||![line[2],repeated].some(value=>value!==null&&noSpace(value)===noSpace(note.text))||noSpace(prefix).length!==offsets[i])return fail();
  }
  return {status:'verified',reason:'oracle-resolution-footnotes-and-positions'};
}
