export const RETRY_DELAYS: number[];
export function retryable(error:unknown):boolean;
export function retryDelay(attempt:number,retryAt?:number,now?:number,random?:number):number;
export function retryableGap<T>(data:T|null|undefined,retryWhile?:(data:T)=>boolean):boolean;
export function gapRetryAt<T>(data:T|null|undefined,retryAtFor?:(data:T)=>number):number;
