import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
import {oracleAddress} from './amendment-oracle-grammar.mjs';

const normal=value=>String(value??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const key=path=>JSON.stringify(path.map(p=>[p.kind,p.value,p.isNew]));
const readable=row=>row.kind==='paragraph'&&!row.hidden&&!row.unsafe&&!row.numbered;
const empty=row=>readable(row)&&!row.text.trim()&&row.nodes.every(node=>Object.keys(node).every(k=>k===':@'||k==='w:pPr'));

// Independent bounded reader for a quoted paragraph list inside an amending
// instruction. Native XML establishes the article, act, instruction and whole
// quote; projection rows supply coordinates only. No placer units/evidence.
function quotedFrame(input) {
  const {wording,placement,nativeQuoted}=input,proposal=input.items?.[placement.itemIndex]?.proposal;
  const outer=oracleAddress(wording.targetLabel?.split('\n')[0]??'','en');
  if(wording.language!=='en'||wording.baseline!=='commission-proposal'||wording.originalText!==''||placement.operation!=='insert'
    ||outer?.length!==3||outer[0].kind!=='article'||outer[1].kind!=='paragraph'||outer[1].value!=='1'||outer[2].kind!=='point'
    ||outer.some(p=>p.isNew)||!Array.isArray(proposal?.paragraphs)||!Buffer.isBuffer(nativeQuoted?.proposalBuffer))return null;
  const hash=createHash('sha256').update(nativeQuoted.proposalBuffer).digest('hex');
  if(proposal.sourceHash!==hash)return null;
  let body,comparison;
  try {body=quotedWordBody(nativeQuoted.proposalBuffer);comparison=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return null;}
  if(!comparison||comparison.language!=='{EN}en'||comparison.outer+'\n'+comparison.act+' — '+comparison.inner!==wording.targetLabel
    ||normal(comparison.original)!==normal(wording.originalText)||normal(comparison.proposed)!==normal(wording.proposedText))return null;
  if(!/^(?:Directive|Regulation|Decision) (?:\((?:EU|EC|EEC)\) )?(?:No )?\d{1,4}\/\d{1,4}(?:\/(?:EU|EC|EEC))?$/u.test(comparison.act))return null;
  const heads=body.filter(row=>readable(row)&&normal(row.text)==='Article '+outer[0].value);
  if(heads.length!==1)return null;
  const start=body.indexOf(heads[0]),end=body.findIndex((row,i)=>i>start&&row.kind==='paragraph'&&/^Article \d+[a-z]*$/u.test(normal(row.text)));
  if(end<0)return null;
  const article=body.slice(start+1,end),lead=article.filter(row=>readable(row)&&normal(row.text)===comparison.act+' is amended as follows:');
  if(lead.length!==1)return null;
  const prefix=article.slice(0,article.indexOf(lead[0]));
  if(prefix.length>1||prefix.some(row=>!readable(row)||normal(row.text)!=='Amendments to '+comparison.act))return null;
  // Follow consecutive outer instructions, never a number inside a quotation.
  const instructions=article.filter(row=>row.kind==='paragraph'&&/^\(\d+\)\s/u.test(row.text.trim()));
  if(!instructions.length||instructions.some((row,i)=>!readable(row)||!row.text.trim().startsWith('('+String(i+1)+')'))
    ||article.indexOf(instructions[0])!==article.indexOf(lead[0])+1)return null;
  const owner=instructions.find(row=>row.text.trim().startsWith('('+outer[2].value+')'));
  const match=owner&&/^\(\d+\)\s+in Article (\d+[a-z]*), the following paragraphs (\d+[a-z]*(?:(?:, | and )\d+[a-z]*)+) are inserted after paragraph \d+[a-z]*:$/u.exec(normal(owner.text));
  if(!match)return null;
  const names=match[2].split(/, | and /u);
  if(new Set(names).size!==names.length)return null;
  const next=instructions[instructions.indexOf(owner)+1],stop=next?article.indexOf(next):article.length;
  let quote=article.slice(article.indexOf(owner)+1,stop);
  while(quote.length&&empty(quote[0]))quote.shift();
  while(quote.length&&empty(quote.at(-1)))quote.pop();
  if(!quote.length||quote.some(row=>!readable(row))||!quote[0].text.trim().startsWith('‘')||!/[.]’[;.]?$/u.test(quote.at(-1).text.trim()))return null;
  const all=quote.map(row=>row.text).join('\n');
  if(all.split('‘').length!==2||all.split('’').length!==2)return null;
  const printed=quote.flatMap((row,i)=>{const m=/^‘?(\d+[a-z]*)[.]\s/u.exec(row.text.trim());return m?[{name:m[1],at:i}]:[];});
  if(printed[0]?.at!==0||printed.map(p=>p.name).join('|')!==names.join('|'))return null;
  const mapped=new Map();
  for(const row of [lead[0],owner,...quote]) {
    const matches=proposal.paragraphs.filter(p=>p.source?.path===row.path&&p.complete===true&&p.source.complete===true&&normal(p.text)===normal(row.text));
    if(matches.length!==1||proposal.paragraphs[matches[0].index]!==matches[0])return null;
    mapped.set(row,matches[0].index);
  }
  const indices=[...mapped.values()];if(indices.some((n,i)=>i&&n!==indices[i-1]+1))return null;
  return {article:match[1],quote,printed,mapped,comparison,hash};
}

// Resolve only when every rejected address is demonstrably absent from this
// complete frame, exactly one distinct address fits, and independent editions
// or the working edition plus native column labels support it.
export function assertEditionFrameFit(input,entries) {
  const unknown={status:'unverified',reason:'oracle-edition-frame-fit-unavailable'};
  const frame=quotedFrame(input);if(!frame)return unknown;
  const byAddress=new Map();
  for(const entry of entries) {
    const path=entry.path;
    if(!/^[a-z]{2}$/u.test(entry.language??'')||path?.length!==3||path[0].kind!=='article'||path[1].kind!=='paragraph'||path[2].kind!=='subparagraph'
      ||path[0].isNew||path[1].isNew||!path[2].isNew||!/^\d+$/u.test(path[2].base)||!/^[a-z]+$/u.test(path[2].suffix))return unknown;
    const k=key(path);if(!byAddress.has(k))byAddress.set(k,{path,languages:new Set()});
    byAddress.get(k).languages.add(entry.language);
  }
  const fits=[];
  for(const address of byAddress.values()) {
    const [article,parent,sub]=address.path,at=frame.printed.findIndex(p=>p.name===parent.value);
    if(article.value!==frame.article||at<0)continue;
    const start=frame.printed[at].at,end=frame.printed[at+1]?.at??frame.quote.length,block=frame.quote.slice(start,end);
    // Footnote scaffolding or explicit child labels cannot prove anonymous
    // subparagraph ordinals. Their presence is unknown, not target absence.
    if(block.some(row=>/^(?:[_*]|\(?[a-z0-9]+\)|Article\b)/u.test(row.text.trim().replace(/^‘/u,''))))return unknown;
    const n=Number(sub.base);if(n<1||n>block.length)continue;
    const before=frame.quote[end]??null,after=block[n-1],following=block[n]??before;
    if(!following)return unknown;
    fits.push({...address,after:frame.mapped.get(after),before:frame.mapped.get(following)});
  }
  if(fits.length!==1)return unknown;
  const fitting=fits[0],working=entries[0];
  const columnLabel=oracleAddress(frame.comparison.proposed.split('\n')[0],'en');
  const columnSupport=key(working.path)===key(fitting.path)&&columnLabel&&key(columnLabel)===key(fitting.path);
  if(fitting.languages.size<2&&!columnSupport)return unknown;
  const assertion={basis:'unique-native-edition-frame-fit',path:fitting.path.map(p=>({kind:p.kind,value:p.value})),languages:[...fitting.languages],nativeColumnSupport:Boolean(columnSupport),proposalSha256:frame.hash};
  return input.placement.insertAfter===fitting.after&&input.placement.insertBefore===fitting.before
    ?{status:'verified',reason:'oracle-native-edition-frame-fit',assertion}
    :{status:'failed',reason:'oracle-edition-frame-boundary-mismatch',assertion};
}
