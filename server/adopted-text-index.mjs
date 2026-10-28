import {array,tail} from './activity-index-model.mjs';

export const ADOPTED_TEXT_DISCOVERY_VERSION=1;
const markerKey='adoptedTextDiscovery';
const yearOf=now=>new Date(now).getUTCFullYear();
const currentMarker=marker=>marker?.version===ADOPTED_TEXT_DISCOVERY_VERSION&&Number.isInteger(marker.throughYear)&&marker.throughYear>=2024;

export function adoptedTextDiscoveryDue(store,now=store.clock()) {
  const marker=store.get(markerKey);
  return !currentMarker(marker)||marker.throughYear<yearOf(now);
}

// Admission is versioned; normal durable catalogue/detail tasks own completion
// and failures. No source request or independent collector runs here.
export function scheduleAdoptedTexts(worker,cycle) {
  const {store}=worker,now=worker.clock();
  if(!adoptedTextDiscoveryDue(store,now))return false;
  return store.transaction(()=>{
    store.assertWriter();
    if(store.get('working')?.generation!==cycle.generation)throw new Error('Adopted-text discovery requires a working generation.');
    const marker=store.get(markerKey),throughYear=yearOf(now);
    const firstYear=currentMarker(marker)?Math.max(2024,marker.throughYear+1):2024;
    for(let year=firstYear;year<=throughYear;year++)store.enqueue(cycle.generation,`catalog:adopted-texts:v${ADOPTED_TEXT_DISCOVERY_VERSION}:${year}`,'catalog',{
      endpoint:'/adopted-texts',params:{year,'parliamentary-term':10,'work-type':'TEXT_ADOPTED'},offset:0,deltaOnly:true,
    },100);
    store.set(markerKey,{version:ADOPTED_TEXT_DISCOVERY_VERSION,throughYear,scheduledAt:new Date(now).toISOString()});
    return true;
  });
}

const reference=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export function validateAdoptedText(endpoint,work) {
  const id=endpoint.match(/^\/adopted-texts\/(TA-10-\d{4}-\d{4,6})$/)?.[1];
  if(!id||work?.identifier!==id||reference(work.id)!=='eli/dl/doc/'+id||tail(work.work_type)!=='TEXT_ADOPTED')
    throw new Error('Invalid exact adopted-text identity or type.');
  const terms=array(work.parliamentary_term);
  if(terms.some(term=>reference(term)!=='org/ep-10'))throw new Error('Invalid adopted-text parliamentary term.');
  return work;
}
