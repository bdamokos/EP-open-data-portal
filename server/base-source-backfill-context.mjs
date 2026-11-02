import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const backfillContext=()=>context.getStore();
export const runBaseBackfill=(state,run)=>context.run(state,run);
export function checkBackfillCapacity(){if(backfillContext()?.full)throw Object.assign(new Error('Base source storage full'),{code:'base_source_full'});}

// Retry acquisition against the saved identity, never a newly selected edition.
export function backfillSelectionMatches(identity){
  const pinned=backfillContext()?.selection;
  if(!pinned)return true;
  if(pinned.workId&&identity.workId!==pinned.workId||pinned.celex&&identity.celex&&identity.celex!==pinned.celex)return false;
  return (pinned.items||[]).every(old=>(identity.items||[]).some(item=>['itemId','expressionId','manifestationId'].every(key=>!old[key]||old[key]===item[key])));
}
export const retryableBaseSelection=result=>/rate|limited|timeout|cancel|busy|http|source-unavailable|stale|fetch|request|ECONN|ENOTFOUND|EAI_|UND_ERR|cellar_error|docx-unavailable/i.test(JSON.stringify(result.gaps||[]));
