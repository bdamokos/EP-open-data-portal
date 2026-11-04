// Independent Poppler evidence for one flat, colon-introduced lettered list.
// Tags alone do not establish where a final point's continuation ends.
// Geometry tolerance is 0.5 PDF point; no producer/parser/placer imports.
const compact=s=>String(s??'').normalize('NFC').replace(/\s/gu,'');
const clean=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const labelled=/^(?:\([\p{L}\p{N}]+\)|[\p{L}]{1,3}[.)]|[ivxlcdm]+[.)]|\d+[.)])\s+\S/iu;
export function nativeCouncilListSubparagraphs(raw,words,boundaryText) {
 if(typeof raw!=='string'||!Array.isArray(words)||!words.length||typeof boundaryText!=='string'||!/^\d+\.\s+\S/u.test(boundaryText))return null;
 const blocks=[];let start=0;
 for(const cut of [...raw.matchAll(/\n\s*\n/gu),{index:raw.length,0:''}]){
  const text=raw.slice(start,cut.index).trim();
  if(text)blocks.push({text:clean(text),offset:compact(raw.slice(0,start)).length,raw:text});
  start=cut.index+cut[0].length;
 }
 if(blocks.length<4||!/^\d+\.\s+[^:]+:$/u.test(blocks[0].text))return null;
 let end=1;
 while(end<blocks.length&&new RegExp('^'+String.fromCharCode(96+end)+'\\)\\s+\\S','u').test(blocks[end].text))end++;
 if(end<3||end>27||end===blocks.length)return null;
 if(blocks.some((b,i)=>b.raw.split(/\r?\n/u).some((line,j)=>labelled.test(line.trim())&&(j!==0||i>=end))))return null;
 const ordered=[];
 for(const page of [...new Set(words.map(w=>w.page))].sort((a,b)=>a-b)){
  const local=words.filter(w=>w.page===page&&!w.reference).sort((a,b)=>a.top-b.top||a.x-b.x),lines=[];
  for(const word of local){
   if(![word.x,word.right,word.top,word.bottom].every(Number.isFinite)||word.bottom<=word.top)return null;
   const line=lines.at(-1);if(line&&Math.abs(line.top-word.top)<=.5)line.words.push(word);else lines.push({top:word.top,words:[word]});
  }
  for(const line of lines)ordered.push(...line.words.sort((a,b)=>a.x-b.x));
 }
 const lengths=ordered.map(w=>compact(w.text).length),joined=ordered.map(w=>compact(w.text)).join(''),needle=compact(raw),boundary=compact(boundaryText),at=joined.indexOf(needle);
 if(!needle||at<0||joined.lastIndexOf(needle)!==at||!joined.startsWith(boundary,at+needle.length))return null;
 const starts=[];let position=0;for(const length of lengths){starts.push(position);position+=length;}
 starts.push(position);
 const first=starts.indexOf(at),last=starts.indexOf(at+needle.length),boundaryEnd=starts.indexOf(at+needle.length+boundary.length);
 if(first<0||last<0||boundaryEnd<=last)return null;
 const owned=ordered.slice(first,boundaryEnd);if(!owned.length||new Set(owned.map(w=>w.page)).size!==1)return null;
 const frame=blocks.map(block=>{
  const from=starts.indexOf(at+block.offset),to=starts.indexOf(at+block.offset+compact(block.text).length);
  if(from<first||to<0)return null;
  const lines=[];for(const word of ordered.slice(from,to)){const line=lines.at(-1);if(line&&Math.abs(line[0].top-word.top)<=.5)line.push(word);else lines.push([word]);}
  return lines;
 });
 if(frame.some(lines=>!lines?.length))return null;
 const lead=frame[0][0],body=lead[1]?.x,label=lead[0]?.x;
 if(!Number.isFinite(body)||body-label<10||body-label>100)return null;
 const aligned=(lines,x)=>lines.every(line=>Math.abs(line[0].x-x)<=.5);
 // The next numeric paragraph closes this parent. Include all its first native
 // block, rather than accepting an arbitrary word after the current unit.
 const closing=[];for(const word of ordered.slice(last,boundaryEnd)){const line=closing.at(-1);if(line&&Math.abs(line[0].top-word.top)<=.5)line.push(word);else closing.push([word]);}
 const head=closing[0],number=/^(\d+)\./u.exec(boundaryText)[0];
 if(head[0]?.text!==number||Math.abs(head[0].x-label)>.5||!head[1]||Math.abs(head[1].x-body)>.5||!aligned(closing.slice(1),body)||head[0].top<=frame.at(-1).at(-1)[0].top+.5)return null;
 if(!aligned(frame[0].slice(1),body))return null;
 let inner;
 for(let i=1;i<end;i++){
  const lines=frame[i],firstLine=lines[0];
  if(firstLine[0].text!==String.fromCharCode(96+i)+')'||Math.abs(firstLine[0].x-body)>.5||!firstLine[1])return null;
  inner??=firstLine[1].x;
  if(inner-body<10||inner-body>100||Math.abs(firstLine[1].x-inner)>.5||!aligned(lines.slice(1),inner))return null;
 }
 // Every continuation line must visibly outdent from the point body to the
 // numbered paragraph's body. A child continuation at the inner indent fails.
 if(frame.slice(end).some(lines=>!aligned(lines,body)))return null;
 return [{text:blocks.slice(0,end).map(b=>b.text).join('\n\n'),offset:blocks[0].offset},...blocks.slice(end).map(({text,offset})=>({text,offset}))];
}
