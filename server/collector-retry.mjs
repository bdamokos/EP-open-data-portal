const DAY=86400_000;
// Admission caps, queue waits, run budgets and source rate limits mean "try
// later"; they never count as a failed read.
export const collectorPaused=error=>['official_context_capacity','admission_paused','source_admission_paused','upstream_busy'].includes(error?.code)||[429,503].includes(error?.status)&&!error?.code||error?.code==='official_source_limited'&&[429,503].includes(error.sourceStatus)||/cache capacity reached|admission paused|budget exhausted/i.test(error?.message||'');
export function collectorPermanent(error){
 for(let e=error,n=0;e&&n<4;e=e.cause,n++)if([404,410].includes(e.status)||[404,410].includes(e.sourceStatus))return true;
 return ['official_source_size','official_source_type','official_source_identity','official_document_invalid','procedure_identity','topic_source_identity','story_source_identity'].includes(error?.code)||error instanceof SyntaxError||/identit(?:y|ies)|reference unavailable|do(?:es)? not match|no readable content|(?:no|invalid) data array/i.test(error?.message||'');
}
export function collectorRetry(error,attempts,now){
 const paused=collectorPaused(error),permanent=!paused&&collectorPermanent(error);
 const delay=paused?60_000:permanent?30*DAY:Math.min(7*DAY,60_000*2**Math.min(attempts,20));
 return {paused,permanent,attempts:attempts+(paused?0:1),next:Math.max(now+delay,Number(error.retryAt)||0,now+(Number(error.retryAfter)||0)*1000)};
}
