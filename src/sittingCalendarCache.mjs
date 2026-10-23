import {createDataClient} from './client.mjs';

// Reopening a partial calendar must reach the server's bounded recovery path.
// Full observations keep each feature's normal browser cache lifetime.
export function calendarCacheMaxAge(data,maxAge) {
  const coverage=data?.coverage,calendar=coverage?.catalogue;
  if(coverage?.catalogueComplete===false||calendar&&calendar.status!=='complete'||calendar?.years?.some(year=>year.sources?.some(source=>source.stale||source.refreshInProgress||source.refreshError)))return 0;
  return maxAge;
}
export const createSpeechCloudClient=load=>createDataClient(load,{maxEntries:48,maxAge:30*60_000,maxAgeFor:data=>calendarCacheMaxAge(data,30*60_000),timeoutFor:()=>35_000});
