export function readExplorerParam<T extends string|number|null>(query:URLSearchParams,key:string,fallback:T,allowed?:readonly T[]):T;
export function explorerParams(query:URLSearchParams,view:string|null,member?:number|null):URLSearchParams;
