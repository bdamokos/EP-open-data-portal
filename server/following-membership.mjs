import {ODP_BASE} from './odp.mjs';

export const MEMBERSHIP_VIEW_VERSION=1;
export const membershipLists=['outgoing','incoming'];
export function membershipSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS membership_marks(event_id TEXT PRIMARY KEY,mark INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS membership_snapshots(generation INTEGER PRIMARY KEY,body TEXT NOT NULL);`);
}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function membershipPersons(rows) {
  let malformed=0;
  const mandates=[];
  for(const person of rows) {
    if(!/^[1-9]\d{0,8}$/.test(person?.identifier||'')||!Array.isArray(person.hasMembership)){malformed++;continue;}
    for(const membership of person.hasMembership) {
      if(!membership||typeof membership!=='object'){malformed++;continue;}
      if(membership.organization!=='org/ep-10'||membership.role!=='def/ep-roles/MEMBER_PARLIAMENT')continue;
      const id=membership.identifier,period=membership.memberDuring;
      if(!/^\d{1,9}-m-\d{1,12}$/.test(id||'')||id.split('-m-')[0]!==String(person.identifier)||!validDate(period?.startDate)||
        period.endDate!=null&&(!validDate(period.endDate)||period.endDate<period.startDate)){malformed++;continue;}
      mandates.push({id,mep:String(person.identifier),start:period.startDate,end:period.endDate||null});
    }
  }
  return {mandates,malformed};
}

// One bounded page per worker task; a failed page never publishes a partial list.
export async function membershipTask(worker,task) {
  const {store}=worker,{generation,body}=task,list=body.list,key='membership:'+list;
  try {
    const params={'parliamentary-term':10,limit:100,offset:body.offset};
    const record=await worker.request('/meps/show-'+list,params);
    const rows=record.payload?.data;
    if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid membership list page.');
    const signature=JSON.stringify(rows.map(person=>person?.identifier));
    if(rows.length&&signature===body.lastPage)throw Error('Membership pagination repeated a page.');
    const parsed=membershipPersons(rows),mandates=[...(body.mandates||[]),...parsed.mandates];
    const sources=[...(body.sources||[]),{url:record.url||new URL('/api/v2/meps/show-'+list,ODP_BASE).href,retrievedAt:record.fetchedAt}];
    const observation={generation,mandates,malformed:(body.malformed||0)+parsed.malformed,sources,retrievedAt:record.fetchedAt};
    if(rows.length===100)store.taskProgress(task,{...body,...observation,offset:body.offset+rows.length,lastPage:signature});
    else {store.putSource(generation,key,'membership',observation,record.fetchedAt);store.finishTask(task);}
  } catch(error) {
    // Retain the last complete observation, with its original provenance.
    if(worker.stopped||worker.controller?.signal.aborted)throw error;
    store.assertWriter();store.finishTask(task);
  }
}
export function scheduleMembership(store,generation,prefix='') {
  for(const list of membershipLists)store.enqueue(generation,prefix+'membership:'+list,'membership',{list,offset:0},109);
}
export function membershipSnapshot(store,generation) {
  const row=store.db.prepare('SELECT body FROM membership_snapshots WHERE generation=?').get(generation);
  return row?JSON.parse(row.body):null;
}
export function freezeMembership(store,generation,previous) {
  const db=store.db,prior=previous?membershipSnapshot(store,previous):null;
  const lists={},mandates=new Map(),conflicts=new Set();
  for(const list of membershipLists) {
    const observation=store.source(generation,'membership:'+list)?.work;
    lists[list]={status:observation?(observation.generation===generation?'fresh':'stale'):'unavailable',retrievedAt:observation?.retrievedAt||null,sources:observation?.sources||[],malformed:observation?.malformed||0};
    for(const mandate of observation?.mandates||[]) {
      const old=mandates.get(mandate.id);
      if(old&&JSON.stringify(old)!==JSON.stringify(mandate))conflicts.add(mandate.mep);
      mandates.set(mandate.id,mandate);
    }
  }
  const events=new Map((prior?.events||[]).map(event=>[event.id,event]));
  const mark=db.prepare('INSERT OR IGNORE INTO membership_marks VALUES (?,?)'),read=db.prepare('SELECT mark FROM membership_marks WHERE event_id=?');
  for(const mandate of mandates.values()) {
    const boundaries=[...(mandate.end?[['end','mandate-ended',null,mandate.end]]:[]),...(mandate.start>'2024-07-16'?[['start','mandate-started',[...mandates.values()].some(earlier=>earlier.mep===mandate.mep&&earlier.end&&earlier.end<mandate.start)?'returned':'joined',mandate.start]]:[])];
    for(const [boundary,type,subtype,date] of boundaries) {
      const id=mandate.id+':'+boundary;mark.run(id,generation);
      events.set(id,{id,mep:mandate.mep,type,subtype,date,mark:read.get(id).mark});
    }
  }
  const members={};
  for(const mep of new Set([...events.values()].map(event=>event.mep))) {
    const ordered=[...mandates.values()].filter(mandate=>mandate.mep===mep).sort((a,b)=>b.start.localeCompare(a.start));
    const latest=ordered[0];
    if(ordered.some(mandate=>mandate.start===latest.start&&mandate.end!==latest.end))conflicts.add(mep);
    const roster=db.prepare('SELECT 1 FROM members WHERE id=?').get(mep)?'current':'absent';
    const status=!latest||conflicts.has(mep)?'unverified':latest.end&&roster==='absent'?'former':!latest.end&&roster==='current'?'current':'unverified';
    members[mep]={roster,status,endDate:status==='former'?latest.end:null};
  }
  const body={lists,events:[...events.values()].map(event=>({...event,...members[event.mep]})),members};
  db.prepare('INSERT OR REPLACE INTO membership_snapshots VALUES (?,?)').run(generation,JSON.stringify(body));
}
