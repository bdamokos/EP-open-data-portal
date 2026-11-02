// Printed instruction boundaries and named act, independently of parsed units.
export function assertElidedDeletion(proposal,wording,placement){
 const unknown=()=>({status:'unverified',reason:'oracle-elided-instruction-unavailable'});
 const outer=/^Article (\d+) – paragraph 1 – point (\d+)$/u.exec(wording.targetPath?.proposal?.[0]?.raw??'');
 const ref=wording.targetPath?.underlying;
 if(!outer||ref?.length!==1||!/^Article \d+$/u.test(ref[0].raw))return unknown();
 const rows=proposal.paragraphs,headings=rows.filter(p=>p.text.trim()==='Article '+outer[1]);
 if(headings.length!==1)return unknown();
 const heading=headings[0],end=rows.find(p=>p.index>heading.index&&/^Article \d+$/u.test(p.text.trim()));
 const section=rows.filter(p=>p.index>heading.index&&p.index<(end?.index??Infinity));
 const leads=section.filter(p=>p.text.trim()===ref[0].document.replace(/^Regulation (?=\d)/u,'Regulation (EU) ')+' is amended as follows:');
 const owners=section.filter(p=>p.text.trim()===`(${outer[2]})\t${ref[0].raw} is amended as follows:`);
 if(leads.length!==1||owners.length!==1)return unknown();
 const owner=owners[0],next=section.find(p=>p.index>owner.index&&p.properties?.styleId===owner.properties?.styleId&&p.text.startsWith(`(${Number(outer[2])+1})\t`));
 if(!next)return unknown();
 const body=rows.slice(owner.index,next.index);
 if(body.some((p,i)=>!p.complete||p.source?.complete!==true||p.source.container!=='body'||i&&(p.source.ordinal!==body[i-1].source.ordinal+1||p.source.segment!==body[i-1].source.segment)))return unknown();
 const sp=placement.splice;
 return sp?.start.paragraph===owner.index&&sp.start.offset===0&&sp.end.paragraph===next.index-1&&sp.end.offset===body.at(-1).text.length?{status:'verified',reason:'oracle-printed-elided-instruction-boundary'}:{status:'failed',reason:'oracle-elided-instruction-boundary-mismatch'};
}
