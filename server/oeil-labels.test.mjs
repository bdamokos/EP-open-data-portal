import {countryLabelSourceFor} from './country-label-source.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conceptLabel} from './oeil-labels.mjs';
import official from './oeil-subjects.json' with {type:'json'};
import translations from './oeil-subject-translations.json' with {type:'json'};
import {languagePreference,EU_PROTOCOL_ORDER} from './language-order.mjs';
const entry=label=>({label,source:'explorer-translation'});
test('official bilingual snapshot and all other interface locales are complete structures',()=>{
 assert.equal(Object.keys(official.subjects).length,450);
 for(const [code,s] of Object.entries(official.subjects)){assert(s.labels.en&&s.labels.fr,code);if(s.parent)assert(official.subjects[s.parent]);}
 assert.deepEqual(Object.keys(translations.locales).sort(),EU_PROTOCOL_ORDER.filter(l=>!['en','fr'].includes(l)).sort());
});
test('reviewed explorer labels cover every official code and annual year in all 22 target locales',()=>{
 const fixed=Object.keys(official.subjects).filter(code=>!official.subjects[code].template).sort();
 assert.equal(fixed.length,424);
 for(const [language,locale] of Object.entries(translations.locales)){
  assert.deepEqual(Object.keys(locale.labels).sort(),fixed,language+' exact nonannual codes');
  assert.deepEqual(Object.keys(locale.templates).sort(),['budget','discharge'],language+' annual families');
  for(const [id,entry] of Object.entries({...locale.labels,...locale.templates})){
   assert.equal(entry.source,'explorer-translation',language+'/'+id+' provenance');
   assert.equal(typeof entry.label,'string');assert(entry.label.trim(),language+'/'+id+' nonempty');
  }
  for(const [code,subject] of Object.entries(official.subjects)){
   const result=conceptLabel({key:'oeil:'+code},language);
   assert.equal(result.labelLanguage,language,language+'/'+code+' native label');
   assert.equal(result.labelSource,'explorer-translation',language+'/'+code+' disclosure');
   if(subject.template){
    assert.deepEqual(locale.templates[subject.template.kind].label.match(/\{[^}]+\}/g),['{year}'],language+'/'+code+' year slot');
    assert(result.label.includes(String(subject.template.year)),language+'/'+code+' published year');
   }
   assert(!/\{[^}]+\}/.test(result.label),language+'/'+code+' resolved slots');
  }
 }
});
test('official English and French cannot be overwritten by translations or stale projected labels',()=>{
 const c={key:'oeil:3.70.03',labels:{en:'old',fr:'old'}};
 const t={locales:{en:{labels:{'3.70.03':entry('wrong')}},fr:{labels:{'3.70.03':entry('wrong')}},hu:{labels:{'3.70.03':entry('Magyar')}}}};
 for(const l of ['en','fr']){const r=conceptLabel(c,l,official,t);assert.equal(r.label,official.subjects['3.70.03'].labels[l]);assert.equal(r.labelLanguage,l);assert(!('source' in r));assert(!('labelSource' in r));}
 assert.equal(conceptLabel(c,'hu',official,t).label,'Magyar');assert.equal(conceptLabel(c,'hu',official,t).labelSource,'explorer-translation');
});
test('fallback uses shared order over every available label, including when English is unavailable',()=>{
 const c={key:'oeil:9.99',labels:{fr:'Français',de:'Deutsch',es:'Español'}};
 const result=conceptLabel(c,'ga');assert.equal(result.labelLanguage,languagePreference(Object.keys(c.labels),'ga')[0]);assert.equal(result.labelLanguage,'fr');assert.equal(result.label,'Français');
 const empty=conceptLabel({key:'oeil:9.99'},'hu');assert.equal(empty.labelLanguage,null);assert.equal(empty.label,'oeil:9.99');
});
test('annual templates use published years and exact code families, including future source codes',()=>{
 const t={locales:{ga:{templates:{budget:entry('Buiséad {year}'),discharge:entry('Urscaoileadh {year}')}}}};
 for(const [key,year,kind] of [['8.70.48','2026','budget'],['8.70.03.14','2024','discharge'],['8.70.46','2028','budget']]){
  const r=conceptLabel({key:'oeil:'+key,labels:{en:year+' '+kind}},'ga',official,t);assert.equal(r.labelLanguage,'ga');assert.equal(r.label,(kind==='budget'?'Buiséad ':'Urscaoileadh ')+year);assert.equal(r.labelSource,'explorer-translation');
 }
 assert.equal(conceptLabel({key:'oeil:9.99',labels:{en:'2028 budget'}},'ga',official,t).labelLanguage,'en');
 assert.equal(conceptLabel({key:'oeil:8.70.46'},'ga',official,t).labelLanguage,null);
});

import {ActivityStore} from './activity-index-store.mjs';
import {RecordTopics,writeTopicProjection} from './topics-store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('overview, detail, records and bilingual search preserve label language and source',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oeil-labels-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 store.acquire();store.set('active',1);const key='oeil:3.70.03',id='E-10-2026-000001';
 writeTopicProjection(store,{concepts:[{key,role:'topic',labels:{en:'old'}}],records:[{id,kind:'question',date:'2026-03-01',titles:{en:'Question'},status:'classified',assignments:[{key,paths:[]}]}]});
 const read=(view,values)=>new RecordTopics(store).query(new URLSearchParams({lang:'fr',...values}),view);
 const label=official.subjects['3.70.03'].labels.fr;
 for(const c of [read('overview',{}).items[0],read('detail',{key}).concept,read('records',{ids:id}).records[0].topics[0]]){assert.equal(c.label,label);assert.equal(c.labelLanguage,'fr');assert(!('source' in c));assert(!c.labelSource);}
 for(const q of [label,official.subjects['3.70.03'].labels.en])assert.equal(read('search',{q}).results[0].labelLanguage,'fr');
});

test('display whitespace is normalized without changing raw official labels',()=>{
 const raw=JSON.stringify(official);
 const entries=Object.entries(official.subjects).flatMap(([code,s])=>Object.entries(s.labels).map(([language,label])=>({code,language,label})));
 assert(entries.some(v=>v.label!==v.label.trim().replace(/\s+/g,' ')));
 for(const {code,language,label} of entries)assert.equal(conceptLabel({key:'oeil:'+code},language).label,label.trim().replace(/\s+/g,' '));
 assert.equal(JSON.stringify(official),raw);
});

test('English search folds survive the concept cache limit without extra row reads or response fields',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oeil-search-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 writeTopicProjection(store,{concepts:[],records:[]});
 const put=store.db.prepare('INSERT INTO record_topic_concepts VALUES (?,?,?,?)'),total=store.db.prepare('INSERT INTO record_topic_totals VALUES (?,?,?,?,?)');
 store.transaction(()=>{for(let i=0;i<2005;i++){const key='oeil:9.99.'+i;put.run(1,key,'topic',JSON.stringify({key,role:'topic',labels:{en:i===0?'English needle':'English '+i,fr:'Français '+i},labelSource:{url:'https://example.test/source'}}));total.run(1,key,'2026-Q1','question',1);}});
 let reads=0;const prepare=store.db.prepare.bind(store.db);t.mock.method(store.db,'prepare',sql=>{const statement=prepare(sql);return sql==='SELECT body FROM record_topic_concepts WHERE generation=? AND key=?'?{get(...args){reads++;return statement.get(...args);}}:statement;});
 const result=new RecordTopics(store).query(new URLSearchParams('lang=fr&q=needle'),'search');
 assert.equal(reads,2005);assert.equal(result.results[0].key,'oeil:9.99.0');assert.equal(result.results[0].label,'Français 0');
 const json=JSON.stringify(result);assert(!json.includes('englishFold'));assert(!json.includes('source'));assert(!json.includes('example.test'));
});

test('official and projected topic, keyword and place labels omit repeated source payloads',()=>{
 for(const key of ['oeil:3.70.03','eurovoc:245','place:HUN']){
  const label=conceptLabel({key,labels:{en:'English'},labelSource:{url:'https://example.test/source',fetchedAt:'2026-11-02'}},'en');
  assert(!('source' in label));assert(!('labelSource' in label));
 }
});

test('keyword and place detail retain one source object while every list stays compact',async t=>{
 const {default:names}=await import('./topic-country-labels.json',{with:{type:'json'}});const countryLabelSource=countryLabelSourceFor(names);
 const dir=await mkdtemp(path.join(tmpdir(),'label-detail-source-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 const source={url:'https://example.test/eurovoc',fetchedAt:'2026-11-02'},id='B-10-2026-000001',keys=['eurovoc:245','place:HUN'];
 writeTopicProjection(store,{concepts:[{key:keys[0],role:'keyword',labels:{en:'Descriptor'},labelSource:source},{key:keys[1],role:'place',labels:{en:'Hungary'}}],records:[{id,kind:'document',date:'2026-03-01',titles:{en:'Document'},assignments:keys.map(key=>({key,paths:[]}))}]});
 const read=(view,values)=>new RecordTopics(store).query(new URLSearchParams(values),view);
 assert.deepEqual(read('detail',{key:keys[0]}).concept.source,source);assert.deepEqual(read('detail',{key:keys[1]}).concept.source,countryLabelSource);
 for(const list of [read('overview',{role:'place'}).items,read('search',{q:'Hungary'}).results,read('search',{q:'Descriptor'}).results,read('records',{ids:id}).records[0].keywords,read('records',{ids:id}).records[0].places,read('detail',{key:keys[0]}).facets.places])for(const label of list)assert(!('source' in label));
});
