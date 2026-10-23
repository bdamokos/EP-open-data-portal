import {after} from 'node:test';
import {createServer,createServerModuleRunner} from 'vite';

const servers=new Map();

after(async()=>{
  await Promise.all([...servers.values()].map(async server=>(await server).close()));
});

// Share transforms for each configuration within a test file, but give each
// harness fresh module instances. Keep the caller's server options and logging.
export async function freshLoader(t,options) {
  // Plugin hooks can carry per-harness state and cannot be keyed as JSON.
  const isolated=Boolean(options.plugins?.length);
  let server;
  if(isolated)server=createServer(options);
  else {
    const key=JSON.stringify(options);
    if(!servers.has(key))servers.set(key,createServer(options));
    server=servers.get(key);
  }
  const vite=await server;
  let runner;
  t.after(async()=>{
    try {if(runner)await runner.close();}
    finally {if(isolated)await vite.close();}
  });
  runner=createServerModuleRunner(vite.environments.ssr,{hmr:false});
  return path=>runner.import(path);
}
