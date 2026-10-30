import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaFreshMs,agendaSettledAfter,agendaViewFreshMs,nextPlenaryWarmup,PLENARY_REFRESH_MS} from './plenary-cache-policy.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';

const now=Date.parse('2026-10-20T12:00:00Z');
const catalogue=dates=>({complete:true,sittings:dates.map(activity_date=>({activity_date}))});
const view=date=>({sitting:{date},detail:null,coverage:{agendaComplete:true,sources:[],catalogue:{status:'complete',years:[]}}});

test('completed weeks have no age expiry; current and future agendas use at least one hour',()=>{
  assert.equal(agendaFreshMs('/meetings/MTG-PL-2026-10-07/foreseen-activities',now),Infinity);
  for(const date of ['2026-10-19','2026-10-20','2026-10-22','2026-11-11'])assert.equal(agendaFreshMs('/meetings/MTG-PL-'+date+'/foreseen-activities',now),PLENARY_REFRESH_MS);
  assert.equal(agendaFreshMs('/procedures/2026-0001',now),null);
  assert.equal(agendaViewFreshMs(view('2026-10-07'),now),Infinity);
  assert.equal(agendaViewFreshMs(view('2026-10-20'),now),PLENARY_REFRESH_MS);
});

test('indefinite retention requires a post-week observation, including across DST',()=>{
  const endpoint='/meetings/MTG-PL-2026-10-20/foreseen-activities',later=Date.parse('2026-10-26T12:00:00Z');
  assert.equal(agendaSettledAfter(endpoint,now),-Infinity);
  assert.equal(agendaSettledAfter(endpoint,later),Date.parse('2026-10-25T23:00:00Z'));
  const preliminary=view('2026-10-20');preliminary.coverage.sources=[{apiUrl:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:new Date(now).toISOString()}];
  assert.equal(agendaViewFreshMs(preliminary,later),60_000);
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-20']),[preliminary],later),PLENARY_REFRESH_MS);
  preliminary.coverage.sources[0].fetchedAt=new Date(later).toISOString();assert.equal(agendaViewFreshMs(preliminary,later),Infinity);
});

test('warm-up checks latest-week details during recesses and wakes for a nearer new week',()=>{
  const asOf=Date.parse('2026-10-29T12:00:00Z');
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-22','2026-11-11']),[view('2026-10-22')],asOf),PLENARY_REFRESH_MS);
  const beforeDst=Date.parse('2026-10-12T12:00:00Z');
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-07','2026-10-20']),[view('2026-10-07')],beforeDst),PLENARY_REFRESH_MS);
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-22']),[view('2026-10-22')],asOf),PLENARY_REFRESH_MS);
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-22','2026-11-11']),[view('2026-10-22')],Date.parse('2026-11-08T22:45:00Z')),15*60_000);
  assert.equal(nextPlenaryWarmup(catalogue(['2026-12-17']),[view('2026-12-17')],Date.parse('2027-01-02T12:00:00Z')),PLENARY_REFRESH_MS);
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-20']),[view('2026-10-20')],now),PLENARY_REFRESH_MS);
  const missing=view('2026-10-07');missing.coverage.agendaComplete=false;
  assert.equal(nextPlenaryWarmup(catalogue(['2026-10-07']),[missing],asOf),PLENARY_REFRESH_MS);
});

test('active views refresh hourly and missing historical agendas remain retryable',async()=>{
  let time=now,loads=0;
  const cache=new InsightViewCache({directory:null,clock:()=>time});
  const options={freshMs:value=>agendaViewFreshMs(value,time)};
  const load=async()=>{loads++;return view('2026-10-20');};
  await cache.get('active',load,options);time+=5*60_000;
  assert.equal((await cache.get('active',load,options)).viewCache.stale,false);assert.equal(loads,1);
  time=now+PLENARY_REFRESH_MS+1;await cache.get('active',load,options);await Promise.all(cache.pending.values());assert.equal(loads,2);
  let available=false;
  const recover=async()=>{const result=view('2026-10-07');result.coverage.agendaComplete=available;return result;};
  await cache.get('missing',recover,options);available=true;time+=60_001;
  await cache.get('missing',recover,options);await Promise.all(cache.pending.values());
  const recovered=await cache.get('missing',recover,options);assert.equal(recovered.coverage.agendaComplete,true);assert.equal(recovered.viewCache.stale,false);
});
