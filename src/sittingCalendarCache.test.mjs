import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarCacheMaxAge,createSpeechCloudClient} from './sittingCalendarCache.mjs';
import {MeetingsReader} from '../server/meetings-reader.mjs';
import {LegislationInsights} from '../server/insights-legislation.mjs';
import {SpeechCloudInsights,speechCloudQuery} from '../server/speech-cloud.mjs';

test('reopening a cloud reaches calendar recovery through the configured browser client',async t=>{
 let now=Date.parse('2026-10-19T12:00:00Z'),failed=true,loads=0;
 t.mock.method(Date,'now',()=>now);
 const request=async(endpoint,params)=>{if(endpoint==='/meetings'&&params.year===2025&&failed)throw Error('Source unavailable');return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now,payload:{data:endpoint==='/meetings'&&params.year===2026?[{id:'eli/dl/event/MTG-PL-2026-10-20',activity_id:'MTG-PL-2026-10-20',activity_date:'2026-10-20',had_activity_type:'def/ep-activities/PLENARY_SITTING'}]:[]}};};
 const clock=()=>now,store={status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({all:()=>[]})}};
 const meetings=new MeetingsReader({request,clock}),legislation=new LegislationInsights(store,{request,clock,meetings}),cloud=new SpeechCloudInsights(store,{request,clock,legislation,readCorpusPage:null});
 const client=createSpeechCloudClient(async route=>{loads++;return cloud.query(speechCloudQuery(new URLSearchParams(route.split('?')[1]),{now}));});
 const route='insights/speech-cloud?week=2026-10-19&lang=en&page=0';
 const first=await client.get(route);assert.equal(first.coverage.catalogueComplete,false);
 failed=false;now+=60_001;
 const recovered=await client.get(route);assert.equal(loads,2);assert.equal(recovered.coverage.catalogueComplete,true);assert.equal(recovered.restarted,true);assert.equal(recovered.nextPage,null);
 await client.get(route);assert.equal(loads,2,'a fresh complete cloud retains the normal browser lifetime');
});
test('partial and transient calendar pages cannot survive a new browser page walk',async()=>{
 for(const coverage of [{catalogueComplete:false},{catalogueComplete:true,catalogue:{status:'complete',years:[{sources:[{stale:true}]}]}},{catalogueComplete:true,catalogue:{status:'complete',years:[{sources:[{refreshInProgress:true}]}]}},{catalogueComplete:true,catalogue:{status:'complete',years:[{sources:[{refreshError:{message:'retry'}}]}]}}]){
   let loads=0;const client=createSpeechCloudClient(async route=>({route,coverage,load:++loads}));
   for(const page of [0,1])await client.get('cloud?page='+page);
   for(const page of [0,1]){const data=await client.get('cloud?page='+page);assert(data.load>2);}
   assert.equal(loads,4);
   assert.equal(calendarCacheMaxAge({coverage},300_000),0,'insights uses the same recovery policy');
 }
});
