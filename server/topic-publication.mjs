import {topicBootstrapRequired} from './topic-projection-state.mjs';
import {topicBuildWindowOpen} from './topic-build-window.mjs';
import {buildTopics} from './topics-project.mjs';
import {topicCollectionDue} from './topics-collector.mjs';
import {storyCollectionDue} from './story-facts-collector.mjs';
// Shadow rows share the covering indexes but have a private publication ID.
// Publishing swaps only metadata in one fenced commit; no live rows are rewritten.
const keys=new Set(['recordTopicProjection','recordTopicCoverage','recordTopicCalendar','recordTopicAskerCoverage','storyProjection','storyCoverage','storyProjectionDirty','topicProjectionDirty']);
export const projectionTables=['record_topic_records','record_topic_memberships','record_topic_concepts','record_topic_totals','record_topic_groups','record_topic_group_summary','record_topic_question_places','record_topic_author_countries','record_topic_filtered_totals','record_topic_filtered_groups','story_facts','story_links','story_places','story_topics','story_parents','story_scope_records','story_scope_counts','story_rank','story_place_rank','story_map_groups'];
export function topicRebuildDue(store,now=store.clock(),window){
 if(!store.get('active'))return false;
 if(topicBootstrapRequired(store))return true;
 if(!topicBuildWindowOpen(now,window))return false;
 if(!store.get('topicProjectionDirty')&&!store.get('storyProjectionDirty'))return false;
 const last=store.get('topicProjectionPublishedAt')||0;
 return !last||now-last>=3*3600_000||!topicCollectionDue(store,now)&&!storyCollectionDue(store,now);
}
export async function rebuildTopicProjection(store,{generation=store.get('active'),onProgress=()=>{},...options}={}){
 store.assertWriter();const old=store.get('recordTopicProjection'),previous=old?.dataGeneration||old?.generation;
 let epoch;store.transaction(()=>{store.assertWriter();epoch=Math.max(1_000_000_000,store.get('topicProjectionSequence')||0)+1;store.set('topicProjectionSequence',epoch);});
 // Older read snapshots retain their rows through SQLite MVCC. Only the
 // current publication must survive while its replacement is built.
 await pruneTopicData(store,[previous].filter(Boolean));
 const staged=new Map(),shadow=new Proxy(store,{get(target,key){if(key==='get')return k=>staged.has(k)?staged.get(k):store.get(k);if(key==='set')return(k,v)=>keys.has(k)?staged.set(k,v):store.set(k,v);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const result=await buildTopics(shadow,{...options,generation:epoch,sourceGeneration:generation,prune:false,onProgress});
 store.transaction(()=>{store.assertWriter();if(store.get('active')!==generation)throw Error('Index generation changed during topic publication.');
  for(const [key,value] of staged){if(value&&typeof value==='object'&&value.generation===epoch)store.set(key,{...value,generation,...(['recordTopicProjection','storyProjection'].includes(key)?{dataGeneration:epoch}:{})});else store.set(key,value);}
  store.set('previousTopicDataGeneration',null);store.set('topicProjectionDirty',false);store.set('storyProjectionDirty',false);store.set('topicProjectionPublishedAt',store.clock());
 });
 onProgress('published');
 // Readers already in a transaction retain the old publication through MVCC.
 await pruneTopicData(store,[epoch]);
 return {...result,generation,dataGeneration:epoch};
}

async function pruneTopicData(store,keep){
 for(const table of projectionTables){if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const old=store.db.prepare('SELECT DISTINCT generation FROM '+table+(keep.length?' WHERE generation NOT IN ('+keep.map(()=>'?').join(',')+')':'')).all(...keep);
  for(const {generation} of old){let n;do{store.transaction(()=>{store.assertWriter();n=store.db.prepare('DELETE FROM '+table+' WHERE rowid IN (SELECT rowid FROM '+table+' WHERE generation=? LIMIT 500)').run(generation).changes;});if(!store.renew())throw Error('Activity-index writer lease was lost.');await new Promise(setImmediate);}while(n);}
 }
}
