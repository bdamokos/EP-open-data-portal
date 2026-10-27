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
  const probe=(start,{end=null,temporal={startDate:'1979-07-17'},currentSince='2012-01-01'}={})=>{
    const history={...membershipHistory,items:[{...item(9,'Probe',start,temporal),end}]};
    window.document.body.innerHTML=renderToStaticMarkup(createElement(ProfileMemberships,{profile:{membershipHistory:history,currentAffiliation:{status:'matched',day:'2026-10-26'},parliamentaryService:{currentSince}},lang:'en',roleName:role=>role,date:value=>value,retry:()=>{}}));
    return window.document.querySelector('li').textContent;
  };
  assert.match(probe('2014-07-01'),/From 2014-07-01/,'continuous service since an earlier term does not make an earlier-term membership current');
  assert.match(probe('2024-09-01'),/2024-09-01 — Present/,'a long-lived body with only a start date keeps a current membership present');
  assert.doesNotMatch(probe('2026-02-30'),/Present/,'an invalid start never establishes a present membership');
  assert.match(probe('2030-01-01'),/From 2030-01-01/,'a future start is not present');
  assert.doesNotMatch(probe('2024-09-01',{end:{raw:'unknown'}}),/Present/,'an invalid supplied end is not a missing end');
  assert.match(probe('2024-09-01',{currentSince:'2025-03-01'}),/From 2024-09-01/,'a membership from before a return to Parliament is not present');
});


test('contiguous profile periods merge by exact organisation identity and preserve current evidence',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {profileMembershipPeriods}=await loadModule('/src/profileMembershipPeriods.ts');
  const {ProfileMemberships}=await loadModule('/src/ProfileMemberships.tsx');
  const item=(index,start,end,bodyId='org/5153',extra={})=>({index,section:'political-groups',membershipId:'membership/'+index,bodyId,role:'def/ep-roles/MEMBER',classification:'def/ep-entities/EU_POLITICAL_GROUP',start,end,dateIssues:[],observation:{id:'membership/'+index},body:{id:bodyId,classification:'def/ep-entities/EU_POLITICAL_GROUP',isVersionOf:'org/PPE',prefLabel:{en:'European People’s Party'},temporal:end?{endDate:end}:{},source:{stale:false}},...extra});
  const old=item(1,'2019-07-02','2024-07-15');
  const current=item(2,'2024-07-16',null,'org/7018');
  const ongoing=row=>row===current;
  const input=[current,old],original=JSON.stringify(input);
  const merged=profileMembershipPeriods(input,ongoing);
  assert.equal(merged.length,1);
  assert.deepEqual([merged[0].start,merged[0].end,merged[0].ongoing],['2019-07-02',null,true]);
  assert.deepEqual(merged[0].items,[old,current]);
  assert.equal(JSON.stringify(input),original,'source observations are unchanged');
  const markup=renderToStaticMarkup(createElement(ProfileMemberships,{profile:{membershipHistory:{observationAvailable:true,observationComplete:true,items:input},currentAffiliation:{status:'matched',day:'2026-10-27'},parliamentaryService:{currentSince:'2019-07-02'}},lang:'en',date:value=>value,roleName:role=>role,retry:()=>{}}));
  assert.match(markup,/2019-07-02<\/span> — <span lang="en">Present/);
  assert.equal((markup.match(/<li>/g)||[]).length,1);
  for(const changed of [
    {...current,start:'2024-07-17'}, // A day without membership.
    {...current,start:'2024-07-15'}, // Overlap.
    {...current,start:'2024-02-30'},
    {...current,end:{raw:'unknown'}},
    {...current,end:'2020-01-01'},
    {...current,role:'def/ep-roles/CHAIR'},
    {...current,classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP'},
    {...current,body:{...current.body,isVersionOf:'org/OTHER'}},
    {...current,body:{...current.body,isVersionOf:null}},
  ])assert.equal(profileMembershipPeriods([old,changed],()=>false).length,2,JSON.stringify(changed));
  assert.equal(profileMembershipPeriods([{...old,end:null},current],ongoing).length,2,'an unknown earlier end cannot bridge a period');
  assert.equal(profileMembershipPeriods([{...old,body:null},{...current,bodyId:old.bodyId,body:null}],ongoing).length,1,'an exact body ID needs no family relationship');
  assert.equal(profileMembershipPeriods([old,{...current,body:{...current.body,isVersionOf:'https://data.europarl.europa.eu/org/PPE'}}],ongoing).length,1);
  const conflict=item(3,'2024-07-01','2024-08-01','org/7018',{role:'def/ep-roles/CHAIR'});
  assert.equal(profileMembershipPeriods([old,current,conflict],ongoing).length,3,'a conflicting role across the boundary stays visible');
  const third=item(4,'2014-07-01','2019-07-01');
  assert.equal(profileMembershipPeriods([current,old,third],ongoing)[0].start,'2014-07-01','multiple boundaries merge');
  const leapOld=item(5,'2020-01-01','2020-02-29');
  assert.equal(profileMembershipPeriods([leapOld,item(6,'2020-03-01','2020-12-31')],()=>false).length,1);
});

test('national-party display merges require exact metadata at a term boundary',async t=>{
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>loadModule.close());
  const {profileMembershipPeriods}=await loadModule('/src/profileMembershipPeriods.ts');
  const {ProfileMemberships}=await loadModule('/src/ProfileMemberships.tsx');
  const make=(index,bodyId,start,end)=>({index,section:'national-parties',membershipId:'membership/'+index,bodyId,role:'def/ep-roles/MEMBER',classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',start,end,dateIssues:[],observation:{id:'membership/'+index},body:{id:bodyId,classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',label:'PP',prefLabel:{en:'Partido Popular',es:'Partido Popular'},represents:['http://publications.europa.eu/resource/authority/country/ESP'],temporal:{startDate:start,...(end?{endDate:end}:{})},source:{stale:false}}});
  const old=make(1,'org/5211','2019-07-02','2024-07-15'),current=make(2,'org/6666','2024-07-16',null);
  const render=items=>renderToStaticMarkup(createElement(ProfileMemberships,{profile:{membershipHistory:{observationAvailable:true,observationComplete:true,items},currentAffiliation:{status:'matched',day:'2026-10-27'},parliamentaryService:{currentSince:'2019-07-02'}},lang:'en',date:value=>value,roleName:role=>role,retry:()=>{}}));
  const input=[current,old],original=JSON.stringify(input),merged=profileMembershipPeriods(input,row=>row===current);
  assert.equal(merged.length,1);assert.deepEqual(merged[0].items,[old,current]);assert.equal(JSON.stringify(input),original);
  assert.equal((render(input).match(/<li>/g)||[]).length,1);assert.match(render(input),/2019-07-02<\/span> — <span lang="en">Present/);
  for(const body of [
    {...current.body,label:'P.P.'},
    {...current.body,label:'-'},
    {...current.body,prefLabel:{en:'Partido popular',es:'Partido Popular'}},
    {...current.body,prefLabel:{en:'Partido Popular'}},
    {...current.body,prefLabel:{en:'Partido Popular',es:''}},
    {...current.body,represents:['http://publications.europa.eu/resource/authority/country/PRT']},
    {...current.body,represents:[]},
    {...current.body,source:{stale:true}},
    {...current.body,temporal:{startDate:'2024-07-17'}},
    {...current.body,id:'org/OTHER'},
  ])assert.equal(profileMembershipPeriods([old,{...current,body}],()=>false).length,2,JSON.stringify(body));
  assert.equal(profileMembershipPeriods([{...old,body:{...old.body,label:'-'}},{...current,body:{...current.body,label:'-'}}],()=>false).length,2,'matching placeholders are not party names');
  assert.equal(profileMembershipPeriods([{...old,body:{...old.body,isVersionOf:'org/OLD'}},{...current,body:{...current.body,isVersionOf:'org/NEW'}}],()=>false).length,2,'published identities cannot be overridden by labels');
  assert.equal(profileMembershipPeriods([{...old,end:'2023-12-31',body:{...old.body,temporal:{endDate:'2023-12-31'}}},{...current,start:'2024-01-01',body:{...current.body,temporal:{startDate:'2024-01-01'}}}],()=>false).length,2,'a midterm body replacement does not use the fallback');
  assert.equal(profileMembershipPeriods([old,current,{...current,index:3,membershipId:'membership/3',bodyId:'org/999',body:{...current.body,id:'org/999'}}],()=>false).length,3,'ambiguous successor observations stay separate');
  const earlier=make(4,'org/1234','2014-07-01','2019-07-01');
  assert.equal(profileMembershipPeriods([earlier,old,current],()=>false).length,1,'multiple term boundaries merge');
  const oldMidterm={...old,start:'2020-03-01'};
  assert.equal(profileMembershipPeriods([oldMidterm,current],()=>false).length,1,'a membership can begin after its body’s term start');
});
