import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {storyTables} from './story-facts-storage.mjs';
import {seedOutsideRoles,publishedOutsideRoles,collectOutsideRoles,roleObservation,trimPublishedRole,heldOutsideRole} from './outside-role-collector.mjs';
const appearance={id:'MTG-PL-2026-01-21-OTH-2017056975107',date:'2026-01-21',header:{observations:[]}};
for(const [language,role,tag]of [['en','King of Spain','es-t-en-mtec'],['fr',"roi d’Espagne",'fr'],['hu','spanyol király','hu']])test('retained header '+language+' avoids upstream',async()=>{
 const db=new DatabaseSync(':memory:');storyTables(db);const values=new Map();const store={db,get:k=>values.get(k),set:(k,v)=>values.set(k,v),assertWriter(){}};
 try{
  const a=structuredClone(appearance);a.header.observations=[{personId:'42',fragmentKey:language,languageTag:tag,role:' , '+role+' . '}];seedOutsideRoles(store,a,'42');
  const selected=publishedOutsideRoles(store,a.id,'42')[language];assert.equal(selected.role,role);assert.equal(selected.machineTranslated,tag.includes('mtec'));
  db.prepare('DELETE FROM outside_role_jobs WHERE language<>?').run(language);
  const worker={store,clock:()=>Date.parse('2026-11-04'),budget:10,requests:0,controller:new AbortController(),request(){throw Error('must not fetch');}};
  assert.equal(await collectOutsideRoles(worker),false);
 }finally{db.close();}
});
test('held corpus XML projects roles without selecting another language',()=>{
 const xml='<oralStatements><speech><from xml:lang="es-t-en-mtec"><person refersTo="person/42">Felipe VI</person><role> King of Spain . </role></from></speech></oralStatements>';
 const corpus={speechMetadata:()=>null,retainedSpeechFragments:()=>({fragments:{en:xml}}),db:{prepare:()=>({get:()=>({source_url:'exact-source',fetched_at:'2026-11-04'})})}};
 const role=heldOutsideRole(corpus,appearance,'42','en');assert.equal(role.role,'King of Spain');assert.equal(role.source.url,'exact-source');assert.equal(heldOutsideRole(corpus,appearance,'42','hu'),null);
});
test('punctuation trims boundaries and preserves quoted titles and null',()=>{
 const role='author of the report ‘Much more than a market’';assert.equal(trimPublishedRole(' , '+role+' . '),role);assert.equal(trimPublishedRole(null),null);
 assert.equal(roleObservation({fragmentKey:'en',languageTag:'en',role:null},'en',{}).role,null);
 assert.equal(roleObservation({fragmentKey:'fr',languageTag:'fr',role:'roi'},'hu',{}),null);
});
test('missing languages use one paced background request and retain null header provenance',async()=>{
 const db=new DatabaseSync(':memory:');storyTables(db);let now=Date.parse('2026-11-04'),calls=0;const values=new Map(),store={db,get:k=>values.get(k),set:(k,v)=>values.set(k,v),assertWriter(){}};
 try{
  seedOutsideRoles(store,appearance,'42');db.exec("DELETE FROM outside_role_jobs WHERE language NOT IN ('en','hu')");
  const worker={store,clock:()=>now,budget:10,requests:0,controller:new AbortController(),async request(endpoint,params,options){calls++;assert.equal(options.backgroundLow,true);assert.equal(params.language,'en');return {url:'exact-source?language=en',fetchedAt:'2026-11-04',payload:{data:[{activity_id:appearance.id,activity_date:appearance.date,had_activity_type:'PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/42']}],recorded_in_a_realization_of:[{'api:xmlFragment':{en:'<oralStatements><speech><from xml:lang="en"><person refersTo="person/42">Felipe VI</person></from></speech></oralStatements>'}}]}]}};}};
  assert(await collectOutsideRoles(worker));assert.equal(calls,1);const role=publishedOutsideRoles(store,appearance.id,'42').en;assert.equal(role.role,null);assert.equal(role.source.url,'exact-source?language=en');assert.equal(await collectOutsideRoles(worker),false);assert.equal(calls,1);
 }finally{db.close();}
});
