// Independent printed-text oracle. Deliberately imports no producer, label
// parser, proposal parser or placer. Poppler text is supplied by its caller.
const fold=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const literal=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim();
const unknown=reason=>({status:'unverified',reason:'oracle-council-pdf-'+reason});
const failed=()=>({status:'failed',reason:'oracle-council-pdf-article-placement-mismatch'});
const grammar={
 en:{article:'Article',paragraph:'paragraph',point:'point',subparagraph:'subparagraph',act:'Directive'},
 cs:{article:'Čl\\.|Článek',paragraph:'odst\\.|odstavec',point:'bod|písm\\.',subparagraph:'pododstavec',act:'Směrnice'},
 es:{article:'Artículo',paragraph:'apartado|párrafo',point:'punto|letra',subparagraph:'párrafo',act:'Directiva'},
 da:{article:'Artikel',paragraph:'stk\\.',point:'nr\\.|litra',subparagraph:'afsnit',act:'Direktiv'},
};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
function label(raw,g) {
 const parts=String(raw??'').split(/[–—]|\s+-\s+/u),result=[];
 for(const part of parts){let found;
  for(const kind of ['article','subparagraph','paragraph','point']){
   const m=new RegExp('^(?:'+g[kind]+')\\s+(-?\\d+|[a-z])\\s*(bis|[a-z])?\\s*(?:\\([^)]*\\))?$','iu').exec(part.trim());
   if(m){found={kind,value:(m[1]+(m[2]??'')).toLowerCase(),base:m[1].toLowerCase(),suffix:(m[2]??'').toLowerCase()};break;}
  }
  if(!found)return null;result.push(found);
 }return result;
}
function printed(raw) {
 // Remove only the two independently recognizable native footer lines, at the
 // bottom of each page. All other printed text remains part of the proof.
 return raw.split('\f').map(page=>{
  const lines=page.trimEnd().split('\n');
  if(/^\s*(?:RELEX\.[\d.]+\s+)?LIMITE\s+(?:EN|CS|ES|DA)\s*$/u.test(lines.at(-1)??'')){
   lines.pop();while(lines.length&&!lines.at(-1).trim())lines.pop();
   if(/^\s*\d{3,5}\/\d{2}\s+\d+\s*$/u.test(lines.at(-1)??''))lines.pop();
   else return page; // Never remove a line on an unproved footer shape.
  }return lines.join('\n');
 }).join('\n\n');
}
function chunks(text) {return text.split(/\n\s*\n/u).map(text=>text.replace(/\s+/gu,' ').trim()).filter(Boolean);}
const starts=(text,kind)=>kind==='paragraph'?/^[„“‘«»"]?(\d+\s*(?:bis|[a-z])?)\.\s+/iu.exec(text):/^\(?([a-z]+)\)\s+/iu.exec(text);
function children(text,kind) {
 const blocks=chunks(text),units=[];
 for(let i=0;i<blocks.length;i++){
  const m=starts(blocks[i],kind);if(!m)continue;
  let end=i+1;while(end<blocks.length&&!starts(blocks[end],kind))end++;
  units.push({value:m[1].replace(/\s/gu,'').toLowerCase(),text:blocks.slice(i,end).join('\n\n'),blocks:blocks.slice(i,end)});
 }return units;
}
export function councilArticleNativeScope(raw,wording) {
 const g=grammar[wording.language];if(!g)return null;
 const outer=label(wording.targetPath?.proposal?.[0]?.raw??String(wording.targetLabel??'').split('\n')[0],g);
 // Spanish uses párrafo for the proposal's unnumbered article lead and for
 // subparagraphs. The full outer article/lead/point frame disambiguates it.
 if(wording.language==='es'&&outer?.length===3&&outer[0].kind==='article'&&outer[1].kind==='subparagraph'&&outer[2].kind==='point')outer[1]={...outer[1],kind:'paragraph'};
 const refs=wording.targetPath?.underlying;
 if(!outer||outer.length!==3||outer[0].kind!=='article'||outer[1].kind!=='paragraph'||outer[1].value!=='1'||outer[2].kind!=='point'||!/^\d+$/u.test(outer[2].value)||refs?.length!==1)return null;
 const inner=label(refs[0].raw,g);if(!inner||inner[0].kind!=='article'||inner.length<2)return null;
 const document=new RegExp('^'+g.act+'\\s+(?:\\((?:EU|UE)\\)\\s+)?(\\d{4}/\\d+)$','iu').exec(refs[0].document?.replace(/\s+/gu,' ').trim()??'');if(!document)return null;
 const source=printed(raw),headers=[...source.matchAll(new RegExp('^\\s*(?:'+g.article+')\\s+(\\d+[a-z]?)\\s*$','gimu'))];
 // The first exact, unquoted article with the named act lead owns its points.
 const candidates=headers.filter(h=>h[1]===outer[0].value&&new RegExp('^\\s*(?:La |I )?'+g.act+'[^\\n]*'+escape(document[1])+'[^\\n]*:\\s*$','imu').test(source.slice(h.index,h.index+500)));
 if(candidates.length!==1)return null;
 const begin=candidates[0],after=source.slice(begin.index+begin[0].length),pointStarts=[...after.matchAll(/^([ \t]*)\(?(\d+)\)\s+/gmu)];
 if(!pointStarts.length)return null;
 const indent=pointStarts[0][1].length,points=pointStarts.filter(m=>m[1].length===indent),chosen=points.filter(m=>m[2]===outer[2].value);
 if(chosen.length!==1||points.some((p,i)=>Number(p[2])!==i+1))return null;
 const at=points.indexOf(chosen[0]),end=points[at+1]?.index??after.length,point=after.slice(chosen[0].index,end);
 // Require an explicit quoted replacement, plus a printed closing delimiter.
 const inherited=wording.language==='cs'?/^\s*\(?\d+\)\s+V článku (\d+[a-z]?) se doplňuje nový odstavec (\d+[a-z]?), který zní:/u.exec(point):null;
 if(!/[“’»«"][.;]?\s*(?:\n|$)/u.test(point))return null;
 const innerHeaders=[...point.matchAll(new RegExp('^[ \\t]*[„“‘«»"]?(?:'+g.article+')\\s+(\\d+[a-z]?)\\s*$','gimu'))],matches=innerHeaders.filter(h=>h[1]===inner[0].value);
 let section,followingSection='';
 if(matches.length===1){const h=matches[0],j=innerHeaders.indexOf(h);section=point.slice(h.index,innerHeaders[j+1]?.index??point.length);if(innerHeaders[j+1])followingSection=point.slice(innerHeaders[j+1].index);}
 else if(inherited&&inherited[1]===inner[0].value&&inner[1]?.kind==='paragraph'&&inherited[2]===inner[1].base){const start=point.search(/^[ \t]*[„“‘«»"]\d+\.\s/mu);if(start<0)return null;section=point.slice(start);}
 else return null;
 if(!/[„“‘«»"][ \t]*(?:Článek|Article|Artículo|Artikel|KAPITOLA|CHAPTER|CAPÍTULO|KAPITEL|\d+\.)/iu.test(point))return null;
 let units=[{text:section,blocks:chunks(section)}];
 for(const segment of inner.slice(1)){
  if(segment.suffix)break; // For insertions the final new label selects siblings below.
  if(segment.kind==='paragraph'||segment.kind==='point')units=units.flatMap(u=>children(u.text,segment.kind)).filter(u=>u.value===segment.value);
  else if(segment.kind==='subparagraph')units=units.flatMap(u=>{
   const direct=u.blocks.filter(b=>!starts(b,'point'));return direct[Number(segment.value)-1]?[{text:direct[Number(segment.value)-1],blocks:[direct[Number(segment.value)-1]]}]:[];
  });else return null;
 }
 return {section,followingSection,units,inner,outer};
}
export function assertCouncilDraftArticleText(raw,{placement,wording,items}) {
 const scope=councilArticleNativeScope(raw,wording);if(!scope)return unknown('article-ownership-unproved');
 const proposal=items?.[placement.itemIndex]?.proposal;if(!proposal)return unknown('projection-unavailable');
 if(placement.operation==='insert'){
  const last=scope.inner.at(-1);if(!last.suffix||!['paragraph','point'].includes(last.kind))return unknown('article-insertion-address-unproved');
  if(!/\([^)]*\)\s*$/u.test(wording.targetPath.underlying[0].raw)){
   const printed=/^(\d+)\s*(bis|[a-z])\.\s+/iu.exec(wording.proposedText?.trim()??'');
   if(wording.originalText?.trim()||!printed||(printed[1]+printed[2]).toLowerCase()!==last.value)return unknown('article-new-label-unproved');
  }
  const parents=scope.units;
  if(!parents?.length)return unknown('article-insertion-parent-unproved');
  const siblings=parents.flatMap(p=>children(p.text,last.kind)),anchors=siblings.filter(s=>s.value===last.base);if(anchors.length!==1)return unknown('article-insertion-anchor-unproved');
  if(new Set(siblings.map(s=>s.value)).size!==siblings.length)return unknown('article-insertion-numbering-unproved');
  const index=siblings.indexOf(anchors[0]),next=siblings[index+1];
  const after=proposal.paragraphs[placement.insertAfter]?.text,before=proposal.paragraphs[placement.insertBefore]?.text;
  if(!Number.isSafeInteger(placement.insertAfter)||placement.insertBefore!==placement.insertAfter+1||!after)return failed();
  if(!literal(anchors[0].text).endsWith(literal(after)))return failed();
  if(placement.splice){
   const s=placement.splice,tail=/[“’»«"][.;]?\s*$/u.exec(after);
   if(next||!tail||!/[“’»«"][.;]?\s*$/u.test(anchors[0].text)||s.start?.paragraph!==placement.insertAfter||s.end?.paragraph!==placement.insertAfter||s.start?.offset!==tail.index||s.end?.offset!==tail.index)return failed();
  }else{
   const following=next?.text??scope.followingSection;
   if(!before||!following||!fold(following).startsWith(fold(before)))return unknown('article-insertion-end-unproved');
  }
  return {status:'verified',reason:'native-council-pdf-article-insertion-boundaries'};
 }
 if(!['replace','delete'].includes(placement.operation))return unknown('article-operation-unproved');
 const s=placement.span,p=placement.splice;
 if(!s||!p||![s.start,s.end,p.start?.paragraph,p.end?.paragraph,p.start?.offset,p.end?.offset].every(Number.isSafeInteger)||s.start<0||s.end<s.start||s.end>=proposal.paragraphs.length||p.start.paragraph!==s.start||p.end.paragraph!==s.end)return failed();
 const first=proposal.paragraphs[s.start].text,last=proposal.paragraphs[s.end].text;
 if(p.start.offset<0||p.start.offset>first.length||p.end.offset<0||p.end.offset>last.length||s.start===s.end&&p.end.offset<=p.start.offset)return failed();
 const rendered=proposal.paragraphs.slice(s.start,s.end+1).map((v,i)=>v.text.slice(i?0:p.start.offset,i===s.end-s.start?p.end.offset:v.text.length)).join(' '),original=literal(wording.originalText);
 if(!original||literal(rendered)!==original)return failed();
 const matches=scope.units.filter(u=>literal(u.text).split(original).length===2);if(matches.length!==1)return unknown('article-original-unproved');
 return {status:'verified',reason:'native-council-pdf-article-original-and-address'};
}
