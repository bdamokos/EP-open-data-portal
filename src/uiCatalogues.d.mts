import type {UiCatalogue,UiI18n,UiLanguage,PluralCategory} from './uiI18n.mjs';
export type UiPluralForms=Readonly<Partial<Record<UiLanguage,Readonly<Record<string,Readonly<Partial<Record<PluralCategory,string>>>>>>>>;
export function uiMessageId(key:string):string;
export function createAppUiI18n(catalogues?:Readonly<Partial<Record<UiLanguage,UiCatalogue>>>,pluralForms?:UiPluralForms):UiI18n;
