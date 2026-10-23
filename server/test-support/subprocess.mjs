import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile),children=new WeakMap();

// Install from beforeEach so this hook precedes fixture t.after callbacks (FIFO).
// node:test can start teardown on cancellation without awaiting the test body.
export function registerSubprocesses(t) {
  if(children.has(t))return;
  const owned=new Set();children.set(t,owned);
  t.after(async()=>{
    for(const entry of owned){
      if(entry.stop)entry.stop();
      else if(entry.child.exitCode===null&&entry.child.signalCode===null)entry.child.kill('SIGKILL');
    }
    await Promise.all([...owned].map(entry=>entry.drain?entry.drain():entry.closed));
    children.delete(t);
  });
}

// Grouped regression runners share the same drain-before-fixture hook.
export function trackSubprocess(t,entry) {
  const owned=children.get(t);
  if(!owned)throw new Error('Install beforeEach(registerSubprocesses) before starting test subprocesses.');
  owned.add(entry);return ()=>owned.delete(entry);
}

// A hang budget, not a startup-speed assertion. NODE_OPTIONS and its network
// guard are inherited. Keep the native promise.child handle for lifecycle checks.
export function execFileAsync(t,file,args,options={}) {
  const owned=children.get(t);
  if(!owned)throw new Error('Install beforeEach(registerSubprocesses) before starting test subprocesses.');
  t.signal.throwIfAborted();
  // execFile forwards signal to spawn without forwarding killSignal. Own the
  // abort listener so cancellation uses SIGKILL as well as the timeout path.
  const execution=execute(file,args,{...options,timeout:120_000,killSignal:'SIGKILL',signal:undefined});
  const child=execution.child,closed=new Promise(resolve=>child.once('close',resolve)),entry={child,closed};
  owned.add(entry);
  const abort=()=>child.kill('SIGKILL');
  t.signal.addEventListener('abort',abort,{once:true});
  if(t.signal.aborted)abort();
  const completed=(async()=>{
    try {return await execution;}
    catch(error) {
      if(t.signal.aborted)throw Object.assign(new Error('Test subprocess was aborted.',{cause:t.signal.reason}),{name:'AbortError',code:'ABORT_ERR'});
      throw error;
    }
    finally {
      t.signal.removeEventListener('abort',abort);
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      await closed;owned.delete(entry);
    }
  })();
  completed.child=child;
  return completed;
}
