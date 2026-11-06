type Listed={kind:string;date:string;people:{id:string}[]};
export function speechPanelCounts(speeches:Listed[]):{speeches:number;statements:number;speakers:number};
export function speechPanelDate(speeches:Pick<Listed,'date'>[]):string|null;
export function listedSpeakerName(listed:string|null,header:string|null|undefined):string|null;
