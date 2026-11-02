import {statSync} from 'node:fs';
import {topicBuildWindowOpen} from './topic-build-window.mjs';
const MINUTE=60_000,DAY=1440*MINUTE;
// Failed or skipped builds wait 15 minutes, doubling to one day. Refreshes
// (not bootstraps) start once per source generation and at most twice per
// Brussels window occurrence, so a generation published later in the window
// still builds but repeated recovery publications cannot rebuild all night.
export const topicBuildBackoff=failures=>Math.min(DAY,15*MINUTE*2**Math.min(Math.max(0,failures-1),20));
export function topicBuildWindowKey(now,window=process.env.TOPICS_REBUILD_WINDOW||'03:00-05:00'){
 topicBuildWindowOpen(now,window);const start=Number(window.slice(0,2))*60+Number(window.slice(3,5));
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))-start*MINUTE).toISOString().slice(0,10);
}
const state=store=>store.get('topicBuildState')||{};
export const topicRefreshesPerWindow=2;
const attempts=(s,key)=>s.window===key&&Array.isArray(s.generations)?s.generations:[];
export function topicBuildAllowed(store,now=store.clock(),{bootstrap=false,window}={}){
 const s=state(store);if(Number(s.retryAt)>now)return false;
 if(bootstrap)return true;const used=attempts(s,topicBuildWindowKey(now,window));
 return used.length<topicRefreshesPerWindow&&!used.includes(store.get('active')??null);
}
export function topicBuildStarted(store,now=store.clock(),{bootstrap=false,window}={}){
 if(bootstrap)return;const s=state(store),key=topicBuildWindowKey(now,window);
 store.set('topicBuildState',{...s,windowAttempt:undefined,window:key,generations:[...attempts(s,key),store.get('active')??null]});
}
export function topicBuildFailed(store,error,now=store.clock(),{skipped=false}={}){
 const s=state(store),failures=(s.failures||0)+1;
 const next={...s,failures,lastFailureAt:new Date(now).toISOString(),error:String(error?.message||error).slice(0,500),...(skipped?{skipped:true}:{skipped:undefined}),retryAt:now+topicBuildBackoff(failures)};
 store.set('topicBuildState',next);return next;
}
export function topicBuildSucceeded(store){const {window,generations}=state(store);store.set('topicBuildState',window?{window,generations}:null);}
// The build adds one publication beside the readable one. Use the last
// measured publication size, or a fifth of the used pages before the first
// measurement, less pages SQLite can reuse.
export function topicBuildDiskCheck(store,diskLimit){
 if(!Number.isFinite(diskLimit)||!store.filename)return {ok:true};
 const size=['','-wal','-shm'].reduce((sum,suffix)=>{try{return sum+statSync(store.filename+suffix).size;}catch{return sum;}},0);
 const page=store.db.prepare('PRAGMA page_size').get().page_size,pages=store.db.prepare('PRAGMA page_count').get().page_count,free=store.db.prepare('PRAGMA freelist_count').get().freelist_count*page;
 const estimate=Number(store.get('topicProjectionSize')?.bytes)||Math.round((pages*page-free)/5),needed=Math.max(0,estimate-free);
 return {ok:size+needed<=diskLimit,size,estimate,needed,diskLimit};
}
