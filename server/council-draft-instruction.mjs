// Bounded positive instruction grammar for a quoted Council provision. A
// quotation's article heading alone cannot establish what the outer point does.
const patterns={
 en:[
  ['articles',/^Articles? (.+) (?:is|are) replaced by the following:$/u],
  ['article',/^(?:In Chapter \d+[a-z]?, )?[Tt]he following Article (\d+[a-z]?) is inserted:$/u],
  ['CHAPTER',/^The following Chapter (\d+[a-z]?) is inserted:$/u],
 ],
 cs:[
  ['articles',/^Člán(?:ek|ky) (.+) se nahrazuj(?:e|í) tímto:$/u],
  ['article',/^(?:V kapitole \d+[a-z]? se vkládá nový článek|Vkládá se nový článek) (\d+[a-z]?), který zní:$/u],
  ['KAPITOLA',/^Vkládá se nová kapitola (\d+[a-z]?), která zní:$/u],
  ['paragraph',/^V článku (\d+[a-z]?) se doplňuje nový odstavec (\d+[a-z]?), který zní:$/u],
 ],
 es:[
  ['articles',/^(?:El artículo|Los artículos) (.+) se sustituy(?:e|en) por el texto siguiente:$/u],
  ['article',/^(?:En el capítulo \d+(?: bis)?, se inserta el artículo|Se inserta el artículo) (\d+(?: bis)?) siguiente:$/u],
  ['CAPÍTULO',/^Se inserta el capítulo (\d+(?: bis)?) siguiente:$/u],
 ],
 da:[
  ['articles',/^Artikel (.+) affattes således:$/u],
  ['article',/^(?:I kapitel \d+[a-z]? indsættes følgende som artikel|Følgende indsættes som artikel) (\d+[a-z]?):$/u],
  ['KAPITEL',/^Følgende indsættes som Kapitel (\d+[a-z]?):$/u],
 ],
};
const compact=value=>value.replace(/\s/gu,'');
export function councilDraftInstructionOwns(raw,inner,quotedStart,language) {
 const lead=String(raw??'').normalize('NFC').replace(/\s+/gu,' ').trim().replace(/^\(?\d+[).]\s*/u,'');
 const article=inner?.segments?.[0];if(article?.kind!=='article')return false;
 for(const [kind,pattern] of patterns[language]??[]){
  const match=pattern.exec(lead);if(!match)continue;
  if(kind==='articles'){
   const labels=match[1].split(/,\s*|\s+(?:and|a|y|og)\s+/u).map(compact);
   return labels.every(label=>/^\d+(?:bis|[a-z])?$/u.test(label))&&new Set(labels).size===labels.length&&labels.includes(article.value);
  }
  if(kind==='article')return compact(match[1])===article.value;
  if(kind==='paragraph')return match[1]===article.value&&inner.segments[1]?.kind==='paragraph'&&match[2]===String(inner.segments[1].number);
  const heading=new RegExp('^[„“‘«»"]'+kind+'\\s+(\\d+(?:\\s*bis|[a-z])?)(?=\\s|$)','iu').exec(String(quotedStart??''));
  return !!heading&&compact(heading[1])===compact(match[1]);
 }
 return false;
}
