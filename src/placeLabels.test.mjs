import test from 'node:test';
import assert from 'node:assert/strict';
import {placeLabel,localizePlaceLabels} from './placeLabels.mjs';
import labels from '../server/topic-country-labels.json' with {type:'json'};
import {conceptLabel} from '../server/oeil-labels.mjs';
import {projectRecordTopics} from '../server/record-topics.mjs';
const expected={UKR:['Ukraine','Ukraine','Ukrajna'],TUR:['Turquie','Türkei','Törökország'],MAR:['Maroc','Marokko','Marokkó'],SRB:['Serbie','Serbien','Szerbia'],HKG:['Hong Kong','Hongkong','Hongkong'],'1A0':['Kosovo','Kosovo','Koszovó']};
for(const [id,names] of Object.entries(expected))for(const [i,language] of ['fr','de','hu'].entries())test(`${id} preferred label in ${language}`,()=>{
 assert.deepEqual(placeLabel(id,language),{label:names[i],labelLanguage:language});
 const c=conceptLabel({key:'place:'+id,labels:{en:'English only'}},language);assert.equal(c.label,names[i]);assert.equal(c.labelLanguage,language);
});
test('authority, source-local, CLDR, English and unknown fallback preserve actual language',()=>{
 const existing={label:'English source',labelLanguage:'en'},notations={MAR:['MA']};
 assert.equal(placeLabel('MAR','fr',existing).label,'Maroc');
 assert.deepEqual(placeLabel('MAR','fr',{label:'Source local',labelLanguage:'fr'},{labels:{},notations}),{label:'Source local',labelLanguage:'fr'});
 assert.deepEqual(placeLabel('MAR','fr',existing,{labels:{MAR:{en:'English authority'}},notations}),{label:'Maroc',labelLanguage:'fr'});
 assert.deepEqual(placeLabel('MAR','fr',existing,{labels:{MAR:{en:'English authority'}},notations:{}}),{label:'English authority',labelLanguage:'en'});
 assert.deepEqual(placeLabel('XXX','fr'),{label:'XXX',labelLanguage:null});
 assert.deepEqual(placeLabel('MAR','zz',existing,{labels:{},notations}),existing);
});
test('nested place concepts receive client fallback without relabelling other concepts',()=>{
 const raw={items:[{key:'place:MAR',label:'Morocco',labelLanguage:'en'},{key:'oeil:1',label:'Other',labelLanguage:'en'}]};const result=localizePlaceLabels(raw,'fr');assert.equal(result.items[0].label,'Maroc');assert.equal(result.items[0].labelLanguage,'fr');assert.deepEqual(result.items[1],raw.items[1]);assert.equal(raw.items[0].label,'Morocco');
});
test('question-title projection retains all multilingual authority names',()=>{
 const projection=projectRecordTopics([{id:'E-10-2026-000001',kind:'question',titles:{en:'Ukraine Türkiye Morocco Serbia Hong Kong Kosovo'},date:'2026-07-01'}]);
 for(const id of Object.keys(expected))assert.deepEqual(projection.concepts.find(c=>c.key==='place:'+id)?.labels,labels.labels[id]);
});
test('every held place, including territories, has all UI language labels',()=>{
 for(const [id,names] of Object.entries(labels.labels))for(const language of ['bg','es','cs','da','de','et','el','en','fr','ga','hr','it','lv','lt','hu','mt','nl','pl','pt','ro','sk','sl','fi','sv'])assert.ok(names[language],`${id} ${language}`);
});
