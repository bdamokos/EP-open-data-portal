import {parseTargetLabel,proposalCandidates} from './proposal-structure.mjs';
const clean=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
// Prove only the initial gap, not the complete parent or its later quotations.
// The existing insertion resolver still owns selection and emitted coordinates.
export function councilOuterInstructionPrefix(items,target,{language,baseline,targetPath,targetLabel,originalText,proposedText}) {
 if(language!=='es'||baseline!=='council-position'||targetPath?.language!==language||items?.length!==1||originalText.trim()||target.segments.length!==3)return null;
 const [article,paragraph,point]=target.segments,refs=targetPath.underlying;
 if(clean(String(targetLabel??'').split('\n')[0])!==clean(targetPath.proposal?.[0]?.raw))return null;
 if(article.kind!=='article'||article.value!=='1'||paragraph.kind!=='paragraph'||paragraph.value!=='1'||point.kind!=='point'||point.value!=='-1'||!point.negative||refs?.length!==1)return null;
 const act=/^Directiva \(UE\) (\d{4}\/\d+)$/u.exec(clean(refs[0].document)),introduced=/^-1\) Se añade el considerando siguiente: «\((\d+)\s*(bis|[a-z])\) [^«»]+»\.$/u.exec(clean(proposedText));
 let inner;try{inner=parseTargetLabel(refs[0].raw,language);}catch{return null;}
 if(!act||!introduced||!inner.complete||inner.segments.length!==1||inner.segments[0].kind!=='recital'||!inner.segments[0].isNew||inner.segments[0].value!==introduced[1]+introduced[2])return null;
 const proposal=items[0].proposal;
 if(items[0].kind!=='act'||proposal?.sourceKind!=='pdf'||proposal.language!==language||!/^[0-9a-f]{64}$/u.test(proposal.nativeSourceHash??'')||proposalCandidates(proposal,target.segments).length)return null;
 const parents=proposalCandidates(proposal,target.segments.slice(0,2)),articles=proposalCandidates(proposal,target.segments.slice(0,1));
 if(parents.length!==1||articles.length!==1)return null;
 const parent=parents[0],owner=articles[0],siblings=parent.children.filter(u=>u.kind==='point'&&u.scope==='proposal').sort((a,b)=>a.extent.start-b.extent.start),first=siblings[0];
 if(parent.pathConflict||!parent.implicit||!parent.instruction||!owner.children.includes(parent)||!first||first.label?.value!=='1'||first.pathConflict||!first.complete||!first.instruction)return null;
 const start=first.extent.start,rows=proposal.paragraphs.slice(start-3,start+1);
 if(rows.length!==4||owner.extent.start!==start-2||parent.extent.start!==start-1||clean(rows[0].text)!=='HA ADOPTADO LA PRESENTE DIRECTIVA:'||clean(rows[1].text)!=='Artículo 1'||clean(rows[2].text)!=='La Directiva (UE) '+act[1]+' se modifica como sigue:'||!/^1\) [^«»]+:$/u.test(clean(rows[3].text))||rows[1].properties?.headingBasis!=='native-first-line')return null;
 if(rows.some(row=>!row.complete||row.source?.complete!==true||row.source.role!=='/P'||row.source.pages?.length!==1||row.source.mcids?.length!==1||row.properties?.annotationsComplete!==true||row.properties?.notesComplete!==true||row.objects.length))return null;
 const page=rows[0].source.pages[0],mcid=rows[0].source.mcids[0].mcid;
 if(!Number.isSafeInteger(page)||page<1||mcid!==0||proposal.paragraphs.find(p=>p.source?.pages?.includes(page))!==rows[0])return null;
 if(rows.some((row,i)=>row.source.pages[0]!==page||row.source.mcids[0].page!==page||row.source.mcids[0].mcid!==mcid+i||proposal.paragraphs.filter(p=>p.source?.path===row.source.path).length!==1)||(proposal.anchors??[]).some(a=>a.paragraph>=start-3&&a.paragraph<=start)||(proposal.links??[]).some(l=>l.paragraph>=start-3&&l.paragraph<=start))return null;
 return {parent,first,itemIndex:0};
}
