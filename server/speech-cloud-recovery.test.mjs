import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
import {HttpError} from './http-utils.mjs';

const now=()=>Date.parse('2026-10-26T00:00:00Z'),date='2026-10-07',sitting='MTG-PL-'+date;
const store={status:()=>({servingGeneration:1}),db:{prepare:()=>({all:()=>[]})}};
const legislation={catalogue:async()=>({sittings:[{activity_id:sitting,activity_date:date}],complete:true})};
const query=speechCloudQuery(new URLSearchParams({sitting,lang:'en'}),{now:now()});
const source=offset=>({url:'https://data.europarl.europa.eu/api/v2/speeches?offset='+offset,fetchedAt:now()+offset});
const activity=i=>({activity_id:sitting+'-OTH-'+i,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',activity_label:{en:'Climate debate'},recorded_in_a_realization_of:[{'api:xmlFragment':{en:'<root><p>Climate energy transport.</p></root>'}}]});

test('a failed public source page preserves successful pages, cursor and provenance for explicit retry',async()=>{
  for(const failure of ['proxy','shape']) {
    const offsets=[];let failed=false;
    const cloud=new SpeechCloudInsights(store,{clock:now,legislation,readCorpusPage:null,request:async(endpoint,{offset})=>{
      assert.equal(endpoint,'/speeches');offsets.push(offset);
      if(offset===100&&!failed){failed=true;if(failure==='proxy')throw new HttpError(502,'odp_unavailable','Parliament data is unavailable (500). Please try again.');return {...source(offset),payload:{data:null}};}
      return {...source(offset),payload:{meta:{total:120},data:Array.from({length:Math.min(50,120-offset)},(_,i)=>activity(offset+i))}};
    }});
    await cloud.query(query);
    const previous=structuredClone(await cloud.query({...query,page:1}));
    assert.equal(previous.coverage.transcripts,100);assert.equal(previous.nextPage,2);assert.equal(previous.coverage.complete,false);
    await assert.rejects(cloud.query({...query,page:2}),error=>error.status===502);
    assert.deepEqual(await cloud.query({...query,page:1}),previous,'failed reads cannot mutate the published result');
    assert.deepEqual(offsets,[0,50,100],'no automatic replay or advance after failure');
    const recovered=await cloud.query({...query,page:2});
    assert.deepEqual(offsets,[0,50,100,100]);
    assert.deepEqual(recovered.speeches.slice(0,100),previous.speeches);
    assert.deepEqual(recovered.sources.slice(0,2),previous.sources);
    assert.deepEqual(recovered.coverage.sourceRecords,{unique:120,declared:120,duplicates:0,issues:[]});
    assert.equal(recovered.coverage.transcripts,120);assert.equal(recovered.coverage.complete,true);assert.equal(recovered.nextPage,null);
  }
});

test('unavailable retained pages resume the saved cursor and preserve missing-text and partial states',async()=>{
  const offsets=[];let failed=false;
  const cloud=new SpeechCloudInsights(store,{clock:now,legislation,walkMs:{first:0,next:0},request:()=>assert.fail('Saved cursors must not switch to public offsets'),readCorpusPage:async({offset})=>{
    offsets.push(offset);
    if(offset===100&&!failed){failed=true;return null;}
    return {revision:'fixture-revision',total:120,nextOffset:offset===100?null:offset+50,records:Array.from({length:Math.min(50,120-offset)},(_,n)=>{
      const i=offset+n,a=activity(i);
      return {id:a.activity_id,metadata:i===1?null:{activity:a,summary:{date,titles:{en:'Climate debate'}},speakers:[],sourceUrl:source(offset).url,fetchedAt:new Date(now()+offset).toISOString()},text:i===0?null:{body:'Climate energy transport.',sourceUrl:source(offset).url,fetchedAt:new Date(now()+offset).toISOString()}};
    })};
  }});
  await cloud.query(query);
  const previous=structuredClone(await cloud.query({...query,page:1}));
  await assert.rejects(cloud.query({...query,page:2}),error=>error.status===503&&error.code==='corpus_unavailable');
  assert.deepEqual(await cloud.query({...query,page:1}),previous);
  const recovered=await cloud.query({...query,page:2});
  assert.deepEqual(offsets,[0,50,100,100]);
  assert.deepEqual(recovered.speeches.slice(0,98),previous.speeches);
  assert.deepEqual(recovered.sources.slice(0,previous.sources.length),previous.sources);
  assert.equal(recovered.coverage.basis,'retained-corpus');assert.equal(recovered.coverage.transcripts,118);
  assert.equal(recovered.coverage.missingLanguage,1);assert.equal(recovered.coverage.unreadableText,1);
  assert.equal(recovered.coverage.complete,false);assert.equal(recovered.nextPage,null);
  assert.deepEqual(recovered.coverage.sourceRecords,{unique:120,declared:null,retained:120,duplicates:0,issues:[]});
});
