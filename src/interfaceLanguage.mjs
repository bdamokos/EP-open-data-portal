import {EU_PROTOCOL_ORDER} from '../server/language-order.mjs';

// public/assets/interface-language.js applies the same key, list and order before the app loads.
export const INTERFACE_LANGUAGE_KEY='ep.interface-language.v1';
export const INTERFACE_LANGUAGES=EU_PROTOCOL_ORDER;

const browserStorage=()=>{try{return globalThis.localStorage??null;}catch{return null;}};

export function saveInterfaceLanguage(language,storage) {
  try{(storage===undefined ? browserStorage() : storage)?.setItem(INTERFACE_LANGUAGE_KEY,language);}catch{}
}

// The language used when a URL has no supported ?lang=: the saved choice, then
// the first supported browser language, then English.
export function defaultInterfaceLanguage({storage,languages}={}) {
  let saved=null;
  try{saved=(storage===undefined ? browserStorage() : storage)?.getItem(INTERFACE_LANGUAGE_KEY)??null;}catch{}
  if(INTERFACE_LANGUAGES.includes(saved))return saved;
  let tags=languages;
  if(tags===undefined)try{tags=globalThis.navigator?.languages?.length ? globalThis.navigator.languages : [globalThis.navigator?.language];}catch{tags=[];}
  for(const tag of tags||[]){const code=String(tag||'').toLowerCase().split('-')[0];if(INTERFACE_LANGUAGES.includes(code))return code;}
  return 'en';
}

// English stays implicit only when it is also the default, so an explicit
// English link keeps its meaning on reload and for other visitors.
export const interfaceLanguageInUrl=(language,defaults)=>language!=='en'||defaultInterfaceLanguage(defaults)!=='en';
