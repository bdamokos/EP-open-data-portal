// Keep the selected value and its supplied language key together, including fallbacks.
export function selectLanguageText(values,requested,fallback='',fallbackLanguage='en') {
  if(values?.[requested])return {text:values[requested],language:requested};
  if(values?.en)return {text:values.en,language:'en'};
  const first=Object.entries(values||{})[0];
  return first?.[1]?{text:first[1],language:first[0]}:{text:fallback,language:fallbackLanguage};
}
