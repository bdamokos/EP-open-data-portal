// Independent printed-text oracle. Deliberately imports no producer, label
// parser, proposal parser or placer. Poppler text is supplied by its caller.
import {nativeCouncilListSubparagraphs} from './amendment-council-list-oracle.mjs';
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
export function councilPrintedText(raw) {
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
function blocksWithOffsets(text) {
 const cuts=[...text.matchAll(/\n\s*\n/gu)],blocks=[];let start=0;
 for(const cut of [...cuts,{index:text.length,0:''}]){
  const raw=text.slice(start,cut.index),value=literal(raw);
  if(value)blocks.push({text:value,offset:coordinates(text.slice(0,start)).length});
  start=cut.index+cut[0].length;
 }return blocks;
}
function chunks(text) {return blocksWithOffsets(text).map(block=>block.text);}
const starts=(text,kind)=>kind==='paragraph'?/^[„“‘«»"]?(\d+\s*(?:bis|[a-z])?)\.\s+/iu.exec(text):/^\(?([a-z]+)\)\s+/iu.exec(text);
function children(text,kind) {
 const blocks=blocksWithOffsets(text),units=[];
 for(let i=0;i<blocks.length;i++){
  const m=starts(blocks[i].text,kind);if(!m)continue;
  let end=i+1;while(end<blocks.length&&!starts(blocks[end].text,kind))end++;
  units.push({value:m[1].replace(/\s/gu,'').toLowerCase(),text:blocks.slice(i,end).map(block=>block.text).join('\n\n'),blocks:blocks.slice(i,end).map(block=>block.text),offset:blocks[i].offset});
 }return units;
}
// Closed native instruction grammar: the quoted heading cannot contradict the
// positive operation or targets printed in its enclosing instruction.
function ownsArticle(point,inner,language) {
 const lead=literal(point.slice(0,point.indexOf(':')+1)).replace(/^\(?\d+[).]\s*/u,'');
 const rules={
  en:{replace:/^Articles? (.+) (?:is|are) replaced by the following:$/u,insert:/^(?:In Chapter \d+[a-z]?, )?[Tt]he following Article (\d+[a-z]?) is inserted:$/u,chapter:/^The following Chapter (\d+[a-z]?) is inserted:$/u,heading:'CHAPTER'},
  cs:{replace:/^Člán(?:ek|ky) (.+) se nahrazuj(?:e|í) tímto:$/u,insert:/^(?:V kapitole \d+[a-z]? se vkládá nový článek|Vkládá se nový článek) (\d+[a-z]?), který zní:$/u,chapter:/^Vkládá se nová kapitola (\d+[a-z]?), která zní:$/u,heading:'KAPITOLA'},
  es:{replace:/^(?:El artículo|Los artículos) (.+) se sustituy(?:e|en) por el texto siguiente:$/u,insert:/^(?:En el capítulo \d+(?: bis)?, se inserta el artículo|Se inserta el artículo) (\d+(?: bis)?) siguiente:$/u,chapter:/^Se inserta el capítulo (\d+(?: bis)?) siguiente:$/u,heading:'CAPÍTULO'},
  da:{replace:/^Artikel (.+) affattes således:$/u,insert:/^(?:I kapitel \d+[a-z]? indsættes følgende som artikel|Følgende indsættes som artikel) (\d+[a-z]?):$/u,chapter:/^Følgende indsættes som Kapitel (\d+[a-z]?):$/u,heading:'KAPITEL'},
 }[language];
 if(!rules)return false;
 const replacement=rules.replace.exec(lead),insert=rules.insert.exec(lead),chapter=rules.chapter.exec(lead);
 if(replacement){const targets=replacement[1].split(/,\s*|\s+(?:and|a|y|og)\s+/u);return targets.every(n=>/^\d+(?:\s*bis|[a-z])?$/u.test(n))&&new Set(targets).size===targets.length&&targets.map(n=>n.replace(/\s/gu,'')).includes(inner[0].value);}
 if(insert)return insert[1].replace(/\s/gu,'')===inner[0].value;
 if(chapter){const quoted=point.slice(point.indexOf(':')+1).trimStart();return new RegExp('^[„“‘«»"]'+rules.heading+'\\s+'+escape(chapter[1])+'(?:\\s|$)','iu').test(quoted);}
 const inherited=language==='cs'?/^V článku (\d+[a-z]?) se doplňuje nový odstavec (\d+[a-z]?), který zní:$/u.exec(lead):null;
 return !!inherited&&inherited[1]===inner[0].value&&inner[1]?.kind==='paragraph'&&inherited[2]===inner[1].base;
}
// Bind paragraph coordinates to an ordered native prefix from the named outer
// article through this whole point. A matching slice elsewhere is insufficient.
const coordinates=text=>String(text??'').normalize('NFC').replace(/\s/gu,'');
function uniqueOffset(text,part) {
 const index=text.indexOf(part);return part&&index>=0&&text.lastIndexOf(part)===index?index:null;
}
function projectedOwner(proposal,scope) {
 const rows=proposal.paragraphs.map(p=>coordinates(p.text)),joined=rows.join(''),frame=coordinates(scope.frame),point=coordinates(scope.point),section=coordinates(scope.section);
 const frameStart=uniqueOffset(joined,frame),sectionOffset=uniqueOffset(point,section);
 if(frameStart===null||sectionOffset===null)return null;
 const end=frameStart+frame.length,begin=end-point.length;let offset=0;const owned=[],starts=[];
 for(const [index,row] of rows.entries()){starts.push(offset);if(offset>=begin&&offset+row.length<=end)owned.push(index);offset+=row.length;}
 return {rows:new Set(owned),starts,section,start:begin+sectionOffset};
}
// The section contains the independently selected inner article. Locate the
// addressed child within that section, then compare actual character positions;
// equality of repeated wording elsewhere in the outer point is not ownership.
function nativeUnitRange(owner,unit) {
 const value=coordinates(unit.text),at=unit.offset;
 return !Number.isSafeInteger(at)||at<0||owner.section.slice(at,at+value.length)!==value?null:{start:owner.start+at,end:owner.start+at+value.length};
}
function nativeUnitText(section,unit) {
 const text=section.normalize('NFC'),end=unit.offset+coordinates(unit.text).length;let position=0,start,finish;
 for(let i=0;i<text.length;i++){
  if(/\s/u.test(text[i]))continue;
  if(position===unit.offset)start=i;
  if(++position===end){finish=i+1;break;}
 }
 const result=start===undefined||finish===undefined?null:text.slice(start,finish);
 return result!==null&&coordinates(result)===coordinates(unit.text)?result:null;
}
export function councilArticleNativeScope(raw,wording,{nativeBodyWords}={}) {
 const g=grammar[wording.language];if(!g)return null;
 if(wording.targetLabel!==undefined&&wording.targetPath?.proposal?.[0]?.raw!==undefined&&literal(String(wording.targetLabel).split('\n')[0])!==literal(wording.targetPath.proposal[0].raw))return null;
 const outer=label(wording.targetPath?.proposal?.[0]?.raw??String(wording.targetLabel??'').split('\n')[0],g);
 // Spanish uses párrafo for the proposal's unnumbered article lead and for
 // subparagraphs. The full outer article/lead/point frame disambiguates it.
 if(wording.language==='es'&&outer?.length===3&&outer[0].kind==='article'&&outer[1].kind==='subparagraph'&&outer[2].kind==='point')outer[1]={...outer[1],kind:'paragraph'};
 const refs=wording.targetPath?.underlying;
 if(!outer||outer.length!==3||outer[0].kind!=='article'||outer[1].kind!=='paragraph'||outer[1].value!=='1'||outer[2].kind!=='point'||!/^\d+$/u.test(outer[2].value)||refs?.length!==1)return null;
 const inner=label(refs[0].raw,g);if(!inner||inner[0].kind!=='article'||inner.length<2)return null;
 // Point leads and nested lists need a separate ordinal proof. Never count a
 // continuation as subparagraph one by dropping its labelled parent lead.
 if(inner.some((segment,index)=>segment.kind==='subparagraph'&&inner[index-1]?.kind!=='paragraph'))return null;
 const document=new RegExp('^'+g.act+'\\s+(?:\\((?:EU|UE)\\)\\s+)?(\\d{4}/\\d+)$','iu').exec(refs[0].document?.replace(/\s+/gu,' ').trim()??'');if(!document)return null;
 const source=councilPrintedText(raw),headers=[...source.matchAll(new RegExp('^\\s*(?:'+g.article+')\\s+(\\d+[a-z]?)\\s*$','gimu'))];
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
 if(!/[“’»«"][.;]?\s*(?:\n|$)/u.test(point)||!ownsArticle(point,inner,wording.language))return null;
 const innerHeaders=[...point.matchAll(new RegExp('^[ \\t]*[„“‘«»"]?(?:'+g.article+')\\s+(\\d+[a-z]?)\\s*$','gimu'))],matches=innerHeaders.filter(h=>h[1]===inner[0].value);
 let section,followingSection='';
 if(matches.length===1){const h=matches[0],j=innerHeaders.indexOf(h);section=point.slice(h.index,innerHeaders[j+1]?.index??point.length);if(innerHeaders[j+1])followingSection=point.slice(innerHeaders[j+1].index);}
 else if(inherited&&inherited[1]===inner[0].value&&inner[1]?.kind==='paragraph'&&inherited[2]===inner[1].base){const start=point.search(/^[ \t]*[„“‘«»"]\d+\.\s/mu);if(start<0)return null;section=point.slice(start);}
 else return null;
 if(!/[„“‘«»"][ \t]*(?:Článek|Article|Artículo|Artikel|KAPITOLA|CHAPTER|CAPÍTULO|KAPITEL|\d+\.)/iu.test(point))return null;
 let units=[{text:section,blocks:chunks(section),offset:0}];
 for(const segment of inner.slice(1)){
  if(segment.suffix)break; // For insertions the final new label selects siblings below.
  if(segment.kind==='paragraph'||segment.kind==='point')units=units.flatMap(u=>children(u.text,segment.kind).map(child=>({...child,offset:u.offset+child.offset}))).filter(u=>u.value===segment.value);
  else if(segment.kind==='subparagraph')units=units.flatMap(u=>{
   // A labelled child and all its continuations need subtree ownership. Flat
   // filtering cannot prove where that child ends. Check original native lines
   // too, so a list without blank separators cannot hide inside a flat block.
   const raw=nativeUnitText(section,u);
   if(raw===null)return [];
   if(raw.split(/\r?\n/u).slice(1).some(line=>/^[ \t]*[„“‘«»"]?(?:\([\p{L}\p{N}]+\)|[\p{L}]{1,3}[.)]|[ivxlcdm]+[.)]|\d+[.)])[ \t]+\S/iu.test(line))){
    const supported=inner[1]?.kind==='paragraph'&&inner[2]===segment&&(inner.length===3||inner.length===4&&inner[3].kind==='point'&&inner[3].suffix==='a');
    const peers=children(section,'paragraph'),index=peers.findIndex(p=>p.offset===u.offset&&p.value===u.value&&coordinates(p.text)===coordinates(u.text)),boundary=index<0?null:peers[index+1]?.blocks[0];
    const proved=wording.language==='cs'&&supported?nativeCouncilListSubparagraphs(raw,nativeBodyWords,boundary):null,block=proved?.[Number(segment.value)-1];
    return block?[{text:block.text,blocks:[block.text],offset:u.offset+block.offset,listGeometry:true,...(Number(segment.value)===1?{followingText:proved[1]?.text}:{})}]:[];
   }
   const direct=blocksWithOffsets(u.text),block=direct[Number(segment.value)-1];return block?[{text:block.text,blocks:[block.text],offset:u.offset+block.offset}]:[];
  });else return null;
 }
 return {section,followingSection,units,inner,outer,point,frame:source.slice(begin.index,begin.index+begin[0].length+end)};
}
export function assertCouncilDraftArticleText(raw,{placement,wording,items,nativeBodyWords}) {
 const scope=councilArticleNativeScope(raw,wording,{nativeBodyWords});if(!scope)return unknown('article-ownership-unproved');
 const proposal=items?.[placement.itemIndex]?.proposal;if(!proposal)return unknown('projection-unavailable');
 const owner=projectedOwner(proposal,scope);if(!owner)return failed();
 if(placement.operation==='insert'){
  const last=scope.inner.at(-1);if(!last.suffix||!['paragraph','point'].includes(last.kind))return unknown('article-insertion-address-unproved');
  if(!/\([^)]*\)\s*$/u.test(wording.targetPath.underlying[0].raw)){
   const printed=/^(\d+)\s*(bis|[a-z])\.\s+/iu.exec(wording.proposedText?.trim()??'');
   if(wording.originalText?.trim()||!printed||(printed[1]+printed[2]).toLowerCase()!==last.value)return unknown('article-new-label-unproved');
  }
  const parents=scope.units;
  if(!parents?.length)return unknown('article-insertion-parent-unproved');
  const siblings=parents.flatMap(p=>children(p.text,last.kind).map(child=>({...child,offset:p.offset+child.offset,followingText:p.followingText,listGeometry:p.listGeometry}))),anchors=siblings.filter(s=>s.value===last.base);if(anchors.length!==1)return unknown('article-insertion-anchor-unproved');
  if(anchors[0].listGeometry&&(wording.originalText?.trim()||last.kind!=='point'||last.suffix!=='a'||!new RegExp('^'+escape(last.value)+'\\)\\s+\\S','u').test(wording.proposedText?.trim()??'')))return unknown('article-list-insertion-label-unproved');
  if(new Set(siblings.map(s=>s.value)).size!==siblings.length)return unknown('article-insertion-numbering-unproved');
  const index=siblings.indexOf(anchors[0]),next=siblings[index+1];
  const after=proposal.paragraphs[placement.insertAfter]?.text,before=proposal.paragraphs[placement.insertBefore]?.text;
  if(!Number.isSafeInteger(placement.insertAfter)||placement.insertBefore!==placement.insertAfter+1||!after||!owner.rows.has(placement.insertAfter))return failed();
  const native=nativeUnitRange(owner,anchors[0]);
  if(!native||owner.starts[placement.insertAfter]+coordinates(after).length!==native.end||!literal(anchors[0].text).endsWith(literal(after)))return failed();
  if(placement.splice){
   const s=placement.splice,tail=/[“’»«"][.;]?\s*$/u.exec(after);
   if(next||!tail||!/[“’»«"][.;]?\s*$/u.test(anchors[0].text)||s.start?.paragraph!==placement.insertAfter||s.end?.paragraph!==placement.insertAfter||s.start?.offset!==tail.index||s.end?.offset!==tail.index)return failed();
  }else{
   const following=next?.text??anchors[0].followingText??scope.followingSection;
   if(!before||!following||!fold(following).startsWith(fold(before)))return unknown('article-insertion-end-unproved');
  }
  return {status:'verified',reason:'native-council-pdf-article-insertion-boundaries'};
 }
 if(!['replace','delete'].includes(placement.operation))return unknown('article-operation-unproved');
 const s=placement.span,p=placement.splice;
 if(!s||!p||![s.start,s.end,p.start?.paragraph,p.end?.paragraph,p.start?.offset,p.end?.offset].every(Number.isSafeInteger)||s.start<0||s.end<s.start||s.end>=proposal.paragraphs.length||p.start.paragraph!==s.start||p.end.paragraph!==s.end)return failed();
 if(Array.from({length:s.end-s.start+1},(_,i)=>s.start+i).some(i=>!owner.rows.has(i)))return failed();
 const first=proposal.paragraphs[s.start].text,last=proposal.paragraphs[s.end].text;
 if(p.start.offset<0||p.start.offset>first.length||p.end.offset<0||p.end.offset>last.length||s.start===s.end&&p.end.offset<=p.start.offset)return failed();
 const rendered=proposal.paragraphs.slice(s.start,s.end+1).map((v,i)=>v.text.slice(i?0:p.start.offset,i===s.end-s.start?p.end.offset:v.text.length)).join(' '),original=literal(wording.originalText);
 if(!original||literal(rendered)!==original)return failed();
 const matches=scope.units.filter(u=>literal(u.text).split(original).length===2);if(matches.length!==1)return unknown('article-original-unproved');
 const native=nativeUnitRange(owner,matches[0]),inside=uniqueOffset(coordinates(matches[0].text),coordinates(original));
 if(!native||inside===null)return unknown('article-original-coordinates-unproved');
 const expected=native.start+inside,actualStart=owner.starts[s.start]+coordinates(first.slice(0,p.start.offset)).length,actualEnd=owner.starts[s.end]+coordinates(last.slice(0,p.end.offset)).length;
 if(actualStart!==expected||actualEnd!==expected+coordinates(original).length)return failed();
 return {status:'verified',reason:'native-council-pdf-article-original-and-address'};
}
