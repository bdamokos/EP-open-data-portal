import {createHash} from 'node:crypto';
import {storyTables,stageStoryInput} from './story-facts-storage.mjs';
import {array,tail} from './story-facts-model.mjs';
export const STORY_PAGE_SIZE=250;
export function storyCollectionDue(store,now){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='story_jobs'").get())return false;
 return Boolean(store.db.prepare("SELECT 1 FROM story_jobs WHERE state='pending' AND next_read<=? LIMIT 1").get(now));
}
function* expanded(work){
 const stack=[[work][Symbol.iterator]()],seen=new WeakSet();
 while(stack.length){const next=stack.at(-1).next();if(next.done){stack.pop();continue;}const value=next.value;if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);yield value;stack.push(array(value.consists_of)[Symbol.iterator]());}
}
export async function collectStorySource(worker){
 const store=worker.store;store.assertWriter();storyTables(store.db);
 if(worker.controller.signal.aborted||worker.requests>=worker.budget)return false;
 const row=store.db.prepare("SELECT * FROM story_jobs WHERE state='pending' AND next_read<=? ORDER BY next_read,key LIMIT 1").get(worker.clock());if(!row)return false;
 const update=(state,error=null,offset=row.offset,signature=null)=>store.db.prepare('UPDATE story_jobs SET state=?,next_read=?,offset=?,signature=?,error=? WHERE key=?').run(state,state==='pending'?0:null,offset,signature,error,row.key);
 if(row.kind==='agenda'&&row.id.slice(7,17)<'2024-12-16'){update('unavailable','not-served-before-2024-12-16');store.set('storyProjectionDirty',true);return true;}
 const endpoint=row.kind==='event'?'/events/'+row.id:'/meetings/'+row.id+(row.kind==='agenda'?'/foreseen-activities':'/decisions');
 const params=row.kind==='decisions'?{'filter-output':'voters'}:row.kind==='agenda'?{limit:STORY_PAGE_SIZE,offset:row.offset}:{};
 try{
  const record=await worker.request(endpoint,params,{backgroundLow:true,preserveStatus:true});worker.controller.signal.throwIfAborted();store.assertWriter();
  if(record.status===204){update('unavailable','http-204');store.set('storyProjectionDirty',true);return true;}
  const works=record.payload?.data;if(!Array.isArray(works))throw Error('Story source has no data array.');
  const ids=works.map(w=>w.activity_id||tail(w.id)),day=row.id.slice(7,17);
  if(row.kind==='event'&&(works.length!==1||ids[0]!==row.id))throw Error('Event identity does not match the request.');
  if(ids.some(id=>id&&!id.startsWith('MTG-PL-'+day+'-')))throw Error('Sitting identities do not match the request.');
  const signature=createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex');
  store.db.exec('CREATE TABLE IF NOT EXISTS story_seen_pages(job TEXT,signature TEXT,PRIMARY KEY(job,signature))');
  if(store.db.prepare('SELECT 1 FROM story_seen_pages WHERE job=? AND signature=?').get(row.key,signature)){update('partial','repeated-page',row.offset,signature);store.set('storyProjectionDirty',true);return true;}
  const source={url:record.url,fetchedAt:record.fetchedAt};let batch=[];
  const save=()=>store.transaction(()=>{store.assertWriter();for(const w of batch)stageStoryInput(store,w,source,{rank:4});});
  for(const work of works)for(const w of row.kind==='agenda'?expanded(work):[work]){
   batch.push(w);if(batch.length===25){save();batch=[];store.renew();await new Promise(setImmediate);}
  }
  if(batch.length)save();
  store.transaction(()=>{store.assertWriter();store.db.prepare('INSERT OR IGNORE INTO story_seen_pages VALUES (?,?)').run(row.key,signature);
   // The decisions endpoint ignores pagination. One full response completes it.
   const more=row.kind==='agenda'&&works.length===STORY_PAGE_SIZE;
   update(more?'pending':'available',null,row.offset+(row.kind==='agenda'?works.length:0),signature);
   store.set(row.kind==='decisions'?'storyProjectionDirty':'topicProjectionDirty',true);
  });
 }catch(error){if(worker.controller.signal.aborted)throw error;store.assertWriter();const delay=Math.min(30*60_000,30_000*2**Math.min(row.attempts,6));store.db.prepare('UPDATE story_jobs SET attempts=attempts+1,next_read=?,error=? WHERE key=?').run(Math.max(worker.clock()+delay,Number(error.retryAt)||0,worker.clock()+(Number(error.retryAfter)||0)*1000),String(error.message).slice(0,200),row.key);}
 return true;
}
