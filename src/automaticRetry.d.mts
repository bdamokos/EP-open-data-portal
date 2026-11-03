export const RETRY_DELAYS: number[];
export function retryable(error:unknown):boolean;
export function retryDelay(attempt:number,retryAt?:number,now?:number,random?:number):number;
export function retryableGap(data:unknown):boolean;
export function gapRetryAt(data:unknown):number;
