// Independent assertion on the published two-row chapter heading, without
// using the placement tree, target parser or matching normaliser.
export function assertChapterTitle({proposal,wording,placement}) {
  const unknown=()=>({status:'unverified',reason:'oracle-chapter-heading-unavailable'});
  const target=wording?.language==='en'&&/^Chapter ([IVXLCDM]+)\s+[–—-]\s+title$/u.exec(wording.targetLabel||'');
  if(!target||!Array.isArray(proposal?.paragraphs))return unknown();
  const number=target[1],rows=proposal.paragraphs;
  const headings=rows.filter(p=>p.text.trim()==='CHAPTER '+number&&p.properties?.styleId==='ChapterTitle');
  if(headings.length!==1)return unknown();
  const head=headings[0],title=rows.find(p=>p.index===head.index+1),following=rows.find(p=>p.index===head.index+2);
  if(!title||title.properties?.styleId!=='ChapterTitle'||!following||following.properties?.styleId!=='Titrearticle'||!/^Article \d+[a-z]*$/u.test(following.text.trim()))return unknown();
  const prefix=rows.filter(p=>p.index<head.index),adoption=prefix.findLastIndex(p=>/^HAVE ADOPTED THIS (?:REGULATION|DIRECTIVE|DECISION):$/u.test(p.text.trim()));
  if(adoption<0||prefix.slice(adoption+1).some(p=>/^\s*['‘“«"]/u.test(p.text)||/:\s*['‘“«"]/u.test(p.text)||/\b(?:is|are) (?:amended|replaced|inserted)\b/u.test(p.text)))return unknown();
  const selected=[head,title,following];
  if(selected.some((p,i)=>!p.complete||p.source?.complete!==true||p.source.container!=='body'||!Number.isSafeInteger(p.source.ordinal)||i&&(p.source.ordinal!==selected[i-1].source.ordinal+1||p.source.segment!==selected[i-1].source.segment||p.source.containerPath!==selected[i-1].source.containerPath)))return unknown();
  const fold=s=>s.replace(/\s+/gu,' ').trim();
  if(fold(wording.originalText)!==number+' '+fold(title.text)||!new RegExp('^'+number+'\\s+\\S','u').test(wording.proposedText||''))return unknown();
  const offset=/^(\s*CHAPTER\s+)/u.exec(head.text)?.[1].length,s=placement?.splice;
  if(placement?.status!=='placed'||placement.operation!=='replace'||placement.span?.start!==head.index||placement.span?.end!==title.index||s?.start.paragraph!==head.index||s.start.offset!==offset||s?.end.paragraph!==title.index||s.end.offset!==title.text.length)return {status:'failed',reason:'oracle-chapter-heading-span-mismatch'};
  return {status:'verified',reason:'oracle-native-chapter-title',rawSourceRows:[head.index,title.index,following.index]};
}
