// An episode is bounded; foreground/online events can revive an exhausted read.
export const RETRY_DELAYS = [5000,15000,45000,120000,300000,300000];
export function retryable(error) {
  if (!error || error.name === 'AbortError') return false;
  if (typeof error.status === 'number') return [408,425,429,500,502,503,504].includes(error.status);
  return error instanceof TypeError || error.name === 'TypeError' || error.name === 'TimeoutError' || error.code === 'snapshot_changed' || error.code === 'request_timeout' || error.uiMessageId === 'batch6.client.the.request.took.too.long.try.again.43';
}
export function retryDelay(attempt,retryAt=0,now=Date.now(),random=Math.random()) {
  return Math.max(0,Math.min(300000,RETRY_DELAYS[Math.min(attempt,5)]*(0.95+random*0.1)),retryAt-now);
}

// These are response-level progress/deadline signals. Source provenance and
// stale/error labels do not promise a different result from another client read.
// Endpoints with a documented nested progress field select it via retryWhile.
export function retryableGap(data,retryWhile) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.retryable === false || data.coverage?.retryable === false) return false;
  return data.refreshInProgress === true || data.pending === true ||
    typeof data.pending === 'number' && data.pending > 0 || data.cache?.complete === false ||
    gapRetryAt(data) > 0 || Boolean(retryWhile?.(data));
}
function deadline(value) {
  const at=typeof value==='string'?Date.parse(value):value;
  return typeof at==='number'&&Number.isFinite(at)&&at>0?at:0;
}
export function gapRetryAt(data,retryAtFor) {
  if(!data||typeof data!=='object'||Array.isArray(data)||data.retryable===false||data.coverage?.retryable===false)return 0;
  return Math.max(deadline(data.retryAt),deadline(data.nextRetryAt),deadline(retryAtFor?.(data)));
}
