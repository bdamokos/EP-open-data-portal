import {EventEmitter} from 'node:events';

// Two ends of an in-memory link shaped like a child-process IPC channel.
// Messages are structured-cloned like the real thing and delivered asynchronously.
export function memoryLink() {
  const make=()=>Object.assign(new EventEmitter(),{connected:true});
  const a=make(),b=make();
  const wire=(from,to)=>{
    from.send=(message,callback)=>{
      if(!from.connected)throw Object.assign(new Error('closed'),{code:'ERR_IPC_CHANNEL_CLOSED'});
      const copy=structuredClone(message);
      queueMicrotask(()=>{if(to.connected)to.emit('message',copy);});
      callback?.(null);return true;
    };
    from.disconnect=()=>{
      if(!from.connected)return;
      from.connected=false;to.connected=false;
      queueMicrotask(()=>{from.emit('disconnect');to.emit('disconnect');});
    };
  };
  wire(a,b);wire(b,a);
  return [a,b];
}
