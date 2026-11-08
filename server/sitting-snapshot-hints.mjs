export const SITTING_HINT_LIMIT=512;

// Foreground readers submit IDs only. The leased index writer drains these
// bounded hints; normal calendar discovery also recovers them after a restart.
export class SittingSnapshotHints {
  constructor(){this.ids=new Map();this.listeners=new Set();}
  enqueue(kind,version,id,{changedDeclarations=false}={}){
    const key=JSON.stringify([kind,version,id]);
    if(this.ids.has(key)||this.ids.size<SITTING_HINT_LIMIT){
      this.ids.set(key,{kind,version,id,changedDeclarations:changedDeclarations||Boolean(this.ids.get(key)?.changedDeclarations)});
      for(const listener of this.listeners)listener();
    }
  }
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  drain(){const hints=[...this.ids.values()];this.ids.clear();return hints;}
  get size(){return this.ids.size;}
}
export const sittingSnapshotHints=new SittingSnapshotHints();
