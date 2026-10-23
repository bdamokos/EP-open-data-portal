export const GROUPS_KEY='ep.following.groups.v1';
export const GROUPS_WINDOW=86_400_000;
const person=value=>typeof value==='string'&&/^[1-9]\d{0,8}$/.test(value);
const generation=value=>Number.isSafeInteger(value)&&value>0;
const epoch=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const group=value=>value&&/^org\/\d+$/.test(value.org)&&/^org\/[A-Z0-9_-]+$/.test(value.groupId)&&typeof value.code==='string'&&value.code.length>0&&value.code.length<=60;
export function validGroupEvent(value) {
  return value&&person(value.mep)&&date(value.date)&&generation(value.mark)&&value.type==='group-changed'&&group(value.from)&&group(value.to)&&value.from.org!==value.to.org&&value.id===`${value.mep}:group:${value.date}:${value.to.org.slice(4)}`;
}
export function validGroupsSnapshot(value) {
  return value&&epoch(value.epoch)&&generation(value.generation)&&value.members&&typeof value.members==='object'&&!Array.isArray(value.members)&&Object.entries(value.members).every(([id,member])=>person(id)&&['complete','partial','unavailable'].includes(member?.coverage)&&typeof member.stale==='boolean')&&Array.isArray(value.events)&&new Set(value.events.map(event=>event.id)).size===value.events.length&&value.events.every(event=>validGroupEvent(event)&&event.mark<=value.generation&&value.members[event.mep]);
}
export const groupIsNew=(entry,now)=>entry.readAt===null&&entry.discoveredAt+GROUPS_WINDOW>now;
export function groupEntries(state,mep,now) {
  const entries=state.entries.filter(entry=>entry.mep===String(mep)).sort((a,b)=>b.discoveredAt-a.discoveredAt||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {fresh:entries.filter(entry=>groupIsNew(entry,now)),history:entries.filter(entry=>!groupIsNew(entry,now))};
}
const empty=()=>({epoch:null,generation:null,baselines:{},entries:[],persistent:true,storageError:false});
function decode(raw) {
  try {
    const value=JSON.parse(raw);
    if(!epoch(value?.epoch)||!generation(value.generation)||!value.baselines||!Array.isArray(value.entries))return null;
    if(!Object.entries(value.baselines).every(([id,b])=>person(id)&&Number.isFinite(b.savedAt)&&(b.generation===null||generation(b.generation))&&typeof b.available==='boolean'))return null;
    if(!value.entries.every(entry=>validGroupEvent(entry)&&Number.isFinite(entry.discoveredAt)&&(entry.readAt===null||Number.isFinite(entry.readAt))))return null;
    return {...empty(),epoch:value.epoch,generation:value.generation,baselines:value.baselines,entries:value.entries};
  }catch{return null;}
}
export function createGroupsStore(storage,notify=()=>{},clock=Date.now) {
  let state=empty();
  try{state=decode(storage?.getItem(GROUPS_KEY))||state;}catch{state.persistent=false;}
  if(!storage)state.persistent=false;
  const publish=()=>{
    try{if(storage){storage.setItem(GROUPS_KEY,JSON.stringify(state));state={...state,persistent:true,storageError:false};}}
    catch{state={...state,persistent:false,storageError:true};}
    notify();return !state.storageError;
  };
  const syncFollows=items=>{
    const baselines={};
    for(const item of items.filter(item=>item.kind==='mep')) {
      const old=state.baselines[item.id],savedAt=item.savedAt||0;
      baselines[item.id]=old?.savedAt===savedAt?old:{savedAt,generation:null,available:false};
    }
    if(JSON.stringify(baselines)===JSON.stringify(state.baselines))return;
    state={...state,baselines,entries:state.entries.filter(entry=>baselines[entry.mep]&&baselines[entry.mep].savedAt===state.baselines[entry.mep]?.savedAt)};publish();
  };
  return {snapshot:()=>state,syncFollows,retryStorage:publish,
    reload(){try{const next=decode(storage?.getItem(GROUPS_KEY));if(next){state=next;notify();}}catch{}},
    // A validated unavailable observation restarts only that person's baseline.
    // Transport/validation errors do not call this or change durable readiness.
    unavailable(){state={...state,baselines:Object.fromEntries(Object.entries(state.baselines).map(([id,b])=>[id,{...b,available:false}]))};publish();},
    observe(snapshot,items) {
      if(!validGroupsSnapshot(snapshot)||state.epoch===snapshot.epoch&&state.generation>snapshot.generation)return false;
      syncFollows(items);
      const reset=state.epoch!==snapshot.epoch,baselines={};
      for(const [id,baseline]of Object.entries(state.baselines)) {
        const coverage=snapshot.members[id]?.coverage||'unavailable',available=coverage!=='unavailable';
        baselines[id]={...baseline,available,generation:reset||!baseline.available?null:baseline.generation};
        if(coverage==='complete'&&baselines[id].generation===null)baselines[id].generation=snapshot.generation;
      }
      const observed=new Map(snapshot.events.map(event=>[event.id,event]));
      const entries=reset?[]:state.entries.filter(entry=>snapshot.members[entry.mep]?.coverage!=='complete'||snapshot.members[entry.mep]?.stale||observed.has(entry.id)).map(entry=>({...entry,...observed.get(entry.id)}));
      const known=new Set(entries.map(entry=>entry.id));
      for(const event of snapshot.events) {
        const baseline=baselines[event.mep];
        if(!reset&&baseline?.generation!==null&&baseline?.available&&event.mark>baseline.generation&&!known.has(event.id)){entries.push({...event,discoveredAt:clock(),readAt:null});known.add(event.id);}
      }
      state={...state,epoch:snapshot.epoch,generation:snapshot.generation,baselines,entries};publish();return true;
    },
    markRead(mep,id){state={...state,entries:state.entries.map(entry=>entry.mep===String(mep)&&(!id||entry.id===id)&&entry.readAt===null?{...entry,readAt:clock()}:entry)};return publish();},
  };
}
