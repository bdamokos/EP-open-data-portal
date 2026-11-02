// Build-only scratch storage. Keys and JSON values stay on disk; reads retain
// only the current row. Callers explicitly save mutated values.
export class TopicDiskMap {
 constructor(db,name){
  if(!/^[a-z_]+$/.test(name))throw Error('Invalid scratch name.');
  this.db=db;this.table='topic_scratch_'+name;
  db.exec(`DROP TABLE IF EXISTS temp.${this.table};CREATE TEMP TABLE ${this.table}(key TEXT PRIMARY KEY,body TEXT)`);
  this.read=db.prepare(`SELECT body FROM ${this.table} WHERE key=?`);
  this.present=db.prepare(`SELECT 1 FROM ${this.table} WHERE key=?`);
  this.remove=db.prepare(`DELETE FROM ${this.table} WHERE key=?`);
  this.count=db.prepare(`SELECT COUNT(*) n FROM ${this.table}`);
  this.scan=db.prepare(`SELECT key,body FROM ${this.table} ORDER BY key`);
  this.put=db.prepare(`INSERT INTO ${this.table} VALUES (?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body`);
 }
 get(key){const row=this.read.get(key);return row?JSON.parse(row.body):undefined;}
 delete(key){return Boolean(this.remove.run(key).changes);}
 has(key){return Boolean(this.present.get(key));}
 set(key,value){this.put.run(key,JSON.stringify(value));return this;}
 get size(){return this.count.get().n;}
 *entries(){for(const row of this.scan.iterate())yield [row.key,JSON.parse(row.body)];}
 *values(){for(const [,value] of this.entries())yield value;}
 [Symbol.iterator](){return this.entries();}
 clear(){this.db.exec(`DELETE FROM ${this.table}`);}
}
export async function topicBatches(store,steps,size=100){
 let step;
 do{
  store.transaction(()=>{store.assertWriter();for(let i=0;i<size;i++){step=steps.next();if(step.done)break;}});
  if(!store.renew())throw Error('Activity-index writer lease was lost.');
  await new Promise(setImmediate);
 }while(!step.done);
 return step.value;
}
