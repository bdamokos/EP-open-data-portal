// Check the printed final article and closing formula without parsed units.
export function assertClosingFormula({proposal,wording,placement}) {
 const unknown={status:'unverified',reason:'oracle-closing-formula-unavailable'};
 if(!proposal||wording.language!=='en'||placement.operation!=='insert')return unknown;
 const label=/^Article (\d+) [–-] paragraph (\d+) \(new\)$/u.exec(wording.targetLabel??'');
 if(!label)return unknown;
 const rows=proposal.paragraphs,headings=rows.filter(r=>/^(?:Titrearticle|ArticleTitle)$/iu.test(r.properties?.styleId??'')&&/^Article \d+$/u.test(r.text.trim()));
 const heading=headings.at(-1);
 if(!heading||heading.text.trim()!==`Article ${label[1]}`||headings.filter(r=>r.text===heading.text).length!==1)return unknown;
 const formulas=rows.filter(r=>r.index>heading.index&&/^This Regulation shall be binding in its entirety and directly applicable in all Member States\.$/u.test(r.text.trim()));
 if(formulas.length!==1)return unknown;
 const formula=formulas[0],content=rows.filter(r=>r.index>heading.index&&r.index<formula.index);
 if(!content.length||[...content,formula].some(r=>r.complete===false||r.source?.complete!==true||r.source.container!=='body'))return unknown;
 const numbered=content.filter(r=>/^(?:Manual)?NumPar1$/iu.test(r.properties?.styleId??''));
 const values=numbered.map(r=>/^(\d+)[.)]\s/u.exec(r.text)?.[1]);
 if(values.some((v,i)=>Number(v)!==i+1)||Number(label[2])<=Math.max(1,values.length))return unknown;
 if(!numbered.length&&!content.some(r=>/^This Regulation shall enter into force\b/u.test(r.text)))return unknown;
 return placement.insertBefore===formula.index&&placement.insertAfter===formula.index-1
  ?{status:'verified',reason:'oracle-before-closing-formula',rawSourceRows:[heading.index,formula.index]}
  :{status:'failed',reason:'oracle-closing-formula-boundary-mismatch'};
}
