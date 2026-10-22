export function personNameIndex(members?:{id:number|string;firstName?:string;lastName?:string}[]):Map<string,string>;
export function personDisplayName(index:Map<string,string>,id:unknown,label?:string|null):string;
