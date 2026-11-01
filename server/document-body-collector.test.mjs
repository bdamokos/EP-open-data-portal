import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {DocumentBodyCollector} from './document-body-collector.mjs';
import {DocumentBodyHints,documentBodyHints} from './document-body-hints.mjs';
import {deflateRawSync,crc32} from 'node:zlib';
import {docxContent,documentText} from './document-text.mjs';
import {DOCX_FORMATTING_VERSION} from './docx-formatting.mjs';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
const now=Date.parse('2026-11-01T12:00:00Z');
const work=(id='B-10-2026-0304')=>({identifier:id,document_date:'2026-09-01',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:`https://data.europarl.europa.eu/distribution/body-test/${id}.docx`}]}]});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'document-body-'));let time=now;
 const store=new ActivityStore(path.join(directory,'index'),{clock:()=>time});store.acquire();store.set('active',1);
 t.after(()=>{store.close();return rm(directory,{recursive:true,force:true});});
 const item=work(),key='/plenary-documents/'+item.identifier;
 store.db.prepare('INSERT INTO sources VALUES (1,?,?,?,?,1)').run(key,'document',JSON.stringify(item),new Date(now).toISOString());
 store.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)').run(key,item.identifier,'42','motions',item.document_date,'{}');
 const worker={requests:0,budget:100,monotonic:()=>0,runDeadline:100,controller:new AbortController()};
 return {directory,store,item,key,worker,setTime:value=>time=value};
}
test('collector discovers indexed bodies, persists cursor/jobs and reader uses disk with zero upstream calls',async t=>{
 const f=await fixture(t);let calls=0;
 const download=async()=>{calls++;return docxContent(zip({'word/document.xml':'<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Retained reader text</w:t></w:r></w:p></w:body></w:document>'}),{includeNoteObjects:true});};
 const collector=new DocumentBodyCollector(f.store,{directory:f.directory,hints:new DocumentBodyHints(),read:(work,language,options)=>documentText(work,language,{...options,download})});
 assert(collector.due());await collector.step(f.worker);assert.equal(calls,1);
 const rows=f.store.db.prepare('SELECT * FROM document_body_jobs').all();assert.equal(rows.length,1);assert.equal(rows[0].state,'retained');
 const reader=await documentText(f.item,'en',{directory:f.directory,clock:()=>now,download:()=>{throw Error('Upstream must not run');}});
 assert.deepEqual(reader.paragraphs,['Retained reader text']);assert.equal(reader.status,'available');
 const names=await readdir(path.join(f.directory,'document-text-v1'));
 assert.equal(names.length,1);assert((await stat(path.join(f.directory,'document-text-v1',names[0]))).size>0);
 collector.admit();assert.equal(new DocumentBodyCollector(f.store,{directory:f.directory,hints:new DocumentBodyHints()}).due(),false);
});
test('foreground miss retains existing fallback and queues an exact high-priority hint',async t=>{
 const f=await fixture(t);documentBodyHints.drain();
 let calls=0;const result=await documentText(f.item,'en',{directory:f.directory,download:async()=>{calls++;return {paragraphs:['Fallback'],formattingVersion:DOCX_FORMATTING_VERSION};}});
 assert.equal(result.status,'available');assert.equal(calls,1);
 assert.deepEqual(documentBodyHints.drain(),[{id:f.item.identifier,language:'en'}]);
});
test('byte-attested parser rejections confirm only after three observations over a day; transient failures recover',async t=>{
 const f=await fixture(t),hints=new DocumentBodyHints();let error=Object.assign(Error('Bad archive'),{code:'invalid_docx',sourceHash:'a'.repeat(64)});
 const collector=new DocumentBodyCollector(f.store,{directory:f.directory,hints,read:async()=>{throw error;}});
 for(const at of [now,now+3600000,now+86400000]){f.setTime(at);f.store.acquire();await collector.step(f.worker);}
 let job=f.store.db.prepare('SELECT * FROM document_body_jobs').get();assert.equal(job.state,'permanent-source-issue');
 error=Object.assign(Error('Limited'),{status:429,retryAfter:7200});f.setTime(job.next_check);f.store.acquire();await collector.step(f.worker);
 job=f.store.db.prepare('SELECT * FROM document_body_jobs').get();assert.equal(job.state,'transient');assert.equal(job.rejection,null);
 assert(job.next_check>=f.store.clock()+7200000);
});
test('non-evicting cache admission refuses excess bytes and preserves existing bodies',async t=>{
 const f=await fixture(t),budget=new CacheDiskBudget(f.directory,{maxBytes:5,maxEntries:5,pattern:/^body/,evict:false});
 await budget.saved('body1',4);assert.equal(await budget.canSave('body2',2),false);assert.equal(budget.bytes,4);
});

function zip(entries){const locals=[],directory=[];let offset=0;for(const [file,value] of Object.entries(entries)){
 const name=Buffer.from(file),body=Buffer.from(value),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(body),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(body),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
 locals.push(local,name,compressed);directory.push(central,name);offset+=30+name.length+compressed.length;
 }const d=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,d,end]);}
test('document hints cross the worker boundary with bounded in-flight batches and recover after restart',async()=>{
 const {EventEmitter}=await import('node:events');
 const {forwardDocumentBodyHints,acceptDocumentBodyHints}=await import('./document-body-hints-rpc.mjs');
 const hints=new DocumentBodyHints(),received=new DocumentBodyHints(),worker=new EventEmitter(),messages=[];
 worker.postMessage=message=>messages.push(message);
 hints.enqueue('B-10-2026-0304','en');const stop=forwardDocumentBodyHints(worker,{hints});
 await new Promise(setImmediate);assert.equal(messages.length,1);
 assert(acceptDocumentBodyHints(messages[0],{hints:received}));assert.equal(received.size,1);
 hints.enqueue('B-10-2026-0305','fr');await new Promise(setImmediate);assert.equal(messages.length,1);
 stop();assert.equal(hints.size,2);
});
test('completed jobs reopen on reader misses without overriding failure backoff, including undated indexed documents',async t=>{
 const f=await fixture(t),hints=new DocumentBodyHints();
 f.store.db.prepare('UPDATE items SET date=NULL').run();
 const collector=new DocumentBodyCollector(f.store,{directory:f.directory,hints,read:async()=>({status:'available'})});
 await collector.step(f.worker);await collector.step(f.worker);
 let job=f.store.db.prepare('SELECT * FROM document_body_jobs').get();assert.equal(job.state,'retained');
 hints.enqueue(f.item.identifier,'en');collector.admit();job=f.store.db.prepare('SELECT * FROM document_body_jobs').get();
 assert.equal(job.next_check,0);assert.equal(job.priority,1000000000);
 f.store.db.prepare("UPDATE document_body_jobs SET state='transient',next_check=?").run(now+3600000);
 hints.enqueue(f.item.identifier,'en');collector.admit();assert.equal(f.store.db.prepare('SELECT next_check FROM document_body_jobs').get().next_check,now+3600000);
});
test('bounded discovery resumes its persisted cursor in a new collector instance',async t=>{
 const f=await fixture(t);
 for(let n=0;n<10;n++)f.store.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)').run(f.key,'document-'+n,'42','motions','2026-10-01','{}');
 const options={directory:f.directory,hints:new DocumentBodyHints()};
 new DocumentBodyCollector(f.store,options).admit();
 const cursor=f.store.get('documentBodyCursor');assert(cursor);assert.equal(cursor.position[0],'2026-10-01');
 new DocumentBodyCollector(f.store,options).admit();
 new DocumentBodyCollector(f.store,options).admit();
 assert.equal(f.store.get('documentBodyCursor'),null);assert(f.store.get('documentBodyDiscovery'));
});
