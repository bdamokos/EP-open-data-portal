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

test('the corpus reader body ignores workers it did not start',async()=>{
  // Activity generation workers carry an operation and import corpus-reader.mjs
  // transitively; they must not run a corpus read alongside their own work.
  const {Worker}=await import('node:worker_threads');
  // The sentinel is posted only after module evaluation has finished, so an
  // empty prefix proves the body did not run rather than not having started.
  const url=JSON.stringify(new URL('./corpus-reader.mjs',import.meta.url).href);
  const worker=new Worker(`import {parentPort} from 'node:worker_threads';await import(${url});await new Promise(resolve=>setImmediate(resolve));parentPort.postMessage('imported');`,{eval:true,type:'module',workerData:{operation:'begin',directory:'/nonexistent'}});
  const messages=[];worker.on('message',message=>messages.push(message));
  const code=await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);});
  assert.equal(code,0);
  assert.deepEqual(messages,['imported']);
});
