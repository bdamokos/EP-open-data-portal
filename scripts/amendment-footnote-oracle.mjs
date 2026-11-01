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
  let clean='',cursor=0;const offsets=[];
  for(const mark of marks){
    if(mark.start<cursor||mark.end<=mark.start||!/^\d+$/u.test(body.slice(mark.start,mark.end)))return fail();
    clean+=body.slice(cursor,mark.start);offsets.push(noSpace(clean).length);cursor=mark.end;
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
    if(!line||line[1]!==body.slice(marks[i].start,marks[i].end)||!note?.complete||noSpace(line[2])!==noSpace(note.text)||noSpace(prefix).length!==offsets[i])return fail();
  }
  return {status:'verified',reason:'oracle-native-footnotes-and-positions'};
}
