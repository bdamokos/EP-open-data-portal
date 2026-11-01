export class DocumentBodyHints {
  constructor(){this.ids=new Map();this.listeners=new Set();}
  enqueue(id,language){
    if(!/^[A-Z0-9-]{1,100}$/.test(id)||typeof language!=='string'||!/^[a-z]{2,3}$/.test(language))return;
    const key=id+':'+language;
    if(this.ids.size>=512&&!this.ids.has(key))return;
    this.ids.set(key,{id,language});for(const listener of this.listeners)listener();
  }
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  drain(){const batch=[...this.ids.values()];this.ids.clear();return batch;}
  get size(){return this.ids.size;}
}
export const documentBodyHints=new DocumentBodyHints();
