import type { CoAuthor } from './explorerTypes';
export function linkedCoAuthors(authors?:CoAuthor[]):CoAuthor[];
export function coAuthorSegments(text:string,authors?:CoAuthor[]):{text:string;id:number|null}[];
export function coAuthorProfileUrl(language:string,id:number):string;
