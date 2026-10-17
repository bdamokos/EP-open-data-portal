export type InterfaceTermKey='first-reading'|'second-reading'|'vote'|'amendment'|'final-text'|'saved-question'|'save-question'|'saved-in-browser'|'save-in-browser';
export type InterfaceTerm={text:string;language:string};
export function interfaceTerm(key:InterfaceTermKey,requested?:string):InterfaceTerm;
export function compoundLanguage(...languages:(string|null|undefined)[]):string;
export function summaryStage(stage:string,language:string):InterfaceTerm;
export function voteScope(scope:string,language:string):InterfaceTerm;
