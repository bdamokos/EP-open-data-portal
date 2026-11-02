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
test('official English and French cannot be overwritten by translations or stale projected labels',()=>{
 const c={key:'oeil:3.70.03',labels:{en:'old',fr:'old'}};
 const t={locales:{en:{labels:{'3.70.03':entry('wrong')}},fr:{labels:{'3.70.03':entry('wrong')}},hu:{labels:{'3.70.03':entry('Magyar')}}}};
 for(const l of ['en','fr']){const r=conceptLabel(c,l,official,t);assert.equal(r.label,official.subjects['3.70.03'].labels[l]);assert.equal(r.labelLanguage,l);assert.equal(r.source.source,'oeil');}
 assert.equal(conceptLabel(c,'hu',official,t).label,'Magyar');assert.equal(conceptLabel(c,'hu',official,t).source.source,'explorer-translation');
});
test('fallback uses shared order over every available label, including when English is unavailable',()=>{
 const c={key:'oeil:9.99',labels:{fr:'Français',de:'Deutsch',es:'Español'}};
 const result=conceptLabel(c,'ga');assert.equal(result.labelLanguage,languagePreference(Object.keys(c.labels),'ga')[0]);assert.equal(result.labelLanguage,'fr');assert.equal(result.label,'Français');
 const empty=conceptLabel({key:'oeil:9.99'},'hu');assert.equal(empty.labelLanguage,null);assert.equal(empty.label,'oeil:9.99');
});
test('annual templates use published years and exact code families, including future source codes',()=>{
 const t={locales:{ga:{templates:{budget:entry('Buiséad {year}'),discharge:entry('Urscaoileadh {year}')}}}};
 for(const [key,year,kind] of [['8.70.48','2026','budget'],['8.70.03.14','2024','discharge'],['8.70.46','2028','budget']]){
  const r=conceptLabel({key:'oeil:'+key,labels:{en:year+' '+kind}},'ga',official,t);assert.equal(r.labelLanguage,'ga');assert(r.label.includes(year));assert.equal(r.source.source,'explorer-translation');
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
 for(const c of [read('overview',{}).items[0],read('detail',{key}).concept,read('records',{ids:id}).records[0].topics[0]]){assert.equal(c.label,label);assert.equal(c.labelLanguage,'fr');assert.equal(c.source.source,'oeil');}
 for(const q of [label,official.subjects['3.70.03'].labels.en])assert.equal(read('search',{q}).results[0].labelLanguage,'fr');
});
