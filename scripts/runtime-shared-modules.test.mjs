import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('server-shared frontend helpers import from the actual runtime image file set',async t=>{
  const root=new URL('../',import.meta.url),dockerfile=await readFile(new URL('Dockerfile',root),'utf8');
  const copy=dockerfile.split('\n').find(line=>line.startsWith('COPY --from=build ')&&line.endsWith(' ./src/'));
  assert(copy,'Runtime image must declare its shared frontend modules.');
  const sources=copy.split(/\s+/).slice(2,-1);
  assert(sources.length>0);
  const staged=await mkdtemp(path.join(tmpdir(),'ep-runtime-shared-'));
  t.after(()=>rm(staged,{recursive:true,force:true}));
  await mkdir(path.join(staged,'src'));
  for(const source of sources){
    assert(source.startsWith('/app/src/'));
    const relative=source.slice('/app/'.length);
    await copyFile(new URL(relative,root),path.join(staged,relative));
  }
  const urls=sources.map(source=>pathToFileURL(path.join(staged,source.slice('/app/'.length))).href);
  execFileSync(process.execPath,['--input-type=module','-e',
    `await Promise.all(${JSON.stringify(urls)}.map(url=>import(url)));`],
    {encoding:'utf8',timeout:10000,stdio:'pipe'});
});
