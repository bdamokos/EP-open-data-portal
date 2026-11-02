export const INTERFACE_LANGUAGE_KEY: string;
export const INTERFACE_LANGUAGES: readonly string[];
type Defaults = {storage?: Pick<Storage, 'getItem'> | null; languages?: readonly string[]};
export function saveInterfaceLanguage(language: string, storage?: Pick<Storage, 'setItem'> | null): void;
export function defaultInterfaceLanguage(defaults?: Defaults): string;
export function interfaceLanguageInUrl(language: string, defaults?: Defaults): boolean;
