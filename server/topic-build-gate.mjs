import {statSync} from 'node:fs';
import {topicBuildWindowOpen} from './topic-build-window.mjs';
const MINUTE=60_000,DAY=1440*MINUTE;
// Failed or skipped builds wait 15 minutes, doubling to one day. Refreshes
// (not bootstraps) start at most once per Brussels window occurrence.
export const topicBuildBackoff=failures=>Math.min(DAY,15*MINUTE*2**Math.min(Math.max(0,failures-1),20));
export function topicBuildWindowKey(now,window=process.env.TOPICS_REBUILD_WINDOW||'03:00-05:00'){
 topicBuildWindowOpen(now,window);const start=Number(window.slice(0,2))*60+Number(window.slice(3,5));
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))-start*MINUTE).toISOString().slice(0,10);
}
const state=store=>store.get('topicBuildState')||{};
export function topicBuildAllowed(store,now=store.clock(),{bootstrap=false,window}={}){
 const s=state(store);if(Number(s.retryAt)>now)return false;
 return bootstrap||s.windowAttempt!==topicBuildWindowKey(now,window);
}
export function topicBuildStarted(store,now=store.clock(),{bootstrap=false,window}={}){
 if(!bootstrap)store.set('topicBuildState',{...state(store),windowAttempt:topicBuildWindowKey(now,window)});
}
export function topicBuildFailed(store,error,now=store.clock(),{skipped=false}={}){
 const s=state(store),failures=(s.failures||0)+1;
 const next={...s,failures,lastFailureAt:new Date(now).toISOString(),error:String(error?.message||error).slice(0,500),...(skipped?{skipped:true}:{skipped:undefined}),retryAt:now+topicBuildBackoff(failures)};
 store.set('topicBuildState',next);return next;
}
export function topicBuildSucceeded(store){const {windowAttempt}=state(store);store.set('topicBuildState',windowAttempt?{windowAttempt}:null);}
// The build adds one publication beside the readable one. Use the last
// measured publication size, or the current projection's pages, less pages
// SQLite can reuse. Without either, assume a fifth of the used pages.
export function topicBuildDiskCheck(store,diskLimit){
 if(!Number.isFinite(diskLimit)||!store.filename)return {ok:true};
 const size=['','-wal','-shm'].reduce((sum,suffix)=>{try{return sum+statSync(store.filename+suffix).size;}catch{return sum;}},0);
 const page=store.db.prepare('PRAGMA page_size').get().page_size,pages=store.db.prepare('PRAGMA page_count').get().page_count,free=store.db.prepare('PRAGMA freelist_count').get().freelist_count*page;
 const estimate=Number(store.get('topicProjectionSize')?.bytes)||currentProjectionBytes(store)||Math.round((pages*page-free)/5),needed=Math.max(0,estimate-free);
 return {ok:size+needed<=diskLimit,size,estimate,needed,diskLimit};
}
function currentProjectionBytes(store){
 try{let bytes=0;for(const {name} of store.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND (tbl_name LIKE 'record\\_topic\\_%' ESCAPE '\\' OR tbl_name LIKE 'story\\_%' ESCAPE '\\') AND tbl_name NOT IN ('story_inputs','story_jobs','story_seen_pages')").all())bytes+=store.db.prepare('SELECT COALESCE(SUM(pgsize),0) n FROM dbstat WHERE name=? AND aggregate=TRUE').get(name).n;return bytes;}
 catch{return 0;}
}
