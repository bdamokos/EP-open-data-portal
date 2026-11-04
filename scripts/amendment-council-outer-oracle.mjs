// Independent native evidence for a new instruction before the first existing
// instruction. No producer, parser, label parser or placement imports.
const literal=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const compact=s=>literal(s).replace(/\s/gu,'');
const unknown=()=>({status:'unverified',reason:'oracle-council-pdf-outer-start-unproved'});
const failed=()=>({status:'failed',reason:'oracle-council-pdf-outer-start-mismatch'});
export function inspectCouncilOuterInsertion({geometry,structure,placement,wording,items}) {
 if(items?.length!==1||items[0]?.kind!=='act'||placement.itemIndex!==0)return unknown();
 const outer=wording.targetPath?.proposal,refs=wording.targetPath?.underlying;
 if(wording.language!=='es'||wording.targetPath?.language!=='es'||outer?.length!==1||refs?.length!==1||wording.originalText?.trim()||placement.operation!=='insert')return unknown();
 if(literal(String(wording.targetLabel??'').split('\n')[0])!==literal(outer[0].raw))return unknown();
 const target=/^Artículo\s+(\d+)\s*[–—]\s*párrafo\s+1\s*[–—]\s*punto\s+-1$/u.exec(literal(outer[0].raw));
 const recital=/^Considerando\s+(\d+)\s*(bis|[a-z])\s*\(nuevo\)$/u.exec(literal(refs[0].raw)),act=/^Directiva\s+\(UE\)\s+(\d{4}\/\d+)$/u.exec(literal(refs[0].document));
 const proposed=/^-1\)\s+Se añade el considerando siguiente:\s*«\((\d+)\s*(bis|[a-z])\)\s+([^«»]+)»\.$/u.exec(literal(wording.proposedText));
 if(!target||!recital||!act||!proposed||recital[1]!==proposed[1]||recital[2]!==proposed[2]||!geometry?.words?.length||!Array.isArray(structure))return unknown();
 const proposal=items?.[placement.itemIndex]?.proposal,rows=proposal?.paragraphs,before=placement.insertBefore,after=placement.insertAfter;
 if(proposal?.sourceKind!=='pdf'||!Array.isArray(rows)||!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before!==after+1||after<2||before>=rows.length||placement.splice||placement.span)return failed();
 const frame=rows.slice(after-2,before+1),expected=['HA ADOPTADO LA PRESENTE DIRECTIVA:','Artículo '+target[1],'La Directiva (UE) '+act[1]+' se modifica como sigue:'];
 if(frame.length!==4||expected.some((text,index)=>literal(frame[index].text)!==text)||!/^1\)\s+[^«»]+:$/u.test(literal(frame[3].text)))return failed();
 if(frame.some(row=>!row.complete||row.source?.complete!==true||row.source.role!=='/P'||row.source.pages?.length!==1))return failed();
 const page=frame[0].source.pages[0];if(frame.some(row=>row.source.pages[0]!==page))return unknown();
 const native=structure.filter(p=>!p.note&&p.mcids.length),indices=frame.map(row=>native.findIndex(p=>p.ref===row.source.path));
 if(indices[0]!==native.findIndex(p=>p.pages.includes(page))||frame[0].source.mcids?.[0]?.mcid!==0)return failed();
 if(indices[0]<0||indices.some((index,i)=>index!==indices[0]+i||JSON.stringify(native[index].pages)!==JSON.stringify([page])||JSON.stringify(native[index].mcids)!==JSON.stringify(frame[i].source.mcids)))return failed();
 // Native P identities keep the actual cursor in source order, even if an
 // otherwise identical text prefix is copied elsewhere in the projection.
 const allPaths=rows.map(row=>row.source?.path),paths=allPaths.slice(0,before+1),pathSet=new Set(paths),known=new Set(native.map(p=>p.ref));
 // Later unsupported paragraphs do not make this already bounded prefix
 // complete or incomplete. Only identities through the actual cursor count.
 if(new Set(allPaths).size!==allPaths.length||paths.some(ref=>!known.has(ref))||JSON.stringify(native.filter(p=>pathSet.has(p.ref)).map(p=>p.ref))!==JSON.stringify(paths))return failed();
 const printed=geometry.words.filter(w=>w.page===page&&!w.reference).map(w=>w.text).join(' '),text=frame.map(row=>row.text).join(' '),needle=compact(text),actual=compact(printed),at=actual.indexOf(needle);
 if(!needle||at!==0||actual.lastIndexOf(needle)!==at)return failed();
 // No earlier peer instruction on the prefix page may be overlooked.
 const tokens=geometry.words.filter(w=>w.page===page),first=tokens.findIndex(w=>w.text==='1)');
 if(first<0||tokens.slice(0,first).some(w=>/^-?\d+\)$/u.test(w.text)))return unknown();
 return {status:'verified',reason:'native-council-pdf-first-outer-instruction-boundary'};
}
