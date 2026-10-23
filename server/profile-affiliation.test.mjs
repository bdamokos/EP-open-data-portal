import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {memberSummary} from './odp.mjs';

const moduleUrl=JSON.stringify(new URL('./odp.mjs',import.meta.url).href);
async function run(t,script) {
  const directory=await mkdtemp(path.join(tmpdir(),'profile-affiliation-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400_000).toISOString()}));
  return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
    const calls=[];
    const people=[['256810','FI','PPE'],['197410','DE','PPE'],['124760','FR','ECR'],['256960','DE','NI']];
    const roster=people.map(([identifier,country,group])=>({identifier,givenName:'Same',familyName:'Name',sortLabel:'Name','api:country-of-representation':country,'api:political-group':group}));
    const person=id=>({identifier:String(id),givenName:'Same',familyName:'Name',hasEmail:['mailto:public@example.org'],hasMembership:[]});
    const reply=data=>Response.json({data});
    const {odpProfile,odpDirectory}=await import(${moduleUrl});
    ${script}
  `],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8',timeout:10000}));
}

test('summary preserves unknown codes and capabilities, distinguishing explicit empty contacts',()=>{
  const missing=memberSummary({identifier:'43'});
  for(const key of ['countryCode','groupCode','hasEmail','hasCv','hasNews','hasVideo'])assert.equal(missing[key],null,key);
  for(const value of [[], '', 'mailto:'])assert.equal(memberSummary({identifier:'43',hasEmail:value}).hasEmail,false);
  assert.equal(memberSummary({identifier:'43',hasEmail:null}).hasEmail,null);
  assert.equal(memberSummary({identifier:'43',hasEmail:['mailto:a@example.org']}).hasEmail,true);
});

test('profile codes use exact current roster IDs, retain provenance, and reconcile directory contacts',async t=>{
  const out=await run(t,`
    globalThis.fetch=async url=>{
      calls.push(String(url));const endpoint=new URL(url).pathname;
      if(endpoint.endsWith('/meps/show-current'))return reply(roster);
      if(endpoint.endsWith('/corporate-bodies/show-current'))return reply([]);
      const id=endpoint.match(/\\/meps\\/(\\d+)$/)?.[1];
      if(id)return reply([person(id)]);
      throw Error('Unexpected fixture source '+url);
    };
    const profiles=[];for(const [id] of people)profiles.push(await odpProfile(id));
    const directory=await odpDirectory();
    console.log(JSON.stringify({profiles,directory,calls}));process.exit(0);
  `);
  const expected=[['FI','PPE'],['DE','PPE'],['FR','ECR'],['DE','NI']];
  for(const [i,p] of out.profiles.entries()) {
    assert.deepEqual([p.countryCode,p.groupCode],expected[i]);
    assert.equal(p.currentAffiliation.personId,String(p.id));
    assert.equal(p.currentAffiliation.status,'matched');
    assert.match(p.currentAffiliation.day,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(p.sources.length,2);
    assert.deepEqual(p.currentAffiliation.sources,[p.sources[1]]);
    assert.match(p.sources[1].url,/\/meps\/show-current\?/);
    assert(Number.isFinite(Date.parse(p.sources[1].fetchedAt)));
    assert.equal(p.sources[1].stale,false);
    assert.equal(p.hasEmail,true);
    const m=out.directory.members.find(m=>m.id===p.id);
    assert.deepEqual([m.countryCode,m.groupCode,m.hasEmail],[...expected[i],true]);
  }
  assert.equal(out.calls.filter(url=>url.includes('/meps/show-current')).length,1,'reuse the shared roster source');
});

test('a same-name different ID cannot establish current affiliation',async t=>{
  const out=await run(t,`
    globalThis.fetch=async url=>new URL(url).pathname.endsWith('/meps/show-current')?reply(roster):reply([person(43)]);
    console.log(JSON.stringify(await odpProfile(43)));
  `);
  assert.equal(out.countryCode,null);assert.equal(out.groupCode,null);
  assert.equal(out.currentAffiliation.status,'not-current');
});

test('missing roster fields remain null and do not fall back to detail or citizenship',async t=>{
  const out=await run(t,`
    globalThis.fetch=async url=>new URL(url).pathname.endsWith('/meps/show-current')?reply([{identifier:'43'}]):reply([{...person(43),'api:country-of-representation':'XX','api:political-group':'OLD',citizenship:'country/FIN'}]);
    console.log(JSON.stringify(await odpProfile(43)));
  `);
  assert.equal(out.countryCode,null);assert.equal(out.groupCode,null);
  assert.equal(out.currentAffiliation.status,'matched');
});

test('roster errors preserve a readable profile and prevent response caching',async t=>{
  const out=await run(t,`
    globalThis.fetch=async url=>{if(new URL(url).pathname.endsWith('/meps/show-current'))throw Error('roster offline');return reply([person(43)]);};
    const profile=await odpProfile(43);
    const {apiCachePolicy}=await import(${JSON.stringify(new URL('./response-cache.mjs',import.meta.url).href)});
    console.log(JSON.stringify({profile,policy:apiCachePolicy({method:'GET'},new URL('http://localhost/api/profile/43'),profile)}));
  `);
  assert.equal(out.profile.countryCode,null);assert.equal(out.profile.groupCode,null);
  assert.equal(out.profile.email,'public@example.org');
  assert.equal(out.profile.currentAffiliation.status,'unavailable');
  assert(out.profile.currentAffiliation.error);
  assert.equal(out.policy.cacheControl,'no-store');
});

test('duplicate roster identifiers are ambiguous and a mismatched person response is rejected',async t=>{
  const out=await run(t,`
    globalThis.fetch=async url=>new URL(url).pathname.endsWith('/meps/show-current')?reply([roster[0],roster[0]]):reply([person(256810)]);
    const profile=await odpProfile(256810);
    const error=await odpProfile(43).then(()=>null,error=>error.code);
    console.log(JSON.stringify({profile,error}));
  `);
  assert.equal(out.profile.countryCode,null);assert.equal(out.profile.groupCode,null);
  assert.equal(out.profile.currentAffiliation.status,'unavailable');
  assert.equal(out.error,'mep_not_found');
});
