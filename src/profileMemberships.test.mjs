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

test('an open membership reads as present only when it began in the current service and its body has not ended',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {ProfileMemberships}=await loadModule('/src/ProfileMemberships.tsx');
  const window=new Window();t.after(()=>window.happyDOM.close());
  const item=(index,name,start,temporal)=>({index,section:'delegations',membershipId:'m'+index,bodyId:'org/'+index,role:'def/ep-roles/MEMBER',classification:null,start,end:null,dateIssues:[],observation:null,body:{id:'org/'+index,identifier:String(index),prefLabel:{en:name},classification:'',temporal,source:{url:'',fetchedAt:'',stale:false}}});
  const items=[item(1,'Current delegation','2024-07-16',{startDate:'2024-07-16'}),item(2,'Earlier delegation','2009-07-14',{startDate:'2009-07-14',endDate:'2014-06-30'}),item(3,'Dissolved delegation','2024-09-01',{startDate:'2024-09-01',endDate:'2025-01-01'})];
  const membershipHistory={version:1,observationAvailable:true,observationComplete:true,observationIssues:[],observations:[],labelsComplete:true,dateIssues:false,complete:true,error:null,sources:[],items};
  const render=status=>{window.document.body.innerHTML=renderToStaticMarkup(createElement(ProfileMemberships,{profile:{membershipHistory,currentAffiliation:{status,day:'2026-10-26'},parliamentaryService:{currentSince:'2024-07-16'}},lang:'en',roleName:role=>role,date:value=>value,retry:()=>{}}));return [...window.document.querySelectorAll('li')].map(node=>node.textContent);};
  const current=render('matched');
  assert.match(current.find(text=>text.includes('Current delegation')),/2024-07-16 — Present/);
  assert.match(current.find(text=>text.includes('Earlier delegation')),/From 2009-07-14/,'an open membership from an earlier term is not presented as current');
  assert.match(current.find(text=>text.includes('Dissolved delegation')),/From 2024-09-01/,'a membership of an ended body is not presented as current');
  assert(render('not-current').every(text=>!text.includes('Present')),'a former member has no present memberships');
});
