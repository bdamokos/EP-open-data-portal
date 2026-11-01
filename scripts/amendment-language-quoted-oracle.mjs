import {createHash} from 'node:crypto';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';

// A final paragraph in an explicitly replaced whole article is bounded by the
// next outer instruction, even when the publication omits the closing quote.
// Read native XML only; production target paths, units and evidence are ignored.
export function languageQuotedSibling({expected,proposal,placement,nativeQuoted}) {
  const unknown=()=>({status:'unverified',reason:'raw-whole-article-unavailable'});
  if(expected?.language!=='en'||expected.sectionKind!=='commission-proposal'||expected.operation!=='insert'||placement?.status!=='placed'||placement.operation!=='insert'||!nativeQuoted)return unknown();
  let source;
  try{source=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
  // expected is the independent Python XML comparison, never runtime wording.
  if(expected.gap||expected.originalText!==''||!expected.proposedText)return unknown();
  const amendment={outer:expected.targetLabel,act:expected.underlyingSection,inner:expected.underlyingTargetLabel,proposed:expected.proposedText};
  const outer=/^Article ([1-9]\d*) – paragraph 1 – point ([1-9]\d*)$/u.exec(amendment.outer);
  const inner=/^Article ([1-9]\d*) – paragraph ([1-9]\d*) ?a \(new\)$/u.exec(amendment.inner||'');
  const act=/^Regulation \(EU\)(?: No)? (\d{4}\/\d+)$/u.exec(amendment.act||'');
  if(!outer||!inner||!act||!new RegExp('^'+inner[2]+'a\\.\\s*\\S','u').test(amendment.proposed))return unknown();
  const headings=source.filter(r=>r.kind==='paragraph'&&r.text.trim()===`Article ${outer[1]}\nAmendments to ${amendment.act}`);
  if(headings.length!==1)return unknown();
  const start=source.indexOf(headings[0]),end=source.findIndex((r,i)=>i>start&&r.kind==='paragraph'&&r.nodes.some(node=>node['w:pPr']?.some(prop=>prop['w:pStyle']&&prop[':@']?.['@_w:val']==='Titrearticle')));
  const article=source.slice(start+1,end<0?undefined:end);
  if(article[0]?.text.trim()!==`Regulation (EU) ${act[1]} is amended as follows:`)return unknown();
  const owners=article.filter(r=>r.kind==='paragraph'&&r.text.trim().startsWith(`(${outer[2]}) `));
  if(owners.length!==1)return unknown();
  const owner=owners[0],instruction=/^\(\d+\) Articles ([1-9]\d*) and ([1-9]\d*) are replaced by the following:$/u.exec(owner.text.trim());
  if(!instruction||instruction[2]!==inner[1])return unknown();
  const tail=article.slice(article.indexOf(owner)+1),next=tail.findIndex(r=>r.kind==='paragraph'&&/^\(\d+\)\s/u.test(r.text.trim()));
  if(next<0||!tail[next].text.trim().startsWith(`(${Number(outer[2])+1}) `))return unknown();
  const block=tail.slice(0,next),rows=block.filter(r=>r.text.trim());
  if([headings[0],article[0],owner,...block,tail[next]].some(r=>r.kind!=='paragraph'||r.unsafe||r.hidden||r.numbered))return unknown();
  if(!new RegExp('^[“‘]Article '+instruction[1]+'[a-z]?$','u').test(rows[0]?.text.trim()||''))return unknown();
  const innerHeadings=rows.filter(r=>/^Article \d+$/u.test(r.text.trim()));
  if(innerHeadings.length!==1||innerHeadings[0].text.trim()!==`Article ${inner[1]}`)return unknown();
  const content=rows.slice(rows.indexOf(innerHeadings[0])+1),paragraphs=content.filter(r=>/^\d+\.\s/u.test(r.text.trim()));
  if(paragraphs.length!==Number(inner[2])||paragraphs.some((r,i)=>!r.text.trim().startsWith(`${i+1}.`)))return unknown();
  const last=content.at(-1);
  // This grammar covers single native rows for each paragraph. Continuations,
  // subordinate lists and any material after the numbered paragraphs stay out.
  if(content.length!==paragraphs.length+1||content[0]===paragraphs[0]||last!==paragraphs.at(-1)||!/[.]$/u.test(last.text.trim()))return unknown();
  const mapped=[];
  for(const native of [owner,...rows,tail[next]]) {
    const matches=proposal.paragraphs.filter(p=>p.source?.path===native.path&&p.text.replace(/\s+/gu,' ').trim()===native.text.replace(/\s+/gu,' ').trim());
    if(matches.length!==1||proposal.paragraphs[matches[0].index]!==matches[0])return unknown();
    mapped.push(matches[0]);
  }
  if(mapped.some((p,i)=>i&&p.index!==mapped[i-1].index+1))return unknown();
  const before=mapped.at(-1).index;
  const assertion={owner:owner.path,article:innerHeadings[0].path,predecessor:last.path,following:tail[next].path,expectedBefore:before,proposalSha256:createHash('sha256').update(nativeQuoted.proposalBuffer).digest('hex'),amendmentSha256:createHash('sha256').update(nativeQuoted.amendmentBuffer).digest('hex')};
  return placement.insertBefore===before&&placement.insertAfter===before-1
    ?{status:'verified',reason:'raw-native-whole-article-sibling',assertion,location:{section:'commission-proposal',kind:'paragraph',value:`article:${outer[1]}/point:${outer[2]}/article:${inner[1]}/paragraph:${inner[2]}a`,scope:'proposal'}}
    :{status:'failed',reason:'raw-native-whole-article-boundary-mismatch',assertion};
}
