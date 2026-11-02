import {EU_PROTOCOL_ORDER} from '../server/language-order.mjs';

// public/assets/interface-language.js applies the same key and list before the app loads.
export const INTERFACE_LANGUAGE_KEY='ep.interface-language.v1';
export const INTERFACE_LANGUAGES=EU_PROTOCOL_ORDER;

export function saveInterfaceLanguage(language,storage=globalThis.localStorage) {
  try{storage?.setItem(INTERFACE_LANGUAGE_KEY,language);}catch{}
}
