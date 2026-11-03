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

// Retry only transient observations, never a generic partial/empty result.
export function retryableGap(data) {
  if (!data || typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.some(retryableGap);
  if (data.retryable === false || data.coverage?.retryable === false) return false;
  if (data.cache?.complete === false || data.pending === true || typeof data.pending === 'number' && data.pending > 0 || data.sourceError === true || data.agendaError || data.issues?.includes?.('source-unavailable')) return true;
  if (data.error && (data.complete === false || data.failed > 0 || data.truncated === false || data.coverage?.complete === false)) return true;
  if (data.retryable === true || data.stale === true || data.refreshError || data.status === 'error' && data.nextRetryAt) return true;
  if (data.status === 'unavailable' && data.retryAt) return true;
  return ['detail','voteCoverage','participantCoverage','index','committeeDetails','committeeMemberships','document','selectedText','text','textCache','source','sources','coverage','fallback','references','debates'].some(key=>retryableGap(data[key]));
}
export function gapRetryAt(data) {
  if(!data||typeof data!=='object')return 0;
  if(Array.isArray(data))return Math.max(0,...data.map(gapRetryAt));
  const at=typeof data.nextRetryAt==='string'?Date.parse(data.nextRetryAt):data.retryAt;
  return Math.max(Number.isFinite(at)?at:0,...['detail','voteCoverage','participantCoverage','index','committeeDetails','committeeMemberships','document','selectedText','text','textCache','source','sources','coverage','fallback','references','debates'].map(key=>gapRetryAt(data[key])));
}
