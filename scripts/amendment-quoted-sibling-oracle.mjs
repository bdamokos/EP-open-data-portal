import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
// Native Word paragraphs establish ownership and boundaries; parsed units and
// placement evidence are deliberately ignored.
export function assertQuotedSibling({proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-quoted-sibling-unavailable'});
 if(wording.language!=='en'||placement.operation!=='insert'||!nativeQuoted)return unknown();
 const target=/^(Article \d+|Annex [IVX]+) – paragraph 1 – point (\d+)(?: [–-] point ([a-z]))?$/u.exec(wording.targetLabel.split('\n')[0]);
 if(!target)return unknown();
 const inner=wording.targetPath?.underlying;
 if(inner?.some(ref=>/^Article \d+\s*[a-z]* \(new\)/u.test(ref.raw)))return unknown();
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
   // A quoted provision's asterisk note (rule, then '*' rows) closes the
   // quotation; a new sibling follows the provision's text, before its note.
   else{const rule=q.findIndex((r,at)=>at>i&&/^_{3,}$/u.test(r.text.trim()));if(rule>i&&q.slice(rule+1).length&&q.slice(rule+1).every(r=>/^\*/u.test(r.text.trim())))last=q[rule-1];}
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

// Finnish whole-paragraph replacements can receive a printed suffixed sibling
// even when the amendment's inner address omits the word "new".
export function assertFinnishQuotedSibling({proposal,wording,placement,nativeQuoted}){
 const outer=/^(\d+) artikla – 1 kohta – (\d+) alakohta – ([a-z]) alakohta$/u.exec(wording.targetLabel?.split('\n')[0]??''),refs=wording.targetPath?.underlying??[];
 const inner=refs.length===1&&/^(\d+) artikla – (\d+) a kohta$/u.exec(refs[0].raw??'');
 const printed=/^(\d+)\s*a[.]\s/u.exec(wording.proposedText??'');
 if(wording.language!=='fi'||wording.originalText!==''||placement.operation!=='insert'||!outer||!inner||!printed||printed[1]!==inner[2])return null;
 if(refs[0].document&&refs[0].document!==refs[0].raw)return null;
 let body;try{body=quotedWordBody(nativeQuoted?.proposalBuffer);}catch{return null;}
 const clean=s=>s.replace(/\s+/gu,' ').trim();
 const style=row=>row.nodes?.flatMap(node=>node['w:pPr']??[]).find(node=>node['w:pStyle'])?.[':@']?.['@_w:val'];
 const adoption=body.filter(row=>row.kind==='paragraph'&&!row.hidden&&!row.unsafe&&clean(row.text)==='OVAT HYVÄKSYNEET TÄMÄN ASETUKSEN:');
 const headings=body.filter(row=>row.kind==='paragraph'&&style(row)==='Titrearticle'&&clean(row.text)===outer[1]+' artikla');if(headings.length!==1||headings[0].hidden||headings[0].unsafe||adoption.length!==1||body.indexOf(adoption[0])>=body.indexOf(headings[0]))return null;
 let rows=body.slice(body.indexOf(headings[0])+1),end=rows.findIndex(row=>row.kind==='paragraph'&&/^\d+ artikla$/u.test(clean(row.text)));if(end>=0)rows=rows.slice(0,end);
 if(rows.some(row=>row.kind==='paragraph'&&/^(?:Manual)?NumPar1$/iu.test(style(row)??'')))return null;
 const parents=rows.filter(row=>row.kind==='paragraph'&&style(row)==='Point0'&&clean(row.text)==='('+outer[2]+') Muutetaan '+inner[1]+' artikla seuraavasti:');if(parents.length!==1||parents[0].hidden||parents[0].unsafe)return null;
 rows=rows.slice(rows.indexOf(parents[0])+1);end=rows.findIndex(row=>row.kind==='paragraph'&&/^\(\d+\)\s/u.test(row.text.trim()));if(end>=0)rows=rows.slice(0,end);
 const owners=rows.filter(row=>row.kind==='paragraph'&&style(row)==='Point1'&&clean(row.text)==='('+outer[3]+') korvataan '+inner[2]+' kohta seuraavasti:');if(owners.length!==1||owners[0].hidden||owners[0].unsafe)return null;
 rows=rows.slice(rows.indexOf(owners[0])+1);end=rows.findIndex(row=>row.kind==='paragraph'&&/^\([a-z]\)\s/u.test(row.text.trim()));if(end<0)return null;
 const quote=rows.slice(0,end),following=rows[end];
 if(quote.length!==1||quote[0].hidden||quote[0].unsafe||quote[0].numbered||!new RegExp('^”'+inner[2]+'[.]\\s[\\s\\S]+”$','u').test(quote[0].text.trim())||following.hidden||following.unsafe)return null;
 const map=row=>proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text.trim()&&p.complete&&p.source.complete&&p.source.container==='body');
 const a=map(quote[0]),b=map(following);if(a.length!==1||b.length!==1||b[0].index!==a[0].index+1)return null;
 return placement.insertAfter===a[0].index&&placement.insertBefore===b[0].index?{status:'verified',reason:'oracle-native-finnish-quoted-sibling'}:{status:'failed',reason:'oracle-finnish-quoted-sibling-mismatch'};
}
