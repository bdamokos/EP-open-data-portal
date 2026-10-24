import {spawn} from 'node:child_process';
import {trackSubprocess} from './subprocess.mjs';

function groupExists(pid) {
  try {process.kill(-pid,0);return true;}
  catch(error) {if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}
}

// Only for the nested lifecycle regression: its Node runner, worker and hanging
// child inherit this new POSIX session/group. Never signal the calling group.
export function execProcessGroupAsync(t,file,args,{env,cwd,maxBuffer=1024*1024}={}) {
  if(process.platform==='win32')throw new Error('The lifecycle process-group probe requires POSIX.');
  t.signal.throwIfAborted();
  const entry={},release=trackSubprocess(t,entry);
  let child;
  try {child=spawn(file,args,{env,cwd,detached:true,stdio:['ignore','pipe','pipe']});}
  catch(error){release();throw error;}
  let spawnError,limitError,timedOut=false,bytes=0,draining,signalled=false;
  const stdout=[],stderr=[];
  const stop=()=>{
    if(!child.pid||signalled)return;
    try {process.kill(-child.pid,'SIGKILL');signalled=true;}
    catch(error){
      if(error.code==='ESRCH'){signalled=true;return;}
      // A group awaiting reaping may no longer accept a signal. It still must
      // disappear (ESRCH) before drain returns; permission errors are not proof.
      if(error.code==='EPERM'&&(child.exitCode!==null||child.signalCode!==null))return;
      throw error;
    }
  };
  const closed=new Promise(resolve=>child.once('close',resolve));
  const drain=()=>draining??=(async()=>{
    stop();await closed;
    if(!child.pid)return;
    const deadline=performance.now()+120_000;
    while(groupExists(child.pid)) {
      if(performance.now()>=deadline)throw new Error('Lifecycle regression process group did not terminate.');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  })();
  Object.assign(entry,{child,closed,stop,drain});
  // A leader can exit while an orphan still owns its stdout/stderr pipes.
  child.once('exit',stop);
  child.once('error',error=>spawnError=error);
  for(const [stream,chunks] of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>maxBuffer){limitError=new Error('Lifecycle regression exceeded its output budget.');stop();}
    else chunks.push(chunk);
  });
  const timer=setTimeout(()=>{timedOut=true;stop();},120_000);
  t.signal.addEventListener('abort',stop,{once:true});
  if(t.signal.aborted)stop();
  const result=(async()=>{
    try {
      await closed;
      const output={stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')};
      if(spawnError||limitError||timedOut||t.signal.aborted||child.exitCode!==0) {
        const error=spawnError||limitError||new Error(t.signal.aborted?'Lifecycle regression was aborted.':timedOut?'Lifecycle regression hung.':'Lifecycle regression exited unsuccessfully.');
        throw Object.assign(error,output,{code:child.exitCode,signal:child.signalCode});
      }
      return output;
    }finally {
      clearTimeout(timer);t.signal.removeEventListener('abort',stop);
      await drain();release();
    }
  })();
  result.child=child;result.drain=drain;
  return result;
}
