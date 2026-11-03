// Public source-derived responses only. Choices never enter a key or value.
export class BallotResponseCache {
  constructor({clock=Date.now,maxEntries=24,maxBytes=8*1024*1024,ttl=60_000}={}){Object.assign(this,{clock,maxEntries,maxBytes,ttl});this.entries=new Map();this.bytes=0;}
  get(key){const value=this.entries.get(key);if(value&&this.clock()-value.at<this.ttl)return value.body;if(value)this.delete(key);return null;}
  delete(key){const entry=this.entries.get(key);if(entry){this.bytes-=entry.size;this.entries.delete(key);}}
  set(key,body){const size=Buffer.byteLength(JSON.stringify(body));this.delete(key);if(size>this.maxBytes)return;this.entries.set(key,{body,at:this.clock(),size});this.bytes+=size;while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes)this.delete(this.entries.keys().next().value);}
}
const caches=new WeakMap();
export function ballotResponseCache(store){if(!store)return null;if(!caches.has(store))caches.set(store,new BallotResponseCache());return caches.get(store);}
