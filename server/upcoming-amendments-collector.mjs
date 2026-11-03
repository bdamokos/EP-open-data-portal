import {SittingSnapshotReader,SITTING_CALENDAR_VERSION} from './sitting-snapshot-store.mjs';
import {activePlenaryWindow,plenaryWindowEnd} from './plenary-window.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {agendaTopics} from './insights-legislation-model.mjs';
import {amendmentTask,failAmendmentTask} from './amendments-worker.mjs';
const HOUR=3600000;
const windowCache=new WeakMap();
export function upcomingWindow(worker) {
  if(!worker.store.db)return null;
  const now=worker.clock(),hour=Math.floor(now/HOUR),cached=windowCache.get(worker);
  // Brussels boundaries fall on whole UTC hours, including across DST. Cache
  // inactive windows too; a newly retained calendar becomes visible next hour.
  if(cached?.hour===hour)return cached.window;
  const year=Number(brusselsDay(now).slice(0,4)),reader=new SittingSnapshotReader({db:worker.store.db});
  const nodes=[year-1,year,year+1].flatMap(y=>reader.read('calendar',SITTING_CALENDAR_VERSION,String(y),{retained:true})?.nodes||[]);
  const window=activePlenaryWindow(nodes,now);
  windowCache.set(worker,{hour,window});
  return window;
}
export function upcomingRefreshDue(worker) {
  if(!worker.store.db||!upcomingWindow(worker))return false;
  return Number(worker.store.get('upcoming:next')||0)<=worker.clock();
}
export async function collectUpcomingAmendments(worker,{window=upcomingWindow(worker)}={}) {
  if(!worker.store.db)return false;
  if(!window)return false;
  const store=worker.store,generation=store.get('working')?.generation||store.get('active');if(!generation||store.generationTaskActive)return false;
  const now=worker.clock();if(Number(store.get('upcoming:next')||0)>now)return false;
  const saved=store.source(generation,'upcoming:agenda')?.work||{},state=saved.window===window.first?saved:{window:window.first,items:[],checked:{}};
  const persist=()=>store.putSource(generation,'upcoming:agenda','upcoming-agenda',state,new Date(now).toISOString());
  // One staged sitting read, then its foreseen activities. No historical backlog.
  const sitting=window.sittingIds.find(id=>now-Number(state.checked[id]||0)>=HOUR);
  if(sitting){
    if(state.meeting?.sitting!==sitting){const record=await worker.request('/meetings/'+sitting);state.meeting={sitting,record};persist();return true;}
    const foreseen=await worker.request('/meetings/'+sitting+'/foreseen-activities');
    state.items=[...state.items.filter(item=>item.date!==sitting.slice(7)),...agendaTopics(state.meeting.record,foreseen).filter(item=>item.kind==='PLENARY_VOTE')];
    state.checked[sitting]=now;delete state.meeting;persist();return true;
  }
  const extract=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind IN ('amendment-extract','amendment-list-detail') AND done=0 AND retry_at<=? AND json_extract(body,'$.upcoming')=1 ORDER BY priority DESC,key LIMIT 1").get(generation,now);
  if(extract){const task={...extract,body:JSON.parse(extract.body),amendmentJob:true};worker.upcomingDocument=task.body.targetDocumentId;worker.upcomingUntil=task.body.upcomingUntil;try{await amendmentTask(worker,task);}catch(error){if(!failAmendmentTask(worker,task,error))store.failTask(task,error);}finally{delete worker.upcomingDocument;delete worker.upcomingUntil;}return true;}
  const documents=[...new Set(state.items.flatMap(item=>item.documentIds).filter(id=>/^(?:A|B|RC)-(?:9|10)-\d{4}-\d{4,6}$/.test(id)))];
  for(const id of documents){
    const key='/plenary-documents/'+id,source=store.source(generation,key);
    if(source&&now-Date.parse(source.fetchedAt)<HOUR)continue;
    // Reuse the canonical task and retry ownership. Its one key coalesces missed
    // hours, including a generation begin that holds the writer for an hour.
    const pending=store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=? AND done<>1').get(generation,key);
    if(pending||now-Number(state.documentChecks?.[id]||0)<HOUR)continue;
    state.documentChecks={...state.documentChecks,[id]:now};persist();
    worker.upcomingDocument=id;worker.upcomingUntil=plenaryWindowEnd(window.last);
    // A direct one-turn canonical read adds no queue entries. Existing pending
    // core reads retain ownership; failures retry once next hour, never pile up.
    try{await worker.task({generation,key,kind:'document',body:{endpoint:key},attempts:0});}
    finally{delete worker.upcomingDocument;delete worker.upcomingUntil;}
    return true;
  }
  store.set('upcoming:next',now+HOUR);return false;
}
