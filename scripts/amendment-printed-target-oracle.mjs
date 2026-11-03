// Independent assertion over native Word paragraphs, without the amendment extractor.
export function printedActTarget(body,number) {
 const starts=body.flatMap((r,i)=>r.kind==='paragraph'&&new RegExp(`^Amendment\\s+${number}$`,'u').test(r.text.trim())?[i]:[]);
 if(starts.length!==1)return null;
 const after=body.slice(starts[0]+1),end=after.findIndex(r=>r.kind!=='paragraph');
 if(end<0)return null;
 const rows=after.slice(0,end).filter(r=>r.text.trim());
 if(rows.some(r=>r.unsafe||r.hidden))return null;
 const targets=rows.flatMap((r,i)=>/^Article \d+ – paragraph \d+ – point \d+$/u.test(r.text.trim())?[i]:[]);
 if(targets.length!==1)return null;
 const at=targets[0],outer=rows[at].text.trim(),act=rows[at+1]?.text.trim(),inner=rows[at+2]?.text.trim();
 if(rows.length!==at+3||!/^Regulation \(EU\) \d{4}\/\d+$/u.test(act??'')||!/^Article \d+ – paragraph \d+(?: – (?:subparagraph \d+|point [a-z]+(?: [a-z])?))+ \(new\)$/u.test(inner??''))return null;
 return {outer,act,inner,label:outer+'\n'+act+' — '+inner};
}
