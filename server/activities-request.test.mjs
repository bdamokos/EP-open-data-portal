import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.ODP_CACHE_DIR='';
const {recentActivities}=await import('./activities.mjs');
const {runWithRequestSignal}=await import('./request-budget.mjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const xml='<rss><channel><item><title>Retained question</title><link>https://www.europarl.europa.eu/doceo/document/E-10-2026-003840_EN.html</link><guid>QE_E-10-2026-003840_EN</guid><pubDate>Thu, 01 Oct 2026 07:23:07 GMT</pubDate></item></channel></rss>';

test('shared activity feed survives its first reader disconnecting and saves the result',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+60_000});
  let finish,feedSignal,feeds=0,profiles=0;
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    if(new URL(url).pathname==='/api/v2/meps/96826'){
      profiles++;return Response.json({data:[{identifier:'96826',givenName:'Tamás',familyName:'Deutsch',hasEmail:'test.feed@europarl.europa.eu'}]});
    }
    assert.equal(new URL(url).pathname,'/rss/mep/test.feed/en.xml');feeds++;feedSignal=signal;
    return new Promise((resolve,reject)=>{
      finish=()=>resolve(new Response(xml,{headers:{'content-type':'application/rss+xml'}}));
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
  });
  const a=new AbortController(),b=new AbortController(),reason=new Error('first reader closed');
  const first=runWithRequestSignal(a.signal,()=>assert.rejects(recentActivities(96826,'en'),e=>e===reason));
  await turn();
  const second=runWithRequestSignal(b.signal,()=>recentActivities(96826,'en'));
  await turn();t.mock.timers.tick(2100);await turn();assert.equal(feeds,1);
  a.abort(reason);await first;assert.equal(feedSignal.aborted,false);
  finish();const result=await second;
  assert.equal(result.items[0].id,'QE_E-10-2026-003840_EN');assert.equal(b.signal.aborted,false);
  assert.equal(await recentActivities(96826,'en'),result);assert.equal(profiles,1);assert.equal(feeds,1);
});
