import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {Worker} from 'node:worker_threads';
import {extractAmendmentsOffThread} from './amendment-extraction-thread.mjs';
import {extractAmendments} from './amendment-documents.mjs';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';

beforeEach(registerSubprocesses);

test('cancelling one of two concurrent parses leaves the other to finish and removes every listener',{timeout:15_000},async t=>{
  const moduleUrl=new URL('./amendment-extraction-thread.mjs',import.meta.url).href;
  const {stdout}=await execFileAsync(t,process.execPath,['--input-type=module','--eval',`
    import assert from 'node:assert/strict';
    import {getEventListeners} from 'node:events';
    import {extractAmendmentsOffThread} from ${JSON.stringify(moduleUrl)};
    const controllers=[new AbortController(),new AbortController()];
    const parses=controllers.map(controller=>extractAmendmentsOffThread(Buffer.alloc(0),{},{signal:controller.signal}));
    const settled=Promise.allSettled(parses);
    const reason=new Error('Cancelled extraction');controllers[0].abort(reason);
    const [cancelled,other]=await settled;
    assert.equal(cancelled.status,'rejected');assert.equal(cancelled.reason,reason);
    // The second parse ran on a replacement thread and reports its own rejection.
    assert.equal(other.status,'rejected');assert.equal(other.reason.code,'source_parser_rejection');
    for(const controller of controllers)assert.equal(getEventListeners(controller.signal,'abort').length,0);
    console.log('cancelled');
  `]);
  assert.equal(stdout.trim(),'cancelled');
});

// Minimal in-memory DOCX with an empty body exercises successful recovery.
function emptyDocx() {
  const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="urn:word"><w:body/></w:document>');
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}

test('a worker failure ends the running parse only and the next parse starts a healthy worker',async t=>{
  let failedWorker;
  const held=t.mock.method(Worker.prototype,'postMessage',function(){failedWorker??=this;});
  const controllers=[new AbortController(),new AbortController()];
  const buffer=emptyDocx();
  const parses=controllers.map(controller=>extractAmendmentsOffThread(buffer,{},{signal:controller.signal}));
  const settled=Promise.allSettled(parses),failure=new Error('Worker failed');
  held.mock.restore();
  failedWorker.emit('error',failure);
  const [failed,queued]=await settled;
  assert.equal(failed.status,'rejected');assert.equal(failed.reason,failure);
  // The queued parse was not harmed: it ran on the replacement worker.
  assert.equal(queued.status,'fulfilled');assert.deepEqual(queued.value,extractAmendments(buffer,{}));
  for(const controller of controllers)assert.equal(getEventListeners(controller.signal,'abort').length,0);
  // Signals belonging to settled requests cannot cancel the replacement worker.
  controllers[1].abort();
  assert.deepEqual(await extractAmendmentsOffThread(buffer,{}),extractAmendments(buffer,{}));
});


test('parser rejections identify the exact bytes while worker failures remain transient',async()=>{
  const {createHash}=await import('node:crypto');const buffer=Buffer.from('invalid archive');
  await assert.rejects(extractAmendmentsOffThread(buffer,{}),error=>{
    assert.equal(error.code,'source_parser_rejection');assert.equal(error.sourceHash,createHash('sha256').update(buffer).digest('hex'));return true;
  });
});
