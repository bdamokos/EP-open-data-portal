import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {parseAst} from 'vite';

// Migrate after the listed PRs merge.
const excluded=new Map([
  ['MemberVotes.test.mjs',[186,190,219]],
  ['documentContextReader.test.mjs',[186,190]],
  ['motionAmendmentsReader.test.mjs',[186,190,219]],
  ['memberVotesHistory.test.mjs',[186,219]],
  ['activityVote.test.mjs',[219]],
  ['motionOutcome.test.mjs',[219]],
  ['contextAnnotations.test.mjs',[186]],
  ['client.test.mjs',[219]],
  ['memberAttendancePresentation.test.mjs',[219]],
  ['memberVotesJourney.test.mjs',[219]],
  ['memberVotesPresentation.test.mjs',[219]],
]);

test('frontend harnesses use freshLoader instead of importing createServer',async()=>{
  const direct=[];
  for(const name of (await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.test.mjs'))) {
    const {body}=parseAst(await readFile(new URL(name,import.meta.url),'utf8'));
    if(body.some(node=>node.type==='ImportDeclaration'&&node.source.value==='vite'&&node.specifiers.some(specifier=>specifier.type==='ImportSpecifier'&&(specifier.imported.name??specifier.imported.value)==='createServer'))&&!excluded.has(name))direct.push(name);
  }
  assert.deepEqual(direct,[],'Import freshLoader from test-support/viteRunner.mjs; only pending-PR follow-ups may use createServer directly.');
});


test('stateless plugin transforms can share a server while module state stays fresh',async t=>{
  const {freshLoader}=await import('./test-support/viteRunner.mjs');
  let servers=0;
  const options={configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},plugins:[{
    name:'shared-fixture',configResolved(){servers++;},
    resolveId(id){if(id==='virtual:fresh-state')return '\0fresh-state';},
    load(id){if(id==='\0fresh-state')return 'export const state={value:0};';},
  }]};
  const sharedServerKey=Symbol('fresh-state');
  const first=await freshLoader(options,{sharedServerKey});
  const a=await first('virtual:fresh-state');a.state.value=42;await first.close();
  const second=await freshLoader(options,{sharedServerKey});t.after(()=>second.close());
  const b=await second('virtual:fresh-state');
  assert.equal(b.state.value,0);assert.notEqual(a.state,b.state);assert.equal(servers,1);
});
