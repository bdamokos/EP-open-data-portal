import test from 'node:test';import assert from 'node:assert/strict';
import {RECORD_TOPICS_VERSION} from './record-topics.mjs';import {STORY_FACTS_VERSION} from './story-facts-model.mjs';
import {readableRecordTopicState,readableStoryState,topicBootstrapRequired} from './topic-projection-state.mjs';
import {topicRebuildDue} from './topic-publication.mjs';
function fixture(){const values=new Map([['active',2],['previous',1],['recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation:2,askerSubsets:['all','home','elsewhere','not-home']}],['storyProjection',{version:STORY_FACTS_VERSION,generation:2}]]);return {get:key=>values.get(key),set:(key,value)=>values.set(key,value),clock:()=>Date.parse('2026-11-02T11:00Z')};}
for(const missing of ['recordTopicProjection','storyProjection'])test('missing '+missing+' makes a bootstrap due outside the window without dirty inputs',()=>{const store=fixture();store.set(missing,null);assert(topicBootstrapRequired(store));assert(topicRebuildDue(store));});
for(const [name,version] of [['recordTopicProjection',RECORD_TOPICS_VERSION-1],['storyProjection',7],['storyProjection',STORY_FACTS_VERSION+1],['storyProjection',8]])test(name+' version '+version+' needs an immediate bootstrap for rejected views',()=>{const store=fixture();store.set(name,{...store.get(name),version});assert(topicBootstrapRequired(store));assert(topicRebuildDue(store));if(name==='storyProjection'&&version===8){assert(readableStoryState(store));assert.equal(readableStoryState(store,{askers:'not-home'}),null);}});
test('readable older story versions and private publications stay ordinary refreshes',()=>{const store=fixture();store.set('recordTopicProjection',{...store.get('recordTopicProjection'),generation:1,dataGeneration:1000000001});store.set('storyProjection',{version:9,generation:1,dataGeneration:1000000001});assert(readableRecordTopicState(store));assert(readableStoryState(store,{askers:'not-home'}));assert.equal(topicBootstrapRequired(store),false);store.set('topicProjectionDirty',true);assert.equal(topicRebuildDue(store),false);});
test('missing current subset or inconsistent publication is not fully readable',()=>{const store=fixture();store.set('recordTopicProjection',{...store.get('recordTopicProjection'),askerSubsets:['all']});assert(topicBootstrapRequired(store));const other=fixture();other.set('storyProjection',{...other.get('storyProjection'),dataGeneration:1000000001});assert.equal(readableStoryState(other),null);assert(topicBootstrapRequired(other));});

test('a bootstrap waits for an index generation to exist',()=>{const store=fixture();store.set('active',0);store.set('topicProjectionDirty',true);store.set('recordTopicProjection',null);assert.equal(topicRebuildDue(store,store.clock(),'00:00-24:00'),false);});

for(const version of [undefined,String(STORY_FACTS_VERSION)])test('an unversioned or nonnumeric story projection needs a first build: '+version,()=>{const store=fixture();store.set('storyProjection',{...store.get('storyProjection'),version});assert.equal(readableStoryState(store),null);assert(topicRebuildDue(store));});
test('a readable current projection with changed inputs waits for the nightly window',()=>{const store=fixture();store.set('topicProjectionDirty',true);store.set('topicProjectionPublishedAt',store.clock()-86400_000);assert.equal(topicBootstrapRequired(store),false);assert.equal(topicRebuildDue(store),false);assert(topicRebuildDue(store,Date.parse('2026-11-02T03:00Z')));});

test('the retained v7 projection stays readable and does not bootstrap for label updates',()=>{
 const store=fixture();store.set('recordTopicProjection',{...store.get('recordTopicProjection'),version:7});
 assert.equal(RECORD_TOPICS_VERSION,7);assert(readableRecordTopicState(store));
 assert.equal(topicBootstrapRequired(store),false);assert.equal(topicRebuildDue(store),false);
});
