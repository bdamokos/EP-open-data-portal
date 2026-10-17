export function searchSnippetParts(value:string|null|undefined):{text:string;match:boolean}[];
export function searchRangeParts(value:string,ranges:{start:number;end:number}[]):{text:string;match:boolean}[];
export function textReadKey(hit:{sourceId:string;sourceKey:string}):string;
export function parseTextReadKey(value:string):{sourceId:string;sourceKey:string}|null;
export function findTextOffsets(value:string,query:string,limit?:number):{start:number;end:number}[];
