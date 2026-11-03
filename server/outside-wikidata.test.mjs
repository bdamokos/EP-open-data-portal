import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {collectOutsideWikidata,outsideWikidataDue} from './outside-wikidata-collector.mjs';
import {outsideNameSearchUrl,outsideNamesUrl,outsideEvidenceQuery,outsideWikidataUrl,outsideWikidataRequest,resolveOutsideWikidata,outsideCandidateEvidence,OUTSIDE_WIKIDATA_LIMITS} from './outside-wikidata-source.mjs';
import {projectOutsideSpeakers,readOutsideSpeakers,outsideSpeakerCoverage} from './story-outside-speakers.mjs';
import {storyTables} from './story-facts-storage.mjs';
const now=Date.parse('2026-11-03T08:00Z'),stamp=new Date(now).toISOString(),DAY=86400_000;
const u=value=>({type:'uri',value}),l=value=>({type:'literal',value}),item=u('http://www.wikidata.org/entity/Q1');
const facts=[{item,kind:l('human')},{item,kind:l('occupation'),occupation:u('http://www.wikidata.org/entity/Q82955'),politician:l('true')},{item,kind:l('citizenship'),citizenship:u('http://www.wikidata.org/entity/Q184'),citizenshipCode:l('BLR')}];
function fakeSource({total=1,continued=false,fuzzy=false,fail}={}){const calls=[];return {calls,request:async url=>{calls.push(url);if(fail)throw fail;const q=new URL(url).searchParams;const body=q.get('list')==='search'?{...(continued?{continue:{sroffset:50}}:{}),query:{searchinfo:{totalhits:total},search:[{title:'Q1'}]}}:q.get('action')==='wbgetentities'?{entities:{Q1:{id:'Q1',lastrevid:123,labels:{en:{language:'en',value:fuzzy?'Example Speeker':'Example Speaker'}},aliases:{}}}}:{results:{bindings:facts}};return {body,url,fetchedAt:stamp};}};}
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'outside-wikidata-')),store=new ActivityStore(dir,{clock:()=>now,initializeIndexes:true});store.acquire();store.set('active',1);storyTables(store.db);t.after(async()=>{store.close();await rm(dir,{force:true,recursive:true});});return store;}
function add(store,person='1',role='Guest speaker',date='2026-02-24'){
 const id='MTG-PL-'+date+'-OTH-'+person,parent='MTG-PL-'+date+'-PVCRE-ITM-8';store.db.prepare('INSERT INTO outside_contributions VALUES (?,?,?,?,?)').run(1,id,person,date,JSON.stringify({id,personId:person,term:10,date,header:{name:'Example Speaker',role},parentIds:[parent]}));store.putSource(1,'outside:agenda:'+parent,'outside-agenda',{id:parent,date,titles:{en:'Address on Ukraine'},source:{url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:stamp}},stamp);
}
const worker=store=>({store,clock:()=>now,requests:0,budget:20,controller:new AbortController()});
test('bounded phrase discovery ignores ranking and verifies exact returned labels, humans and occupation',async()=>{
 const fake=fakeSource(),r=await resolveOutsideWikidata(['Example Speaker'],{request:fake.request});assert.equal(r.status,'available');assert.equal(r.candidates[0].human,true);assert.equal(r.candidates[0].politician,true);assert.equal(r.candidates[0].revision,123);assert.equal(r.candidates[0].citizenships[0].country,'BLR');assert.equal(fake.calls.length,3);assert.match(new URL(fake.calls[0]).searchParams.get('srsearch'),/inlabel:"Example Speaker"/);
 const fuzzy=fakeSource({fuzzy:true});assert.equal((await resolveOutsideWikidata(['Example Speaker'],{request:fuzzy.request})).status,'none');assert.equal(fuzzy.calls.length,2,'a search hit alone cannot establish identity');
});
test('search continuation, absent totals and candidate caps are explicit unavailable inputs',async()=>{
 for(const options of [{total:51},{continued:true},{total:undefined}]){const fake=fakeSource(options);if(options.total===undefined)fake.request=async url=>({body:{query:{search:[{title:'Q1'}]}},url,fetchedAt:stamp});await assert.rejects(resolveOutsideWikidata(['Example Speaker'],{request:fake.request}),/incomplete|cap/);}
 assert.throws(()=>outsideNamesUrl(['Q1) SERVICE <https://example.com>']),/Invalid/);assert.throws(()=>outsideEvidenceQuery([]),/Invalid/);assert.match(outsideEvidenceQuery(['Q1']),/VALUES \?item/);assert.match(outsideEvidenceQuery(['Q1']),/LIMIT 1001$/);assert.equal(new URL(outsideNameSearchUrl('Name" OR *')).searchParams.get('srlimit'),'50');
});
test('unknown jurisdiction is retained as unknown without corrupting an exact-human observation',()=>{
 const discovery=[{item,key:l('example speaker'),value:l('Example Speaker'),property:u('http://www.w3.org/2000/01/rdf-schema#label')}];
 const position={item,kind:l('position'),position:u('http://www.wikidata.org/entity/Q2'),statement:u('http://www.wikidata.org/entity/statement/q1-123-abc'),jurisdiction:u('http://www.wikidata.org/.well-known/genid/abc123'),international:l('false')};
 const [c]=outsideCandidateEvidence(discovery,[...facts,position]);assert.equal(c.positions[0].hasJurisdiction,true);assert.deepEqual(c.positions[0].jurisdictions,[]);assert(c.human);
 assert.throws(()=>outsideCandidateEvidence(discovery,[...facts,{...position,international:undefined}]),/Invalid office evidence/);
});
test('collector caches per person for seven days and counts each admitted request against its run budget',async t=>{
 const store=await fixture(t);add(store);const fake=fakeSource(),w=worker(store);assert(outsideWikidataDue(store,now));await collectOutsideWikidata(w,{request:fake.request});const saved=store.source(1,'wikidata:person:1').work;assert.equal(saved.status,'available');assert.equal(saved.nextRead,now+7*DAY);assert.equal(saved.candidates[0].qid,'Q1');assert.equal(w.requests,3);assert(!outsideWikidataDue(store,now));assert(outsideWikidataDue(store,now+7*DAY));assert(store.get('storyProjectionDirty'));
});
test('option A and institutional/international speakers consume no Wikidata requests',async t=>{
 const store=await fixture(t);add(store,'1','President of Ukraine');add(store,'2','Special Adviser to the President of the European Commission');add(store,'3','President-in-Office of the Council');add(store,'4','President of the UN General Assembly');const w=worker(store);for(let i=0;i<4;i++)await collectOutsideWikidata(w,{request:()=>assert.fail('excluded or option-A speaker queried')});assert.equal(w.requests,0);assert(!outsideWikidataDue(store,now));
});
test('unavailable/maxlag replaces stale candidate data, backs off and withholds the quarter',async t=>{
 const store=await fixture(t);add(store);store.putSource(1,'outside:state','outside-state',{},stamp);const fake=fakeSource({fail:Object.assign(Error('Wikidata maxlag'),{retryAfter:600})}),w=worker(store);await collectOutsideWikidata(w,{request:fake.request});const saved=store.source(1,'wikidata:person:1').work;assert.equal(saved.status,'unavailable');assert.equal(saved.nextRead,now+600_000);await projectOutsideSpeakers(store,2,1);assert.deepEqual(readOutsideSpeakers(store,2,{scope:'map',zoom:'world',period:'2026-Q1'},'world'),[]);assert.deepEqual(outsideSpeakerCoverage(store,2).wikidataUnavailablePeriods,['2026-Q1']);
});
test('projection discloses ambiguity in diagnostics and retains the cached matching evidence',async t=>{
 const store=await fixture(t);add(store);store.putSource(1,'outside:state','outside-state',{},stamp);const fake=fakeSource(),r=await resolveOutsideWikidata(['Example Speaker'],{request:fake.request});store.putSource(1,'wikidata:person:1','wikidata-person',r,stamp);await projectOutsideSpeakers(store,2,1);let rows=readOutsideSpeakers(store,2,{scope:'map',zoom:'world',period:'2026-Q1'},'world');assert.equal(rows[0].country,'BLR');assert.equal(rows[0].wikidata.qid,'Q1');assert.equal(rows[0].wikidata.fetchedAt,stamp);
 r.candidates.push({...r.candidates[0],qid:'Q2'});store.putSource(1,'wikidata:person:1','wikidata-person',r,stamp);await projectOutsideSpeakers(store,3,1);assert.equal(outsideSpeakerCoverage(store,3).wikidataDiagnostics[0].status,'ambiguous');assert.deepEqual(readOutsideSpeakers(store,3,{scope:'map',zoom:'world',period:'2026-Q1'},'world'),[]);
});
test('future rows and insufficient budgets cannot start discovery',async t=>{
 const store=await fixture(t);add(store,'1','Guest speaker','2026-12-01');assert.equal(outsideWikidataDue(store,now),false);add(store,'2');const w=worker(store);w.budget=1;assert.equal(await collectOutsideWikidata(w,{request:()=>assert.fail('budget exceeded')}),false);
});
test('streaming byte cap cancels an oversized response and the source admits only one request at a time',async()=>{
 let cancelled=false;await assert.rejects(outsideWikidataRequest(outsideNameSearchUrl('Example Speaker'),{fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(OUTSIDE_WIKIDATA_LIMITS.bytes+1));},cancel(){cancelled=true;}})})}),/size cap/);assert(cancelled);
 let active=0,max=0;const fetchImpl=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return Response.json({query:{searchinfo:{totalhits:0},search:[]}});};await Promise.all([1,2].map(()=>outsideWikidataRequest(outsideNameSearchUrl('Example Speaker'),{fetchImpl})));assert.equal(max,1);
 await assert.rejects(outsideWikidataRequest('https://example.com/api'),/Unsupported/);
});
test('full qualifier precision and unknown ends survive parser to matcher',async()=>{
 const {matchOutsideName}=await import('./outside-speaker-country.mjs');
 const discovery=[{item,key:l('example speaker'),value:l('Example Speaker'),property:u('http://www.w3.org/2000/01/rdf-schema#label')}];
 const position={item,kind:l('position'),position:u('http://www.wikidata.org/entity/Q2'),statement:u('http://www.wikidata.org/entity/statement/Q1-123-abc'),international:l('false'),country:u('http://www.wikidata.org/entity/Q45'),countryCode:l('PRT')};
 const qualifier=(key,value,precision)=>({[key]:l(value),[key+'Full']:l(value),[key+'Precision']:l(String(precision)),[key+'Calendar']:u('http://www.wikidata.org/entity/Q1985727')});
 const match=(row,day)=>{const candidates=outsideCandidateEvidence(discovery,[...facts,{...position,...row}]);return matchOutsideName({date:day,header:{name:'Example Speaker'}},{status:'available',dateVersion:1,candidates});};
 for(const [precision,before,bound] of [[9,'2026-12-30','2026-12-31'],[10,'2026-01-30','2026-01-31']]){
  const row=qualifier('start','2026-01-01T00:00:00Z',precision);assert.equal(match(row,before).country,'BLR');assert.equal(match(row,bound).country,'PRT');assert.equal(match(row,'2026-01-21').basis,'wikidata-name-citizenship');
 }
 for(const [precision,bound,after] of [[9,'2026-01-01','2026-01-02'],[10,'2026-02-01','2026-02-02']]){
  const row={...qualifier('start','2020-01-01T00:00:00Z',11),...qualifier('end',precision===9?'2026-01-01T00:00:00Z':'2026-02-01T00:00:00Z',precision)};assert.equal(match(row,bound).country,'PRT');assert.equal(match(row,after).country,'BLR');
 }
 const started=qualifier('start','2020-01-01T00:00:00Z',11);
 assert.equal(match(started,'2026-01-21').country,'PRT','absent end is open');
 for(const end of [u('http://www.wikidata.org/.well-known/genid/abc123'),l('not a date')])assert.equal(match({...started,end},'2026-01-21').country,'BLR','unknown/invalid end cannot establish tenure');
 assert.equal(match({...started,...qualifier('end','not a date',11)},'2026-01-21').country,'BLR');
 const legacy={status:'available',candidates:outsideCandidateEvidence(discovery,[...facts,{...position,...started}])};assert.equal(matchOutsideName({date:'2026-01-21',header:{name:'Example Speaker'}},legacy).status,'unavailable','legacy precision-less cache is fenced');
 assert.match(outsideEvidenceQuery(['Q1']),/pqv:P580/);assert.match(outsideEvidenceQuery(['Q1']),/wikibase:timePrecision/);
});
