import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {freshLoader} from './test-support/viteRunner.mjs';
import {Window} from 'happy-dom';
import {profileMemberships} from '../server/profile-memberships.mjs';

test('profile disclosures are collapsed, retain raw identifiers, language and safe uncertain dates',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {ProfileMemberships}=await loadModule('/src/ProfileMemberships.tsx');
  const window=new Window();t.after(()=>window.happyDOM.close());
  const date=value=>{assert(!value.includes('02-30'));return value;};
  const render=membershipHistory=>{window.document.body.innerHTML=renderToStaticMarkup(createElement(ProfileMemberships,{profile:{membershipHistory},lang:'hu',roleName:role=>({MEMBER:'Tag',CHAIR_VICE:'Alelnök'})[role],date,retry:()=>{}}));return window.document.body;};
  const rows=[{id:'membership/1',organization:'org/5177',role:'def/ep-roles/MEMBER',membershipClassification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',memberDuring:{startDate:null}},
    {id:'membership/2',organization:'org/5142',role:'def/ep-roles/UNKNOWN_ROLE',membershipClassification:'def/ep-entities/DELEGATION_PARLIAMENTARY_ASSEMBLY',memberDuring:{startDate:'2024-02-30',endDate:{raw:'unknown'}}}];
  const history=profileMemberships({hasMembership:rows},{url:'https://data.europarl.europa.eu/api/v2/meps/124936',fetchedAt:Date.now()});
  history.items[0].body={prefLabel:{fr:'Parti Socialiste'}};
  const page=render(history);
  assert.equal(page.querySelectorAll('.explorer-profile-memberships > details').length,2);assert.equal(page.querySelectorAll('details[open]').length,0);
  assert.deepEqual([...page.querySelectorAll('.explorer-profile-memberships > details > summary')].map(node=>node.textContent),['Political affiliations','Delegations and other roles']);
  assert.equal(page.querySelector('details').firstElementChild.tagName,'SUMMARY');
  assert.equal(page.querySelector('a'),null,'organisation records are not linked as machine-readable data');
  assert.doesNotMatch(page.textContent,/not supplied|invalid in source/);assert.doesNotMatch(page.textContent,/Present/);
  assert.doesNotMatch(page.textContent,/invalid in source/);
  assert.doesNotMatch(page.textContent,/Role label unavailable|Name unavailable/);assert.match(page.textContent,/Unnamed organisation/);assert.doesNotMatch(page.textContent,/org\/5142/);
  assert.equal([...page.querySelectorAll('[lang=fr]')][0].textContent,'Parti Socialiste');
  assert(![...page.querySelectorAll('ol p')].some(node=>node.textContent==='Tag'),'ordinary affiliation membership is implicit');
  assert.equal(page.querySelector('ol').classList.contains('explorer-membership'),false);
  assert.match(render({...history,observationAvailable:false,observationComplete:false,observations:null}).textContent,/Membership information is unavailable/);
  assert.doesNotMatch(render({...history,observationAvailable:false,observationComplete:false,observations:null}).textContent,/None listed/);
  for(const entries of [[{}],['bad'],[{},rows[0],{...rows[1],role:null,organization:null}]]) {
    const malformed=profileMemberships({hasMembership:entries},{url:'https://data.europarl.europa.eu/api/v2/meps/124936',fetchedAt:Date.now()});
    const page=render(malformed);
    assert.match(page.textContent,/Some memberships unavailable/);
    assert.doesNotMatch(page.textContent,/No memberships listed in the source|Membership information is unavailable/);
    assert(page.querySelector('button'));
    if(entries.length>1){assert.doesNotMatch(page.textContent,/org\/5177|Role not supplied/);assert.match(page.textContent,/Unnamed organisation/);}
  }
});
