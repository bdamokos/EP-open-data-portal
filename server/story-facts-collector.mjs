import {collectOutsideRoles,outsideRolesDue} from './outside-role-collector.mjs';
import {collectorRetry} from './collector-retry.mjs';
import {createHash} from 'node:crypto';
import {storyTables,stageStoryInput,adoptHeldEventSnapshots} from './story-facts-storage.mjs';
import {array,tail} from './story-facts-model.mjs';
export const STORY_PAGE_SIZE=250;
const DAY=86400_000;
export const brusselsDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(now);
// Vote decisions are read only after the sitting day. An empty or 204 reply
// for a recent sitting is rechecked 1, 3, 7 and 30 days after it, then kept.
export function decisionRecheck(sittingId,now){const sitting=Date.parse(sittingId.slice(7,17)+'T00:00:00Z');for(const days of [1,3,7,30])if(sitting+days*DAY>now)return sitting+days*DAY;return null;}
export function storyCollectionDue(store,now){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='story_jobs'").get())return false;
 return outsideRolesDue(store,now)||Boolean(store.db.prepare("SELECT 1 FROM story_jobs WHERE state IN ('pending','unavailable') AND next_read<=? LIMIT 1").get(now));
}
function* expanded(work){
 const stack=[[work][Symbol.iterator]()],seen=new WeakSet();
 while(stack.length){const next=stack.at(-1).next();if(next.done){stack.pop();continue;}const value=next.value;if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);yield value;stack.push(array(value.consists_of)[Symbol.iterator]());}
}
export async function collectStorySource(worker){
 const store=worker.store;store.assertWriter();storyTables(store.db);
 if(worker.controller.signal.aborted||worker.requests>=worker.budget)return false;
 const row=store.db.prepare("SELECT * FROM story_jobs WHERE state IN ('pending','unavailable') AND next_read<=? ORDER BY next_read,key LIMIT 1").get(worker.clock());if(!row)return collectOutsideRoles(worker);
 const update=(state,error=null,offset=row.offset,signature=null)=>store.db.prepare('UPDATE story_jobs SET attempts=0,state=?,next_read=?,offset=?,signature=?,error=? WHERE key=?').run(state,state==='pending'?0:null,offset,signature,error,row.key);
 const day=row.id.slice(7,17);
 if(row.kind==='decisions'&&day>=brusselsDay(worker.clock())){store.db.prepare('UPDATE story_jobs SET next_read=? WHERE key=?').run(Math.max(Date.parse(day+'T00:00:00Z')+DAY,worker.clock()+60_000),row.key);return true;}
 const recheck=error=>{const next=row.kind==='decisions'?decisionRecheck(row.id,worker.clock()):null;if(!next)return false;store.db.prepare('UPDATE story_jobs SET attempts=0,state=?,next_read=?,error=? WHERE key=?').run('unavailable',next,error,row.key);if(row.state!=='unavailable'||row.error!==error)store.set('storyProjectionDirty',true);return true;};
 // A held complete debate snapshot is the same response: adopt it instead of reading again.
 if(row.kind==='event'&&adoptHeldEventSnapshots(store,{ids:[row.id]}).adopted)return true;
 if(row.kind==='agenda'&&row.id.slice(7,17)<'2024-12-16'){update('unavailable','not-served-before-2024-12-16');store.set('storyProjectionDirty',true);return true;}
 const endpoint=row.kind==='event'?'/events/'+row.id:'/meetings/'+row.id+(row.kind==='agenda'?'/foreseen-activities':'/decisions');
 const params=row.kind==='decisions'?{'filter-output':'voters'}:row.kind==='agenda'?{limit:STORY_PAGE_SIZE,offset:row.offset}:{};
 try{
  const record=await worker.request(endpoint,params,{backgroundLow:true,preserveStatus:true});worker.controller.signal.throwIfAborted();store.assertWriter();
  if(record.status===204){if(!recheck('http-204')){update('unavailable','http-204');store.set('storyProjectionDirty',true);}return true;}
  const works=record.payload?.data;if(!Array.isArray(works))throw Error('Story source has no data array.');
  if(!works.length&&recheck('empty-response'))return true;
  const ids=works.map(w=>w.activity_id||tail(w.id));
  if(row.kind==='event'&&(works.length!==1||ids[0]!==row.id))throw Error('Event identity does not match the request.');
  if(ids.some(id=>id&&!id.startsWith('MTG-PL-'+day+'-')))throw Error('Sitting identities do not match the request.');
  const signature=createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex');
  store.db.exec('CREATE TABLE IF NOT EXISTS story_seen_pages(job TEXT,signature TEXT,PRIMARY KEY(job,signature))');
  if(store.db.prepare('SELECT 1 FROM story_seen_pages WHERE job=? AND signature=?').get(row.key,signature)){update('partial','repeated-page',row.offset,signature);store.set('storyProjectionDirty',true);return true;}
  const source={url:record.url,fetchedAt:record.fetchedAt},dirtyKey=row.kind==='decisions'?'storyProjectionDirty':'topicProjectionDirty';let batch=[];
  // Each batch that changes inputs marks the projection in its own commit.
  const save=()=>store.transaction(()=>{store.assertWriter();let changed=false;for(const w of batch)changed=Boolean(stageStoryInput(store,w,source,{rank:4}))||changed;if(changed)store.set(dirtyKey,true);});
  for(const work of works)for(const w of row.kind==='agenda'?expanded(work):[work]){
   batch.push(w);if(batch.length===25){save();batch=[];store.renew();await new Promise(setImmediate);}
  }
  if(batch.length)save();
  store.transaction(()=>{store.assertWriter();store.db.prepare('INSERT OR IGNORE INTO story_seen_pages VALUES (?,?)').run(row.key,signature);
   // The decisions endpoint ignores pagination. One full response completes it.
   const more=row.kind==='agenda'&&works.length===STORY_PAGE_SIZE;
   update(more?'pending':'available',null,row.offset+(row.kind==='agenda'?works.length:0),signature);
  });
 }catch(error){if(worker.controller.signal.aborted)throw error;store.assertWriter();const retry=collectorRetry(error,row.attempts,worker.clock());store.db.prepare('UPDATE story_jobs SET state=?,attempts=?,next_read=?,error=? WHERE key=?').run(retry.permanent?'unavailable':'pending',retry.attempts,retry.next,retry.paused?null:String(error.message).slice(0,200),row.key);if(retry.permanent&&(row.state!=='unavailable'||row.error!==String(error.message).slice(0,200)))store.set('storyProjectionDirty',true);}
 return true;
}
