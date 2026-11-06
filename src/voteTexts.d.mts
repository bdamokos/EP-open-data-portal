export function votedDocumentId(votes:{decidedDocumentIds?:string[]}[]|null|undefined,documentIds:string[]):string|null;
export function voteOptionParts(votes:{id:string;subject?:string|null;title:string;scope:string;method?:string;decidedDocumentIds?:string[]}[]):Map<string,{text:string;ordinal:{number:number;count:number}|null}>;
export function votePosition(votes:{id:string}[],id:string|null|undefined):{number:number;count:number}|null;
export function voteSentenceKind(vote:{scope?:string;decidedDocumentIds?:string[]}):'text'|'amendment'|'part'|'other';
