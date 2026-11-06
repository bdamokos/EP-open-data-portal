type Listed={kind:string;date:string;people:{id:string}[]};
export function speechPanelCounts(speeches:Listed[]):{speeches:number;statements:number;speakers:number};
export function speechPanelDate(speeches:Pick<Listed,'date'>[]):string|null;
