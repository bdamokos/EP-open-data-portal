import {collectTopicProcedure} from './topics-collector.mjs';
import {collectStorySource} from './story-facts-collector.mjs';
const state=worker=>worker.store.get('topicCollectorDispatch')||{ordinary:0,next:'topic'};
export function ordinaryCollectorTurn(worker){const s=state(worker);worker.store.set('topicCollectorDispatch',{...s,ordinary:Math.min(31,s.ordinary+1)});}
export async function dispatchCollector(worker,{busy=false,topic=collectTopicProcedure,story=collectStorySource}={}){
 const s=state(worker);if(busy&&s.ordinary<31||worker.requests>=worker.budget||worker.controller.signal.aborted)return false;
 const lanes=s.next==='topic'?[['topic',topic],['story',story]]:[['story',story],['topic',topic]];
 for(const [name,collect] of lanes)if(await collect(worker)){worker.store.set('topicCollectorDispatch',{ordinary:0,next:name==='topic'?'story':'topic'});return true;}
 return false;
}
