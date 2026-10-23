import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);

// A hang budget, not a startup-speed assertion. Inherit NODE_OPTIONS (including
// the suite network guard), and reap the child before fixture cleanup can run.
export async function execFileAsync(t,file,args,options={}) {
  const execution=execute(file,args,{...options,timeout:120_000,killSignal:'SIGKILL',signal:t.signal});
  const child=execution.child;
  const closed=new Promise(resolve=>child.once('close',resolve));
  try {return await execution;}
  finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    await closed;
  }
}
