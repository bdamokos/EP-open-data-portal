const literal=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const strip=s=>literal(s).replace(/^\d+\.\s+/u,'');
// The source's printed labels remain untouched. Only a repeated, otherwise
// consecutive run can establish the report's ordinal paragraph address.
export function sequentialParagraphPlacement(proposal,parent,target,{originalText,proposedText,operation,itemIndex=0,quoted=false}={}) {
 const [article,label,sub]=target.segments;
 if(target.segments.length<2||target.segments.length>3||article.kind!=='article'||label.kind!=='paragraph'||!Number.isSafeInteger(label.number)||sub&& (sub.kind!=='subparagraph'||sub.suffix||sub.isNew))return null;
 let peers=parent.children.filter(u=>u.kind!=='title');
 if(proposal.sourceKind==='docx'){
  const printed=proposal.paragraphs.slice(parent.extent.start+1,parent.extent.end).filter(r=>/^\d+\.\s/u.test(r.text));
  peers=printed.map((r,i)=>{const number=Number(/^\d+/u.exec(r.text)[0]);return {kind:'paragraph',label:{number,value:String(number),suffix:''},extent:{start:r.index,end:printed[i+1]?.index??parent.extent.end}};});
 }
 const numbers=peers.map(u=>u.label?.number);
 if(peers.length<3||peers.length>64||numbers[0]!==1||new Set(numbers).size===numbers.length||peers.some((u,i)=>u.kind!=='paragraph'||u.label.suffix||String(numbers[i])!==u.label.value||!Number.isSafeInteger(numbers[i])||numbers[i]<1||i&&(numbers[i]<numbers[i-1]||numbers[i]>numbers[i-1]+1||peers[i-1].extent.end!==u.extent.start)))return null;
 const selected=peers[label.number-1];if(!selected||selected.label.number===label.number)return null;
 const rows=proposal.paragraphs.slice(selected.extent.start,selected.extent.end);
 if(!rows.length||rows.some(r=>!r.complete||r.source?.complete!==true||r.objects?.length||r.properties?.notesComplete===false||(proposal.anchors??[]).some(a=>a.paragraph===r.index)||(proposal.links??[]).some(a=>a.paragraph===r.index)))return null;
 const evidence=[{basis:'sequential-paragraph-number',reference:String(label.number),label:selected.label.value}];
 if(operation==='insert'){
  if(sub||label.suffix!=='a'||originalText.trim()||!new RegExp('^'+label.value+'\\.\\s+\\S','u').test(proposedText.trim()))return null;
  const row=rows.at(-1),next=peers[label.number];
  if(next)return {status:'placed',operation,itemIndex,insertAfter:row.index,insertBefore:row.index+1,evidence};
  if(!quoted)return null;
  const closing=/[“’»«"][.;]?\s*$/u.exec(row.text);
  if(!closing||row.index+1!==parent.extent.end)return null;
  const cursor={paragraph:row.index,offset:closing.index};
  return {status:'placed',operation,itemIndex,insertAfter:row.index,insertBefore:row.index+1,splice:{start:cursor,end:{...cursor}},evidence};
 }
 if(!['replace','delete'].includes(operation)||label.suffix)return null;
 const chosen=sub?rows.slice(sub.number-1,sub.number):rows;
 if(!chosen.length||sub&&rows.some((r,i)=>i&&/^(?:\d+[.)]|[a-z]\))\s/u.test(r.text)))return null;
 const text=chosen.map(r=>r.text).join('\n'),original=strip(originalText);
 if(!original||strip(text)!==original||proposal.paragraphs.map(r=>strip(r.text)).join(' ').split(original).length!==2)return null;
 return {status:'placed',operation,itemIndex,span:{start:chosen[0].index,end:chosen.at(-1).index},splice:{start:{paragraph:chosen[0].index,offset:0},end:{paragraph:chosen.at(-1).index,offset:chosen.at(-1).text.length}},originalText:text,evidence};
}
