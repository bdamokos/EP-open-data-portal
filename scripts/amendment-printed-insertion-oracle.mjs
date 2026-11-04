import {createHash} from 'node:crypto';
import {quotedWordBody,quotedWordComparison} from './amendment-benchmark-quoted-oracle.mjs';
import {safe} from './amendment-native-table-oracle.mjs';
const fold=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const hasOuter=nodes=>nodes.some(node=>node['w:pStyle']&&['Point0','Titrearticle'].includes(node[':@']?.['@_w:val'])||Object.values(node).some(value=>Array.isArray(value)&&hasOuter(value)));
const style=row=>row.nodes.find?.(node=>node['w:pPr'])?.['w:pPr'].find(node=>node['w:pStyle'])?.[':@']?.['@_w:val'];
// A printed new Na instruction can disagree with its outer N label. Establish
// the full N subtree from native Word paragraphs, independently of placer units.
export function assertPrintedInsertion({items,wording,placement,nativeQuoted}) {
 const outer=(wording.targetPath?.proposal?.[0]?.raw??wording.targetLabel??'').split('\n')[0];
 const label=/^Article ([1-9]\d*) – paragraph 1 – point ([1-9]\d*)$/u.exec(outer);
 const printed=/^\(([1-9]\d*)a\) in Article [1-9]\d*, the following paragraph is inserted:\n\S/u.exec(wording.proposedText??'');
 if(wording.language!=='en'||wording.baseline!=='commission-proposal'||wording.originalText!==''||!label||!printed||label[2]!==printed[1])return null;
 const unknown=()=>({status:'unverified',reason:'oracle-printed-insertion-unavailable'});
 if(placement.operation!=='insert'||wording.targetPath?.proposal?.length>1)return unknown();
 let comparison;try{comparison=quotedWordComparison(quotedWordBody(nativeQuoted.amendmentBuffer),nativeQuoted.number);}catch{return unknown();}
 if(!comparison||comparison.outer!==outer||comparison.original!==''||fold(comparison.proposed)!==fold(wording.proposedText)||[comparison.outer,comparison.act+' — '+comparison.inner].join('\n')!==wording.targetLabel)return unknown();
 const found=[];
 for(const [itemIndex,item] of (items??[]).entries()){
  const proposal=item.proposal,buffer=nativeQuoted?.proposalBuffers?.[itemIndex]??(itemIndex===placement.itemIndex?nativeQuoted?.proposalBuffer:null);
  if(item.kind==='annex'||proposal.sourceKind!=='docx'||!buffer||createHash('sha256').update(buffer).digest('hex')!==proposal.sourceHash)continue;
  let body;try{body=quotedWordBody(buffer);}catch{continue;}
  const heads=body.flatMap((row,index)=>row.kind==='paragraph'&&style(row)==='Titrearticle'&&row.text.trim()===`Article ${label[1]}`?[index]:[]);
  if(heads.length!==1)continue;
  const start=heads[0],end=body.findIndex((row,index)=>index>start&&row.kind==='paragraph'&&style(row)==='Titrearticle'&&/^Article \d+$/u.test(row.text.trim()));
  if(end<0)continue;
  const scoped=body.slice(start,end+1);
  // Opaque blocks cannot conceal another outer instruction or article.
  if(scoped.some(row=>row.kind!=='paragraph'&&hasOuter([row.nodes])))continue;
  const points=scoped.filter(row=>style(row)==='Point0');
  if(!points.length||!points.every((row,index)=>new RegExp('^\\('+String(index+1)+'\\)\\s','u').test(row.text)))continue;
  const first=scoped.indexOf(points[0]),lead=scoped[first-1];
  if(![2,3].includes(first)||!/is amended as follows:$/u.test(lead?.text.trim()??''))continue;
  const anchor=points[Number(label[2])-1],next=points[Number(label[2])]??body[end];
  if(!anchor||scoped.some(row=>row.kind==='paragraph'&&new RegExp('^\\('+printed[1]+'a\\)\\s','u').test(row.text)))continue;
  const boundary=scoped.slice(scoped.indexOf(anchor),scoped.indexOf(next)+1);
  if([body[start],...points,...boundary].some(row=>row.kind!=='paragraph'||row.hidden||row.numbered||!safe(row.nodes)))continue;
  const rows=boundary.filter(row=>row.text.trim()),mapped=rows.map(native=>proposal.paragraphs.filter(row=>row.source?.path===native.path&&fold(row.text)===fold(native.text)&&row.complete&&row.source.complete===true));
  if(mapped.some(matches=>matches.length!==1)||mapped.some((matches,index)=>index&&matches[0].index!==mapped[index-1][0].index+1))continue;
  const before=proposal.paragraphs.find(row=>row.source.path===next.path)?.index;
  if(!Number.isInteger(before))continue;
  found.push({itemIndex,before,nativeAnchor:anchor.path,nativeFollowing:next.path});
 }
 if(found.length!==1)return unknown();
 const proof=found[0];
 return placement.itemIndex===proof.itemIndex&&placement.insertBefore===proof.before&&placement.insertAfter===proof.before-1
  ?{status:'verified',reason:'oracle-printed-insertion-native-boundary',assertion:proof}
  :{status:'failed',reason:'oracle-printed-insertion-boundary-mismatch',assertion:proof};
}
