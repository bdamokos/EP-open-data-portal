// The outer proposal label remains visible when the reader compares the inner
// existing-law replacement. Keep its published number; never renumber it.
export function proposalInsertionNote(wording,placement) {
 if(placement?.status!=='placed'||placement.outerOperation!=='insert'||wording?.baseline!=='present-text')return null;
 const raw=wording.targetPath?.proposal?.length===1?wording.targetPath.proposal[0].raw:wording.targetLabel?.split('\n')[0];
 const pattern=wording.language==='pl'?/^Artykuł \d+ – akapit 1 – punkt (\d+)\s*(a) – litera [a-z] \(nowa\)$/u:wording.language==='en'?/^Article \d+ – paragraph 1 – point (\d+)\s*(a) – point [a-z] \(new\)$/u:null;
 const match=pattern?.exec(raw??'');
 return match?{point:match[1]+match[2],base:match[1]}:null;
}
