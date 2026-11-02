import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {procedurePageHints,procedureRefresh} from './topic-refresh.mjs';import {ActivityStore} from './activity-index-store.mjs';import {topicCollectorTables} from './topics-project.mjs';import {collectTopicProcedure} from './topics-collector.mjs';
const DAY=86400_000;
test('ongoing procedures decay by last observed activity, ignoring future events',()=>{
 const now=Date.parse('2026-11-01');for(const [date,days] of [['2026-10-01',30],['2026-06-01',90],['2025-10-01',180]])assert.equal(procedureRefresh({consists_of:[{activity_date:date},{activity_date:'2029-01-01'}]}, {},now).freshMs,days*DAY);
 assert(procedureRefresh({stage:'COMPLETED'}, {},now).completed);assert(procedureRefresh({process_status:'COMPLETED',consists_of:{activity_date:'2026-10-01',occured_at_stage:'PLENARY'}}, {},now).completed);assert(procedureRefresh({consists_of:[{activity_date:'2026-10-01',occured_at_stage:'COMPLETED'},{activity_date:'2026-01-01',occured_at_stage:'ONGOING'}]}, {},now).completed);assert.equal(procedureRefresh({}, {status:{label:'Procedure completed'}},now).next,null);assert(!procedureRefresh({stage:['COMPLETED','ONGOING']},{},now).completed);
});
for(const held of [false,true,'mismatch'])test(`completed OEIL pages are read once and held forever (${held?'already cached':'first read'})`,async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-refresh-'));let now=Date.now(),calls=0;const store=new ActivityStore(dir,{clock:()=>now,initializeIndexes:true});store.acquire();t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2025-0407','2025/0407(COD)');
 const page={html:await readFile(new URL('./fixtures/oeil-procedure-2025-0407.html',import.meta.url),'utf8'),url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference:'2025/0407(COD)'}),fetchedAt:new Date(now-400*DAY).toISOString()},sources={get:async()=>{calls++;return page;},...(held?{cache:{key:()=>'',stored:async()=>({value:held==='mismatch'?{...page,url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=wrong'}:page})}}:{})};
 const worker={store,clock:()=>now,requests:0,budget:20,controller:new AbortController()};await collectTopicProcedure(worker,{sources});assert.equal(calls,held===true?0:1);assert.equal(store.db.prepare('SELECT next_read FROM topic_procedure_queue').get().next_read,null);
 now+=500*DAY;store.acquire();assert.equal(await collectTopicProcedure(worker,{sources}),false);assert.equal(calls,held===true?0:1);
});
test('unchanged ongoing held pages are not redownloaded before cadence, new activity invalidates them',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-ongoing-')),now=Date.parse('2026-11-01'),store=new ActivityStore(dir,{clock:()=>now,initializeIndexes:true});store.acquire();t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2025-0001','2025/0001(COD)');
 store.db.prepare('INSERT INTO topic_procedure_metadata VALUES (?,?,?,?)').run('2025-0001',JSON.stringify({consists_of:[{activity_date:'2026-10-01'}]}),'source',new Date(now).toISOString());store.db.prepare('INSERT INTO topic_procedure_pages VALUES (?,?,?)').run('2025-0001','2025/0001(COD)',JSON.stringify({subjects:[],source:{fetchedAt:'2026-10-30'}}));
 let calls=0;const sources={get:async()=>{calls++;throw Error('transport');}},worker={store,clock:()=>now,requests:0,budget:20,controller:new AbortController()};assert.equal(await collectTopicProcedure(worker,{sources}),false);assert.equal(calls,0);
 store.db.prepare('UPDATE topic_procedure_metadata SET body=?').run(JSON.stringify({consists_of:[{activity_date:'2026-10-31'}]}));store.db.prepare('UPDATE topic_procedure_queue SET next_read=0').run();await collectTopicProcedure(worker,{sources});assert.equal(calls,1);
});

test('refresh age uses every retained past key event and ignores future schedule rows',async()=>{
 const source=await readFile(new URL('./fixtures/oeil-procedure-2026-2937-progress.html',import.meta.url),'utf8'),row=date=>'<tr><td>'+date+'</td><td>Recorded event</td><td></td><td></td></tr>';
 const html=source.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody>'+row('01/01/2025').repeat(301)+row('01/10/2026')+row('01/01/2029')+'</tbody>');
 assert.equal(procedurePageHints(html,'2026/2937(RSP)',Date.parse('2026-11-01')).lastActivity,'2026-10-01');
});
