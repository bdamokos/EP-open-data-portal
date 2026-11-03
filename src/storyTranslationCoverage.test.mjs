import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppUiI18n} from './uiCatalogues.mjs';
const languages='bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
const read=name=>JSON.parse(readFileSync(new URL('./ui-locales/'+name+'.json',import.meta.url)));
const catalogues=Object.fromEntries(languages.map(l=>[l,read(l)])),forms=read('plural-forms'),english=read('en'),pairs=read('plural-pairs');
const i18n=createAppUiI18n(catalogues),slots=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
test('reviewed story messages and outside labels have native whole-message coverage and exact slots',()=>{
 const keys=Object.keys(catalogues.fr).filter(k=>k.startsWith('topics.story.')||k.startsWith('MotionComparison.contextStage.')||k.startsWith('membervotesummary.fullPosition.')||k.startsWith('membervotes.summary.recorded.'));
 for(const l of languages)for(const k of keys){assert.equal(typeof catalogues[l][k],'string',l+'/'+k);assert(catalogues[l][k].trim());assert.deepEqual(slots(catalogues[l][k]),slots(english[k]),l+'/'+k);assert.equal(i18n.forLocale(l).messageLocale(k),i18n.forLocale(l).locale,l+'/'+k);}
});
test('story cardinal families retain numeric selectors including decimals and independent counts',()=>{
 const counts=[0,1,2,3,5,7,11,19,20,21,22,101,111,1.5,2.1];
 for(const l of languages){const ui=i18n.forLocale(l);for(const pair of pairs.filter(p=>p.other.startsWith('topics.story.'))){
  const fs=forms[l][pair.other];assert(fs&&fs.other,l+'/'+pair.other);
  for(const [category,value]of Object.entries(fs)){assert(['zero','one','two','few','many','other'].includes(category));assert(value.trim());assert.deepEqual(slots(value),slots(english[pair.other]));}
  for(const n of counts){const values=Object.fromEntries(slots(english[pair.other]).map(k=>[k,k===pair.count?String(n):'7']));const category=new Intl.PluralRules(ui.locale).select(n),expected=(fs[category]??fs.other).replace(/\{(\w+)\}/g,(_,k)=>values[k]);assert.equal(ui.t(pair.other,values,{[pair.count]:n}),expected,l+'/'+pair.other+'/'+n);}
 }}
 assert.equal(i18n.forLocale('pt').locale,'pt-PT');
});
