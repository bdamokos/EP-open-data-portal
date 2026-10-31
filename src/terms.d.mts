export type InterfaceTermKey='new-version'|'view-error'|'view-error-help'|'view-reload-help'|'try-again'|'go-home'|'reload-page'|'loading-view'|'first-reading'|'second-reading'|'vote'|'amendment'|'final-text'|'saved-question'|'save-question'|'saved-in-browser'|'save-in-browser';
export type InterfaceTerm={text:string;language:string};
export function interfaceTerm(key:InterfaceTermKey,requested?:string):InterfaceTerm;
export function compoundLanguage(...languages:(string|null|undefined)[]):string;
export function summaryStage(stage:string,language:string, ui?: import('./uiI18n.mjs').UiFormatter):InterfaceTerm;
export function voteScope(scope:string,language:string, ui?: import('./uiI18n.mjs').UiFormatter):InterfaceTerm;
