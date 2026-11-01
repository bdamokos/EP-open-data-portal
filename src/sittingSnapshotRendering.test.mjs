import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {ActivityStore} from '../server/activity-index-store.mjs';
import {ActivityWorker} from '../server/activity-index-worker.mjs';
import {SittingSnapshotCollector} from '../server/sitting-snapshot-collector.mjs';
import {SittingSnapshotReader,SittingSnapshotHints} from '../server/sitting-snapshot-store.mjs';
import {snapshotFixture,snapshotResponses,SNAPSHOT_NOW,SNAPSHOT_SITTING,SNAPSHOT_MEMBER} from '../server/test-support/sitting-snapshots.mjs';

test('fixture votes and attendance render identical list and detail markup from upstream and disk',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'snapshot-render-')),clock=()=>SNAPSHOT_NOW;
  const store=new ActivityStore(directory,{clock});assert(store.acquire());
  const fixture=snapshotFixture(),hints=new SittingSnapshotHints(),collector=new SittingSnapshotCollector(store,{hints,readChairs:async()=>null});
  const worker=new ActivityWorker(store,{clock,fetchRecord:fixture.request});worker.runDeadline=Infinity;
  for(let i=0;i<20&&collector.due();i++)await collector.step(worker);
  const reader=new SittingSnapshotReader({directory,clock,hints});
  const direct=await snapshotResponses({request:fixture.request,clock});
  const retained=await snapshotResponses({request:async()=>assert.fail('render fixture must use disk'),snapshots:reader,clock});
  const window=new Window({url:'http://localhost/'}),originals=new Map();
  for(const [key,value] of Object.entries({window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(async()=>{await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];reader.close();store.close();rmSync(directory,{recursive:true,force:true});});
  const {createRoot}=await import('react-dom/client');
  let responses=direct,voteReads=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('/member-votes/')){
      voteReads++;const votes=structuredClone(responses.votes),decision=new URL(String(url),'http://localhost').searchParams.get('decision');
      if(decision)votes.selected={status:'found',item:votes.items.find(item=>item.id===decision)};
      return Response.json(votes);
    }
    if(String(url).includes('/member-attendance/'))return Response.json(responses.attendance);
    if(String(url).includes('/vote-periods'))return Response.json({version:2,weeks:[{week:'2026-10-05',sittings:[{sittingId:SNAPSHOT_SITTING,date:SNAPSHOT_SITTING.slice(7)}]}],coverage:{status:'complete',years:[]}});
    return Response.json({error:{code:'unavailable'}},{status:503});
  });
  async function render(data,decisionId){
    // Isolate the data-client cache so both paths must actually supply data.
    vite.moduleGraph.invalidateAll();
    const {MemberVotes,defaultMemberVotesState}=await vite.ssrLoadModule('/src/MemberVotes.tsx');
    responses=data;const before=voteReads,container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    try {
      await act(async()=>root.render(createElement(MemberVotes,{memberId:Number(SNAPSHOT_MEMBER),memberName:'Test member',language:'en',
        state:{...defaultMemberVotesState,week:null,sittingId:SNAPSHOT_SITTING,snapshotId:data.votes.snapshotId,decisionId},onStateChange:()=>{},renderContext:()=>null})));
      if(!decisionId)assert.match(container.textContent,/Listed as present|listed present/);
      assert.match(container.textContent,/Test member voted For/);
      assert.doesNotMatch(container.textContent,/couldn.t be loaded/);
      assert(voteReads>before);
      // React allocates new opaque control IDs for each mounted root.
      const ids=new Map();
      return container.innerHTML.replace(/_r_[a-z0-9]+_/g,id=>{if(!ids.has(id))ids.set(id,'control-'+ids.size);return ids.get(id);});
    }finally{await act(async()=>root.unmount());container.remove();}
  }
  for(const decisionId of [null,direct.votes.items[0].id])assert.equal(await render(retained,decisionId),await render(direct,decisionId));
});
