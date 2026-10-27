export const PROGRESS_REFRESH_DELAYS:readonly number[];
export const PROGRESS_REFRESH_DEADLINE:number;
export function isProgressRoute(route:string|null):boolean;
export function progressPending(data:unknown):boolean;
export function progressSourceState(data:unknown):{failed:boolean;stale:boolean;pending:boolean;retryAt:number};
export function progressCacheMaxAge(data:unknown,route:string,maxAge:number):number;
export function readRefreshingInsight<T>(route:string,options:{get:(route:string,options:{force?:boolean;signal:AbortSignal})=>Promise<T>;force?:boolean;signal:AbortSignal;initialData?:T|null;onData:(data:T,loading:boolean)=>void}):Promise<T>;
