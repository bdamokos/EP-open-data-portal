import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ipcPort} from './ipc-port.mjs';
import {memoryLink} from './test-support/memory-link.mjs';
import {retentionClient,serveRetention} from './base-source-rpc.mjs';
import {DocumentBodyHints} from './document-body-hints.mjs';
import {forwardDocumentBodyHints,acceptDocumentBodyHints} from './document-body-hints-rpc.mjs';
import {SittingSnapshotHints} from './sitting-snapshot-hints.mjs';
import {forwardSittingSnapshotHints,acceptSittingSnapshotHints} from './sitting-snapshot-hints-rpc.mjs';

// The API process and the front each own one end; the front's accept side answers with the same acknowledgements a writer thread sends.
function ends() {
  const [front,child]=memoryLink();
  return {front:ipcPort(front,'hints'),child:ipcPort(child,'hints'),link:[front,child]};
}

test('retained source bodies cross the link as bytes and are acknowledged',async()=>{
  const [front,child]=memoryLink(),retained=[];
  const client=retentionClient(ipcPort(child,'retention'));
  const stop=serveRetention(ipcPort(front,'retention'),async(observation,body,{directory})=>{retained.push({observation,body,directory});return true;});
  const body=new TextEncoder().encode('source bytes');
  assert.equal(await client.send({body,observation:{url:'https://example.test/a'},directory:'base'}),true);
  assert.equal(retained.length,1);
  assert.equal(Buffer.from(retained[0].body).toString(),'source bytes');
  assert.deepEqual(retained[0].observation,{url:'https://example.test/a'});assert.equal(retained[0].directory,'base');
  // A link that goes away resolves pending sends as not retained instead of hanging.
  child.disconnect();await delay(10);
  assert.equal(await client.send({body,observation:{},directory:'base'}),false);
  client.close();await stop();
});

test('document body hints reach the front one batch at a time',async()=>{
  const {front,child}=ends(),childHints=new DocumentBodyHints(),frontHints=new DocumentBodyHints();
  front.on('message',message=>{if(acceptDocumentBodyHints(message,{hints:frontHints}))front.postMessage({type:'document-body-hints-received'});});
  const stop=forwardDocumentBodyHints(child,{hints:childHints});
  childHints.enqueue('DOC-1','en');childHints.enqueue('DOC-2','fr');
  await delay(30);
  assert.deepEqual(frontHints.drain().map(hint=>hint.id+':'+hint.language).sort(),['DOC-1:en','DOC-2:fr']);
  assert.equal(childHints.size,0,'the sender drained its queue');
  childHints.enqueue('DOC-3','de');await delay(30);
  assert.deepEqual(frontHints.drain().map(hint=>hint.id),['DOC-3']);
  stop();
});

test('an unacknowledged hint batch returns to the sender when the API process stops',async()=>{
  const {child}=ends(),childHints=new DocumentBodyHints();
  const stop=forwardDocumentBodyHints(child,{hints:childHints});
  childHints.enqueue('DOC-9','en');await delay(30);
  assert.equal(childHints.size,0,'in flight to a front that never acknowledges');
  stop();
  assert.equal(childHints.size,1,'nothing is lost');
});

test('sitting snapshot hints keep their kind, version and declaration flag',async()=>{
  const {front,child}=ends(),childHints=new SittingSnapshotHints(),frontHints=new SittingSnapshotHints();
  front.on('message',message=>{if(acceptSittingSnapshotHints(message,{hints:frontHints}))front.postMessage({type:'sitting-hints-received'});});
  const stop=forwardSittingSnapshotHints(child,{hints:childHints});
  childHints.enqueue('votes',2,'MTG-PL-2026-10-20',{changedDeclarations:true});
  childHints.enqueue('calendar',1,'2026');
  await delay(30);
  assert.deepEqual(frontHints.drain().sort((a,b)=>a.kind.localeCompare(b.kind)),[
    {kind:'calendar',version:1,id:'2026',changedDeclarations:false},
    {kind:'votes',version:2,id:'MTG-PL-2026-10-20',changedDeclarations:true}]);
  stop();
});
