import {languagePreference} from '../server/language-order.mjs';
// Keep the selected value and its supplied language key together, including fallbacks.
export function selectLanguageText(values,requested,fallback='',fallbackLanguage='en') {
  const language=languagePreference(Object.keys(values||{}).filter(code=>typeof values[code]==='string'&&values[code].trim()),requested)[0];
  return language!==undefined?{text:values[language],language}:{text:fallback,language:fallbackLanguage};
}
