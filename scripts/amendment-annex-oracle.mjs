// Independent raw-source assertion for Annex I a after a sole unnumbered annex.
// Do not inspect parsed units, placement evidence, or production label helpers.
export function assertBareAnnexInsertion(items,wording,placement) {
  if(wording.language!=='en'||placement.operation!=='insert'||!/^Annex I\s*[a-z]{1,3} \(new\)$/u.test(wording.targetLabel||''))return null;
  const headings=[];
  for(const [itemIndex,item] of (items||[]).entries())for(const row of item.proposal?.paragraphs||[]) {
    if(/^Annexetitre$/iu.test(row.properties?.styleId||''))headings.push({itemIndex,row,proposal:item.proposal});
  }
  if(headings.length!==1||headings[0].row.text.split(/\r?\n/u)[0].trim()!=='ANNEX')return null;
  const {itemIndex,row,proposal}=headings[0],rows=proposal.paragraphs.filter(p=>p.index>=row.index);
  const unknown=()=>({status:'unverified',reason:'oracle-bare-annex-end-unverified'});
  if(proposal.sourceKind!=='docx'||!rows.length||proposal.gaps?.some(gap=>gap.paragraph>=row.index))return unknown();
  for(const [i,p] of rows.entries()) {
    const previous=rows[i-1];
    if(p.complete!==true||p.source?.complete!==true||p.source.container!=='body'||i&&(p.index!==previous.index+1||p.source.containerPath!==previous.source.containerPath||p.source.segment!==previous.source.segment||p.source.ordinal!==previous.source.ordinal+1))return unknown();
  }
  const before=rows.at(-1).index+1;
  return placement.itemIndex===itemIndex&&placement.insertAfter===before-1&&placement.insertBefore===before
    ?{status:'verified',reason:'oracle-sole-bare-annex-end'}:{status:'failed',reason:'oracle-bare-annex-boundary-mismatch'};
}
