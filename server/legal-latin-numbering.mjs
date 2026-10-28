// French EU numbering: ISG 3.3.2 and Annex B. Keep compounds distinct from
// their first suffix (e.g. 1 bis bis is between 1 bis and 1 ter).
export const LATIN_NUMBER_SUFFIXES=Object.freeze(['bis','ter','quater','quinquies','sexies','septies','octies','nonies','decies','undecies','duodecies','terdecies','quaterdecies','quindecies','sexdecies','septdecies','octodecies','novodecies','vicies','unvicies','duovicies','tervicies','quatervicies','quinvicies']);
export function latinSuffixParts(value) {
  const text=String(value).trim().replace(/\s+/gu,' ');
  if(!text||text.length>75)return null;
  const parts=text.split(' ');
  return parts.length<=3&&parts.every(part=>LATIN_NUMBER_SUFFIXES.includes(part))?parts:null;
}
export function latinSuffixRank(value) {
  if(value==='')return 0;
  const parts=latinSuffixParts(value);
  return parts?parts.reduce((rank,part,index)=>rank+(LATIN_NUMBER_SUFFIXES.indexOf(part)+1)/26**index,0):null;
}
