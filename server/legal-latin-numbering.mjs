// French EU numbering: ISG 3.3.2 and Annex B. Keep compounds distinct from
// their first suffix (e.g. 1 bis bis is between 1 bis and 1 ter).
export const LATIN_NUMBER_SUFFIXES=Object.freeze(['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies','undecies','duodecies','terdecies','quaterdecies','quindecies','sexdecies','septdecies','octodecies','novodecies','vicies','unvicies','duovicies','tervicies','quatervicies','quinvicies']);
const token=new RegExp([...LATIN_NUMBER_SUFFIXES].sort((a,b)=>b.length-a.length).join('|'),'g');
export function latinSuffixParts(value) {
  const compact=String(value).replace(/\s+/gu,'');
  if(!compact||compact.length>75)return null;
  const parts=compact.match(token);
  return parts&&parts.length<=3&&parts.join('')===compact?parts:null;
}
export function latinSuffixRank(value) {
  if(value==='')return 0;
  const parts=latinSuffixParts(value);
  return parts?parts.reduce((rank,part,index)=>rank+(LATIN_NUMBER_SUFFIXES.indexOf(part)+1)/26**index,0):null;
}
