type VoteLike={id:string;decidedDocumentIds?:string[]};
export function textAdoptedId(reference:string|null|undefined):string|null;
export function quotedVote<T extends VoteLike>(votes:T[]|null|undefined,documentReference:string|null|undefined):T|null;
export function withoutTally(text:string):string;
export function aboutContent<T extends VoteLike>(input:{blocks:{kind:string;text:string}[];votes:T[];viewedId:string|null|undefined;documentReference:string|null|undefined}):{blocks:{kind:string;text:string}[];whole:T|null};
