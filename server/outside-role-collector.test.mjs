import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {storyTables} from './story-facts-storage.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {speechTexts} from './corpus-worker.mjs';
import {outsideSpeech,OUTSIDE_ROLE_PARSER_REVISION} from './outside-model.mjs';
import {EU_PROTOCOL_ORDER} from './language-order.mjs';
import {seedOutsideRoles,publishedOutsideRoles,collectOutsideRoles,outsideRolesDue,roleObservation,trimPublishedRole,heldOutsideRoles,outsideRoleRetry,nextRoleRead,listOrCategoryRole} from './outside-role-collector.mjs';
const previousCorpusDirectory=process.env.CORPUS_DIR;
test.before(()=>{process.env.CORPUS_DIR=path.join(os.tmpdir(),'outside-role-test-no-corpus');});
test.after(()=>{if(previousCorpusDirectory===undefined)delete process.env.CORPUS_DIR;else process.env.CORPUS_DIR=previousCorpusDirectory;});
const id='MTG-PL-2026-01-21-OTH-2017056975107',date='2026-01-21',stamp='2026-11-04T10:00:00Z',source={url:'https://data.europarl.europa.eu/api/v2/speeches/'+id+'?include-output=xml_fragment',fetchedAt:stamp};
const fragment=(role,tag='en',machine=false)=>`<oralStatements><speech${machine?' xml:lang="en-t-hu-mtec"':''}><from xml:lang="${tag}"><person refersTo="person/42">Felipe VI</person>${role===null?'':`<role>${role}</role>`}</from><p>Retained speech.</p></speech></oralStatements>`;
const activity=fragments=>({activity_id:id,activity_date:date,had_activity_type:'PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/42']}],recorded_in_a_realization_of:[{'api:xmlFragment':fragments}]});
function setup(t,fragments={}){
 const db=new DatabaseSync(':memory:');storyTables(db);const values=new Map();let now=Date.parse(stamp),calls=0;
 const store={db,get:k=>values.get(k),set:(k,v)=>values.set(k,v),assertWriter(){}};t.after(()=>db.close());
 const speech=outsideSpeech(activity(fragments),source.fetchedAt,source.url);seedOutsideRoles(store,{...speech,header:speech.headers[0]},'42');
 const worker={store,clock:()=>now,requests:0,budget:10,controller:new AbortController(),async request(endpoint,params,options){calls++;assert.equal(endpoint,'/speeches/'+id);assert.deepEqual(params,{'include-output':'xml_fragment'});assert.equal(options.backgroundLow,true);return {...source,payload:{data:[activity({en:fragment('King of Spain'),hu:fragment('spanyol király'),pt:fragment('King of Spain')})]}};}};
 return {store,worker,calls:()=>calls,advance:delta=>now+=delta,row:()=>db.prepare('SELECT * FROM outside_role_speech_reads').get()};
}
test('real plain-tag shapes reject repetitions but keep Hungarian despite its English tag',()=>{
 const os=outsideSpeech(activity({en:fragment('King of Spain'),pt:fragment('King of Spain'),hu:fragment('spanyol király','en',true)}),stamp).headers[0].observations;
 assert.equal(roleObservation(os.find(o=>o.fragmentKey==='pt'),'pt',source,os).rejected,'untranslated');
 const hu=roleObservation(os.find(o=>o.fragmentKey==='hu'),'hu',source,os);assert.equal(hu.role,'spanyol király');assert.equal(hu.languageTag,'en');assert.equal(hu.machineTranslated,true);
 for(const [key,tag,title]of [['ro','en','President of the Republic of Moldova'],['fr','es','presidente electo de Venezuela']]){
  const obs=[{fragmentKey:key,languageTag:tag,role:title.toUpperCase()},{fragmentKey:tag,languageTag:tag,role:title}];assert.equal(roleObservation(obs[0],key,source,obs).rejected,'untranslated');
 }
});
test('only mul can use the tag to supply a missing language',()=>{
 for(const [key,tag,title]of [['en','es','Presidente Electo of Venezuela'],['hu','en','spanyol király']]){
  const o={fragmentKey:key,languageTag:tag,role:title};assert.equal(roleObservation(o,tag,source,[o]),null);
  assert.equal(roleObservation({...o,fragmentKey:'mul'},tag,source,[]).role,title);
 }
});
test('nested role markup, quoted reports and real abbreviation dots survive',()=>{
 const speech=outsideSpeech(activity({en:fragment('author of the report <i>‘Much more than a market’</i> .')}),stamp);
 assert.equal(trimPublishedRole(speech.headers[0].role),'author of the report ‘Much more than a market’');
 for(const title of ['President of the U.S.','Dr.'])assert.equal(trimPublishedRole(title),title);
 assert.equal(trimPublishedRole(' , King of Spain . '),'King of Spain');assert.equal(trimPublishedRole(null),null);
});
for(const role of ['Kategorie: Ministerpräsident (Armenien)','Anexo: Lista de primeiros-ministros da Armênia','Lista över Ukrainas presidenter','Lijst van premiers van Armenië','Lista de primeiros-ministros do Luxemburgo','Kategori: President','Kategoria: President','Kategorija: President','Categorie: President','Liste de présidents'])test('reject list/category: '+role,()=>assert(listOrCategoryRole(role)));
test('ordinary and imprecise titles remain outside the list detector',()=>{for(const role of ['Prime Minister of Armenia','author of the report ‘Much more than a market’','Jordānijas Hāšimītu Karalistes karaliste'])assert.equal(listOrCategoryRole(role),false);});
test('one all-language read fills every language together and keeps jobs compact',async t=>{
 const f=setup(t,{en:fragment('King of Spain')});assert(await collectOutsideRoles(f.worker,{held:()=>({})}));assert.equal(f.calls(),1);
 const roles=publishedOutsideRoles(f.store,id,'42');assert.equal(roles.en.role,'King of Spain');assert.equal(roles.hu.role,'spanyol király');assert.equal(roles.pt.role,null);assert.deepEqual(roles.hu.source,source);
 assert.equal(JSON.parse(f.row().body).appearance,undefined);assert.equal(await collectOutsideRoles(f.worker),false);
 assert.equal(f.row().next_read,nextRoleRead(date,f.worker.clock()));
});
test('real CorpusStore end-to-end reuses held languages and never files them by a mismatching tag',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'role-corpus-'));const corpus=new CorpusStore(dir);corpus.acquire();
 t.after(()=>{corpus.close();rmSync(dir,{recursive:true,force:true});});
 const fragments=Object.fromEntries(EU_PROTOCOL_ORDER.map(lang=>[lang,fragment(lang==='en'?'King of Spain':'Title '+lang,lang)]));
 fragments.hu=fragment('spanyol király','en',true);
 const a=activity(fragments),extracted=speechTexts(a,source.url,stamp);corpus.putDocument(extracted.document,extracted.texts);corpus.putSpeechMetadata(a,source.url,stamp);
 const f=setup(t);await collectOutsideRoles(f.worker,{held:(row,people)=>heldOutsideRoles(corpus,row,people)});
 assert.equal(f.calls(),0);assert.equal(publishedOutsideRoles(f.store,id,'42').hu.role,'spanyol király');assert.equal(publishedOutsideRoles(f.store,id,'42').en.role,'King of Spain');
 assert.deepEqual(publishedOutsideRoles(f.store,id,'42').hu.source,source);
 const compact=new CorpusStore(mkdtempSync(path.join(os.tmpdir(),'role-compact-')));compact.acquire();t.after(()=>{const directory=path.dirname(compact.filename);compact.close();rmSync(directory,{recursive:true,force:true});});
 compact.putSpeechMetadata(activity({en:fragment('King of Spain')}),source.url,stamp);
 assert.equal(heldOutsideRoles(compact,{speech:id,date},['42'])['42'][0].machineTranslated,null);
});
test('held-only en tagged es cannot permanently populate es; held hu cannot populate en',t=>{
 for(const [key,tag,title,absent]of [['en','es','Presidente Electo of Venezuela','es'],['hu','en','spanyol király','en']]){
  const f=setup(t,{[key]:fragment(title,tag)});assert.equal(publishedOutsideRoles(f.store,id,'42')[absent],undefined);assert.equal(f.row().next_read,0);
 }
});
for(const status of [404,410])test('terminal '+status+' is not retried',async t=>{
 const f=setup(t);f.worker.request=async()=>{throw {status,message:'source unavailable'};};await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().next_read,null);f.advance(400*86400_000);assert.equal(await collectOutsideRoles(f.worker),false);
});
test('persistent 500 grows intervals then stops, and late translations decay with age',()=>{
 let last=0;for(let attempt=0;attempt<7;attempt++){const retry=outsideRoleRetry({status:500},attempt,0);if(attempt<6){assert(retry.next>last);last=retry.next;}else assert.equal(retry.next,null);}
 const now=Date.parse(stamp);assert.equal(nextRoleRead('2026-11-01',now)-now,86400_000);assert.equal(nextRoleRead('2026-10-01',now)-now,7*86400_000);assert.equal(nextRoleRead('2026-01-21',now)-now,90*86400_000);assert.equal(nextRoleRead('2024-01-21',now)-now,365*86400_000);
});
test('429 keeps attempts and honours Retry-After; failure must fence the writer',async t=>{
 const f=setup(t);f.worker.request=async()=>{throw {status:429,retryAfter:300};};await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().attempts,0);assert.equal(f.row().next_read,f.worker.clock()+300_000);
 const g=setup(t);let lost=false;g.store.assertWriter=()=>{if(lost)throw Error('lost lease');};g.worker.request=async()=>{lost=true;throw Error('ordinary failure');};await assert.rejects(collectOutsideRoles(g.worker,{held:()=>({})}),/lost lease/);assert.equal(g.row().attempts,0);
});
test('missing CORPUS_DIR disables pending collection, logs once and never rewrites rows',async t=>{
 const previous=process.env.CORPUS_DIR;delete process.env.CORPUS_DIR;t.after(()=>{process.env.CORPUS_DIR=previous;});
 const warnings=[];t.mock.method(console,'warn',message=>warnings.push(message));const f=setup(t),before=f.row();
 assert.equal(outsideRolesDue(f.store,f.worker.clock()),false);assert.equal(await collectOutsideRoles(f.worker),false);
 assert.equal(outsideRolesDue(f.store,f.worker.clock()),false);assert.equal(warnings.length,1);assert.match(warnings[0],/CORPUS_DIR/);
 assert.equal(f.calls(),0);assert.deepEqual(f.row(),before);assert.equal(f.row().next_read,0);
});
test('ordinary read failures persist growing retries per speech',async t=>{
 const f=setup(t);let calls=0;f.worker.request=async()=>{calls++;throw {status:500};};await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().attempts,1);assert.equal(f.row().next_read,f.worker.clock()+86400_000);
 f.advance(86400_000);await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().attempts,2);assert.equal(f.row().next_read,f.worker.clock()+3*86400_000);assert.equal(calls,2);
});
test('a fresh all-language read replaces a legacy header with unknown retrieval date',async t=>{
 const f=setup(t,{en:fragment('Old title')});const body=JSON.parse(f.row().body);body.people['42'][0].source={url:null,fetchedAt:null};f.store.db.prepare('UPDATE outside_role_speech_reads SET body=?').run(JSON.stringify(body));
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(publishedOutsideRoles(f.store,id,'42').en.role,'King of Spain');
});

test('unchanged rechecks and provenance changes do not dirty stories; role/tag changes do',async t=>{
 const f=setup(t);await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.store.get('storyProjectionDirty'),true);
 f.store.set('storyProjectionDirty',false);f.advance(f.row().next_read-f.worker.clock());
 const request=f.worker.request;f.worker.request=async(...args)=>({...await request(...args),fetchedAt:new Date(f.worker.clock()).toISOString()});
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.store.get('storyProjectionDirty'),false,'provenance-only recheck');
 f.advance(f.row().next_read-f.worker.clock());f.worker.request=async()=>({...source,fetchedAt:new Date(f.worker.clock()).toISOString(),payload:{data:[activity({en:fragment('King of Spain'),hu:fragment('spanyol király','hu'),pt:fragment('King of Spain')})]}});
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.store.get('storyProjectionDirty'),true,'published source language tag changed');
 f.store.set('storyProjectionDirty',false);f.advance(f.row().next_read-f.worker.clock());f.worker.request=async()=>({...source,fetchedAt:new Date(f.worker.clock()).toISOString(),payload:{data:[activity({en:fragment('King of Spain'),hu:fragment('Spanyolország királya','hu'),pt:fragment('King of Spain')})]}});
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.store.get('storyProjectionDirty'),true,'published role changed');
});
for(const data of [[],null,{},[{}],[{activity_id:id}]])test('empty/204 or malformed payload remains retryable: '+JSON.stringify(data),async t=>{
 const f=setup(t);f.worker.request=async()=>({...source,status:204,payload:{data}});
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().attempts,1);assert.equal(f.row().next_read,f.worker.clock()+86400_000);assert.equal(f.store.get('storyProjectionDirty'),undefined);
});
for(const error of [new SyntaxError('invalid JSON'),Error('invalid data array'),Error('identity mismatch')])test('ordinary source parse failure remains retryable: '+error.message,async t=>{
 const f=setup(t);f.worker.request=async()=>{throw error;};await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().next_read,f.worker.clock()+86400_000);
});
for(const changed of [{activity_id:'MTG-PL-2026-01-21-OTH-999'},{activity_date:'2026-01-22'}])test('a real source identity mismatch is terminal: '+JSON.stringify(changed),async t=>{
 const f=setup(t);f.worker.request=async()=>({...source,payload:{data:[{...activity({}),...changed}]}});await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(f.row().next_read,null);
});
test('a corpus identity/parser failure falls through to the source read even with complete seeds',async t=>{
 const f=setup(t,Object.fromEntries(EU_PROTOCOL_ORDER.map(lang=>[lang,fragment('Role '+lang,lang)])));await collectOutsideRoles(f.worker,{held:()=>{throw SyntaxError('Corpus identity mismatch');}});
 assert.equal(f.calls(),1);assert.equal(f.row().attempts,0);assert.equal(publishedOutsideRoles(f.store,id,'42').en.role,'King of Spain');assert(f.row().next_read>f.worker.clock());
});
test('current parser wins over newer old-parser seeds through the read-only CorpusStore branch',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'role-read-only-')),corpus=new CorpusStore(dir);corpus.acquire();
 const previous=process.env.CORPUS_DIR;process.env.CORPUS_DIR=dir;t.after(()=>{process.env.CORPUS_DIR=previous;corpus.close();rmSync(dir,{recursive:true,force:true});});
 const title='author of the report ‘Much more than a market’',fragments=Object.fromEntries(EU_PROTOCOL_ORDER.map(lang=>[lang,fragment(lang==='en'?'author of the report <i>‘Much more than a market’</i>':'Role '+lang,lang)]));
 const a=activity(fragments),feb='2026-02-01T10:00:00Z',extracted=speechTexts(a,source.url,feb);corpus.putDocument(extracted.document,extracted.texts);corpus.putSpeechMetadata(a,source.url,feb);
 const f=setup(t),old={personId:'42',name:'Felipe VI',role:'author of the report',fragmentKey:'en',languageTag:'en'};
 seedOutsideRoles(f.store,{id,date,header:{observations:[old]},headerSource:{...source,fetchedAt:'2026-03-01T10:00:00Z'}},'42');
 await collectOutsideRoles(f.worker);assert.equal(f.calls(),0,'readHeld must open the held corpus read-only');assert.equal(publishedOutsideRoles(f.store,id,'42').en.role,title);
 const saved=JSON.parse(f.row().body).people['42'].find(o=>o.fragmentKey==='en');assert.equal(saved.parserRevision,OUTSIDE_ROLE_PARSER_REVISION);assert.equal(saved.source.fetchedAt,feb);
 seedOutsideRoles(f.store,{id,date,header:{observations:[old]},headerSource:{...source,fetchedAt:'2026-04-01T10:00:00Z'}},'42');assert.equal(publishedOutsideRoles(f.store,id,'42').en.role,title,'a later old seed cannot undo the corrected parser');
});
test('pacing keeps pending roles visible to the publication gate',async t=>{
 const {topicRebuildDue}=await import('./topic-publication.mjs'),{RECORD_TOPICS_VERSION}=await import('./record-topics.mjs'),{STORY_FACTS_VERSION}=await import('./story-facts-model.mjs');
 const f=setup(t);seedOutsideRoles(f.store,{id:'MTG-PL-2026-01-21-OTH-999',date,header:{observations:[]}},'42');
 f.store.set('active',1);f.store.set('recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation:1,askerSubsets:['not-home']});f.store.set('storyProjection',{version:STORY_FACTS_VERSION,generation:1});f.store.set('topicProjectionPublishedAt',f.worker.clock()-1000);
 await collectOutsideRoles(f.worker,{held:()=>({})});assert.equal(outsideRolesDue(f.store,f.worker.clock()),true);assert.equal(await collectOutsideRoles(f.worker,{held:()=>({})}),false);assert.equal(f.calls(),1);
 assert.equal(topicRebuildDue(f.store,f.worker.clock(),'00:00-24:00'),false,'do not publish after one row while the next is pacing');
});
