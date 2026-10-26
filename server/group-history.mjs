import {ODP_BASE,readCachedMepRecord} from './odp.mjs';
import {membershipPersons,membershipLists} from './following-membership.mjs';

export const GROUP_HISTORY_VERSION=2;
const DAY=86_400_000,TTL=7*DAY;
const classification='def/ep-entities/EU_POLITICAL_GROUP';
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const next=value=>new Date(Date.parse(value)+DAY).toISOString().slice(0,10);
const end=value=>value||'9999-12-31';
export function groupHistorySchema(db) {
  db.exec('CREATE TABLE IF NOT EXISTS group_history_snapshots(generation INTEGER PRIMARY KEY,body TEXT NOT NULL)');
}
export function projectGroupHistory(person,mapping) {
  if(!person||!Array.isArray(person.hasMembership))throw Error('Invalid group history person.');
  const parsed=membershipPersons([{...person,hasMembership:person.hasMembership.filter(membership=>membership?.organization==='org/ep-10'&&membership?.role==='def/ep-roles/MEMBER_PARLIAMENT')}]),mandates=parsed.mandates.map(({id,start,end})=>({id,start,end})).sort((a,b)=>a.start.localeCompare(b.start));
  let malformed=parsed.malformed;
  const periods=[];
  for(const membership of person.hasMembership) {
    if(membership?.membershipClassification!==classification)continue;
    const period=membership.memberDuring,org=membership.organization;
    if(typeof membership.identifier!=='string'||!new RegExp('^'+person.identifier+'-[mf]-[0-9]+$').test(membership.identifier)||!/^org\/\d+$/.test(org||'')||!validDate(period?.startDate)||period.endDate!=null&&(!validDate(period.endDate)||period.endDate<period.startDate)){malformed++;continue;}
    for(const mandate of mandates) {
      const start=[period.startDate,mandate.start,'2024-07-16'].sort().at(-1),last=[end(period.endDate),end(mandate.end)].sort()[0];
      if(start<=last)periods.push({org,groupId:mapping[org]?.groupId||null,code:mapping[org]?.code||null,start,end:last==='9999-12-31'?null:last,membershipIds:[membership.identifier]});
    }
  }
  // Merge role changes within one organization; never bridge a mandate gap.
  const groups=[];
  for(const period of periods.sort((a,b)=>a.org.localeCompare(b.org)||a.start.localeCompare(b.start))) {
    const prior=groups.at(-1);
    if(prior?.org===period.org&&(!prior.end||period.start<=next(prior.end))) {
      prior.end=end(prior.end)>=end(period.end)?prior.end:period.end;
      prior.membershipIds=[...new Set([...prior.membershipIds,...period.membershipIds])];
    }else groups.push({...period});
  }
  groups.sort((a,b)=>a.start.localeCompare(b.start)||a.org.localeCompare(b.org));
  const ambiguous=[];
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++) {
    const a=groups[i],b=groups[j],start=[a.start,b.start].sort().at(-1),last=[end(a.end),end(b.end)].sort()[0];
    if(a.org!==b.org&&start<=last)ambiguous.push({start,end:last==='9999-12-31'?null:last,organizations:[a.org,b.org]});
  }
  let complete=mandates.length>0&&!malformed&&!ambiguous.length&&groups.every(group=>group.groupId&&group.code);
  for(const mandate of mandates) {
    let cursor=mandate.start,covered=false;
    for(const group of groups.filter(group=>group.start<=end(mandate.end)&&end(group.end)>=mandate.start)) {
      if(group.start>cursor)complete=false;
      if(end(group.end)>=end(mandate.end)){covered=true;break;}
      if(group.end>=cursor)cursor=next(group.end);
    }
    if(!covered)complete=false;
  }
  return {coverage:complete?'complete':'partial',mandateCoverage:mandates.length&&!parsed.malformed?'complete':'partial',mandates,groups,ambiguous,malformed};
}
export function groupEvents(mep,person,today) {
  const events=[];
  const continuous=[];
  for(const mandate of person.mandates) {
    const prior=continuous.at(-1);
    if(prior&&(!prior.end||mandate.start<=next(prior.end)))prior.end=end(prior.end)>=end(mandate.end)?prior.end:mandate.end;
    else continuous.push({...mandate});
  }
  for(const mandate of continuous) {
    const groups=person.groups.filter(group=>group.start>=mandate.start&&group.start<=end(mandate.end));
    for(let i=1;i<groups.length;i++) {
      const to=groups[i],from=groups[i-1];
      if(to.start>today||!from.end||next(from.end)!==to.start||from.org===to.org||!from.code||!to.code||!to.groupId)continue;
      if(person.ambiguous.some(period=>period.start<=to.start&&end(period.end)>=from.end))continue;
      events.push({id:`${mep}:group:${to.start}:${to.org.slice(4)}`,mep,type:'group-changed',date:to.start,from:{org:from.org,groupId:from.groupId,code:from.code},to:{org:to.org,groupId:to.groupId,code:to.code}});
    }
  }
  return events;
}
export function groupHistorySnapshot(store,generation) {
  const row=store.db.prepare('SELECT body FROM group_history_snapshots WHERE generation=?').get(generation);
  return row?JSON.parse(row.body):null;
}
export function scheduleGroupHistory(store,generation,prefix='') {
  store.enqueue(generation,prefix+'group-history:catalogue','group-history-catalogue',{offset:0,rows:[],sources:[]},108);
  store.enqueue(generation,prefix+'group-history:discover','group-history-discover',{},106);
}
function people(store,generation) {
  const ids=new Set(store.source(generation,'group-history:known-people')?.work.ids||[]);
  for(const row of store.db.prepare('SELECT id FROM members').all())ids.add(row.id);
  // A later roster/list omission cannot erase a known term-10 person's history.
  for(const row of store.db.prepare("SELECT key FROM sources WHERE generation=? AND kind='group-history'").all(generation))ids.add(row.key.slice('group-history:'.length));
  for(const list of membershipLists)for(const mandate of store.source(generation,'membership:'+list)?.work.mandates||[])ids.add(mandate.mep);
  return [...ids];
}
// Called inside discovery/publication transactions, independently of acquisition.
function rememberPeople(store,generation,ids) {
  store.assertWriter();
  store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,'group-history:known-people','group-history-known-people',JSON.stringify({ids}),new Date(store.clock()).toISOString());
}
const timestamp=value=>typeof value==='number'?new Date(value).toISOString():value;
export async function groupHistoryTask(worker,task) {
  const {store}=worker,{generation,body,kind}=task;
  if(kind==='group-history-discover') {
    // Missing/oldest observations lead each cycle, so cold acquisition progresses
    // rather than repeatedly using its allowance on the same current members.
    const known=people(store,generation),latest=store.db.prepare('SELECT date FROM items INDEXED BY item_lookup WHERE generation=? AND mep=? ORDER BY date DESC LIMIT 1');
    const recent=new Map(known.map(id=>[id,latest.get(store.get('active')||generation,id)?.date||'']));
    const ids=known.sort((a,b)=>(Date.parse(store.source(generation,'group-history:'+a+':attempt')?.work.lastAttemptAt||store.source(generation,'group-history:'+a)?.fetchedAt)||0)-(Date.parse(store.source(generation,'group-history:'+b+':attempt')?.work.lastAttemptAt||store.source(generation,'group-history:'+b)?.fetchedAt)||0)||(recent.get(b)||'').localeCompare(recent.get(a)||'')||Number(a)-Number(b));
    store.transaction(()=>{
      rememberPeople(store,generation,ids);
      ids.forEach((id,index)=>store.enqueue(generation,'group-history:'+id,'group-history-person',{id},105-index/10000,true));
    });
    store.finishTask(task);return;
  }
  const key=kind==='group-history-person'?'group-history:'+body.id:kind==='group-history-body'?'group-body:'+body.id:'group-history:catalogue';
  try {
    if(kind==='group-history-catalogue') {
      const prior=store.source(generation,key);
      if(prior&&worker.clock()-Date.parse(prior.fetchedAt)<DAY){
        for(const org of prior.work.organizations)store.enqueue(generation,'group-body:'+org.id.slice(4),'group-history-body',{id:org.id.slice(4),code:org.label},107);
        store.finishTask(task);return;
      }
      const record=await worker.request('/corporate-bodies/show-current',{limit:1000,offset:body.offset});
      const rows=record.payload?.data;
      if(!Array.isArray(rows)||rows.length>1000)throw Error('Invalid corporate bodies catalogue.');
      const signature=JSON.stringify(rows.map(row=>row.id));
      if(rows.length&&signature===body.lastPage)throw Error('Corporate bodies pagination repeated a page.');
      const sources=[...body.sources,{url:record.url,retrievedAt:timestamp(record.fetchedAt)}],all=[...body.rows,...rows];
      if(rows.length===1000){store.taskProgress(task,{offset:body.offset+rows.length,rows:all,sources,lastPage:signature});return;}
      const organizations=all.filter(row=>row.classification===classification&&/^org\/\d+$/.test(row.id||''));
      if(!organizations.length)throw Error('No political groups in corporate bodies catalogue.');
      store.putSource(generation,key,'group-catalogue',{organizations,sources},timestamp(record.fetchedAt));
      // show-current provides codes but omits isVersionOf. Resolve exact body IDs.
      for(const org of organizations)store.enqueue(generation,'group-body:'+org.id.slice(4),'group-history-body',{id:org.id.slice(4),code:org.label},107);
    }else if(kind==='group-history-body') {
      const prior=store.source(generation,key);
      if(prior&&worker.clock()-Date.parse(prior.fetchedAt)<DAY){store.finishTask(task);return;}
      const record=await worker.request('/corporate-bodies/'+body.id),org=record.payload?.data.find(row=>row.id==='org/'+body.id);
      if(!org||org.classification!==classification||!/^org\/[A-Z0-9_-]+$/.test(org.isVersionOf||'')||typeof body.code!=='string'||!body.code)throw Error('Invalid political group identity.');
      store.putSource(generation,key,'group-body',{org:org.id,groupId:org.isVersionOf,code:body.code,url:record.url,retrievedAt:timestamp(record.fetchedAt)},timestamp(record.fetchedAt));
    }else {
      const prior=store.source(generation,key);
      let record=await (worker.readCachedMepRecord||readCachedMepRecord)(body.id,{now:worker.clock(),signal:worker.controller.signal});
      if(!record&&prior&&worker.clock()-Date.parse(prior.fetchedAt)<TTL){store.finishTask(task);return;}
      if(!record) {
        const cycle=store.get('working');
        if(!cycle||cycle.generation!==generation)throw Error('Group history acquisition requires a working generation.');
        if((cycle.groupHistoryRefetches||0)>=150){store.finishTask(task);return;}
        store.updateCycle({groupHistoryRefetches:(cycle.groupHistoryRefetches||0)+1});
        record=await worker.request('/meps/'+body.id);
      }
      const person=record.payload?.data.find(row=>row.identifier===body.id);
      if(!person)throw Error('Missing exact group history person.');
      const mapping=Object.fromEntries(store.sources(generation,'group-body').map(source=>[source.work.org,source.work]));
      const observation=projectGroupHistory(person,mapping);
      store.putSource(generation,key,'group-history',{...observation,generation,url:record.url,retrievedAt:timestamp(record.fetchedAt)},timestamp(record.fetchedAt));
    }
    store.putSource(generation,key+':attempt','group-history-attempt',{generation,lastError:null,lastAttemptAt:new Date(worker.clock()).toISOString()},new Date(worker.clock()).toISOString());
    store.finishTask(task);
  }catch(error) {
    if(worker.stopped||worker.controller.signal.aborted)throw error;
    const at=new Date(worker.clock()).toISOString();
    store.putSource(generation,key+':attempt','group-history-attempt',{generation,lastError:String(error.message).replace(/[\r\n]+/g,' ').slice(0,240),lastAttemptAt:at},at);
    store.finishTask(task);
  }
}
export function freezeGroupHistory(store,generation,previous,{sourceGeneration=generation,publication=null,people:boundPeople=null}={}) {
  const prior=previous?groupHistorySnapshot(store,previous):null,members={},events=new Map((prior?.events||[]).map(event=>[event.id,event]));
  const today=publication?.asOf||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(store.clock()));
  const mark=store.db.prepare('INSERT OR IGNORE INTO membership_marks VALUES (?,?)'),read=store.db.prepare('SELECT mark FROM membership_marks WHERE event_id=?');
  const ids=boundPeople?[...boundPeople]:people(store,sourceGeneration);
  // Binding an older snapshot must not discard newer failed/deferred people
  // from the working generation's durable discovery set.
  rememberPeople(store,sourceGeneration,boundPeople?[...new Set([...people(store,sourceGeneration),...ids])]:ids);
  for(const id of ids) {
    const source=store.source(sourceGeneration,'group-history:'+id)?.work,attempt=store.source(sourceGeneration,'group-history:'+id+':attempt')?.work;
    const stale=!!source&&(source.generation!==sourceGeneration||!!attempt?.lastError);
    const person=source?{...source,stale,lastError:attempt?.lastError||null,lastAttemptAt:attempt?.lastAttemptAt||source.retrievedAt}:{coverage:'unavailable',mandateCoverage:'unavailable',mandates:[],groups:[],ambiguous:[],stale:false,lastError:attempt?.lastError||null,lastAttemptAt:attempt?.lastAttemptAt||null};
    if(publication?.asOf)for(const key of ['mandates','groups','ambiguous'])person[key]=person[key].filter(period=>period.start<=today).map(period=>({...period,end:!period.end||period.end>today?today:period.end}));
    members[id]=person;
    const current=source?groupEvents(id,person,today):[];
    if(source?.coverage==='complete'&&!stale)for(const [key,event]of events)if(event.mep===id)events.delete(key);
    for(const event of current){mark.run(event.id,generation);events.set(event.id,{...event,mark:read.get(event.id).mark});}
  }
  const coverage={total:Object.keys(members).length,complete:Object.values(members).filter(person=>person.coverage==='complete').length,partial:Object.values(members).filter(person=>person.coverage==='partial').length,unavailable:Object.values(members).filter(person=>person.coverage==='unavailable').length};
  const catalogue=store.source(sourceGeneration,'group-history:catalogue');
  const body={...(publication?{publication}:{}),members,events:[...events.values()],coverage,catalogue:{retrievedAt:catalogue?.fetchedAt||null,sources:catalogue?.work.sources||[],bodies:store.sources(sourceGeneration,'group-body').map(source=>source.work)}};
  store.db.prepare('INSERT OR REPLACE INTO group_history_snapshots VALUES (?,?)').run(generation,JSON.stringify(body));
}
