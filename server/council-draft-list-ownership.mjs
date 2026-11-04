// A flat PDF tag tree does not own continuations. Prove one small native list
// from horizontal text geometry, with 0.5 point alignment tolerance. A rotated,
// nested, cross-page, annotated or incomplete frame supplies no such proof.
export function councilPdfLines(items) {
 const lines=[];
 for(const item of items){
  if(!item.str?.trim())continue;
  const t=item.transform;
  if(!Array.isArray(t)||t.length!==6||!t.every(Number.isFinite)||Math.abs(t[1])>.000001||Math.abs(t[2])>.000001||t[0]<=0||t[3]<=0||!Number.isSafeInteger(item.page))return null;
  const last=lines.at(-1);
  if(last&&last.page===item.page&&Math.abs(last.y-t[5])<=.5)last.items.push({text:item.str.trim(),x:t[4]});
  else {if(last&&(last.page!==item.page||t[5]>=last.y))return null;lines.push({page:item.page,y:t[5],items:[{text:item.str.trim(),x:t[4]}]});}
 }
 return lines.length?lines:null;
}
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.5;
const label=/^(?:\([\p{L}\p{N}]+\)|[\p{L}\p{N}]+[.)])(?:\s|$)/u;
export function councilPdfListOwnership(rows) {
 const proofs=[],paths=new Map();for(const row of rows)paths.set(row.source?.path,(paths.get(row.source?.path)??0)+1);
 for(let start=0;start<rows.length;start++){
  const lead=rows[start],m=/^(\d+)\.\s+.+:$/u.exec(lead.text);if(!m)continue;
  let end=start+1;const points=[];
  while(end<rows.length&&points.length<26&&rows[end].text.startsWith(String.fromCharCode(97+points.length)+') '))points.push(end++);
  if(points.length<2)continue;
  const continuations=[];
  while(end<rows.length&&end-start<64&&!label.test(rows[end].text)&&!rows[end].text.includes(':'))continuations.push(end++);
  if(!continuations.length||!/^\d+\.\s+\S/u.test(rows[end]?.text??''))continue;
  const frame=rows.slice(start,end+1),page=lead.source?.pages?.[0],mcid=lead.source?.mcids?.[0]?.mcid;
  if(frame.some((row,i)=>!row.complete||row.attached||!['/P','/LBody'].includes(row.source?.role)||row.source.pages?.length!==1||row.source.pages[0]!==page||row.source.mcids?.length!==1||row.source.mcids[0].page!==page||row.source.mcids[0].mcid!==mcid+i||!row.lines?.length||row.lines.some(l=>l.page!==page)))continue;
  if(new Set(frame.map(r=>r.source.path)).size!==frame.length||frame.some(r=>paths.get(r.source.path)!==1))continue;
  const a=lead.lines[0].items,body=a[1]?.x,outer=a[0]?.x,inner=rows[points[0]].lines[0].items[1]?.x;
  if(a[0]?.text!==m[1]+'.'||!Number.isFinite(body)||body-outer<10||body-outer>100||!Number.isFinite(inner)||inner-body<10||inner-body>100)continue;
  const aligned=(lines,x)=>lines.every(l=>near(l.items[0]?.x,x));
  if(!aligned(lead.lines.slice(1),body)||!near(rows[end].lines[0].items[0]?.x,outer)||!near(rows[end].lines[0].items[1]?.x,body))continue;
  if(points.some((at,i)=>{const lines=rows[at].lines,first=lines[0].items;return first[0]?.text!==String.fromCharCode(97+i)+')'||!near(first[0]?.x,body)||!near(first[1]?.x,inner)||!aligned(lines.slice(1),inner)||lines.slice(1).some(l=>label.test(l.items.map(i=>i.text).join(' ')));}))continue;
  if(continuations.some(at=>!aligned(rows[at].lines,body)||rows[at].lines.some(l=>label.test(l.items.map(i=>i.text).join(' ')))))continue;
  // All rows must advance physically as well as in persistent MCID order.
  if(frame.some((r,i)=>i&&r.lines[0].y>=frame[i-1].lines.at(-1).y))continue;
  proofs.push({start,end,points,continuations,bodyIndent:body,pointIndent:inner,basis:'native-pdf-list-lines',tolerance:.5});
 }
 return proofs;
}
