import {createAppUiI18n} from './uiCatalogues.mjs';
import type {UiCatalogue, UiLanguage} from './uiI18n.mjs';
export {uiMessageId} from './uiCatalogues.mjs';

// Only real language assets are bundled. Missing messages fall back individually.
const modules=import.meta.glob('./ui-locales/*.json',{eager:true,import:'default'});
const catalogues:Partial<Record<UiLanguage,UiCatalogue>>={};
for(const [file,messages] of Object.entries(modules)) {
  const language=file.match(/\/([a-z]{2})\.json$/)?.[1] as UiLanguage|undefined;
  if(language&&language!=='en')catalogues[language]=messages as UiCatalogue;
}
export const appUiI18n=createAppUiI18n(catalogues);
export function uiForLocale(language='en'){return appUiI18n.forLocale(language);}
