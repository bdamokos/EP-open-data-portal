import type {NoteAnchor,DocumentLink} from './explorerTypes';
export function mapContextAnnotations(paragraphs:string[],span:{start:number;end:number},original:string,anchors?:NoteAnchor[],links?:DocumentLink[]):{anchors:NoteAnchor[];links:DocumentLink[]}|null;
export function mapWordingFormatting(source:string|null|undefined,target:string|null|undefined,formatting?:import('./components/WordingFormatting').WordingFormat[]):import('./components/WordingFormatting').WordingFormat[]|null;
