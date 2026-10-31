import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {questionPdf,downloadQuestionPdf} from './question-pdf.mjs';
import {extractPdfText} from './pdf-text-thread.mjs';
import {documentText} from './document-text.mjs';
import {questionFiles} from './question-files.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';
import {invalidDocx} from './document-file-failure.mjs';

const now=()=>Date.parse('2026-10-31T09:00:00Z');
let serial=0;
const work=()=>{
 const id='E-10-2026-'+String(++serial).padStart(6,'0');
 return {id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-05-01',originalLanguage:['ENG'],is_realized_by:[{id:'expression-en',language:'ENG',is_embodied_by:[{id:'word-en',format:'DOCX',issued:'2026-05-01T12:00:00Z',byteSize:100,is_exemplified_by:'distribution/fixture/'+id+'.docx'},{id:'pdf-en',format:'PDF',issued:'2026-05-02T12:00:00Z',byteSize:200,is_exemplified_by:'distribution/fixture/'+id+'.pdf'}]}]};
};
const fixture=t=>{const directory=mkdtempSync(path.join(tmpdir(),'question-pdf-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;};
const pdf=(stream='BT /F1 12 Tf 50 750 Td (An official answer.) Tj ET')=>{
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let body='%PDF-1.4\n',offsets=[0];for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(body);body+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(body);
};

test('PDF extraction uses bounded actual PDF text and rejects invalid or empty files',async()=>{
 const buffer=pdf(),result=await extractPdfText(buffer);
 assert.equal(result.pages,1);assert.deepEqual(result.paragraphs,['An official answer.']);
 const wrapped=await extractPdfText(pdf('BT /F1 12 Tf 50 750 Td (First line) Tj 0 -14 Td (continues here.) Tj 0 -32 Td (Second paragraph.) Tj ET'));
 assert.deepEqual(wrapped.paragraphs,['First line continues here.','Second paragraph.']);
 await assert.rejects(extractPdfText(Buffer.from('html')),/Invalid/);
 const controller=new AbortController();controller.abort(Error('cancelled'));
 await assert.rejects(extractPdfText(buffer,{signal:controller.signal}),/cancelled/);
});

test('only a unique API-declared same-language question PDF is eligible',()=>{
 const item=work(),candidate=questionPdf(item,'en');
 assert.equal(candidate.language,'en');assert.equal(candidate.manifestationId,'pdf-en');assert.equal(candidate.issued,'2026-05-02T12:00:00Z');
 assert.equal(questionFiles(item)[0].pdf.url,candidate.url);
 assert.equal(questionPdf(item,'de'),null);
 assert.equal(questionPdf({...item,work_type:'REPORT'},'en'),null);
 for(const type of ['QUESTION_WRITTEN','def/ep-document-types/QUESTION_WRITTEN','http://data.europarl.europa.eu/def/ep-document-types/QUESTION_WRITTEN','https://data.europarl.europa.eu/def/ep-document-types/QUESTION_WRITTEN',{id:'def/ep-document-types/QUESTION_WRITTEN'},['def/ep-document-types/QUESTION_WRITTEN']])assert.ok(questionPdf({...item,work_type:type},'en'));
 assert.equal(questionPdf({...item,work_type:['QUESTION_WRITTEN','REPORT']},'en'),null);
 assert.equal(questionPdf({...item,work_type:'https://foreign.test/QUESTION_WRITTEN'},'en'),null);
 item.is_realized_by[0].is_embodied_by.push({...item.is_realized_by[0].is_embodied_by[1],id:'second',is_exemplified_by:'distribution/fixture/second.pdf'});
 assert.equal(questionPdf(item,'en'),null);
});

test('PDF download verifies the actual edition and fences cancellation before parsing',async()=>{
 const buffer=pdf(),file={url:'https://data.europarl.europa.eu/distribution/fixture/a.pdf',byteSize:buffer.length};
 let parses=0;const download=async()=>({body:buffer,resolvedSourceUrl:file.url}),extract=async()=>{parses++;return {paragraphs:['Text']};};
 const result=await downloadQuestionPdf(file,{download,extract});assert.equal(result.observedByteSize,buffer.length);assert.match(result.sourceHash,/^[a-f0-9]{64}$/);
 await assert.rejects(downloadQuestionPdf({...file,byteSize:buffer.length+1},{download,extract}),/exact parliamentary reference/);assert.equal(parses,2);
 const controller=new AbortController();await assert.rejects(downloadQuestionPdf(file,{signal:controller.signal,download:async()=>{controller.abort(Error('cancelled'));return {body:buffer};},extract}),/cancelled/);assert.equal(parses,2);
});

test('reader falls back for broken question DOCX and preserves independent PDF provenance and cache',async t=>{
 const directory=fixture(t),item=work();let words=0,pdfs=0;
 const options={directory,clock:now,download:async()=>{words++;throw invalidDocx(Error('Invalid DOCX archive'));},downloadPdf:async file=>{pdfs++;assert.equal(file.url,questionPdf(item,'en').url);return {paragraphs:['PDF answer'],sourceHash:'f'.repeat(64)};}};
 const result=await documentText(item,'en',options);
 assert.equal(result.status,'available');assert.equal(result.sourceFormat,'PDF');assert.equal(result.textLanguage,'en');assert.equal(result.sourceUrl,questionPdf(item,'en').url);assert.equal(result.sourceVersion.issued,'2026-05-02T12:00:00Z');assert.equal(result.notesStatus,'not-extracted');
 const saved=await documentText(item,'en',{...options,cacheOnly:true});assert.equal(saved.status,'available');assert.equal(saved.sourceFormat,'PDF');
 await documentText(item,'en',options);assert.equal(words,1);assert.equal(pdfs,1);
});

test('reader preserves working DOCX and does not bypass quota, transport or unchanged cooldowns',async t=>{
 const directory=fixture(t);let pdfs=0;
 for(const error of [Object.assign(Error('Rate limited'),{status:429,retryAfter:3600}),Object.assign(Error('Unavailable'),{status:503}),Error('transport timeout')]) {
  const item=work();let words=0;const options={directory,clock:now,download:async()=>{words++;throw error;},downloadPdf:async()=>{pdfs++;return {paragraphs:['Wrong']};}};
  const first=await documentText(item,'en',options);assert.equal(first.status,'error');await documentText(item,'en',options);assert.equal(words,1);
  if(error.status===429)assert.equal(first.nextRetryAt,new Date(now()+3600000).toISOString());
 }
 const available=await documentText(work(),'en',{directory,clock:now,download:async()=>({paragraphs:['Word text']}),downloadPdf:async()=>{pdfs++;}});
 assert.equal(available.sourceFormat,'DOCX');assert.equal(pdfs,0);
});

function corpusFixture(t){const directory=fixture(t),store=new CorpusStore(directory,{clock:now});assert.equal(store.acquire(),true);t.after(()=>{if(store.db.isOpen)store.close();});return {directory,store};}
function job(store,item){const file=questionFiles(item)[0],key='docx:'+file.url;store.enqueue(key,'docx',file,50);return store.task(key);}

test('ordinary DOCX owner retains independent PDF without completing or shortening the failed owner',async t=>{
 const {store}=corpusFixture(t),item=work(),task=job(store,item);let pdfs=0;
 const worker=new CorpusWorker(store,{clock:now,runUpstream:fn=>fn(worker.controller.signal),download:async()=>{throw invalidDocx(Error('Invalid DOCX archive'));},downloadPdf:async()=>{pdfs++;return {paragraphs:['Searchable PDF answer'],sourceHash:'a'.repeat(64),observedByteSize:200};}});
 await assert.rejects(worker.task(task),/Invalid DOCX/);store.failTask(task,invalidDocx(Error('Invalid DOCX archive')));
 const failed=store.task(task.key),record=store.text({sourceId:item.identifier,sourceKey:'en'});
 assert.equal(failed.done,0);assert.equal(failed.attempts,1);assert.equal(failed.retry_at,now()+60000);assert.equal(record.sourceFormat,'pdf');assert.equal(record.sourceUrl,task.body.pdf.url);assert.equal(record.sourceVersion.observedByteSize,200);assert.equal(store.search({query:'searchable'}).total,1);
 await assert.rejects(worker.task(failed),/Invalid DOCX/);assert.equal(pdfs,1,'the identical retained PDF is not downloaded again');
});

test('PDF fallback respects the existing per-iteration request allowance and never replaces readable DOCX',async t=>{
 const {store}=corpusFixture(t),item=work(),task=job(store,item);let pdfs=0;
 const worker=new CorpusWorker(store,{clock:now,runUpstream:fn=>fn(worker.controller.signal),download:async()=>{throw invalidDocx(Error('Invalid DOCX'));},downloadPdf:async()=>{pdfs++;return {paragraphs:['PDF']};}});
 worker.dispatches=worker.budget;await assert.rejects(worker.task(task),/Invalid DOCX/);assert.equal(pdfs,0);
 worker.dispatches=0;store.putDocument({sourceId:item.identifier,kind:'question'},[{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'docx',sourceUrl:task.body.url,fetchedAt:new Date(now()).toISOString(),body:'Retained Word text',raw:null}]);
 await assert.rejects(worker.task(task),/Invalid DOCX/);assert.equal(pdfs,0);assert.equal(store.text({sourceId:item.identifier,sourceKey:'en'}).body,'Retained Word text');
});

test('stopped-app PDF migration preserves row IDs, raw bytes, FTS results and future task clocks',t=>{
 const {directory,store}=corpusFixture(t),item=work(),task=job(store,item);
 store.putDocument({sourceId:item.identifier,kind:'question'},[{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'docx',sourceUrl:task.body.url,fetchedAt:new Date(now()).toISOString(),body:'Ocean protection.',raw:null}]);
 store.db.prepare('UPDATE tasks SET retry_at=?,attempts=5,error=? WHERE key=?').run(now()+86400000,'Invalid DOCX',task.key);
 const before=store.db.prepare('SELECT * FROM texts').all().map(({source_edition,...row})=>({...row})),retry=store.task(task.key);
 // Construct the accepted pre-PDF table without changing any stored content.
 store.db.exec(`DROP TRIGGER texts_ai;DROP TRIGGER texts_ad;DROP TRIGGER texts_au;
  CREATE TABLE texts_old AS SELECT id,document_id,language,source_key,translation_type,source_format,source_url,fetched_at,checked_at,sha256,chars,body,raw FROM texts;
  DROP TABLE texts;ALTER TABLE texts_old RENAME TO texts;`);
 store.set('corpusTextVersion',0);store.release();store.close();
 const result=prepareIndexes({corpusDirectory:directory,clock:now,log:()=>{}});assert.equal(result[0].noop,false);
 const reopened=new CorpusStore(directory,{clock:now});t.after(()=>reopened.close());assert.equal(reopened.acquire(),true);
 assert.deepEqual(reopened.db.prepare('SELECT * FROM texts').all().map(({source_edition,...row})=>({...row})),before);
 assert.deepEqual(reopened.task(task.key),retry);assert.equal(reopened.search({query:'ocean'}).total,1);assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);
 reopened.putDocument({sourceId:item.identifier,kind:'question'},[{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'pdf',sourceUrl:task.body.pdf.url,fetchedAt:new Date(now()).toISOString(),body:'Fresh PDF wording',raw:null}]);
 assert.equal(reopened.search({query:'ocean'}).total,0);assert.equal(reopened.search({query:'wording'}).total,1);
});

test('a declared size mismatch requires the exact printed reference and records the mismatch',async()=>{
 const buffer=pdf(),file={url:'https://data.europarl.europa.eu/distribution/fixture/a.pdf',sourceId:'E-10-2026-001715-ASW',byteSize:buffer.length+1};
 const download=async()=>({body:buffer}),extract=async()=>({paragraphs:['E-001715/2026','Official answer text']});
 const result=await downloadQuestionPdf(file,{download,extract});assert.equal(result.byteSizeMatches,false);assert.equal(result.observedByteSize,buffer.length);
 const shortYear=await downloadQuestionPdf(file,{download,extract:async()=>({paragraphs:['E-001715/26','Official answer']})});assert.equal(shortYear.byteSizeMatches,false);
 await assert.rejects(downloadQuestionPdf({...file,sourceId:'E-10-2026-001716-ASW'},{download,extract}),/exact parliamentary reference/);
 await assert.rejects(downloadQuestionPdf({...file,sourceId:'E-10-2025-001715-ASW'},{download,extract}),/exact parliamentary reference/);
});

test('future PDF editions, foreign languages and rate limits do not create fallback acquisitions',async t=>{
 const {store}=corpusFixture(t);let pdfs=0;
 for(const change of ['future','language','rate','cancel']) {
  const item=work(),task=job(store,item);if(change==='future')task.body.pdf.issued='2027-01-01T00:00:00Z';if(change==='language')task.body.pdf.language='de';
  const worker=new CorpusWorker(store,{clock:now,runUpstream:fn=>fn(worker.controller.signal),download:async()=>{
   if(change==='rate')throw Object.assign(Error('Rate limit'),{status:429,retryAfter:60});
   if(change==='cancel')worker.controller.abort(Error('cancelled'));
   throw invalidDocx(Error('Invalid DOCX'));
  },downloadPdf:async()=>{pdfs++;return {paragraphs:['PDF']};}});
  await assert.rejects(worker.task(task));assert.equal(store.text({sourceId:item.identifier,sourceKey:'en'}),null);
 }
 assert.equal(pdfs,0);
});

test('cancellation after PDF download cannot retain or settle any task',async t=>{
 const {store}=corpusFixture(t),item=work(),task=job(store,item);
 const worker=new CorpusWorker(store,{clock:now,runUpstream:fn=>fn(worker.controller.signal),download:async()=>{throw invalidDocx(Error('Invalid DOCX'));},downloadPdf:async()=>{worker.controller.abort(Error('lost lease'));return {paragraphs:['Late PDF']};}});
 await assert.rejects(worker.task(task),/lost lease/);assert.equal(store.text({sourceId:item.identifier,sourceKey:'en'}),null);assert.equal(store.task(task.key).done,0);
});

test('a one-request worker resumes PDF fallback at its unchanged natural retry',async t=>{
 const {store}=corpusFixture(t),item=work(),task=job(store,item);let words=0,pdfs=0;
 const options={clock:now,budget:1,runUpstream:fn=>fn(new AbortController().signal),download:async()=>{words++;throw invalidDocx(Error('Invalid DOCX'));},downloadPdf:async()=>{pdfs++;return {paragraphs:['PDF answer']};}};
 const first=new CorpusWorker(store,options);first.dispatches=1;
 await assert.rejects(first.task(task),/Invalid DOCX/);store.failTask(task,invalidDocx(Error('Invalid DOCX')));
 const retry=store.task(task.key);assert.ok(retry.body.pdfPending);assert.equal(retry.retry_at,now()+60000);assert.equal(pdfs,0);
 const second=new CorpusWorker(store,{...options,clock:()=>retry.retry_at});second.dispatches=1;
 await assert.rejects(second.task(retry),/Invalid DOCX/);assert.equal(pdfs,1);assert.equal(words,1,'the retry slot performs only its saved PDF step');
 assert.equal(store.task(task.key).retry_at,retry.retry_at);assert.equal(store.task(task.key).done,0);assert.equal(store.text({sourceId:item.identifier,sourceKey:'en'}).sourceFormat,'pdf');
});

test('preparation refuses a live writer before changing PDF schema or task state',t=>{
 const {directory,store}=corpusFixture(t),item=work(),task=job(store,item);
 store.set('corpusTextVersion',0);const before=store.task(task.key);
 assert.throws(()=>prepareIndexes({corpusDirectory:directory,clock:now,log:()=>{}}),/writer lease is active/);
 assert.equal(store.get('corpusTextVersion'),0);assert.deepEqual(store.task(task.key),before);
});
