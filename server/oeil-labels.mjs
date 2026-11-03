import countryNames from './topic-country-labels.json' with {type:'json'};
import official from './oeil-subjects.json' with {type:'json'};
import translations from './oeil-subject-translations.json' with {type:'json'};
import {languagePreference} from './language-order.mjs';

// Reader contract only; retained projections need no rebuild.
export const OEIL_LABELS_VERSION=2;

// Identity comes from the projection, never from a label or a year.
export function conceptLabel(concept, requested, catalogue=official, translated=translations) {
 if(concept.key?.startsWith('place:'))concept={...concept,labels:{...concept.labels,...countryNames.labels[concept.key.slice(6)]}};
 const code=concept.key?.startsWith('oeil:')?concept.key.slice(5):null;
 const subject=code?catalogue.subjects[code]:null;
 const labels={};
 for(const [language,label] of Object.entries(concept.labels||{}))if(typeof label==='string'&&label.trim())labels[language]={label,source:concept.labelSource};
 if(code){
  // Snapshot labels and source-attested projected English/French always win.
  for(const [language,label] of Object.entries(subject?.labels||{}))labels[language]={label:label.trim().replace(/\s+/g,' ')};
  const yearLabel=labels.en?.label.match(/^(\d{4}) (budget|discharge)\s*$/);
  const annualFamily=yearLabel&&(yearLabel[2]==='budget'?/^8\.70\.\d+$/:/^8\.70\.03\.\d+$/).test(code);
  const annual=subject?.template||(annualFamily?{kind:yearLabel[2],year:yearLabel[1]}:null);
  for(const [language,entries] of Object.entries(translated.locales||{})){
   if(language==='en'||language==='fr')continue;
   const entry=annual?entries.templates?.[annual.kind]:entries.labels?.[code];
   if(entry?.source!=='explorer-translation'||typeof entry.label!=='string'||!entry.label.trim())continue;
   if(annual&&!entry.label.includes('{year}'))continue;
   labels[language]={label:annual?entry.label.replaceAll('{year}',annual.year):entry.label,source:'explorer-translation'};
  }
 }
 const labelLanguage=languagePreference(Object.keys(labels),requested)[0]||null;
 return {label:labels[labelLanguage]?.label||concept.key,labelLanguage,language:labelLanguage,...(labels[labelLanguage]?.source==='explorer-translation'?{labelSource:'explorer-translation'}:{})};
}
