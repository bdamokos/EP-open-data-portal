export type ReadRoute={documentId:string;amendmentId?:string;listId?:string;wordingLanguage?:string|null;textLanguage?:string;staleAmendment:boolean};
export function readableDocument(id:unknown):boolean;
export function readHref(target:{documentId:string;amendmentId?:string|null;listId?:string|null;wordingLanguage?:string|null;language?:string|null}):string;
export function readRoute(query:URLSearchParams):ReadRoute|null;
export function legacyReaderRedirect(search:string):{origin:string;read:string}|null;
export function documentReferenceLabel(id:string):string;
export function amendmentNumber(id:string|null|undefined):string|null;
export function provisionLabel(label:string|null|undefined):string|null;
