import {createAppUiI18n} from './uiCatalogues.mjs';
import {normalizeUiLocale, type UiCatalogue, type UiI18n, type UiLanguage} from './uiI18n.mjs';
export {uiMessageId} from './uiCatalogues.mjs';

// Language factories are immutable. Browsers fetch only the languages they use.
const modules=import.meta.glob<UiCatalogue>(['./ui-locales/*.json','!./ui-locales/{en,aliases,existing,plural-forms,plural-pairs}.json'],{import:'default'});
const factories=new Map<string,UiI18n>([['en',createAppUiI18n()]]);
const pending=new Map<string,Promise<void>>();
const failures=new Map<string,unknown>();
const languageKey=(language?:string|null)=>normalizeUiLocale(language).split('-')[0] as UiLanguage;
export function loadUiLocale(language?:string|null):Promise<void> {
  const key=languageKey(language);
  if(factories.has(key))return Promise.resolve();
  const cached=pending.get(key);
  if(cached)return cached;
  const loader=modules[`./ui-locales/${key}.json`];
  if(!loader)return Promise.resolve();
  const request=loader().then(messages=>{
    factories.set(key,createAppUiI18n({[key]:messages}));
    pending.delete(key);
  }).catch(error=>{pending.delete(key);failures.set(key,error);throw error;});
  pending.set(key,request);
  return request;
}
export const appUiI18n:UiI18n={sourceLocale:'en',forLocale(language){
  const key=languageKey(language),factory=factories.get(key);
  if(failures.has(key))throw failures.get(key);
  if(!factory&&modules[`./ui-locales/${key}.json`])throw loadUiLocale(language);
  return (factory??factories.get('en')!).forLocale(language);
}};
export function uiForLocale(language='en'){return appUiI18n.forLocale(language);}

// SSR/test callers retain synchronous formatters. The browser shell and React
// share a single request for the initial language before either renders.
if(import.meta.env.SSR) {
  const catalogues:Record<string,UiCatalogue>={};
  await Promise.all(Object.entries(modules).map(async([file,loader])=>{
    const language=file.match(/\/([a-z]{2})\.json$/)?.[1];
    if(language)catalogues[language]=await loader();
  }));
  const factory=createAppUiI18n(catalogues);
  for(const language of ['en',...Object.keys(catalogues)])factories.set(language,factory);
} else {
  await loadUiLocale(new URLSearchParams(window.location.search).get('lang'));
}
