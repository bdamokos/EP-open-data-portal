import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {UI_LANGUAGES,normalizeUiLocale} from './uiI18n.mjs';
import contracts from './ui-counted-source.json' with {type:'json'};
import neutral from './ui-counted-neutral.json' with {type:'json'};
import english from './ui-locales/en.json' with {type:'json'};
import {amendmentPlanSummary} from './amendmentModel.mjs';

test('counted source contracts support every native category and raw rich selectors',()=>{
  // Fractional values exercise diagnostic categories; production entity counts stay integers.
  const samples=[0,1,2,3,4,5,7,11,21,22,101,1000000,0.1,1.5,2.5];
  for(const language of UI_LANGUAGES){
    const categories=new Intl.PluralRules(normalizeUiLocale(language)).resolvedOptions().pluralCategories;
    const messages=Object.fromEntries(Object.entries(contracts).map(([id,message])=>[id,{...message,...Object.fromEntries(categories.map(category=>[category,message.other+' ['+category+']']))}]));
    const ui=createAppUiI18n(language==='en'?{}:{[language]:messages},{}).forLocale(language);
    for(const [id,message] of Object.entries(contracts))for(const count of samples){
      const values=Object.fromEntries([...message.other.matchAll(/\{(\w+)\}/g)].map(m=>[m[1],'<retained slot>']));
      const parts=ui.rich(id,values,{[message.plural]:count});
      if(language!=='en')assert(parts.join('').endsWith('['+new Intl.PluralRules(normalizeUiLocale(language)).select(count)+']'),language+'/'+id+'/'+count);
    }
  }
});

test('neutral independent-count contracts retain their original named slots',()=>{
  for(const [id,message] of Object.entries(neutral))assert.equal(message,english[id]);
  const ui=createAppUiI18n().forLocale('en');
  assert.equal(ui.t('legislation.shownpeople_of_totalpeople_contributors_shownspeeches_of_totalspeeches_listed_speeche.8f434c',{shownPeople:1,totalPeople:2,shownSpeeches:3,totalSpeeches:21}),'Contributors: 1 of 2 · Listed speeches: 3 of 21');
});

test('new families preserve unknown units, lower-bound display and quoted occurrence identifiers',()=>{
  const ui=createAppUiI18n().forLocale('en');
  assert.equal(ui.t('app.mepCountUnknownUnit'),'MEPs');
  assert.equal(ui.t('app.mepCountUnit',{}, {count:0}),'MEPs');
  assert.equal(ui.t('app.mepCountUnit',{}, {count:1}),'MEP');
  assert.equal(ui.t('outsidevoices.date_availabilityvalue_agenda_items.84907a',{date:'2026-10',count:'1+'},{count:1}),'2026-10: 1+ agenda item');
  assert.deepEqual(amendmentPlanSummary({type:'text',quote:'exact {source}',expectedCount:1},ui),['The text “exact {source}” · 1 expected occurrence']);
  assert.deepEqual(amendmentPlanSummary({type:'text',quote:'exact',occurrences:[21]},ui),['The text “exact” · occurrence 21']);
});
