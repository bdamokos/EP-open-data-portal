// A point-only address can omit the article while inserting a printed Na.
// Resolve it only within a complete, explicitly named multi-article quotation.
export function pointArticleParagraphInsertion({unit:owner,proposal,itemIndex},{targetLabel,originalText,proposedText,language,baseline}) {
 if(baseline!=='commission-proposal'||!['fi','en'].includes(language)||proposal.language!==language||originalText!==''||owner.kind!=='point'||owner.scope!=='proposal')return null;
 const normal=s=>s.replace(/\s+/gu,' ').trim(),labels=targetLabel.split(/\n| — /u).map(normal);
 if(labels.some(label=>label!==labels[0])||owner.path.length!==3||owner.path[0].kind!=='article'||owner.path[1].kind!=='paragraph'||owner.path[1].value!=='1')return null;
 const printed=/^(\d+)\s*a\.\s+\S/u.exec(proposedText);if(!printed)return null;
 const raw=normal(owner.instruction?.raw??'');
 const instruction=(language==='fi'?/^\(\d+\) Lisätään (.+) artikla seuraavasti:$/u:/^\(\d+\) the following Articles (.+) are inserted:$/u).exec(raw);
 if(!instruction)return null;
 const names=instruction[1].split(/,\s*| ja | and /u).map(s=>s.replace(/\s/gu,''));if(names.length<2||new Set(names).size!==names.length||names.some(s=>!/^\d+[a-z]*$/u.test(s)))return null;
 if(proposal.gaps.some(g=>g.paragraph>=owner.extent.start&&g.paragraph<owner.extent.end&&g.code!=='duplicate-label'))return null;
 const rows=proposal.paragraphs.slice(owner.extent.start+1,owner.extent.end),next=proposal.paragraphs[owner.extent.end];
 if(!rows.length||!next||!new RegExp('^\\('+(Number(owner.label.value)+1)+'\\)\\s','u').test(next.text))return null;
 const all=[proposal.paragraphs[owner.extent.start],...rows,next];
 if(all.some((p,i)=>!p.complete||p.source?.complete!==true||p.source.container!=='body'||p.objects.length||(proposal.anchors??[]).some(a=>a.paragraph===p.index)||i&&(p.source.containerPath!==all[i-1].source.containerPath||p.source.segment!==all[i-1].source.segment||p.source.ordinal!==all[i-1].source.ordinal+1)))return null;
 const headings=rows.flatMap((p,i)=>{const m=(language==='fi'?/^[”]?(\d+\s*[a-z]*) artikla$/u:/^[‘]?Article (\d+[a-z]*)$/u).exec(normal(p.text));return m?[{i,value:m[1].replace(/\s/gu,'')}]:[];});
 if(headings.length!==names.length||headings.some((h,i)=>h.value!==names[i])||headings[0].i!==0||!(language==='fi'?/^”/u:/^‘/u).test(rows[0].text)||!(language==='fi'?/”[;.]?$/u:/’[;.]?$/u).test(normal(rows.at(-1).text)))return null;
 const matches=[];
 for(let i=0;i<headings.length;i++){
  const content=rows.slice(headings[i].i+1,headings[i+1]?.i??rows.length),numbered=content.filter(p=>/^\d+[a-z]*\.\s/u.test(p.text));
  if(numbered.some((p,j)=>!new RegExp('^'+(j+1)+'\\.\\s','u').test(p.text)))return null;
  const at=numbered.findIndex(p=>new RegExp('^'+printed[1]+'\\.\\s','u').test(p.text));
  if(at>=0){const anchor=numbered[at],following=numbered[at+1];if(!following||following.index!==anchor.index+1)return null;matches.push(following.index);}
 }
 if(matches.length!==1)return null;
 return {itemIndex,insertBefore:matches[0],evidence:[{basis:'point-only-article-paragraph',owner:owner.id}]};
}
