import test from 'node:test';
import assert from 'node:assert/strict';
import {MeetingsReader} from './meetings-reader.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {participation} from './insights-participation.mjs';
import {SpeechCloudInsights} from './speech-cloud.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {HttpError} from './http-utils.mjs';
const NOW=Date.parse('2026-10-19T12:00:00Z');
const store={clock:()=>NOW,get:()=>null,status:()=>({currentMeps:1,servingGeneration:1,complete:true}),db:{prepare:()=>({all:()=>[],get:()=>null})}};
const meeting=date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'});
function setup(){let now=NOW,failed=true;const calls=[];const clock=()=>now,request=async(endpoint,params={})=>{calls.push([endpoint,params.year]);if(endpoint==='/meetings'&&params.year===2025&&failed)throw new HttpError(502,'odp_unavailable','Source unavailable');return {url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?'+new URLSearchParams(params),fetchedAt:now,payload:{data:endpoint==='/meetings'&&params.year===2026?[meeting('2026-10-07'),meeting('2026-10-20')]:[]}};};const reader=new MeetingsReader({request,clock}),legislation=new LegislationInsights(store,{request,clock,meetings:reader,loadMetadata:async()=>new Map()});return {reader,legislation,calls,clock,request,recover(){failed=false;now+=60_001;}};}
const policy=(view,value)=>apiCachePolicy({method:'GET'},new URL('https://example.test/api/insights/'+view),value);
test('partial calendars retain selectable agendas and propagate once through participation',async()=>{
 const {legislation,calls,clock}=setup();
 const original=legislation.query.bind(legislation);let pinned;
 legislation.query=(query,catalogue,...args)=>{pinned=catalogue;return original(query,catalogue,...args);};
 const result=await participation(legislation,store,{week:'2026-10-05',language:'en',country:null},{clock});
 assert.equal(result.coverage.catalogueComplete,false);assert.equal(result.coverage.catalogue.status,'partial');assert.equal(pinned.coverage.status,'partial');assert.equal(calls.filter(([ep,year])=>ep==='/meetings'&&year===2025).length,1);
 assert.equal(policy('participation',result).cdnCacheControl,'no-store');
 const known=await original({language:'en',sitting:'MTG-PL-2026-10-07'},pinned);assert.equal(known.sitting.id,'MTG-PL-2026-10-07');assert.equal(known.coverage.catalogueComplete,false);
 await assert.rejects(original({language:'en',sitting:'MTG-PL-2025-12-18'},pinned),e=>e.status===503&&e.code==='sitting_calendar_unavailable');
});
test('topic clouds pass their original catalogue and missing partial selections stay unavailable',async()=>{
 const {legislation,clock}=setup(),catalogue=await legislation.catalogue();let reads=0;
 const source={catalogue:async()=>{reads++;return catalogue;},query:async(query,pinned)=>{assert.equal(pinned,catalogue);return {detail:{coverage:{speechAssociations:{sources:[]}},people:[],title:'Topic',titleLanguage:'en'}};}};
 const cloud=new SpeechCloudInsights(store,{legislation:source,clock});
 const scope=await cloud.scope({sitting:'MTG-PL-2026-10-07',topic:'exact-topic',language:'en'});assert.equal(scope.catalogueComplete,false);assert.equal(reads,1);
 await assert.rejects(cloud.scope({sitting:'MTG-PL-2025-12-18',language:'en'}),e=>e.status===503);
});
test('partial cloud scopes restart from page zero after bounded recovery',async()=>{
 const {legislation,clock,request,recover}=setup();
 const cloud=new SpeechCloudInsights(store,{legislation,clock,request,readCorpusPage:null}),query={week:'2026-10-19',language:'en',page:0};
 const first=await cloud.query(query);assert.equal(first.coverage.catalogueComplete,false);assert.equal(first.coverage.complete,false);assert.equal(policy('speech-cloud',first).cdnCacheControl,'no-store');
 recover();const next=await cloud.query({...query,page:3});assert.equal(next.restarted,true);assert.equal(next.coverage.catalogueComplete,true);assert.equal(next.coverage.catalogue.status,'complete');
});
test('incomplete assembled views refresh after one minute, including error-free truncation',async()=>{
 let now=NOW,loads=0;const cache=new InsightViewCache({directory:null,clock:()=>now});
 const load=async()=>({coverage:{catalogueComplete:++loads>1,catalogue:{status:loads>1?'complete':'partial',years:[]}}});
 const first=await cache.get('calendar',load);assert.equal(first.coverage.catalogueComplete,false);assert.equal(policy('legislation',first).cdnCacheControl,'no-store');
 now+=60_001;await cache.get('calendar',load);await Promise.all(cache.pending.values());const recovered=await cache.get('calendar',load);assert.equal(recovered.coverage.catalogueComplete,true);assert.equal(loads,2);
});
test('HTTP 204 agendas remain unavailable and selectable; successful empty calendars remain distinct',async()=>{
 const {legislation}=setup();const catalogue=await legislation.catalogue();legislation.request=async()=>{throw new HttpError(502,'odp_no_content','No content');};
 const result=await legislation.query({language:'en',sitting:'MTG-PL-2026-10-07'},catalogue);assert.equal(result.coverage.agendaComplete,false);assert.equal(result.coverage.agendaError,'No content');assert.equal(result.topics.length,0);assert(result.sittings.some(s=>s.id===result.sitting.id));
 const empty=new LegislationInsights(store,{clock:()=>NOW,request:async()=>({url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:NOW,payload:{data:[]}})});assert.equal((await empty.catalogue()).complete,true);await assert.rejects(empty.query({language:'en',week:'latest'}),e=>e.status===404);
});
test('an unreadable newest year cannot silently move the default into older history',async()=>{
 const request=async(endpoint,params={})=>{if(endpoint==='/meetings'&&params.year===2026)throw Error('Current year unavailable');return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:NOW,payload:{data:endpoint==='/meetings'?[meeting(params.year===2024?'2024-07-16':'2025-12-18')]:[]}};};
 const clock=()=>NOW,legislation=new LegislationInsights(store,{request,clock,loadMetadata:async()=>new Map()}),catalogue=await legislation.catalogue();
 assert.equal(catalogue.latestAvailable,false);assert.equal(catalogue.sittings.length,2);
 for(const query of [{language:'en'},{language:'en',week:'latest'}]){const navigation=await legislation.query(query,catalogue);assert.equal(navigation.selectionUnavailable,true);assert.equal(navigation.sitting,null);assert.equal(navigation.sittings.length,2);assert.deepEqual(navigation.topics,[]);}
 await assert.rejects(participation(legislation,store,{language:'en'},{clock}),error=>error.status===503);
 const selected=await legislation.query({language:'en',sitting:'MTG-PL-2025-12-18'},catalogue);assert.equal(selected.sitting.id,'MTG-PL-2025-12-18');assert.equal(selected.coverage.latestAvailable,false);
 const week=await legislation.query({language:'en',week:'2025-12-15'},catalogue);assert.equal(week.week,'2025-12-15');
 const cloud=new SpeechCloudInsights(store,{request,clock,legislation,readCorpusPage:null});assert.equal((await cloud.scope({language:'en',sitting:'MTG-PL-2025-12-18'})).dates[0].start,'2025-12-18');
});
test('an older calendar gap does not block a verified newer latest week',async()=>{
 const {legislation}=setup(),catalogue=await legislation.catalogue();assert.equal(catalogue.latestAvailable,true);
 assert.equal((await legislation.query({language:'en',week:'latest'},catalogue)).week,'2026-10-05');
});
