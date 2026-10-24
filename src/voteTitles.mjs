import {languagePreference} from '../server/language-order.mjs';
const days=[
  ['lundi','Monday','Montag'],['mardi','Tuesday','Dienstag'],
  ['mercredi','Wednesday','Mittwoch'],['jeudi','Thursday','Donnerstag'],
  ['vendredi','Friday','Freitag'],['samedi','Saturday','Samstag'],
  ['dimanche','Sunday','Sonntag'],
];
const normalize=value=>value.replace(/\s+/g,' ').trim();
const usable=value=>typeof value==='string'&&value.trim().length>0;

function agendaLanguages(values) {
  if(!usable(values.mul)||!usable(values.fr))return {};
  // These are plain source strings, without language-tagged XML spans. Accept
  // only the complete FR / EN / DE agenda format, anchored to the supplied FR
  // label and matching weekdays. Hyphens inside a title are not delimiters.
  const boundaries=[...values.mul.matchAll(/\s+[-–—]\s+(?=(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[’']s Agenda|Tagesordnung für (?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))\s+[-–—]\s+)/gi)];
  if(boundaries.length!==2)return {};
  const [english,german]=boundaries;
  const fr=values.mul.slice(0,english.index).trim();
  const en=values.mul.slice(english.index+english[0].length,german.index).trim();
  const de=values.mul.slice(german.index+german[0].length).trim();
  if(normalize(fr)!==normalize(values.fr))return {};
  const day=days.find(([frDay])=>new RegExp('^Ordre du jour de '+frDay+'\\s+[-–—]\\s+\\S','i').test(fr));
  if(!day||!new RegExp('^'+day[1]+"[’']s Agenda\\s+[-–—]\\s+\\S",'i').test(en)||!new RegExp('^Tagesordnung für '+day[2]+'\\s+[-–—]\\s+\\S','i').test(de))return {};
  return {fr,en,de};
}

// Derived text is for display only. Keep the original map and literal, including
// the complete multilingual string, available to the caller for provenance.
export function selectVoteTitle(values,requested,fallback='',fallbackLanguage='en') {
  const supplied=values&&typeof values==='object'&&!Array.isArray(values)?values:{};
  const parsed=agendaLanguages(supplied);
  for(const language of [...(requested==='mul'&&Object.hasOwn(supplied,'mul')?['mul']:[]),...languagePreference([...new Set([...Object.keys(supplied),...Object.keys(parsed)])].filter(key=>key!=='mul'),requested),...(Object.hasOwn(supplied,'mul')?['mul']:[])]) {
    if(usable(supplied[language]))return {text:supplied[language],language,sourceLiteral:supplied[language]};
    if(usable(parsed[language]))return {text:parsed[language],language,sourceLiteral:supplied.mul};
  }
  return {text:fallback,language:fallbackLanguage,sourceLiteral:fallback};
}
