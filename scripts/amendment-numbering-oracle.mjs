// Verify an explicit point label against unique printed wording in its article.
// No production units, target parser, normalizer or placement evidence is used.
export function assertWordingNumbering({proposal,wording,placement}) {
 const unknown={status:'unverified',reason:'oracle-numbering-unavailable'};
 if(!proposal||wording.language!=='en'||!['replace','delete'].includes(placement.operation))return unknown;
 const label=/^Article (\d+) – paragraph 1 – point ([a-z])$/u.exec(wording.targetLabel??'');
 const old=/^\(([a-z])\)\s+([^\n]+)$/u.exec(wording.originalText??'');
 if(!label||!old||label[2]!==old[1])return unknown;
 const rows=proposal.paragraphs,heads=rows.filter(r=>/^Article \d+$/u.test(r.text.trim())&&/^(?:Titrearticle|ArticleTitle)$/iu.test(r.properties?.styleId??''));
 const roots=heads.filter(r=>r.text.trim()===`Article ${label[1]}`);
 if(roots.length!==1)return unknown;
 const end=heads.find(r=>r.index>roots[0].index)?.index;
 if(end===undefined)return unknown;
 const content=rows.slice(roots[0].index+1,end);
 if(content.some(r=>r.complete===false||r.source?.complete!==true||r.source.container!=='body'||/^(?:Manual)?NumPar1$/iu.test(r.properties?.styleId??'')))return unknown;
 const key=s=>s.normalize('NFC').replace(/^\([a-z]\)\s+/u,'').replace(/\s+/gu,' ').trim();
 if(key(old[2]).length<30)return unknown;
 const matches=content.filter(r=>key(r.text)===key(old[2]));
 if(matches.length!==1)return unknown;
 const row=matches[0];
 if(!placement.span||!placement.splice||placement.span.start!==row.index||placement.span.end!==row.index||placement.splice.start.paragraph!==row.index||placement.splice.end.paragraph!==row.index||placement.splice.start.offset!==0||placement.splice.end.offset!==row.text.length)return {status:'failed',reason:'oracle-numbering-boundary-mismatch'};
 return {status:'verified',reason:'oracle-numbering-unique-wording',rawSourceRows:[roots[0].index,row.index,end]};
}
