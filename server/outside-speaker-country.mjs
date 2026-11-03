import {outsideOfficeOnDay} from './outside-office-date.mjs';
import {outsideCapacity} from './outside-model.mjs';
import {titlePlaces} from './insights-places.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import casefold from './outside-name-casefold.json' with {type:'json'};
const institutional=new Set(['commission','council','eu']);
export const normalizeOutsideName=value=>[...String(value||'').normalize('NFC').replace(/\s+/gu,' ').trim()].map(c=>casefold.folds[c]||c).join('');
export const outsideRoleCountries=a=>[...new Set([a.header?.role,...(a.header?.observations||[]).map(o=>o.role)].flatMap(r=>titlePlaces(r||'').places.map(p=>countryIdentity(p.id)?.id).filter(Boolean)))];
export function outsideInstitutionalMajority(appearances){
 const current=appearances.filter(a=>a.term===10),rows=current.length?current:appearances;
 const counts=new Map();for(const a of rows){const c=outsideCapacity(a.header?.role);if(c)counts.set(c,(counts.get(c)||0)+1);}
 const max=Math.max(0,...counts.values());return [...institutional].some(c=>counts.get(c)===max);
}
export const outsideAppearanceEligible=a=>!institutional.has(outsideCapacity(a.header?.role))&&outsideCapacity(a.header?.role)!=='international';
const country=id=>countryIdentity(id)?.id||null;
function officeCountry(position){
 if(position.international)return null;
 // A country-valued jurisdiction is the office's more specific territory
 // (for example Greenland); the holder's nationality does not override it.
 const jurisdictions=[...new Set((position.jurisdictions||[]).map(country).filter(Boolean))];
 if(jurisdictions.length)return jurisdictions.length===1?jurisdictions[0]:null;
 const countries=[...new Set((position.countries||[]).map(country).filter(Boolean))];
 return countries.length===1?countries[0]:null;
}
export function matchOutsideName(appearance,record){
 if(!record||record.status==='unavailable')return {status:'unavailable'};
 if(record.status==='none')return {status:'none',reason:'no-exact-human'};
 if(record.status!=='available'||record.dateVersion!==1||!Array.isArray(record.candidates))return {status:'unavailable'};
 const wanted=normalizeOutsideName(appearance.header?.name);if(!wanted)return {status:'none',reason:'name-unavailable'};
 const exact=record.candidates.filter(c=>c.human===true&&/^Q[1-9]\d*$/.test(c.qid||'')&&(c.names||[]).some(n=>['label','alias'].includes(n.kind)&&normalizeOutsideName(n.value)===wanted));
 const candidates=[...new Map(exact.map(c=>[c.qid,c])).values()];
 // Uniqueness is about exact-name humans, before occupation, office or country.
 if(candidates.length!==1)return {status:candidates.length?'ambiguous':'none',reason:candidates.length?'multiple-exact-humans':'no-exact-human',candidateIds:candidates.map(c=>c.qid)};
 const candidate=candidates[0],held=(candidate.positions||[]).filter(p=>p.statement&&/^Q[1-9]\d*$/.test(p.id||''));
 if(!candidate.politician&&!held.length)return {status:'none',reason:'not-politician-or-office-holder',qid:candidate.qid};
 const positions=held.filter(p=>held.filter(q=>q.statement===p.statement).every(q=>outsideOfficeOnDay(q,appearance.date)));
 if(positions.some(p=>p.international))return {status:'none',reason:'international-office',qid:candidate.qid};
 const choices=positions.map(p=>({position:p,country:officeCountry(p)})).filter(p=>p.country),countries=[...new Set(choices.map(p=>p.country))];
 const citizenships=candidate.citizenships||[],single=citizenships.length===1?country(citizenships[0]?.country??citizenships[0]):null;
 if(countries.length>1)return {status:'none',reason:'conflicting-office-countries',qid:candidate.qid};
 const selected=countries[0]||single;if(!selected)return {status:'none',reason:'country-unavailable',qid:candidate.qid};
 return {status:'matched',country:selected,basis:countries.length?'wikidata-name-office':'wikidata-name-citizenship',wikidata:{qid:candidate.qid,revision:candidate.revision,matchingName:(candidate.names||[]).find(n=>['label','alias'].includes(n.kind)&&normalizeOutsideName(n.value)===wanted),politician:candidate.politician||false,occupations:candidate.occupations||[],positions:(countries.length?choices.filter(p=>p.country===selected).map(p=>p.position):held),citizenships:candidate.citizenships,fetchedAt:record.fetchedAt,urls:record.urls}};
}
// Option A is the primary EP path. Only speakers failing it enter the name
// matcher, at the maintainer's direction; a unique human plus politician or
// office-holder status corroborates equality of the names. Diagnostic ambiguity never becomes UI method text.
export function resolveOutsideSpeaker(personId,appearances,{wikidata,requireWikidata=true}={}){
 const rows=appearances.filter(a=>String(a.personId)===String(personId)),addresses=new Map(),unavailable=[],diagnostics=[];
 if(outsideInstitutionalMajority(rows))return {addresses,unavailable,diagnostics};
 for(const a of rows){
  if(!outsideAppearanceEligible(a))continue;
  const agreed=outsideRoleCountries(a).filter(p=>a.debatePlaces?.includes(p));
  if(outsideCapacity(a.header?.role)==='leaders'&&agreed.length===1){addresses.set(a.id,{country:agreed[0],basis:'role-debate-agreement'});continue;}
  const match=matchOutsideName(a,wikidata);
  if(match.status==='unavailable'&&requireWikidata)unavailable.push(a.id);
  if(match.status==='ambiguous')diagnostics.push({speechId:a.id,status:'ambiguous',candidateIds:match.candidateIds});
  if(match.status==='matched')addresses.set(a.id,{country:match.country,basis:match.basis,wikidata:match.wikidata});
 }
 return {addresses,unavailable,diagnostics};
}
export function outsideSpeakerCountries(personId,appearances,options={}){return resolveOutsideSpeaker(personId,appearances,{requireWikidata:false,...options}).addresses;}
