import {validDay} from './source-availability.mjs';
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
function officeCountry(position,citizenships){
 if(position.international)return null;
 const countries=[...new Set((position.countries||[]).map(country).filter(Boolean))];
 if(countries.length)return countries.length===1?countries[0]:null;
 const jurisdictions=[...new Set((position.jurisdictions||[]).map(country).filter(Boolean))];
 if(jurisdictions.length)return jurisdictions.length===1?jurisdictions[0]:null;
 // An observed non-country jurisdiction is not a missing property. International
 // offices cannot borrow the nationality of their holder.
 if(position.hasCountry||position.hasJurisdiction)return null;
 const fallback=[...new Set((citizenships||[]).map(country).filter(Boolean))];
 return fallback.length===1?fallback[0]:null;
}
export function matchOutsideName(appearance,record){
 if(!record||record.status==='unavailable')return {status:'unavailable'};
 if(record.status==='none')return {status:'none'};
 if(record.status!=='available'||!Array.isArray(record.candidates))return {status:'unavailable'};
 const wanted=normalizeOutsideName(appearance.header?.name);if(!wanted)return {status:'none'};
 const active=record.candidates.filter(c=>c.human===true&&/^Q[1-9]\d*$/.test(c.qid||'')&&(c.names||[]).some(n=>['label','alias'].includes(n.kind)&&normalizeOutsideName(n.value)===wanted)).map(c=>({candidate:c,positions:(c.positions||[]).filter(p=>validDay(p.start)&&p.statement&&p.start<=appearance.date&&(!p.end||validDay(p.end)&&p.end>=appearance.date))})).filter(c=>c.positions.length);
 // Uniqueness precedes country selection: a second dated exact-name candidate
 // remains ambiguous even when only one of them has a usable country.
 const candidates=[...new Map(active.map(c=>[c.candidate.qid,c])).values()];
 if(candidates.length!==1)return {status:candidates.length?'ambiguous':'none',candidateIds:candidates.map(c=>c.candidate.qid)};
 const {candidate,positions}=candidates[0];if(positions.some(p=>p.international))return {status:'none',reason:'international-office'};
 const choices=positions.map(p=>({position:p,country:officeCountry(p,candidate.citizenships)})).filter(p=>p.country),countries=[...new Set(choices.map(p=>p.country))];
 if(countries.length!==1)return {status:'none',reason:'office-country-unavailable'};
 return {status:'matched',country:countries[0],basis:'wikidata-name-dated-office',wikidata:{qid:candidate.qid,revision:candidate.revision,matchingName:(candidate.names||[]).find(n=>normalizeOutsideName(n.value??n)===wanted),positions:choices.filter(p=>p.country===countries[0]).map(p=>p.position),fetchedAt:record.fetchedAt,urls:record.urls}};
}
// Option A is the primary EP path. Only speakers failing it enter the name
// matcher, at the maintainer's direction; office dates and uniqueness corroborate
// equality of the names. Diagnostic ambiguity never becomes UI method text.
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
