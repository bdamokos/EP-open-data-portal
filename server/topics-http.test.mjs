import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loopback} from './test-support/loopback.mjs';
import {projectRecordTopics} from './record-topics.mjs';
import {writeTopicProjection} from './topics-store.mjs';
test('topic HTTP namespaces, filters and record reads use the saved projection without collectors',loopback,async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'topics-http-'));process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;process.env.CORPUS_ENABLED='false';const {server}=await import('./index.mjs'),{activityIndex}=await import('./activity-index-worker.mjs'),{store,worker,press}=activityIndex();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.exec('PRAGMA query_only=OFF');store.close();press?.close();await rm(directory,{recursive:true,force:true});});
 const read=(route,options={})=>new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,...options},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text?JSON.parse(text):null}));});r.on('error',reject);r.end();});
 assert((await read('/api')).body.endpoints.includes('topics'));const initial=await read('/api/topics/overview');assert.equal(initial.status,200);assert.deepEqual(initial.body,{ready:false});
 store.acquire();store.set('active',1);store.setMembers([{id:'42',countryCode:'GR'}]);const id='E-10-2026-000001';writeTopicProjection(store,projectRecordTopics([{id,kind:'question',date:'2026-10-07',titles:{en:'Greece and Cyprus'},members:['42']} ]));store.release();store.db.exec('PRAGMA query_only=ON');
 const overview=await read('/api/topics/overview?role=place&askers=elsewhere');assert.equal(overview.status,200);assert.equal(overview.body.items[0].id,'CYP');const detail=await read('/api/topics/detail?key=place:GRC&askers=home');assert.equal(detail.status,200);assert.equal(detail.body.total,1);assert.equal(detail.body.series[0].questionHome,1);const search=await read('/api/topics/search?q=Greece&askers=home');assert.equal(search.body.results[0].key,'place:GRC');const records=await read('/api/insights/record-topics?ids='+id);assert.equal(records.status,200);assert.equal(records.body.records[0].places.find(p=>p.id==='GRC').askers,'home');
 assert.equal((await read('/api/topics/search?askers=bad')).status,400);assert.equal((await read('/api/topics/overview',{method:'POST'})).status,405);assert.equal((await read('/api/topics/overview',{headers:{Origin:'https://unrelated.example'}})).status,403);assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);store.db.exec('PRAGMA query_only=OFF');
});
