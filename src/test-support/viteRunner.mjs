import {after} from 'node:test';
import {createServer,createServerModuleRunner} from 'vite';

const servers=new Map();

after(async()=>{
  await Promise.all([...servers.values()].map(async server=>(await server).close()));
});

// Share transforms for each configuration within a test file, but give each
// harness fresh module instances. Keep the caller's server options and logging.
// The caller owns disposal: await load.close() after consumer teardown, including
// any dynamic imports it performs. Registering a hook here would run too early.
export async function freshLoader(options,{sharedServerKey}={}) {
  // Plugin hooks can carry per-harness state and cannot be keyed as JSON.
  // Stateless fixture hooks may opt in with one stable key for that configuration;
  // only the transform server is shared, never evaluated module instances.
  const isolated=Boolean(options.plugins?.length&&!sharedServerKey);
  let server;
  if(isolated)server=createServer(options);
  else {
    const key=sharedServerKey??JSON.stringify(options);
    if(!servers.has(key))servers.set(key,createServer(options));
    server=servers.get(key);
  }
  const vite=await server;
  let runner;
  // Source-mapped stacks make Node decode every evaluated module's map, which was about a tenth
  // of frontend test CPU. TEST_SOURCE_MAPS=1 restores .tsx line numbers when debugging a failure.
  try {runner=createServerModuleRunner(vite.environments.ssr,{hmr:false,sourcemapInterceptor:process.env.TEST_SOURCE_MAPS==='1'?'node':false});}
  catch(error) {if(isolated)await vite.close();throw error;}
  const load=path=>runner.import(path);
  load.close=async()=>{
    try {await runner.close();}
    finally {if(isolated)await vite.close();}
  };
  return load;
}
