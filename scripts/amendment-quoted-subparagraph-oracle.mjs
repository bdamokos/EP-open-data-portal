import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
// Native Word rows only: an instruction replacing "the Nth subparagraph" of
// Article X(Y) quotes that whole subparagraph. A new point or subparagraph
// addressed inside it is located from the printed labels of the quoted rows.
const ORDINALS=['first','second','third','fourth','fifth','sixth'];
const pointToken=segment=>{
 const value=segment.replace(/^point\s+/u,'').replace(/\s*\(?new\)?$/u,'').trim();
 const pair=/^\(?([a-z]+)\)?\s*\(([a-z]+)\)$/u.exec(value);
 return pair?[pair[1],pair[2]]:[value.replace(/[()\s]/gu,'')];
};
export function assertQuotedSubparagraph({proposal,wording,placement,nativeQuoted}){
 const unknown=()=>({status:'unverified',reason:'oracle-quoted-subparagraph-unavailable'});
 if(wording.language!=='en'||placement.operation!=='insert'||!nativeQuoted||!proposal)return unknown();
 const owner=/^Article (\d+) – paragraph 1 – point (\d+)$/u.exec(wording.targetLabel.split('\n')[0]);
 const lines=wording.targetLabel.split('\n');
 const inner=wording.targetPath?.underlying?.length?wording.targetPath.underlying:lines.length===3&&/^(?:Regulation|Directive|Decision) \(EU\) \d{4}\/\d+$/u.test(lines[1])?[{document:lines[1],raw:lines[2]}]:[];
 if(!owner||inner?.length!==1)return unknown();
 const parts=inner[0].raw.split(/\s+[–-]\s+/u);
 const article=/^Article (\d+[a-z]*)$/u.exec(parts[0]??''),paragraph=/^paragraph (\d+)$/u.exec(parts[1]??'');
 const sub=/^(?:subparagraph (\d+)|([a-z]+) subparagraph)(\s*\(new\))?$/u.exec(parts[2]??'');
 if(!article||!paragraph||!sub)return unknown();
 const subNumber=sub[1]?Number(sub[1]):ORDINALS.indexOf(sub[2])+1;
 const tokens=parts.slice(3).flatMap(pointToken);
 if(!subNumber||parts.slice(3).some(segment=>!/^point\s/u.test(segment)))return unknown();
 let raw;try{raw=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
 const paragraphs=raw.filter(row=>row.kind==='paragraph');
 const heading=paragraphs.filter(row=>row.text.trim()==='Article '+owner[1]);
 if(heading.length!==1)return unknown();
 let rows=paragraphs.slice(paragraphs.indexOf(heading[0])+1);
 const stop=rows.findIndex(row=>/^Article \d+$/u.test(row.text.trim()));if(stop>=0)rows=rows.slice(0,stop);
 const starts=rows.filter(row=>row.text.startsWith('('+owner[2]+')\t'));
 if(starts.length!==1)return unknown();
 const instruction=/^\(\d+\)\tin Article (\d+[a-z]*)\((\d+)\), the ([a-z]+) subparagraph is replaced by the following:$/u.exec(starts[0].text.trim());
 if(!instruction||instruction[1]!==article[1]||instruction[2]!==paragraph[1])return unknown();
 const replaced=ORDINALS.indexOf(instruction[3])+1;
 rows=rows.slice(rows.indexOf(starts[0])+1);
 if(!rows.length||!rows[0].text.trim().startsWith('‘'))return unknown();
 const close=rows.findIndex(row=>/’[;.]?\s*$/u.test(row.text));
 if(close<0)return unknown();
 const quote=rows.slice(0,close+1);
 if(quote.some(row=>row.unsafe||row.hidden))return unknown();
 let target;
 if(!tokens.length){
  if(!sub[3]||subNumber!==replaced+1)return unknown();
  target={after:quote.at(-1)};
 } else {
  if(subNumber!==replaced||sub[3])return unknown();
  const label=tokens.at(-1),parents=tokens.slice(0,-1),suffix=/^([a-z]+?)([a-z])$/u.exec(label);
  if(parents.length>1||!suffix||/^[ivxl]+$/u.test(label))return unknown();
  const opens=value=>row=>row.text.trim().replace(/^‘/u,'').startsWith('('+value+')');
  const letterBlock=letter=>{
   const at=quote.findIndex(opens(letter));
   if(at<0||quote.filter(opens(letter)).length!==1)return null;
   const next=quote.findIndex(opens(String.fromCharCode(letter.charCodeAt(0)+1)));
   return {start:at,end:next>at?next:quote.length};
  };
  if(!parents.length){
   if(!/^[a-z]$/u.test(suffix[1]))return unknown();
   const block=letterBlock(suffix[1]);
   if(!block||quote.some(opens(label)))return unknown();
   target=block.end<quote.length?{before:quote[block.end]}:{after:quote.at(-1)};
  } else {
   if(!/^[a-z]$/u.test(parents[0])||!/^[ivxl]+$/u.test(suffix[1]))return unknown();
   const block=letterBlock(parents[0]);
   if(!block)return unknown();
   const inside=quote.slice(block.start+1,block.end),roman=row=>/^\([ivxl]+[a-z]?\)/u.test(row.text.trim());
   const bases=inside.filter(opens(suffix[1]));
   if(bases.length!==1)return unknown();
   const family=inside.some(row=>new RegExp('^\\('+suffix[1]+'[a-z]\\)','u').test(row.text.trim()));
   if(family&&(!/\(new\)\s*$/u.test(parts.at(-1))||!wording.proposedText?.trim().replace(/^\(([^)]+)\)/u,(_,value)=>'('+value.replace(/\s/gu,'')+')').startsWith('('+label+')')))return unknown();
   const next=inside.slice(inside.indexOf(bases[0])+1).find(roman);
   target=next?{before:next}:block.end<quote.length?{before:quote[block.end]}:{after:quote.at(-1)};
  }
 }
 const row=target.before??target.after;
 const projected=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text.trim());
 if(projected.length!==1)return unknown();
 const before=projected[0].index+(target.after?1:0);
 return placement.insertBefore===before&&placement.insertAfter===before-1
  ?{status:'verified',reason:'oracle-native-quoted-subparagraph'}:{status:'failed',reason:'oracle-native-quoted-subparagraph-mismatch',expectedBefore:before};
}

// New anonymous subparagraph Na is an ordinal within its quoted paragraph;
// a sibling paragraph bearing the same digits is outside that address.
export function assertNewQuotedOrdinal({proposal,wording,placement,nativeQuoted}){
 const unknown=()=>null;
 const refs=wording.targetPath?.underlying??[],outer=/^Article (\d+) – paragraph 1 – point (\d+)$/u.exec(wording.targetLabel?.split('\n')[0]??'');
 const inner=refs.length===1&&/^Article (\d+)\s*([a-z]*) – paragraph (\d+)\s*([a-z]*) – subparagraph (\d+)\s*([a-z]+) \(new\)$/u.exec(refs[0].raw??'');
 if(wording.language!=='en'||wording.originalText!==''||placement.operation!=='insert'||!inner||!outer||!refs[0].document||!wording.proposedText?.trim()||/^\d+[a-z]*[.)]\s/u.test(wording.proposedText.trim()))return unknown();
 let body;try{body=quotedWordBody(nativeQuoted?.proposalBuffer);}catch{return unknown();}
 const heading=body.filter(row=>row.kind==='paragraph'&&row.text.trim()==='Article '+outer[1]);if(heading.length!==1)return unknown();
 let rows=body.slice(body.indexOf(heading[0])+1),end=rows.findIndex(row=>row.kind==='paragraph'&&/^Article \d+$/u.test(row.text.trim()));if(end>=0)rows=rows.slice(0,end);
 const instructions=rows.filter(row=>row.kind==='paragraph'&&new RegExp('^\\('+outer[2]+'\\)\\s+in Article '+inner[1]+inner[2]+', the following paragraphs (.+) are inserted after paragraph \\d+:$','u').test(row.text.trim()));
 if(instructions.length!==1||instructions[0].hidden||instructions[0].unsafe)return unknown();
 const act=rows.slice(0,rows.indexOf(instructions[0])).filter(row=>row.kind==='paragraph'&&/^(?:Directive|Regulation|Decision) .+ is amended as follows:$/u.test(row.text.trim())).at(-1);
 if(!act||act.hidden||act.unsafe||act.text.trim()!==refs[0].document+' is amended as follows:')return unknown();
 const parent=inner[3]+inner[4],names=/the following paragraphs (.+) are inserted/u.exec(instructions[0].text)?.[1].split(/,\s*| and /u);
 if(!names?.includes(parent))return unknown();
 rows=rows.slice(rows.indexOf(instructions[0])+1);
 const ownerEnd=rows.findIndex(row=>row.kind==='paragraph'&&/^\(\d+\)\s/u.test(row.text.trim()));if(ownerEnd>=0)rows=rows.slice(0,ownerEnd);
 const empty=row=>row.kind==='paragraph'&&!row.hidden&&!row.unsafe&&!row.numbered&&!row.text.trim()&&row.nodes.every(node=>Object.keys(node).every(key=>key===':@'||key==='w:pPr'));
 while(rows.length&&empty(rows[0]))rows=rows.slice(1);
 if(!rows.length||rows[0].kind!=='paragraph'||!rows[0].text.trim().startsWith('‘'))return unknown();
 const closes=rows.flatMap((row,i)=>row.kind==='paragraph'&&/’[;.]?\s*$/u.test(row.text)?[i]:[]);
 if(closes.length!==1||rows.slice(closes[0]+1).some(row=>!empty(row)))return unknown();
 rows=rows.slice(0,closes[0]+1);
 if(rows.some(row=>row.kind!=='paragraph'||row.hidden||row.unsafe||row.numbered)||rows.slice(1).some(row=>row.text.trim().startsWith('‘')))return unknown();
 const printed=rows.flatMap(row=>/^[‘]?(\d+[a-z]*)[.]\s/u.exec(row.text.trim())?.[1]??[]);
 if(printed.join('|')!==names.join('|'))return unknown();
 const starts=rows.flatMap((row,i)=>row.kind==='paragraph'&&new RegExp('^[‘]?'+parent+'[.]\\s','u').test(row.text.trim())?[i]:[]);if(starts.length!==1)return unknown();
 const from=starts[0],until=rows.findIndex((row,i)=>i>from&&row.kind==='paragraph'&&/^\d+[a-z]*[.]\s/u.test(row.text.trim()));if(until<0)return unknown();
 const block=rows.slice(from,until),ordinal=Number(inner[5]);if(ordinal<1||ordinal>block.length||block.some(row=>row.kind!=='paragraph'||row.hidden||row.unsafe||row.numbered||!row.text.trim()))return unknown();
 const selected=block[ordinal-1],next=rows[rows.indexOf(selected)+1];
 const map=row=>proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.text===row.text.trim()&&p.complete&&p.source.complete&&p.source.container==='body');
 const a=map(selected),b=map(next);if(a.length!==1||b.length!==1||b[0].index!==a[0].index+1)return unknown();
 return placement.insertAfter===a[0].index&&placement.insertBefore===b[0].index?{status:'verified',reason:'oracle-native-quoted-ordinal'}:{status:'failed',reason:'oracle-quoted-ordinal-mismatch'};
}
