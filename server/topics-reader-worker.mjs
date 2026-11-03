import {overviewState} from './topics-overview-state.mjs';
import {storyFacts} from './story-facts-reader.mjs';
import {groupVoicesPage} from './group-voices-store.mjs';
import {groupVoicesQuery} from './group-voices-model.mjs';
import {parentPort} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {RecordTopics} from './topics-store.mjs';
// Connections stay open between requests; each request reads one snapshot.
const connections=new Map();
function database(filename){let db=connections.get(filename);if(!db){db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-4096');connections.set(filename,db);}return db;}
parentPort.on('message',({id,filename,view,pressFilename,params,cachedToken})=>{
 let db;
 try{db=database(filename);db.exec('BEGIN');const store={db,clock:Date.now,get:key=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'null'),readSnapshot:fn=>fn()};
  // An overview depends on the published projection, its readiness, coverage and the Brussels date (periods and the day bound), so an unchanged token reuses the caller's copy.
  const token=view==='overview'?overviewState(store).token:null;
  if(token&&token===cachedToken){db.exec('COMMIT');parentPort.postMessage({id,unchanged:true,token});return;}
  const value=view==='story-facts'?storyFacts(store,new URLSearchParams(params),{pressFilename}):view==='group-voices'?groupVoicesPage(store,groupVoicesQuery(new URLSearchParams(params))):new RecordTopics(store).query(new URLSearchParams(params),view);db.exec('COMMIT');parentPort.postMessage({id,value,token});}
 catch(e){try{if(db?.isTransaction)db.exec('ROLLBACK');}catch{/* The next request starts a fresh snapshot. */}parentPort.postMessage({id,error:e.message,status:e.status,code:e.code});}
});
