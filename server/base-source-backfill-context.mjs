import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const backfillContext=()=>context.getStore();
export const runBaseBackfill=(state,run)=>context.run(state,run);
export function checkBackfillCapacity(){if(backfillContext()?.full)throw Object.assign(new Error('Base source storage full'),{code:'base_source_full'});}
