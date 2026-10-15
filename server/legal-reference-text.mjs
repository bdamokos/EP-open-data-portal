// Recognise exact official reference numbers. A match yields a lookup key, never a title guess.
const pad=(value,length)=>String(value).padStart(length,'0');
const fullYear=value=>value.length===4?Number(value):Number(value)>=50?1900+Number(value):2000+Number(value);
const actLetter={regulation:'R',directive:'L',decision:'D','framework decision':'F'};
const eliLetter={reg:'R',reg_impl:'R',reg_del:'R',dir:'L',dir_impl:'L',dir_del:'L',dec:'D',dec_impl:'D',dec_del:'D'};
const documentSector={COM:['PC','DC'],SWD:['SC'],JOIN:['JC']};
// Written-question numbers restart each year. Years with a term change are checked against the API.
const questionTerms=year=>year>=2025?[10]:year===2024?[9,10]:year>=2020?[9]:year===2019?[8,9]:year>=2015?[8]:year===2014?[7,8]:year>=2010?[7]:[];

const celexKey=(year,letter,number)=>year>=1950&&year<=2099&&Number(number)>0&&Number(number)<=99999?`celex:3${year}${letter}${pad(Number(number),4)}`:null;
const patterns=[
  {kind:'eli',pattern:/\bhttps?:\/\/(?:data\.europa\.eu|eur-lex\.europa\.eu)\/eli\/(reg|reg_impl|reg_del|dir|dir_impl|dir_del|dec|dec_impl|dec_del)\/(\d{4})\/(\d{1,4})(?![\d])(?:\/[a-z0-9_/-]*)?/gi,
    key:m=>celexKey(Number(m[2]),eliLetter[m[1].toLowerCase()],m[3])},
  {kind:'celex',pattern:/\bhttps?:\/\/eur-lex\.europa\.eu\/[^\s<>"]*?[?&]uri=celex(?::|%3A)([35]\d{4}[A-Z]{1,2}\d{4})(?![0-9A-Z])[^\s<>"]*/gi,
    key:m=>`celex:${m[1].toUpperCase()}`},
  // Post-2015 acts use one year/number sequence: Regulation (EU) 2016/679.
  {kind:'act',pattern:/\b(Regulation|Directive|Decision)\s+\((?:EU|EU,\s*Euratom|Euratom|CFSP)\)\s+(?!No\b)(20\d{2})\/(\d{1,4})(?![\d/])/g,
    key:m=>Number(m[2])>=2015?celexKey(Number(m[2]),actLetter[m[1].toLowerCase()],m[3]):null},
  // Earlier regulations are number/year: Regulation (EC) No 139/2004, Regulation 1013/2006.
  {kind:'act',pattern:/\bRegulation\s+(?:\((?:EC|EEC|EU|Euratom|EC,\s*Euratom|EEC,\s*Euratom|ECSC)\)\s+)?(?:No\.?\s+)?(\d{1,4})\/(\d{4}|\d{2})(?![\d/])/g,
    key:m=>{const year=fullYear(m[2]);return year<=2014?celexKey(year,'R',m[1]):null;}},
  // Earlier directives and decisions are year/number/series: Directive 2002/49/EC.
  {kind:'act',pattern:/\b(Framework Decision|Directive|Decision)\s+(No\.?\s+)?(\d{1,4})\/(\d{1,4})\/(EC|EEC|EU|CFSP|JHA|Euratom|ECSC)\b/g,
    key:m=>{const [year,number]=m[2]?[fullYear(m[4]),m[3]]:[fullYear(m[3]),m[4]];return year<=2014||m[5]==='CFSP'?celexKey(year,actLetter[m[1].toLowerCase()],number):null;}},
  {kind:'document',pattern:/\b(COM|SWD|JOIN)\s?\((\d{4})\)\s?(\d{1,4})(?![\d/])(?:\s+final)?/g,
    key:m=>`${m[1].toLowerCase()}:${m[2]}/${Number(m[3])}`},
  {kind:'procedure',pattern:/\b((?:19|20)\d{2})\/(\d{4}[A-Z]?)\s?\(([A-Z]{3})\)/g,
    key:m=>`procedure:${m[1]}/${m[2]}(${m[3]})`},
  {kind:'question',pattern:/\bhttps?:\/\/www\.europarl\.europa\.eu\/doceo\/document\/([EPO])-\d{1,2}-(\d{4})-(\d{6})(?:-ASW)?_[A-Z]{2}\.html\b/g,
    key:m=>questionTerms(Number(m[2])).length?`question:${m[1]}-${m[2]}-${m[3]}`:null},
  {kind:'question',pattern:/\b([EPO])-(\d{6})\/((?:19|20)\d{2}|\d{2})(?![\d/])/g,
    key:m=>{const year=fullYear(m[3]);return questionTerms(year).length?`question:${m[1]}-${year}-${m[2]}`:null;}},
];

export function referenceKey(value) {
  const text=String(value);
  if(/^celex:[35]\d{4}[A-Z]{1,2}\d{4}$/.test(text))return text;
  if(/^(?:com|swd|join):(?:19|20)\d{2}\/[1-9]\d{0,3}$/.test(text))return text;
  if(/^procedure:(?:19|20)\d{2}\/\d{4}[A-Z]?\([A-Z]{3}\)$/.test(text))return text;
  const question=text.match(/^question:([EPO])-((?:19|20)\d{2})-(\d{6})$/);
  if(question&&questionTerms(Number(question[2])).length)return text;
  return null;
}
// Candidate CELEX numbers for a Commission document. Exactly one must exist to resolve.
export function documentCelexCandidates(key) {
  const match=String(key).match(/^(com|swd|join):(\d{4})\/(\d{1,4})$/);
  return match?documentSector[match[1].toUpperCase()].map(sector=>`5${match[2]}${sector}${pad(match[3],4)}`):[];
}
export function questionCandidates(key) {
  const match=String(key).match(/^question:([EPO])-(\d{4})-(\d{6})$/);
  return match?questionTerms(Number(match[2])).map(term=>`${match[1]}-${term}-${match[2]}-${match[3]}`):[];
}
export function findReferences(text) {
  const value=String(text||''),found=[];
  for(const {kind,pattern,key} of patterns)for(const match of value.matchAll(pattern)) {
    const id=key(match);
    if(id)found.push({start:match.index,end:match.index+match[0].replace(/[.,;:]+$/,'').length,key:id,kind});
  }
  found.sort((a,b)=>a.start-b.start||b.end-a.end);
  const result=[];let end=0;
  for(const item of found)if(item.start>=end){result.push({...item,text:value.slice(item.start,item.end)});end=item.end;}
  return result;
}
// Splits text into plain parts and reference parts without changing a character.
export function referenceSegments(text) {
  const value=String(text||''),parts=[];let cursor=0;
  for(const ref of findReferences(value)){if(ref.start>cursor)parts.push({text:value.slice(cursor,ref.start)});parts.push({text:ref.text,ref});cursor=ref.end;}
  if(cursor<value.length)parts.push({text:value.slice(cursor)});
  return parts;
}
export function referenceKeys(texts,limit=40) {
  const keys=[];
  for(const text of texts)for(const ref of findReferences(text))if(!keys.includes(ref.key)){keys.push(ref.key);if(keys.length>=limit)return keys;}
  return keys;
}
export const eurLexUrl=(celex,language='en')=>`https://eur-lex.europa.eu/legal-content/${String(language).toUpperCase()}/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
// Cellar writes 2012/0011/COD; Parliament and OEIL write 2012/0011(COD).
export function cellarProcedureReference(value) {
  const match=String(value||'').match(/^((?:19|20)\d{2})\/(\d{4}[A-Z]?)[/(]([A-Z]{3})\)?$/);
  return match?`${match[1]}/${match[2]}(${match[3]})`:null;
}
