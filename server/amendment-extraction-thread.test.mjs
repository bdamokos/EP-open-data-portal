import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {Worker} from 'node:worker_threads';
import {extractAmendmentsOffThread} from './amendment-extraction-thread.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';

beforeEach(registerSubprocesses);

test('cancelling concurrent parses removes every listener and lets the process exit naturally',{timeout:15_000},async t=>{
  const moduleUrl=new URL('./amendment-extraction-thread.mjs',import.meta.url).href;
  const {stdout}=await execFileAsync(t,process.execPath,['--input-type=module','--eval',`
    import assert from 'node:assert/strict';
    import {getEventListeners} from 'node:events';
    import {extractAmendmentsOffThread} from ${JSON.stringify(moduleUrl)};
    const controllers=[new AbortController(),new AbortController()];
    const parses=controllers.map(controller=>extractAmendmentsOffThread(Buffer.alloc(0),{},{signal:controller.signal}));
    const settled=Promise.allSettled(parses);
    const reason=new Error('Cancelled extraction');controllers[0].abort(reason);
    for(const result of await settled){assert.equal(result.status,'rejected');assert.equal(result.reason,reason);}
    for(const controller of controllers)assert.equal(getEventListeners(controller.signal,'abort').length,0);
    console.log('cancelled');
  `]);
  assert.equal(stdout.trim(),'cancelled');
});

test('worker failure cleans all pending entries and the next parse starts a healthy worker',async t=>{
  let failedWorker;
  const held=t.mock.method(Worker.prototype,'postMessage',function(){failedWorker=this;});
  const controllers=[new AbortController(),new AbortController()];
  const parses=controllers.map(controller=>extractAmendmentsOffThread(Buffer.alloc(0),{},{signal:controller.signal}));
  const settled=Promise.allSettled(parses),failure=new Error('Worker failed');
  failedWorker.emit('error',failure);held.mock.restore();
  for(const result of await settled){assert.equal(result.status,'rejected');assert.equal(result.reason,failure);}
  for(const controller of controllers)assert.equal(getEventListeners(controller.signal,'abort').length,0);
  // Minimal in-memory DOCX with an empty body exercises successful recovery.
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body/></w:document>');
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  const buffer=Buffer.concat([local,name,body,central,name,end]);
  assert.deepEqual(await extractAmendmentsOffThread(buffer,{}),extractAmendments(buffer,{}));
  // Signals belonging to failed requests cannot cancel the replacement worker.
  controllers[1].abort();
  assert.deepEqual(await extractAmendmentsOffThread(buffer,{}),extractAmendments(buffer,{}));
});
