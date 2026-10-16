export type SourceTarget={url:string;endpoint:string;family:string;id:string|null;collection:boolean;params:Record<string,string>};
export function sourceTarget(value:string):SourceTarget|null;
export function humanSourceUrl(value:string,options?:{language?:string;reference?:string;record?:Record<string,unknown>}):string|null;
export function recordTitle(record:Record<string,unknown>,language?:string):string;
