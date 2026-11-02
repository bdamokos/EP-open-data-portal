import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

// Top-level await turns a module into an async module. Worker entries are
// terminated on timeouts and after replies, and V8 can abort the whole process
// (Check failed: !is_null() in SourceTextModule::ExecuteAsyncModule) when an
// async module graph is torn down mid-evaluation. Keep runtime modules synchronous.
test('runtime server modules have no top-level await',()=>{
  const files=readdirSync(new URL('./',import.meta.url)).filter(name=>name.endsWith('.mjs')&&!name.endsWith('.test.mjs')).map(name=>'server/'+name);
  const probe=`import vm from 'node:vm';import {readFileSync} from 'node:fs';
    const found=[];for(const file of JSON.parse(process.argv[1])){if(new vm.SourceTextModule(readFileSync(file,'utf8'),{identifier:file}).hasTopLevelAwait())found.push(file);}
    process.stdout.write(JSON.stringify(found));`;
  const found=JSON.parse(execFileSync(process.execPath,['--experimental-vm-modules','--no-warnings','--input-type=module','-e',probe,JSON.stringify(files)],{cwd:root,encoding:'utf8'}));
  assert.ok(files.includes('server/corpus-reader.mjs'));
  assert.deepEqual(found,[]);
});
