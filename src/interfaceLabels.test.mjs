import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interfaceLabel,countryName,languageName} from './interfaceLabels.mjs';
test('public ISO and EU country codes share localized names and missing metadata stays readable',()=>{
 assert.equal(countryName('hu','EL'),'Görögország');assert.equal(countryName('hu','EL'),countryName('hu','GR'));
 for(const value of [null,undefined,''])assert.equal(countryName('en',value),'Unknown country');
 assert.equal(countryName('en','unknown'),'unknown');
});
test('all 24 interfaces have app-owned labels and native language names without a data export',()=>{
 for(const lang of 'bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ')){
  for(const key of ['country','political_group','reset_filters','chair','viceChair','member','substitute'])assert.notEqual(interfaceLabel(lang,key,'missing'),'missing',lang+':'+key);
  assert(languageName(lang).length>2,lang);
 }
 assert.equal(interfaceLabel('en','chair','missing'),'Chair');assert.equal(interfaceLabel('en','viceChair','missing'),'Vice-Chair');
 assert.equal(interfaceLabel('hu','member','missing'),'Tag');
});
