import {nameScript} from './speaker-identity.mjs';
import {amendmentProposerDate,normalizedDocxDescriptor} from './amendments.mjs';

export const AMENDMENT_AUTHOR_NAMES_VERSION=1;
export const memberNameFields=person=>Object.fromEntries(['givenName','familyName','officialGivenName','officialFamilyName'].map(key=>[key,typeof person?.[key]==='string'?person[key]:'']));
const normalized=value=>value.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('und');
export const hasNonLatinAuthors=extraction=>Boolean(extraction?.amendments?.some(a=>a.authors?.some(name=>/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name))));
const latinLanguages=['en','fr','es','de','it','pl','nl','pt','sv','fi','ro','mt','lv','sl','ga','cs','hr','sk','da','hu','et','lt'];
// Read at most one published Latin-script counterpart, only when the chosen
// source has Greek/Cyrillic proposers. Never construct a distribution URL.
export function alternateAuthorDescriptor(list,extraction) {
  if(!hasNonLatinAuthors(extraction))return null;
  const files=list.distributionEvidence?.descriptors||[];
  return normalizedDocxDescriptor(latinLanguages.flatMap(language=>files.filter(file=>file.language===language&&file.url!==extraction.sourceUrl))[0]);
}
export function authorNameVariants(author,source) {
  return [{value:author.name,script:nameScript(author.name),language:source?.language??null,source:source??null}];
}
// A byline established elsewhere in this exact list/date can disambiguate a
// multi-author amendment. Conflicting crosswalks never pick an identity.
export function listAuthorResolver({extraction,alternate,resolve,date,source}) {
  const bridges=new Map();
  for(const amendment of extraction.amendments||[]) {
    if(amendmentProposerDate(amendment)?.date!==date||amendment.authors?.length!==1)continue;
    const matches=(alternate?.amendments||[]).filter(other=>Number(other.number)===Number(amendment.number));
    if(matches.length!==1)continue;
    const authors=resolveParallelAuthors({authors:resolve(amendment.authors),amendment,alternate:matches[0],resolve,source});
    const author=authors[0];
    if(author.status!=='resolved'||author.method!=='parallel_list_full_name_active_mandate')continue;
    const key=normalized(author.name),prior=bridges.get(key)||[];if(!prior.some(a=>a.personId===author.personId))bridges.set(key,[...prior,author]);
  }
  return names=>resolve(names).map(author=>{
    const candidates=bridges.get(normalized(author.name))||[],ids=new Set(candidates.map(a=>a.personId));
    if(!ids.size)return author;
    if(ids.size>1||author.personId&&!ids.has(author.personId))return {...author,personId:null,status:'ambiguous',method:null,evidence:[...author.evidence,...candidates.flatMap(a=>a.evidence)]};
    return author.status==='missing'?{...candidates[0],name:author.name,evidence:[...author.evidence,...candidates.flatMap(a=>a.evidence)]}:author;
  });
}
// Parallel language editions identify the same numbered amendment in the same
// published list. Transfer only a SINGLE remaining identity after every other
// proposer already matches; array order and transliteration establish nothing.
const conflict=(authors,source,reason)=>authors.map(author=>author.status==='missing'||author.method==='parallel_list_full_name_active_mandate'?{...author,personId:null,status:'ambiguous',method:null,displayName:undefined,nameVariants:(author.nameVariants||[]).filter(v=>v.value===author.name),evidence:[...author.evidence,{type:'parallel_list_conflict',source,reason}]}:author);
export function resolveParallelAuthors({authors,amendment,alternate,resolve,source}) {
  if(amendment.proposerRetained||amendment.recordRetained||!alternate||alternate.listId!==amendment.listId||alternate.targetDocumentId!==amendment.targetDocumentId||Number(alternate.number)!==Number(amendment.number))return authors;
  const date=amendmentProposerDate(amendment),otherDate=amendmentProposerDate(alternate);
  if(!date||!otherDate||date.date!==otherDate.date||!Array.isArray(alternate.authors))return authors;
  if(alternate.authors.length&&alternate.authors.length!==authors.length)return conflict(authors,source,'different-proposer-count');
  const counterparts=resolve(alternate.authors);
  if(counterparts.some(a=>a.status!=='resolved'||!a.personId)||new Set(counterparts.map(a=>a.personId)).size!==counterparts.length)return authors;
  const known=authors.filter(a=>a.personId).map(a=>a.personId);
  if(new Set(known).size!==known.length||known.some(id=>!counterparts.some(a=>a.personId===id)))return conflict(authors,source,'different-proposer-identities');
  const unknown=authors.filter(a=>a.status==='missing');
  if(unknown.length!==1||authors.some(a=>a.status!=='resolved'&&a.status!=='missing'))return authors;
  const remaining=counterparts.filter(a=>!known.includes(a.personId));
  if(remaining.length!==1||normalized(unknown[0].name)===normalized(remaining[0].name))return authors;
  const counterpart=remaining[0];
  return authors.map(author=>author!==unknown[0]?author:{...author,personId:counterpart.personId,status:'resolved',method:'parallel_list_full_name_active_mandate',displayName:counterpart.displayName||counterpart.name,
    nameVariants:[...(author.nameVariants||[]),...authorNameVariants(counterpart,source)],
    evidence:[...author.evidence,{type:'parallel_list_byline',listId:amendment.listId,amendmentNumber:amendment.number,date:date.date,source,sourceName:author.name,matchedName:counterpart.name,personId:counterpart.personId,identityEvidence:counterpart.evidence}]});
}
