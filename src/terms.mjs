import {defaultUi} from './uiDefault.mjs';
import catalogue from './terms.json' with {type:'json'};

// These are interface labels. Source-title and document translation metadata
// must never be inferred from the language or provenance of an interface term.
export function interfaceTerm(key,requested='en') {
  if(!Object.hasOwn(catalogue.terms,key))throw new RangeError('Unknown interface term: '+key);
  const term=catalogue.terms[key];
  const locale=String(requested).toLowerCase().split('-')[0];
  const language=Object.hasOwn(term.labels,locale)?locale:'en';
  const raw=term.labels[language];
  return {text:raw[0].toLocaleUpperCase(language)+raw.slice(1),language};
}

// Flat native options and aria-label strings cannot mark each constituent.
// Keep unknown or genuinely different source languages explicit.
export function compoundLanguage(...languages) {
  return languages[0]&&languages.every(language=>language===languages[0])?languages[0]:'';
}

const stageEnglish={'parliament-decision':'Parliament’s decision','final-act':'Final act',proposal:'Commission proposal',document:'Summary'};
export function summaryStage(stage,language, ui = defaultUi) {
  return ['first-reading','second-reading'].includes(stage)?interfaceTerm(stage,language):{text:Object.hasOwn(stageEnglish,stage)?stageEnglish[stage]:ui.t("batch5.procedurecontext.tsx.33.71"),language:'en'};
}

export function voteScope(scope,language, ui = defaultUi) {
  if(['final-text','amendment'].includes(scope))return interfaceTerm(scope,language);
  if(scope==='unclassified')return interfaceTerm('vote',language);
  return {text:scope==='procedural'?ui.t("terms.proceduralVote"):scope,language:scope==='procedural'?ui.language:''};
}
