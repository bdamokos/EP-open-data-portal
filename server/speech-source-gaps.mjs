// Exact speech IDs the speech list names without a record. A row outlives
// generations; its state changes, not each retry, reach the log.
export const WEBSITE_ACQUISITION='website-xml';
export const WEBSITE_RECHECK_MS=30*86_400_000;
const held=`json_extract(body,'$.acquisition')='${WEBSITE_ACQUISITION}'`;

export function speechSourceGapSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS speech_source_gaps(id TEXT PRIMARY KEY,state TEXT NOT NULL,sitting TEXT NOT NULL,search_window TEXT,http_status INTEGER,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,next_check INTEGER)`);
}
export const websiteSpeechHeld=(store,generation,id)=>Boolean(store.db.prepare(`SELECT 1 FROM sources WHERE generation=? AND key=? AND ${held}`).get(generation,'/speeches/'+id));

// `missing-hit` opens a record, `detail-failed` confirms the API has none.
// Later list reads and retries of an open record only move last_seen.
function nextState(previous,state) {
  if(!state)return previous;
  if(!previous||previous==='resolved'||state==='held-website'||state==='resolved')return state;
  return previous==='missing-hit'&&state==='detail-failed'?state:previous;
}
export function observeSpeechGap(store,{id,state=null,searchWindow,status,at,nextCheck},{log=true}={}) {
  store.assertWriter();
  const old=store.db.prepare('SELECT * FROM speech_source_gaps WHERE id=?').get(id);
  if(!old&&(!state||state==='resolved'))return null;
  const next=nextState(old?.state,state),seen=at||new Date(store.clock()).toISOString();
  const row={id,state:next,sitting:id.slice(7,17),search_window:searchWindow?JSON.stringify(searchWindow):old?.search_window??null,http_status:status??old?.http_status??null,first_seen:old?.first_seen||seen,last_seen:seen,next_check:next==='held-website'?nextCheck??old?.next_check??null:null};
  store.db.prepare('INSERT OR REPLACE INTO speech_source_gaps VALUES (?,?,?,?,?,?,?,?)').run(row.id,row.state,row.sitting,row.search_window,row.http_status,row.first_seen,row.last_seen,row.next_check);
  if(old?.state===next)return null;
  const change={id,state:next,previous:old?.state||null,sittingDate:row.sitting,searchWindow:searchWindow||(old?.search_window?JSON.parse(old.search_window):null),httpStatus:row.http_status,firstSeen:row.first_seen,lastSeen:row.last_seen};
  if(log)logSpeechGapChange(change);
  return change;
}
export const logSpeechGapChange=change=>console.log('[speech-source-gap]',JSON.stringify(change));

// The list only re-reads recent days, so a held record needs its own slow check
// to learn that the API has gained the real one. A failed check opens no gap.
export function scheduleWebsiteRechecks(store,generation) {
  const now=store.clock(),due=store.db.prepare("SELECT id,sitting FROM speech_source_gaps WHERE state='held-website' AND next_check<=?").all(now);
  if(!due.length)return 0;
  store.transaction(()=>{
    store.assertWriter();
    for(const {id,sitting} of due) {
      store.enqueue(generation,'website-recheck:/speeches/'+id,'speeches',{recoveryId:id,websiteRecheck:true,params:{'sitting-date':sitting,'sitting-date-end':sitting},offset:0},50,true);
      store.db.prepare('UPDATE speech_source_gaps SET next_check=? WHERE id=?').run(now+WEBSITE_RECHECK_MS,id);
    }
  });
  return due.length;
}

export function speechSourceGapAudit(db) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='speech_source_gaps'").get())return {state:'unavailable',reason:'table absent'};
  const records=db.prepare('SELECT id,state,sitting,search_window AS searchWindow,http_status AS httpStatus,first_seen AS firstSeen,last_seen AS lastSeen,next_check AS nextCheck FROM speech_source_gaps ORDER BY sitting,id').all().map(row=>({...row,searchWindow:row.searchWindow?JSON.parse(row.searchWindow):null}));
  const count=state=>records.filter(row=>row.state===state).length;
  return {state:'observed',count:records.length-count('resolved'),missingFromApi:count('missing-hit')+count('detail-failed'),heldFromWebsite:count('held-website'),resolved:count('resolved'),records};
}
