import {outsideCapacity} from './outside-model.mjs';
import {titlePlaces} from './insights-places.mjs';
import {countryIdentity} from './topic-country-identity.mjs';

// Replaceable eligibility policy. Inputs are all retained appearances of one exact
// person ID (one row per speech), with debatePlaces resolved by the projection.
// Output maps qualifying speech IDs to country and evidence basis; no names
// participate in identity or geography. A tied institutional majority fails closed.
export function outsideSpeakerCountries(personId,appearances){
 const rows=appearances.filter(a=>String(a.personId)===String(personId));
 const counts=new Map();for(const a of rows){const c=outsideCapacity(a.header?.role);if(c)counts.set(c,(counts.get(c)||0)+1);}
 const max=Math.max(0,...counts.values());
 if(['commission','council','eu'].some(c=>counts.get(c)===max))return new Map();
 const qualified=new Map();
 for(const a of rows){
  if(outsideCapacity(a.header?.role)!=='leaders')continue;
  const roles=[a.header?.role,...(a.header?.observations||[]).map(o=>o.role)];
  const places=new Set(roles.flatMap(r=>titlePlaces(r||'').places.map(p=>countryIdentity(p.id)?.id).filter(Boolean)));
  const agreed=[...places].filter(p=>a.debatePlaces?.includes(p));
  if(agreed.length===1)qualified.set(a.id,{country:agreed[0],basis:'role-debate-agreement'});
 }
 return qualified;
}
