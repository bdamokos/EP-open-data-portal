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
