import {dispatchBaseBackfill} from './base-source-backfill-dispatch.mjs';
import {collectorTurnEvery} from './collector-share.mjs';
import {collectTopicProcedure} from './topics-collector.mjs';
import {collectStorySource} from './story-facts-collector.mjs';
const state=worker=>worker.store.get('topicCollectorDispatch')||{ordinary:0,next:'topic'};
export function ordinaryCollectorTurn(worker,every=collectorTurnEvery){const s=state(worker);worker.store.set('topicCollectorDispatch',{...s,ordinary:Math.min(every-1,s.ordinary+1)});}
export async function dispatchCollector(worker,{busy=false,every=collectorTurnEvery,topic=collectTopicProcedure,story=collectStorySource}={}){
 const s=state(worker);if(busy&&s.ordinary<every-1||worker.requests>=worker.budget||worker.controller.signal.aborted)return false;
 // Backfill, topic and story rotate within one optional allocation. Persist
 // both the core count and next lane across short iterations and restarts.
 const lanes=worker.baseBackfill?[['topic',topic],['story',story],['backfill',dispatchBaseBackfill]]:[['topic',topic],['story',story]];
 const start=Math.max(0,lanes.findIndex(([name])=>name===s.next));
 for(let offset=0;offset<lanes.length;offset++){
  const index=(start+offset)%lanes.length,[,collect]=lanes[index];
  if(await collect(worker)){worker.store.set('topicCollectorDispatch',{ordinary:0,next:lanes[(index+1)%lanes.length][0]});return true;}
 }
 return false;
}
