import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/ukraine-cloud-scope.json',import.meta.url)));
const params=topic=>new URLSearchParams({sitting:fixture.sitting,topic,lang:'en'});

test('Ukraine story verbatim debate accepts its exact ID and reads only associated retained speeches',async()=>{
  const query=speechCloudQuery(params(fixture.topic));
  let reads=0;
  const store={status:()=>({servingGeneration:1}),db:{prepare:()=>({all:()=>[]})}};
  const cloud=new SpeechCloudInsights(store,{
    request:async()=>{throw new Error('No source downloads');},
    legislation:{catalogue:async()=>({complete:true,sittings:[{activity_id:fixture.sitting,activity_date:'2026-07-07'}]}),query:async selection=>{
      assert.equal(selection.topic,fixture.topic);
      return {detail:{title:fixture.title,titleLanguage:'en',people:[],coverage:{speechAssociations:{sources:[{eventDate:'2026-07-07',contributionIds:fixture.contributionIds}]}}}};
    }},
    readCorpusPage:async selection=>{
      reads++;assert.deepEqual(selection.sourceIds,fixture.contributionIds);assert.equal(selection.language,'en');
      return {total:1,revision:1,nextOffset:null,records:[{id:fixture.speechId,metadata:{activity:{had_participation:[]},summary:{date:'2026-07-07',titles:{en:fixture.title}},speakers:[],sourceUrl:fixture.sourceUrl,fetchedAt:fixture.fetchedAt},text:{body:fixture.paragraphs.join('\n'),translationType:'machine',sourceUrl:fixture.sourceUrl,fetchedAt:fixture.fetchedAt}}]};
    },
  });
  const result=await cloud.query(query);
  assert.equal(reads,1);assert.equal(result.scope.topic,fixture.topic);
  assert.equal(result.coverage.transcripts,1);assert.equal(result.coverage.missingLanguage,0);
  assert(result.words.some(term=>term.label==='Commission Report on Ukraine'));
  assert.deepEqual(result.speeches.map(s=>s.id),[fixture.speechId]);
});

test('verbatim cloud IDs stay bounded to the selected sitting and supported event forms',()=>{
  assert.equal(speechCloudQuery(params(fixture.topic+'-1')).topic,fixture.topic+'-1');
  for(const topic of ['MTG-PL-2026-07-08-PVCRE-ITM-14',fixture.topic+'-1-2',fixture.topic+'/../../speeches',fixture.sitting+'-PVCRE-ITM-x'])
    assert.throws(()=>speechCloudQuery(params(topic)),error=>error.status===400&&error.code==='invalid_scope');
});
