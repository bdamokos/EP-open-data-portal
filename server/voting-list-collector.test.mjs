import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {VotingListCollector,VotingListStore,prepareVotingLists,votingListSessions,discoverVotingLists,allowedVotingListUrl,fetchVotingList,votingListsResponse} from './voting-list-collector.mjs';
import {VOTING_LIST_PAGE} from './voting-lists.mjs';
const nodes=['2026-11-11','2026-11-12'].map(date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'}));
const url='https://www.europarl.europa.eu/sedcms/votingList/A10-0201.docx';
const html=`<h4>Wednesday, 11 November 2026 - Thursday, 12 November 2026</h4><h3>Thursday, 12 November 2026</h3><a href="${url}?version=FINAL+VERSION">WORD</a><a href="${url.replace('.docx','.pdf')}">PDF</a>`;
function setup(t,at='2026-11-07T06:00:00Z'){
 let now=Date.parse(at);const db=new DatabaseSync(':memory:'),meta=new Map();const store={db,clock:()=>now,get:k=>meta.get(k),set:(k,v)=>meta.set(k,v),assertWriter(){},transaction(fn){assert.equal(db.isTransaction,false);db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}};
 prepareVotingLists(store);t.after(()=>db.close());return {store,now:()=>now,advance:ms=>now+=ms};
}
test('Brussels windows include four lead days and DST; exact section discovery and allowlist',()=>{
 const sessions=votingListSessions(nodes);assert.equal(new Date(sessions[0].start).toISOString(),'2026-11-07T06:00:00.000Z');assert.equal(new Date(sessions[0].end).toISOString(),'2026-11-12T22:00:00.000Z');
 const discovery=discoverVotingLists(html,sessions);assert.equal(discovery.links.length,1);assert.equal(discovery.links[0].sittingId,'MTG-PL-2026-11-12');assert.equal(discovery.links[0].linkVersion,'FINAL VERSION');assert.equal(discovery.links[0].url,url);
 assert.equal(discoverVotingLists(`<a href="${url}">doc</a>`,sessions).gaps[0].code,'unmapped-section');
 for(const bad of ['https://evil.test/sedcms/votingList/x.docx','https://www.europarl.europa.eu/other.docx','https://www.europarl.europa.eu/sedcms/votingList/%2f..%2fother.docx','https://www.europarl.europa.eu/sedcms/votingList/../secret.docx'])assert.equal(allowedVotingListUrl(bad),null);
});
test('hourly page, six-hour documents, validators, revisions, late purge, read-only endpoint',async t=>{
 const s=setup(t),calls=[];let revision=0;
 const bytes=readFileSync(new URL('./fixtures/voting-lists/A10-0201.docx',import.meta.url));
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read(){return {pages:[{payload:{data:[{activity_id:'MTG-PL-2026-11-12-OJ-ITM-V-29',had_activity_type:'def/ep-activities/PLENARY_VOTE',based_on_a_realization_of:['eli/dl/doc/A-10-2026-0201']}]}}]};}},fetchSource:async (source,options)=>{calls.push({source,...options});return source===VOTING_LIST_PAGE?{status:options.etag?304:200,buffer:Buffer.from(html),etag:'page'}:revision++?{status:304,etag:'file'}:{status:200,buffer:bytes,etag:'file',lastModified:'Thu, 01 Jan 2026 00:00:00 GMT'};}});
 const worker={controller:new AbortController()};await collector.step(worker);await collector.step(worker);assert.equal(calls.length,2);
 let docs=new VotingListStore(s.store,{clock:s.now}).votingListsForSitting('MTG-PL-2026-11-12');assert.equal(docs.length,1);assert.equal(docs[0].agendaItemId,'MTG-PL-2026-11-12-OJ-ITM-V-29');assert.equal(docs[0].revisions.length,1);
 await collector.step(worker);assert.equal(calls.length,2);s.advance(3600000);await collector.step(worker);assert.equal(calls.length,3);assert.equal(calls[2].etag,'page');
 s.advance(5*3600000);await collector.step(worker);await collector.step(worker);assert.equal(calls.at(-1).etag,'file');assert.ok(calls.at(-1).lastModified);assert.equal(new VotingListStore(s.store,{clock:s.now}).votingListsForSitting('MTG-PL-2026-11-12')[0].revisions.length,1);
 s.advance(40*86400000);await collector.step(worker);assert.equal(s.store.db.prepare('SELECT count(*) n FROM voting_list_revisions').get().n,0);assert.equal(s.store.db.prepare('SELECT count(*) n FROM voting_list_sources').get().n,0);
 assert.throws(()=>votingListsResponse(s.store,new URLSearchParams('sitting=x')),e=>e.status===400);assert.equal(votingListsResponse(s.store,new URLSearchParams('sitting=MTG-PL-2026-11-12')).documents.length,0);
});
test('outside windows and night make no requests; existing transaction is reused',async t=>{
 const s=setup(t,'2026-11-06T12:00:00Z');const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),fetchSource:()=>assert.fail('outside window')});
 await collector.step({controller:new AbortController()});s.advance(35*3600000);await collector.step({controller:new AbortController()});s.store.db.exec('BEGIN');collector.write(()=>{});s.store.db.exec('ROLLBACK');
});
test('website transport sends validators and handles 304 without reading bytes',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let called=false;
 globalThis.fetch=async (source,options)=>{called=true;assert.equal(source,url);assert.equal(options.headers['If-None-Match'],'held');assert.equal(options.redirect,'error');return new Response(null,{status:304,headers:{ETag:'held'}});};
 assert.equal((await fetchVotingList(url,{etag:'held'})).status,304);assert.ok(called);
});
test('sitting morning overrides six-hour due time, remains hourly and stops after slot',async t=>{
 const s=setup(t,'2026-11-12T04:00:00Z'),calls=[];
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read(){return {pages:[{payload:{data:[{had_activity_type:'def/ep-activities/MEETING_PART',consists_of:['eli/dl/event/vote'],activity_end_date:'2026-11-12T13:00:00+01:00'},{id:'eli/dl/event/vote',had_activity_type:'def/ep-activities/PLENARY_VOTE'}]}}]};}},fetchSource:async (url,opts)=>{calls.push(opts);return {status:304};}});
 s.store.set('votingListPage',{nextCheck:s.now()+86400000});
 s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url,'MTG-PL-2026-11-12',JSON.stringify({sessionFirst:'2026-11-11',etag:'held',checkedAt:s.now()}),s.now()+6*3600000,s.now()+40*86400000);
 await collector.step({controller:new AbortController()});assert.equal(calls.length,0);
 s.advance(3600000);await collector.step({controller:new AbortController()});assert.equal(calls.length,1);
 await collector.step({controller:new AbortController()});assert.equal(calls.length,1);
 s.advance(3600000);await collector.step({controller:new AbortController()});assert.equal(calls.length,2);
 s.advance(5*3600000);await collector.step({controller:new AbortController()});assert.equal(calls.length,3);
 s.advance(61*60000);await collector.step({controller:new AbortController()});assert.equal(calls.length,3);
});
test('trimmed real page assigns lists to exact ODP day sections and schedule to session',()=>{
 const days=['14','15','16','17'].map(day=>{const date='2026-09-'+day;return {id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'};});
 const html=readFileSync(new URL('./fixtures/voting-lists/votes-page.html',import.meta.url),'utf8'),found=discoverVotingLists(html,votingListSessions(days));
 assert.deepEqual(found.gaps,[]);assert.ok(found.links.some(l=>l.schedule&&l.sittingId===null));assert.ok(found.links.some(l=>l.url.includes('A10-0201')&&l.sittingId==='MTG-PL-2026-09-15'));assert.ok(found.links.some(l=>l.url.includes('B10-0386')&&l.sittingId==='MTG-PL-2026-09-17'));
});
test('a reverted file hash remains the current document while both revisions survive',t=>{
 const s=setup(t),db=s.store.db,purge=s.now()+40*86400000;
 db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url,'MTG-PL-2026-11-12',JSON.stringify({latestHash:'a',checkedAt:s.now()}),s.now(),purge);
 for(const [hash,date] of [['a','2026-11-01T10:00:00Z'],['b','2026-11-02T10:00:00Z']]){
  const body={documentId:'A-10-2026-0201',versionLabel:'FINAL VERSION',revision:{sha256:hash,observedAt:date}};
  db.prepare('INSERT INTO voting_list_revisions VALUES (?,?,?,?,?,?)').run(url,'MTG-PL-2026-11-12',hash,date,JSON.stringify(body),purge);
 }
 const docs=new VotingListStore(s.store,{clock:s.now}).votingListsForSitting('MTG-PL-2026-11-12');assert.equal(docs.length,1);assert.equal(docs[0].revision.sha256,'a');assert.equal(docs[0].revisions.length,2);
});
test('one worker run is capped at 120 DOCX GETs and a later run resumes without hourly backlog',async t=>{
 const s=setup(t),sessions=votingListSessions(nodes);let gets=0;
 s.store.set('votingListPage',{nextCheck:s.now()+86400000});
 for(let n=0;n<121;n++){const file=url.replace('A10-0201',String(n));s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(file,'MTG-PL-2026-11-12',JSON.stringify({url:file,sessionFirst:'2026-11-11'}),s.now(),sessions[0].purgeAt);}
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions,snapshots:{read:()=>null},fetchSource:async()=>{gets++;return {status:304};}}),worker={controller:new AbortController()};
 for(let n=0;n<122;n++)await collector.step(worker);assert.equal(gets,120);
 s.advance(3600000);await collector.step({controller:new AbortController()});assert.equal(gets,121);
});
test('outside windows due checks cache the calendar and reserve only one daily purge',async t=>{
 const s=setup(t,'2026-12-01T12:00:00Z');let reads=0,writes=0;
 const set=s.store.set;s.store.set=(...args)=>{writes++;set(...args);};
 const collector=new VotingListCollector(s.store,{clock:s.now,snapshots:{read(){reads++;return {nodes};}},fetchSource:()=>assert.fail('outside window')});
 assert.equal(collector.due(),true);await collector.step({controller:new AbortController()});const after=writes;
 for(let i=0;i<100;i++)assert.equal(collector.due(),false);assert.equal(reads,2);assert.equal(writes,after);
 s.advance(3600000);assert.equal(collector.due(),false);assert.equal(reads,4);assert.equal(writes,after);
 s.advance(23*3600000);assert.equal(collector.due(),true);await collector.step({controller:new AbortController()});assert.equal(collector.due(),false);
});
test('expiry is purged within a day with no active plenary window',async t=>{
 const s=setup(t,'2026-12-11T12:00:00Z'),collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),fetchSource:()=>assert.fail('outside window')});
 const purge=votingListSessions(nodes)[0].purgeAt;
 s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url,'MTG-PL-2026-11-12','{}',0,purge);
 await collector.step({controller:new AbortController()});assert.equal(s.store.db.prepare('SELECT count(*) n FROM voting_list_sources').get().n,1);
 s.advance(24*3600000);assert.equal(collector.due(),true);await collector.step({controller:new AbortController()});assert.equal(s.store.db.prepare('SELECT count(*) n FROM voting_list_sources').get().n,0);assert.ok(s.now()-purge<24*3600000);
});
test('idle candidates do not inflate any agenda snapshot',async t=>{
 const s=setup(t,'2026-11-12T10:00:00Z'),counts=new Map();s.store.set('votingListPage',{nextCheck:s.now()+3600000});
 for(let i=0;i<120;i++)s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url+i,'MTG-PL-2026-11-12',JSON.stringify({sessionFirst:'2026-11-11',checkedAt:s.now()-60000}),s.now()+3600000,s.now()+86400000);
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read(kind,version,id){counts.set(id,(counts.get(id)||0)+1);return {pages:[{payload:{data:[{id:'eli/dl/event/vote',had_activity_type:'def/ep-activities/PLENARY_VOTE'},{had_activity_type:'def/ep-activities/MEETING_PART',consists_of:['eli/dl/event/vote'],activity_end_date:'2026-11-12T13:00:00+01:00'}]}}]};}},fetchSource:()=>assert.fail('no file due')});
 await collector.step({controller:new AbortController()});assert.deepEqual([...counts.values()],[]);
});
test('response revisions and file-error gaps use the store clock',t=>{
 const s=setup(t,'2000-01-01T00:00:00Z'),sitting='MTG-PL-2026-11-12',purge=s.now()+3600000;
 s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url,sitting,JSON.stringify({url,error:'missing'}),0,purge);
 const body={documentId:'A-10-2026-0201',revision:{sha256:'a',observedAt:'2000-01-01T00:00:00Z'}};
 s.store.db.prepare('INSERT INTO voting_list_revisions VALUES (?,?,?,?,?,?)').run(url,sitting,'a',body.revision.observedAt,JSON.stringify(body),purge);
 const read=()=>votingListsResponse(s.store,new URLSearchParams({sitting}));assert.equal(read().documents.length,1);assert.equal(read().gaps[0].code,'file-unavailable');
 s.advance(3600000);assert.equal(read().documents.length,0);assert.deepEqual(read().gaps,[]);
});
test('an idle hour has one due hit and write, no agenda reads or GETs',async t=>{
 const s=setup(t),end=s.now()+3600000;let writes=0,reads=0,hits=0;
 s.store.set('votingListPurgeCheck',s.now()+86400000);s.store.set('votingListPage',{nextCheck:end});
 const set=s.store.set;s.store.set=(...args)=>{writes++;set(...args);};
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read(){reads++;assert.fail('idle agenda read');}},fetchSource:()=>assert.fail('idle GET')});
 for(let minute=0;minute<60;minute++){if(collector.due()){hits++;await collector.step({controller:new AbortController()});}s.advance(60000);}
 assert.equal(hits,1);assert.equal(writes,1);assert.equal(reads,0);assert.equal(s.store.get('votingListSweep'),end);assert.equal(collector.due(),true);
});
test('metadata sweep wakes at a sitting-day hourly check before the next page GET',async t=>{
 const s=setup(t,'2026-11-12T10:00:00Z'),start=s.now();let gets=0,reads=0;
 s.store.set('votingListPurgeCheck',start+86400000);s.store.set('votingListPage',{nextCheck:start+3600000});
 s.store.db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?)').run(url,'MTG-PL-2026-11-12',JSON.stringify({sessionFirst:'2026-11-11',checkedAt:start-45*60000}),start+5*3600000,start+86400000);
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read(){reads++;return {pages:[{payload:{data:[{id:'eli/dl/event/vote',had_activity_type:'def/ep-activities/PLENARY_VOTE'},{had_activity_type:'def/ep-activities/MEETING_PART',consists_of:['eli/dl/event/vote'],activity_end_date:'2026-11-12T13:00:00+01:00'}]}}]};}},fetchSource:async()=>{gets++;return {status:304};}});
 await collector.step({controller:new AbortController()});assert.equal(reads,0);assert.equal(s.store.get('votingListSweep'),start+15*60000);
 s.advance(15*60000);assert.equal(collector.due(),true);await collector.step({controller:new AbortController()});assert.equal(reads,1);assert.equal(gets,1);
});
test('opening a new session window forces a full page read after an unchanged 304',async t=>{
 const s=setup(t,'2026-11-12T10:00:00Z'),allNodes=[...nodes,...['2026-11-18','2026-11-19'].map(date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'}))];
 const nextHtml=html.replaceAll('11 November','18 November').replaceAll('12 November','19 November'),calls=[];
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(allNodes),fetchSource:async (url,options)=>{calls.push(options);return options.etag?{status:304,etag:'same'}:{status:200,buffer:Buffer.from(nextHtml),etag:'same',lastModified:'unchanged'};}});
 const worker={controller:new AbortController()};await collector.step(worker);assert.equal(s.store.db.prepare('SELECT count(*) n FROM voting_list_sources').get().n,0);
 assert.equal(votingListsResponse(s.store,new URLSearchParams('sitting=MTG-PL-2026-11-12')).gaps.length,0);
 assert.equal(votingListsResponse(s.store,new URLSearchParams('sitting=MTG-PL-2026-11-19')).gaps[0].code,'unmapped-section');
 s.advance(3600000);await collector.step(worker);assert.equal(calls[1].etag,'same');
 s.advance(47*3600000);await collector.step(worker);assert.equal(calls.length,3);assert.equal(calls[2].etag,null);assert.equal(calls[2].lastModified,null);
 assert.equal(s.store.db.prepare('SELECT sitting FROM voting_list_sources').get().sitting,'MTG-PL-2026-11-19');
 assert.deepEqual(votingListsResponse(s.store,new URLSearchParams('sitting=MTG-PL-2026-11-19')).gaps,[]);
});
test('discovery and page errors are scoped to the sitting or session they concern',t=>{
 const s=setup(t),sessions=votingListSessions(nodes);
 const gapHtml=`<h4>Wednesday, 18 November 2026 - Thursday, 19 November 2026</h4><a href="${url}"></a>`;
 const gaps=discoverVotingLists(gapHtml,sessions).gaps;assert.equal(gaps[0].sessionFirst,'2026-11-18');
 s.store.set('votingListDiscoveryGaps',[...gaps,{code:'day-gap',sittingId:'MTG-PL-2026-11-12',message:'Day gap'},{code:'unknown-scope',message:'Unmapped'}]);
 s.store.set('votingListPage',{error:'Page error',errorSittings:sessions[0].sittings});
 const codes=sitting=>votingListsResponse(s.store,new URLSearchParams({sitting})).gaps.map(g=>g.code);
 assert.deepEqual(codes('MTG-PL-2026-11-11'),['page-unavailable']);assert.deepEqual(codes('MTG-PL-2026-11-12'),['day-gap','page-unavailable']);
 assert.deepEqual(codes('MTG-PL-2026-11-18'),['unmapped-section']);assert.deepEqual(codes('MTG-PL-2026-11-19'),['unmapped-section']);assert.deepEqual(codes('MTG-PL-2026-09-15'),[]);
});
test('a due page check warms active agendas through hints without inflating snapshots',async t=>{
 const s=setup(t),hints=[];
 const collector=new VotingListCollector(s.store,{clock:s.now,sessions:votingListSessions(nodes),snapshots:{read:()=>assert.fail('page check needs no agenda bytes'),enqueue:(kind,version,sitting)=>hints.push([kind,version,sitting])},fetchSource:async()=>({status:200,buffer:Buffer.from(html)})});
 await collector.step({controller:new AbortController()});assert.deepEqual(hints,nodes.map(n=>['agenda',1,n.activity_id]));
});
