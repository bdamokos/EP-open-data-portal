import {retryable} from './automaticRetry.mjs';

/** Independent reads keep their own eligibility, even when one UI check joins them. */
export function retryFailure(errors:unknown[]) {
  const selected=errors.find(retryable)||errors[0];
  if(!selected)return null;
  const at=Math.max(0,...errors.filter(retryable).map(error=>Number((error as {retryAt?:number})?.retryAt)||0));
  if(!at)return selected;
  const source=selected as Error;
  return Object.assign(new Error(source.message),{name:source.name},source,{retryAt:at});
}
export class RetryReads {
  errors=new Map<string,unknown>();
  canRead(key:string,recover:boolean) {
    if(!this.errors.has(key))return true;
    const error=this.errors.get(key);
    return recover&&retryable(error)&&!(Number((error as {retryAt?:number})?.retryAt)>Date.now());
  }
  async read<T>(key:string,load:()=>Promise<T>,recover:boolean):Promise<T> {
    if(!this.canRead(key,recover))throw this.errors.get(key);
    try {const data=await load();this.errors.delete(key);return data;}
    catch(error){if((error as {name?:string;code?:string})?.name!=='AbortError'&&(error as {code?:string})?.code!=='generation_changed')this.errors.set(key,error);throw error;}
  }
}
