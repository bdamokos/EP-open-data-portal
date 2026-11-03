import {createHash} from 'node:crypto';
import {docxContent} from './document-text.mjs';

// An attached guidelines document has one global paragraph sequence. Headings
// divide the guidelines, but do not restart the amendment's paragraph addresses.
export function guidelineAnnexLayout(content,{language='en'}={}) {
  if(language!=='en'||!Array.isArray(content.paragraphs))return null;
  const rows=content.paragraphs,properties=content.paragraphProperties,sources=content.paragraphSources;
  const header=text=>/^Guideline (\d+):\s+\S/u.exec(text.trim());
  const start=rows.findIndex(text=>header(text));if(start<0)return null;
  if(start>1||rows.slice(0,start).some((text,i)=>text!=='\uFFFC'||properties?.[i]?.styleId!=='Pagedecouverture'))return null;
  const headings=[],paragraphs=[];
  for(let i=start;i<rows.length;i++) {
    if(!sources?.[i]?.complete||sources[i].container!=='body'||properties?.[i]?.numberingComplete===false||properties?.[i]?.notesComplete===false||properties?.[i]?.annotationsComplete===false||/[\uFFFC]/u.test(rows[i]))return null;
    const match=header(rows[i]);
    if(match){if(headings.length&&(Number(match[1])!==headings.at(-1).number+1||!paragraphs.length||paragraphs.at(-1)<headings.at(-1).index))return null;headings.push({index:i,number:Number(match[1])});}
    else {if(/^Guideline\b|^\s*(?:\(\d+\)|\d+[.)])\s/u.test(rows[i]))return null;paragraphs.push(i);}
  }
  if(headings.length<2||!paragraphs.length||paragraphs.at(-1)<headings.at(-1).index)return null;
  return {start,headings,paragraphs};
}

// Metadata already binds the single annex to the exact proposal work. The
// native act must also adopt its singular Annex. This establishes a sole-annex
// address alias, not a printed Roman ordinal inferred from a file/part number.
export function nativeGuidelineAnnex(actBuffer,annexBuffer,{language='en'}={}) {
  let act,annex;try{act=docxContent(actBuffer,{includeParagraphProperties:true});annex=docxContent(annexBuffer,{includeParagraphProperties:true});}catch{return null;}
  const layout=guidelineAnnexLayout(annex,{language});if(!layout)return null;
  const candidates=act.paragraphs.flatMap((text,i)=>/^(?:Article 1|Article 1\.)$/u.test(text.trim())&&/Titrearticle/iu.test(act.paragraphProperties[i].styleId||'')?[i]:[]);
  if(candidates.length!==1)return null;
  const i=candidates[0]+1,text=act.paragraphs[i];
  if(!/\b[Gg]uidelines\b[\s\S]*\bas set out in the Annex\b[\s\S]*\bare hereby adopted\b/u.test(text||'')||!act.paragraphSources[i]?.complete||act.paragraphSources[i].container!=='body'||act.paragraphProperties[i].notesComplete===false)return null;
  return {status:'verified',basis:'sole-annex-adopted-by-native-act',ordinal:null,sourcePath:act.paragraphSources[i].path,sha256:createHash('sha256').update(annexBuffer).digest('hex'),paragraphs:layout.paragraphs.length};
}
