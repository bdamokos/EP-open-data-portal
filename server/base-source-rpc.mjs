// A dedicated channel avoids a dependency cycle with upstream admission RPC:
// capture acknowledgements never require another HTTP admission grant.
let forward=null;
export const setRetentionForwarder=handler=>{forward=handler;};
export async function sendRetention(value) {try{return forward?await forward(value):false;}catch{return false;}}
export function retentionClient(port) {
  const pending=new Map();let sequence=0,bytes=0,closed=false;
  const close=()=>{if(closed)return;closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.resolve(false);}pending.clear();bytes=0;port.close();};
  port.on('message',({id,value})=>{const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);bytes-=entry.size;entry.resolve(value===true);});
  port.once('close',close);port.unref();
  const send=value=>{
    if(closed||!(value.body instanceof Uint8Array)||value.body.byteLength>12*1024*1024)return Promise.resolve(false);
    const size=value.body.byteLength+Buffer.byteLength(JSON.stringify(value.observation));
    if(size-value.body.byteLength>256*1024||bytes+size>16*1024*1024||pending.size>=32)return Promise.resolve(false);
    const id=++sequence;bytes+=size;
    return new Promise(resolve=>{const timer=setTimeout(close,5000);timer.unref();pending.set(id,{resolve,size,timer});try{port.postMessage({id,...value});}catch{pending.delete(id);clearTimeout(timer);bytes-=size;resolve(false);}});
  };
  return {send,close};
}
export function serveRetention(port,retain) {
  let tail=Promise.resolve(),closed=false;
  port.on('message',message=>{
    tail=tail.then(async()=>{
      let value=false;try{value=await retain(message.observation,Buffer.from(message.body),{directory:message.directory});}catch{}
      if(!closed)try{port.postMessage({id:message.id,value});}catch{}
    });
  });
  return async()=>{await tail;closed=true;port.close();};
}
