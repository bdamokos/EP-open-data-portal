// Event-driven only: each changed readable token gets at most three sequential
// attempts. Busy readers or a failed read abandon the pass until another token.
const variants=[['place','all'],['place','not-home'],['topic','all']];
export function createOverviewWarmup({read,busy,schedule=fn=>{const task=setImmediate(fn);task.unref();return task;}}){
 const seen=new Map(),pending=new Map();let running=false,scheduled;
 const scheduleNext=()=>{if(!running&&!scheduled&&pending.size)scheduled=schedule(()=>{scheduled=null;void run();});};
 const run=async()=>{
  const [filename,pass]=pending.entries().next().value||[];if(!pass)return;
  if(busy()||seen.get(filename)!==pass.token){pending.delete(filename);scheduleNext();return;}
  const [role,askers]=pass.remaining.shift();if(!pass.remaining.length)pending.delete(filename);
  running=true;
  try{await read(filename,new URLSearchParams({role,askers,lang:'en'}));}
  catch{if(pending.get(filename)===pass)pending.delete(filename);}
  // Yield between reads so newly arriving visitors get admission first.
  finally{running=false;scheduleNext();}
 };
 return (filename,{token,ready})=>{
  if(seen.get(filename)===token)return;
  seen.delete(filename);seen.set(filename,token);pending.delete(filename);
  // Bound metadata even if callers use more than the server's one index file.
  if(seen.size>8){const oldest=seen.keys().next().value;seen.delete(oldest);pending.delete(oldest);}
  // Coalesce a newer publication behind the current warm read; admission is
  // checked again after it finishes, without waiting or retrying for visitors.
  if(ready&&(running||!busy())){pending.set(filename,{token,remaining:[...variants]});scheduleNext();}
 };
}
