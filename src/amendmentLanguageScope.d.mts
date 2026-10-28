export type AmendmentLanguageScope={status:'not-applicable';language:string;field:'originalText'|'proposedText';note:string};
/** Note offsets are UTF-16 positions in the selected published comparison field. */
export type AmendmentMixedLanguageScope={status:'partial';language:string;field:'originalText'|'proposedText';notes:{start:number;end:number;note:string}[]};
export function amendmentLanguageScope(value?:{originalText?:string|null;proposedText?:string|null;language?:string|null}):AmendmentLanguageScope|null;
export function amendmentMixedLanguageScope(value?:{originalText?:string|null;proposedText?:string|null;language?:string|null}):AmendmentMixedLanguageScope|null;
