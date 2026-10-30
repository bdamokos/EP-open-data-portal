import {createHash} from 'node:crypto';
import {docxContent} from './document-text.mjs';

/** Match the declared English directive's visible legal heading, not its memo. */
export function nativeConsultationProcedure(buffer,{procedure,language}={}) {
  const unknown=reason=>({status:'unresolved',reason});
  const expected=/^(\d{4})\/(\d{4})\(CNS\)$/u.exec(procedure??'');
  if(!expected||language!=='en')return unknown('native-procedure-language-unavailable');
  let content;try{content=docxContent(buffer,{includeParagraphProperties:true});}catch{return unknown('native-procedure-content-unavailable');}
  const rows=content.paragraphs,claims=[];
  for(let i=0;i<rows.length;i++) {
    const code=/^(\d{4})\/(\d{1,4})\s*\((COD|CNS)\)$/u.exec(rows[i]);
    if(!code)continue;
    const heading=rows.slice(i,i+3),sources=content.paragraphSources.slice(i,i+3),properties=content.paragraphProperties.slice(i,i+3);
    if(heading[1]!=='Proposal for a'||heading[2]!=='COUNCIL DIRECTIVE')continue;
    if(properties.map(p=>p.styleId).join('|')!=='Rfrenceinterinstitutionnelle|Statut|Typedudocument')continue;
    if(sources.length!==3||sources.some(s=>s.container!=='body'||!s.complete)||sources.some((s,j)=>j&&s.ordinal!==sources[j-1].ordinal+1)
      ||properties.some(p=>p.numberingComplete===false||p.notesComplete===false))return unknown('native-procedure-heading-incomplete');
    claims.push({procedure:`${code[1]}/${code[2].padStart(4,'0')}(${code[3]})`,raw:rows[i],sourcePaths:sources.map(s=>s.path)});
  }
  if(claims.length!==1)return unknown('native-procedure-heading-ambiguous');
  if(claims[0].procedure!==procedure)return unknown('native-procedure-reference-conflict');
  return {status:'verified',...claims[0],language,sha256:createHash('sha256').update(buffer).digest('hex'),basis:'visible-native-proposal-heading'};
}
