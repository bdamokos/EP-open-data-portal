export type AmendmentLanguageScope={status:'not-applicable';language:string;field:string;note:string};
export function amendmentLanguageScope(value?:{originalText?:string|null;proposedText?:string|null;language?:string|null}):AmendmentLanguageScope|null;
