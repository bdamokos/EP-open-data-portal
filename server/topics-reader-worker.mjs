import {groupVoicesPage} from './group-voices-store.mjs';
import {groupVoicesQuery} from './group-voices-model.mjs';
import {workerData,parentPort} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {RecordTopics} from './topics-store.mjs';
const db=new DatabaseSync(workerData.filename,{readOnly:true});
try{db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-4096; BEGIN');const store={db,clock:Date.now,get:key=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'null'),readSnapshot:fn=>fn()};const value=workerData.view==='group-voices'?groupVoicesPage(store,groupVoicesQuery(new URLSearchParams(workerData.params))):new RecordTopics(store).query(new URLSearchParams(workerData.params),workerData.view);db.exec('COMMIT');parentPort.postMessage({value});}catch(e){parentPort.postMessage({error:e.message,status:e.status,code:e.code});}finally{db.close();parentPort.close();}
