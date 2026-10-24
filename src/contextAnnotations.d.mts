import type {NoteAnchor,DocumentLink} from './explorerTypes';
export function mapContextAnnotations(paragraphs:string[],span:{start:number;end:number},original:string,anchors?:NoteAnchor[],links?:DocumentLink[]):{anchors:NoteAnchor[];links:DocumentLink[]}|null;
