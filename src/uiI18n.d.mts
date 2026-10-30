export type UiLanguage = 'bg' | 'cs' | 'da' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'ga' | 'hr' | 'hu' | 'it' | 'lt' | 'lv' | 'mt' | 'nl' | 'pl' | 'pt' | 'ro' | 'sk' | 'sl' | 'sv';
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type UiMessage = string | (Readonly<{plural: string; type?: Intl.PluralRuleType; other: string}> & Readonly<Partial<Record<PluralCategory, string>>>);
export type UiCatalogue = Readonly<Record<string, UiMessage>>;
export type UiTextValues = Readonly<Record<string, string | number | bigint>>;
export interface UiFormatter {
  readonly locale: string;
  readonly language: UiLanguage;
  t(id: string, values?: UiTextValues): string;
  /** Numbers are formatted; other values (including React nodes) retain identity. */
  rich<T = never>(id: string, values?: Readonly<Record<string, T | string | number | bigint>>, counts?: Readonly<Record<string, number>>): Array<string | T>;
  number(value: number | bigint): string;
  messageLocale(id:string):string;
  pluralCategoryFor(id:string,value:number,type?:Intl.PluralRuleType):PluralCategory;
  pluralCategory(value: number, type?: Intl.PluralRuleType): PluralCategory;
}
export interface UiI18n {
  readonly sourceLocale: string;
  forLocale(language?: string | null): UiFormatter;
}
export const UI_LANGUAGES: readonly UiLanguage[];
export function normalizeUiLocale(language?: string | null, fallback?: string): string;
export function createUiI18n(options: {
  source: UiCatalogue;
  translations?: Readonly<Partial<Record<UiLanguage, UiCatalogue>>>;
  sourceLocale?: string;
}): UiI18n;
