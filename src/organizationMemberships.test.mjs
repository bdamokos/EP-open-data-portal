import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationMemberships} from '../server/odp.mjs';
import {organizationId,matchesOrganization,membershipHref} from './memberFilters.mjs';
test('organisation membership uses exact IDs and valid inclusive dates',()=>{
 const make=(org,start,end)=>({organization:org,memberDuring:{startDate:start,endDate:end}});
 const rows=organizationMemberships({hasMembership:[make('org/12','2024-07-16','2026-10-31'),make('org/13','2026-11-01'),make('org/14','2026-02-30'),make('org/15',null),make('https://example.org/org/12','2024-07-16'),make('org/16','2024-01-01','2026-10-30')]},'2026-10-31');
 assert.deepEqual(rows.filter(r=>r.current).map(r=>r.id),['12']);
 assert(matchesOrganization({organizationMemberships:rows},'12'));
 assert(!matchesOrganization({organizationMemberships:rows},'13'));
 assert(!matchesOrganization({organizationMemberships:null},'12'));
 assert.equal(organizationMemberships({}),null);
 assert.deepEqual(organizationMemberships({hasMembership:[]}),[]);
 assert.equal(organizationId('https://example.org/org/12'),'');
 assert.equal(organizationId('https://data.europarl.europa.eu/org/12'),'12');
 assert.equal(new URL(membershipHref('org/12','hu','A & B'),'https://example.org').searchParams.get('organization'),'12');
});

test('object references and observation completeness remain independent of known matches',async()=>{
 const {organizationMembershipSnapshot}=await import('../server/organization-memberships.mjs');
 const {organizationCoverageComplete}=await import('./memberFilters.mjs');
 const valid={organization:{id:'org/12'},memberDuring:{startDate:'2024-07-16'}};
 const exact=organizationMembershipSnapshot({hasMembership:[valid]},'2026-10-31');
 assert.equal(exact.items[0].id,'12');assert.equal(exact.items[0].current,true);assert.equal(exact.complete,true);
 for(const bad of [null,'bad',{}, {organization:'org/12',memberDuring:{startDate:'2026-02-30'}},{organization:'org/12'}, {organization:'org/12',memberDuring:{startDate:'2024-07-16',endDate:{raw:'unknown'}}}]){
  const snapshot=organizationMembershipSnapshot({hasMembership:[valid,bad]},'2026-10-31');
  const member={organizationMemberships:snapshot.items,organizationMembershipsComplete:snapshot.complete};
  assert(matchesOrganization(member,'12'),'a known match is retained');
  assert.equal(organizationCoverageComplete(member,'12'),false,'incomplete observations cannot establish a complete count');
 }
 const empty=organizationMembershipSnapshot({hasMembership:[]},'2026-10-31');
 assert.equal(organizationCoverageComplete({organizationMemberships:empty.items,organizationMembershipsComplete:empty.complete},'12'),true);
});

test('known exact body dates suppress ended/future bodies without successor expansion',async()=>{
 const {organizationMembershipSnapshot}=await import('../server/organization-memberships.mjs');
 const person={hasMembership:[{organization:'org/12',memberDuring:{startDate:'2024-09-01'}}]};
 for(const [temporal,current] of [[{endDate:'2025-01-01'},false],[{startDate:'2027-01-01'},false],[{endDate:'2026-10-31'},true],[{endDate:'2026-02-30'},null]]){
  const rows=organizationMembershipSnapshot(person,'2026-10-31',new Map([['12',{temporal}]]));assert.equal(rows.items[0].current,current);
 }
 assert.equal(organizationMembershipSnapshot(person,'2026-10-31',new Map([['13',{temporal:{endDate:'2025-01-01'}}]])).items[0].current,true);
});
