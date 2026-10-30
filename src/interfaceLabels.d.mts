export function interfaceLabel(language:string,key:string,fallback:string):string;
export function countryName(language:string,code:string|null|undefined, ui?: import('./uiI18n.mjs').UiFormatter):string;
export function languageName(code:string):string;
export function compareCountries(language:string,a:string,b:string, ui?: import('./uiI18n.mjs').UiFormatter):number;
