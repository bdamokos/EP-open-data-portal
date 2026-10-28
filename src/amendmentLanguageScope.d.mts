export type AmendmentLanguageScope={status:'not-applicable';language:string;field:'originalText'|'proposedText';note:string};
export type AmendmentMixedLanguageScope={status:'partial';language:string;field:'originalText'|'proposedText';notes:{start:number;end:number;note:string}[]};
export function amendmentLanguageScope(value?:{originalText?:string|null;proposedText?:string|null;language?:string|null}):AmendmentLanguageScope|null;
export function amendmentMixedLanguageScope(value?:{originalText?:string|null;proposedText?:string|null;language?:string|null}):AmendmentMixedLanguageScope|null;
