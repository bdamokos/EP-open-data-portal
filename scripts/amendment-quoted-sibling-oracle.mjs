import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
// Native Word paragraphs establish ownership and boundaries; parsed units and
// placement evidence are deliberately ignored.
export function assertQuotedSibling({proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-quoted-sibling-unavailable'});
 if(wording.language!=='en'||placement.operation!=='insert'||!nativeQuoted)return unknown();
 const target=/^(Article \d+|Annex [IVX]+) – paragraph 1 – point (\d+)(?: [–-] point ([a-z]))?$/u.exec(wording.targetLabel.split('\n')[0]);
 if(!target)return unknown();
 let raw;try{raw=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
 const heading=raw.filter(r=>r.kind==='paragraph'&&r.text.trim().toLowerCase()===target[1].toLowerCase());
 if(heading.length!==1)return unknown();
 let rows=raw.slice(raw.indexOf(heading[0])+1);
 const end=rows.findIndex(r=>r.kind==='paragraph'&&/^(?:Article \d+|ANNEX [IVX]+)$/u.test(r.text.trim()));if(end>=0)rows=rows.slice(0,end);
 const owners=rows.filter(r=>r.kind==='paragraph'&&(r.text.startsWith('('+target[2]+')\t')||r.numberingLabel===target[2]+'.'));
 if(owners.length!==1)return unknown();
 rows=rows.slice(rows.indexOf(owners[0]));
 const next=rows.findIndex((r,i)=>i&&r.kind==='paragraph'&&r.text.startsWith('('+(Number(target[2])+1)+')\t'));if(next>=0)rows=rows.slice(0,next);
 if(target[3]){
  const parts=rows.filter(r=>r.kind==='paragraph'&&r.text.startsWith('('+target[3]+')\t')&&/\b(?:is|are)\b.+:$/u.test(r.text.trim()));
  if(parts.length!==1)return unknown();rows=rows.slice(rows.indexOf(parts[0]));
  const stop=rows.findIndex((r,i)=>i&&r.kind==='paragraph'&&/^\([a-z]\)\t/u.test(r.text));if(stop>=0)rows=rows.slice(0,stop);
 }
 const lead=rows[0],leadText=lead.text.replace(/\s+/gu,' ');
 if(lead.kind!=='paragraph'||/subparagraph/u.test(lead.text)||lead.unsafe||lead.hidden)return unknown();
 // Read the proposed subdivision, including explicit prose for ordinal insertion.
 const first=wording.proposedText.trim().split('\n')[0];
 const numeric=/^(\d+)\s*([a-z]+)\.\s/u.exec(first),letter=/^\(([a-z])\s+([a-z]+)\)\s/u.exec(first),clause=/^The following paragraph (\d+)\s*([a-z]+) is inserted:/u.exec(first);
 const wanted=numeric?numeric[1]+numeric[2]:letter?letter[1]+letter[2]:clause?clause[1]+clause[2]:first==='The following paragraph is inserted after the seventh paragraph:'?'7a':null;
 if(!wanted)return unknown();
 const quotes=[];let open=null;
 for(const r of rows.slice(1)){
  if(r.kind!=='paragraph'||r.unsafe||r.hidden)return unknown();
  if(/^[‘]/u.test(r.text.trim())){if(open)return unknown();open=[];}
  if(open)open.push(r);
  if(open&&/[’][;.]?\s*$/u.test(r.text)){quotes.push(open);open=null;}
 }
 if(open||!quotes.length)return unknown();
 const options=[];
 for(const q of quotes){
  for(let i=0;i<q.length;i++){
   const m=/^[‘]?([0-9]+[a-z]*|\([a-z]\))[.]?\s/u.exec(q[i].text.trim());if(!m)continue;
   const label=m[1].replace(/[()]/gu,'');
   if(wanted===label)return unknown();
   if(!wanted.startsWith(label)||!/^([a-z]+)$/u.test(wanted.slice(label.length)))continue;
   // Prove the instruction provides the whole paragraph, or a whole article/section.
   const named=/(?:paragraphs? | and |, )([\d]+[a-z]*)/gu;
   const names=[...leadText.matchAll(named)].map(m=>m[1]);
   const whole=/The following Article is inserted:/u.test(leadText)&&/^‘Article \d+[a-z]*$/u.test(q[0].text.trim())||/Article [\d]+[a-z]* is (?:inserted|replaced|added)|section [\d.]+ is replaced/u.test(leadText);
   if(!whole&&!names.includes(label))continue;
   let last=q.at(-1);
   const following=q.slice(i+1).find(r=>/^[0-9]+[a-z]*[.]\s/u.test(r.text.trim()));
   if(following)last=q[q.indexOf(following)-1];
   options.push({label,last});
  }
 }
 const max=Math.max(...options.map(o=>o.label.length)),chosen=options.filter(o=>o.label.length===max);
 if(chosen.length!==1)return unknown();
 const last=chosen[0].last,projected=proposal.paragraphs.filter(p=>p.source?.path===last.path&&p.text===last.text.trim());
 if(projected.length!==1)return unknown();
 const before=projected[0].index+1;
 return placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-whole-quoted-sibling'}:{status:'failed',reason:'oracle-native-quoted-sibling-boundary-mismatch',expectedBefore:before};
}
