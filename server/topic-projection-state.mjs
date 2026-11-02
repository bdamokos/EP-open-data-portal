import {RECORD_TOPICS_VERSION} from './record-topics.mjs';
import {STORY_FACTS_VERSION} from './story-facts-model.mjs';

// Keep background scheduling aligned with the exact versions readers accept.
export function readableRecordTopicState(store){
 const state=store.get('recordTopicProjection'),active=store.get('active');
 return state?.version===RECORD_TOPICS_VERSION&&state.generation<=active&&(state.dataGeneration||state.generation===active||state.generation===store.get('previous'))?{...state,sourceGeneration:state.generation,generation:state.dataGeneration||state.generation}:null;
}
export function readableStoryState(store,{askers='all'}={}){
 const state=store.get('storyProjection'),base=readableRecordTopicState(store),active=store.get('active'),generation=state?.dataGeneration||state?.generation;
 if(!state||!base||!Number.isSafeInteger(state.version)||state.version<8||state.version>STORY_FACTS_VERSION||askers==='not-home'&&state.version<9||state.generation>active||!state.dataGeneration&&![active,store.get('previous')].includes(state.generation)||base.sourceGeneration!==state.generation||base.generation!==generation)return null;
 return state;
}
export function topicBootstrapRequired(store){
 const base=readableRecordTopicState(store);
 // The current place overview/search and story templates use not-home too.
 return !base||!base.askerSubsets?.includes('not-home')||!readableStoryState(store,{askers:'not-home'});
}
