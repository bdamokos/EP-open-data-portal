import {canonicalEPReference} from './amendments.mjs';

// A listing provides the inverse adopts relationship, which reports need not
// expose. Match both identity and decision date; competing editions stay unbound.
export function adoptedPlacementText(records,{documentId,dates,language}) {
  const uniqueDates=[...new Set(dates)];
  if(uniqueDates.length!==1||!/^\d{4}-\d{2}-\d{2}$/u.test(uniqueDates[0]||''))return null;
  const matches=records.filter(work=>canonicalEPReference(work.id)==='eli/dl/doc/'+work.identifier
    &&/^TA-10-\d{4}-\d{4,6}$/u.test(work.identifier||'')
    &&String(work.work_type?.id||work.work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'')==='def/ep-document-types/TEXT_ADOPTED'
    &&work.document_date===uniqueDates[0]
    &&(Array.isArray(work.adopts)?work.adopts:[]).some(value=>canonicalEPReference(value)==='eli/dl/doc/'+documentId));
  if(matches.length!==1)return null;
  const code=/^[a-z]{2}$/u.test(language||'')?language:'en';
  return `https://www.europarl.europa.eu/doceo/document/${matches[0].identifier}_${code.toUpperCase()}.html`;
}

let listingTail=Promise.resolve(),nextListingAt=0,listingPausedUntil=0;
// Optional enrichment never retries a throttled source. Serialize new listing
// reads, including reads for different years, through the shared cache client.
// Await stale refreshes so throttling reaches this three-minute pause instead
// of being swallowed by an unobserved stale-while-revalidate background request.
export async function placementAdoptedListing(request,year) {
  const run=listingTail.then(async()=>{
    if(Date.now()<listingPausedUntil)return null;
    const delay=nextListingAt-Date.now();
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    nextListingAt=Date.now()+2000;
    try{return await request('/adopted-texts',{year,limit:500},{ttl:86_400_000,staleWhileRevalidate:false});}
    catch(error){if(error?.status===429||error?.code==='odp_rate_limited')listingPausedUntil=Date.now()+180_000;throw error;}
  });
  listingTail=run.catch(()=>{});
  return run;
}
