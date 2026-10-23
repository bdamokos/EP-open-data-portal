import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freshLoader} from './test-support/viteRunner.mjs';

const options=root=>({root,configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'vite-runner-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'dependency.ts'),'export const state={value:0};');
  await writeFile(join(root,'entry.ts'),"export {state} from './dependency.ts'; export const local={value:0};");
  return root;
}

test('fresh loaders retain module identity within a harness and reset the whole graph between harnesses',async t=>{
  const root=await fixture(t);
  let first;
  await t.test('first harness',async t=>{
    const load=await freshLoader(t,options(root));
    first=await load('/entry.ts');
    assert.equal(await load('/entry.ts'),first);
    first.state.value=7;first.local.value=8;
  });
  await t.test('next harness',async t=>{
    const load=await freshLoader(t,options(root)),next=await load('/entry.ts');
    assert.notEqual(next,first);
    assert.notEqual(next.state,first.state);
    assert.equal(next.state.value,0);assert.equal(next.local.value,0);
  });
});

test('different server options retain their own transforms',async t=>{
  const root=await fixture(t);
  const first=await freshLoader(t,{...options(root),define:{__FIXTURE_VALUE__:'1'}});
  const second=await freshLoader(t,{...options(root),define:{__FIXTURE_VALUE__:'2'}});
  await writeFile(join(root,'defined.ts'),'export const value=__FIXTURE_VALUE__;');
  assert.equal((await first('/defined.ts')).value,1);
  assert.equal((await second('/defined.ts')).value,2);
});

test('plugin closures remain isolated even when their serializable options match',async t=>{
  const root=await fixture(t);
  const plugin=value=>({name:'value-fixture',resolveId:id=>id==='virtual:fixture'?'\0fixture':null,load:id=>id==='\0fixture'?`export const value=${value};`:null});
  const first=await freshLoader(t,{...options(root),plugins:[plugin(1)]});
  const second=await freshLoader(t,{...options(root),plugins:[plugin(2)]});
  assert.equal((await first('virtual:fixture')).value,1);
  assert.equal((await second('virtual:fixture')).value,2);
});

test('module evaluation and transform failures reject the import',async t=>{
  const root=await fixture(t),load=await freshLoader(t,options(root));
  await writeFile(join(root,'throws.ts'),"throw new Error('fixture evaluation failed');");
  await writeFile(join(root,'invalid.ts'),'export const broken = ;');
  await assert.rejects(load('/throws.ts'),/fixture evaluation failed/);
  await assert.rejects(load('/invalid.ts'),/Unexpected|expected|Expression/i);
});
