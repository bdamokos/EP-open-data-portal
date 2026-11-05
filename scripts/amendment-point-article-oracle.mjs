import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
const norm=s=>s.replace(/\s+/gu,' ').trim();
// Independent native XML proof. No parsed units, paths or placer evidence.
export function assertPointArticleParagraph({proposal,wording,placement,nativeQuoted}) {
 const unknown=()=>null;
 if(!proposal||!nativeQuoted||!['en','fi'].includes(wording.language)||wording.originalText!==''||placement.operation!=='insert')return unknown();
 const labels=wording.targetLabel?.split(/\n| — /u).map(norm),outer=labels?.[0];
 if(!outer||labels.some(s=>s!==outer))return unknown();
 const address=(wording.language==='fi'?/^(\d+) artikla – 1 kohta – (\d+) alakohta$/u:/^Article (\d+) – paragraph 1 – point (\d+)$/u).exec(outer);
 const added=/^(\d+)\s*a\.\s+\S/u.exec(wording.proposedText??'');if(!address||!added)return unknown();
 let raw;try{raw=quotedWordBody(nativeQuoted.proposalBuffer);}catch{return unknown();}
 const rows=raw.filter(r=>r.kind!=='paragraph'||r.text.trim()),head=wording.language==='fi'?address[1]+' artikla':'Article '+address[1];
 const heads=rows.filter(r=>norm(r.text)===head);if(heads.length!==1)return unknown();
 const tail=rows.slice(rows.indexOf(heads[0])+1),stop=tail.findIndex(r=>(wording.language==='fi'?/^\d+ artikla$/u:/^Article \d+$/u).test(norm(r.text)));
 const scope=stop<0?tail:tail.slice(0,stop),owners=scope.filter(r=>new RegExp('^\\('+address[2]+'\\)\\s','u').test(r.text));if(owners.length!==1)return unknown();
 const start=scope.indexOf(owners[0]),end=scope.findIndex((r,i)=>i>start&&/^\(\d+\)\s/u.test(r.text));if(end<0)return unknown();
 const block=scope.slice(start,end),instruction=norm(block[0].text);
 const match=(wording.language==='fi'?/^\(\d+\) Lisätään (.+) artikla seuraavasti:$/u:/^\(\d+\) the following Articles (.+) are inserted:$/u).exec(instruction);
 if(!match)return unknown();
 const names=match[1].split(/,\s*| and | ja /u).map(s=>s.replace(/\s/gu,''));if(names.length<2||new Set(names).size!==names.length||names.some(s=>!/^\d+[a-z]*$/u.test(s)))return unknown();
 if(block.some(r=>r.kind!=='paragraph'||r.unsafe||r.hidden||r.numbered))return unknown();
 const title=r=>(wording.language==='fi'?/^[”]?(\d+\s*[a-z]*) artikla$/u:/^[‘]?(?:Article) (\d+[a-z]*)$/u).exec(norm(r.text));
 const articles=block.flatMap((r,i)=>{const m=title(r);return m?[{i,name:m[1].replace(/\s/gu,'')}]:[];});
 if(articles.map(a=>a.name).join('|')!==names.join('|')||articles[0].i!==1||!(wording.language==='fi'?/^”/u:/^‘/u).test(block[1].text)||!(wording.language==='fi'?/”[;.]?$/u:/’[;.]?$/u).test(norm(block.at(-1).text)))return unknown();
 const options=[];
 for(let j=0;j<articles.length;j++){
  const content=block.slice(articles[j].i+1,articles[j+1]?.i??block.length);
  const numbered=content.filter(r=>/^\d+[a-z]*\.\s/u.test(norm(r.text)));
  if(numbered.some((r,i)=>!norm(r.text).startsWith((i+1)+'. ')))return unknown();
  const anchor=numbered[Number(added[1])-1];if(anchor){const next=numbered[Number(added[1])];if(!next||block.indexOf(next)!==block.indexOf(anchor)+1)return unknown();options.push({anchor,next});}
 }
 if(options.length!==1)return unknown();
 const mapped=block.map(r=>proposal.paragraphs.filter(p=>p.source?.path===r.path&&norm(p.text)===norm(r.text)));
 if(mapped.some((m,i)=>m.length!==1||i&&m[0].index!==mapped[i-1][0].index+1))return unknown();
 const before=mapped[block.indexOf(options[0].next)][0].index;
 return placement.insertBefore===before&&placement.insertAfter===before-1?{status:'verified',reason:'oracle-native-point-only-paragraph',location:{section:'commission-proposal',kind:'paragraph',value:outer+'/'+added[1]+'a',scope:'proposal'}}:{status:'failed',reason:'oracle-point-only-boundary-mismatch',expectedBefore:before};
}
