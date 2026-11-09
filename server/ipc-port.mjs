import {EventEmitter} from 'node:events';

// A MessagePort-shaped view of one channel on a child-process IPC link, so the
// existing worker-thread protocols (upstream admission, source retention, writer
// hints) run unchanged between the front and API processes. Both ends call
// ipcPort(process-or-child, channel). The link must use 'advanced' serialization
// so retained bodies travel as bytes.
const TAG='explorer-ipc';
export function ipcPort(link,channel) {
  const port=new EventEmitter();let closed=false;
  const receive=envelope=>{
    if(closed||envelope?.[TAG]!==channel)return;
    port.emit('message',envelope.message);
  };
  const detach=()=>{link.off('message',receive);link.off('disconnect',close);link.off('exit',close);};
  function close() {
    if(closed)return;
    closed=true;detach();port.emit('close');
  }
  port.postMessage=message=>{
    if(closed||link.connected===false)return;
    try {link.send({[TAG]:channel,message},error=>{if(error&&!link.connected)close();});}
    catch{/* A link that is going away closes the port on 'disconnect'. */}
  };
  port.close=close;
  port.unref=()=>port;port.ref=()=>port;
  link.on('message',receive);link.once('disconnect',close);link.once('exit',close);
  return port;
}
