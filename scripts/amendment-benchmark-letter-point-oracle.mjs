import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';

const unknown=reason=>({status:'unverified',reason});
const failed=reason=>({status:'failed',reason});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Read literal native fields and printed body rows. Production units, target
// parsers and placement evidence never establish the legal address or boundary.
export function rawLetterPointAssertion({proposal,wording,placement,nativeQuoted}) {
  if(wording?.language!=='en'||wording.baseline!=='commission-proposal'||placement?.status!=='placed'||placement.operation!=='insert'||!Array.isArray(proposal?.paragraphs)||!nativeQuoted||!Number.isSafeInteger(nativeQuoted.number))return unknown('oracle-letter-point-input-unavailable');
  if(!/ – point [a-z] [a-z] \(new\)$/u.test(wording.targetLabel??''))return unknown('oracle-letter-point-address-unavailable');
  let amendment,source;
  try{
    amendment=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);
  }catch{return unknown('oracle-letter-point-native-unavailable');}
  if(!amendment||amendment.language!=='{EN}en'||amendment.original!==''||wording.originalText!==''||amendment.proposed!==wording.proposedText||amendment.outer+'\n'+amendment.act+' — '+amendment.inner!==wording.targetLabel)return unknown('oracle-letter-point-comparison-unavailable');
  const outer=/^Article ([1-9]\d*) – paragraph 1 – point ([1-9]\d*)$/u.exec(amendment.outer??'');
  const inner=/^Article ([1-9]\d*) ?([a-z]?) – paragraph ([1-9]\d*) – point ([a-z]) ([a-z]) \(new\)$/u.exec(amendment.inner??'');
  if(!outer||!inner||!/^Regulation \(EU\) \d{4}\/\d+$/u.test(amendment.act??'')||!amendment.proposed.startsWith(`(${inner[4]} ${inner[5]})\t`))return unknown('oracle-letter-point-address-unavailable');
  try{source=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown('oracle-letter-point-native-unavailable');}
  const headings=source.filter(row=>row.kind==='paragraph'&&row.text.trim()==='Article '+outer[1]);
  if(headings.length!==1)return unknown('oracle-letter-point-owner-ambiguous');
  const start=source.indexOf(headings[0]),next=source.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&/^Article [1-9]\d*$/u.test(row.text.trim()));
  const article=source.slice(start+1,next<0?undefined:next);
  const leads=article.filter(row=>row.kind==='paragraph'&&row.text.trim()===amendment.act+' is amended as follows:');
  if(leads.length!==1)return unknown('oracle-letter-point-act-unavailable');
  const lead=leads[0],prefix=article.slice(0,article.indexOf(lead));
  if(prefix.length>1||prefix.some(row=>row.kind!=='paragraph'||row.text.trim()!=='Amendments to '+amendment.act))return unknown('oracle-letter-point-outer-paragraph-unavailable');
  const number=inner[1]+inner[2];
  const owners=article.filter(row=>row.kind==='paragraph'&&new RegExp(`^\\(${outer[2]}\\)\\tthe following Article ${number} is inserted in Chapter [IVXLCDM]+:$`,'u').test(row.text));
  if(owners.length!==1||article.indexOf(owners[0])<=article.indexOf(lead))return unknown('oracle-letter-point-owner-ambiguous');
  const owner=owners[0],after=article.slice(article.indexOf(owner)+1),end=after.findIndex(row=>row.kind==='paragraph'&&/^\([1-9]\d*\)\s/u.test(row.text));
  if(end<0)return unknown('oracle-letter-point-owner-incomplete');
  const quote=after.slice(0,end);
  if(quote[0]?.text!=='‘Article '+number||quote.some(row=>row.kind!=='paragraph'||row.unsafe||row.hidden)||[headings[0],lead,owner].some(row=>row.unsafe||row.hidden))return unknown('oracle-letter-point-owner-incomplete');
  const starts=quote.filter(row=>new RegExp(`^${inner[3]}\\.\\s+`,'u').test(row.text));
  if(starts.length!==1||!/:\s*$/u.test(starts[0].text))return unknown('oracle-letter-point-paragraph-unavailable');
  const intro=starts[0],tail=quote.slice(quote.indexOf(intro)+1),followingParagraph=tail.findIndex(row=>/^\d+\.\s/u.test(row.text));
  if(followingParagraph<0)return unknown('oracle-letter-point-paragraph-unavailable');
  const points=tail.slice(0,followingParagraph),labels=points.map(row=>/^\(([a-z])\)\s+\S/u.exec(row.text)?.[1]);
  if(!points.length||labels.some((letter,index)=>letter!==String.fromCharCode(97+index)))return unknown('oracle-letter-point-list-unavailable');
  const at=labels.indexOf(inner[4]);
  if(at<0||at+1>=points.length)return unknown('oracle-letter-point-sibling-unavailable');
  // The next printed numeric paragraph bounds this list even when the Word
  // publication omits a closing quote later in the inserted article.
  const nativeRows=[owner,...quote.slice(0,quote.indexOf(tail[followingParagraph])+1)],mapped=[];
  for(const raw of [lead,...nativeRows]){
    const matches=proposal.paragraphs.filter(row=>row.source?.path===raw.path&&row.text===raw.text.trim());
    if(matches.length!==1||proposal.paragraphs.indexOf(matches[0])!==matches[0].index)return failed('oracle-letter-point-native-row-mismatch');
    if(raw!==lead)mapped.push(matches[0]);
  }
  if(mapped.some((row,index)=>index&&row.index!==mapped[index-1].index+1))return failed('oracle-letter-point-native-row-mismatch');
  const following=points[at+1],before=mapped[nativeRows.indexOf(following)].index;
  const assertion={rawOuterTarget:amendment.outer,rawInnerTarget:amendment.inner,namedAct:amendment.act,nativeOwner:owner.path,nativeParagraph:intro.path,nativePredecessor:points[at].path,nativeFollowing:following.path,nativeNextParagraph:tail[followingParagraph].path,expectedBefore:before,proposalSha256:hash(nativeQuoted.proposalBuffer),amendmentSha256:hash(nativeQuoted.amendmentBuffer)};
  if(placement.insertBefore!==before||placement.insertAfter!==before-1)return {...failed('oracle-letter-point-boundary-mismatch'),assertion};
  return {status:'verified',reason:'oracle-native-letter-point-boundary',assertion};
}
