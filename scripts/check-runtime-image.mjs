import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';

const [image,revision]=process.argv.slice(2);
if(!image||!revision||!/^[a-f0-9]{40}$/.test(revision))throw new Error('Pass a built image and its full APP_REVISION.');
const nodeVersion=readFileSync(new URL('../.nvmrc',import.meta.url),'utf8').trim();
assert(/^\d+\.\d+\.\d+$/.test(nodeVersion),'Pin an exact Node version in .nvmrc.');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30_000,maxBuffer:1024*1024}).trim();
let container;
try{
  // Run the image's real CMD and HEALTHCHECK. No source access, host ports or retained data.
  container=docker('run','--detach','--network','none','--read-only',
    '--tmpfs','/data:rw,noexec,nosuid,size=16m,uid=1000,gid=1000',
    '--memory','256m','--cpus','1','--pids-limit','64','--cap-drop','ALL',
    '--security-opt','no-new-privileges',
    '--env','ACTIVITY_INDEX_ENABLED=false','--env','CORPUS_ENABLED=false',
    '--health-interval','1s','--health-start-period','0s','--health-retries','5',image);
  const deadline=Date.now()+30_000;
  while(true){
    const state=JSON.parse(docker('inspect','--format','{{json .State}}',container));
    assert(state.Running&&!state.Restarting&&!state.OOMKilled,`Runtime exited before health: ${JSON.stringify(state)}`);
    assert(state.Health,'The image must define its production HEALTHCHECK.');
    if(state.Health.Status==='healthy')break;
    assert.notEqual(state.Health.Status,'unhealthy','Production HEALTHCHECK failed.');
    assert(Date.now()<deadline,'Timed out waiting for the production HEALTHCHECK.');
    await setTimeout(500);
  }
  const probe=`
    import assert from 'node:assert/strict';
    import {brotliCompressSync,brotliDecompressSync,createBrotliDecompress} from 'node:zlib';
    assert.equal(process.versions.node,${JSON.stringify(nodeVersion)},'Runtime Node must match .nvmrc.');
    const plain=Buffer.from('Parliament source response');
    assert.deepEqual(brotliDecompressSync(brotliCompressSync(plain)),plain);
    // Upstream CVE-2026-111497 regression: nodejs/node commit 03923858417da6a87670cf4c099993dbcc6d8361.
    const invalidBlockSwitch=Buffer.from('200010414141fcffff07002228f00b60f7f41f000000','hex');
    const expectedError={code:'ERR__ERROR_FORMAT_BLOCK_SWITCH',errno:-17};
    assert.throws(()=>brotliDecompressSync(invalidBlockSwitch),expectedError);
    await assert.rejects(async()=>{
      const decoder=createBrotliDecompress();
      for(let i=0;i<invalidBlockSwitch.length;i++)decoder.write(invalidBlockSwitch.subarray(i,i+1));
      decoder.end();
      for await(const chunk of decoder){} // Consume any decoded prefix until the format error.
    },expectedError);
    const base='http://127.0.0.1:8790';
    const get=async path=>{
      const response=await fetch(base+path,{signal:AbortSignal.timeout(3000)});
      assert.equal(response.status,200,path);
      assert.equal(response.headers.get('X-Parliament-Explorer-Revision'),${JSON.stringify(revision)},path);
      return response;
    };
    const health=await (await get('/healthz')).json();
    assert.equal(health.ok,true);assert.equal(health.service,'parliament-explorer');
    const html=await (await get('/')).text();
    const asset=html.match(/<script[^>]+src="((?:\\.)?\\/assets\\/[^"?]+\\.js)"/);
    assert(asset,'Built frontend entry is missing.');
    assert((await (await get(new URL(asset[1],base).pathname)).text()).length>0,'Built frontend entry is empty.');
    assert.equal((await fetch(base+'/src/speakerNames.mjs',{signal:AbortSignal.timeout(3000)})).status,404,'Runtime source must not be publicly served.');
    console.log(JSON.stringify({revision:${JSON.stringify(revision)},node:process.versions.node,health:health.ok,asset:asset[1]}));
  `;
  console.log(docker('exec',container,'node','--input-type=module','-e',probe));
}catch(error){
  if(container)process.stderr.write(docker('logs','--tail','80',container)+'\n');
  throw error;
}finally{
  if(container)docker('rm','--force',container);
}
