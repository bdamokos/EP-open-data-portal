export const MEMBERSHIP_KEY='ep.following.membership.v1';
export const MEMBERSHIP_WINDOW=24*60*60*1000;
const personId=value=>typeof value==='string'&&/^[1-9]\d{0,8}$/.test(value);
const generation=value=>Number.isSafeInteger(value)&&value>0;
const epoch=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function validMembershipEvent(event) {
  return event&&/^\d{1,9}-m-\d{1,12}:(start|end)$/.test(event.id)&&personId(event.mep)&&event.id.split('-m-')[0]===event.mep&&
    generation(event.mark)&&date(event.date)&&((event.type==='mandate-ended'&&event.id.endsWith(':end')&&event.subtype===null)||
      (event.type==='mandate-started'&&event.id.endsWith(':start')&&['joined','returned'].includes(event.subtype)));
}
export function validMembershipSnapshot(value) {
  return value&&epoch(value.epoch)&&generation(value.generation)&&['outgoing','incoming'].every(list=>['fresh','stale','unavailable'].includes(value.lists?.[list]?.status))&&
    Array.isArray(value.events)&&value.events.every(event=>validMembershipEvent(event)&&event.mark<=value.generation)&&value.members&&Object.entries(value.members).every(([id,member])=>personId(id)&&
      ['current','absent'].includes(member.roster)&&['current','former','unverified'].includes(member.status)&&
      (member.status!=='former'||member.roster==='absent'&&date(member.endDate)));
}
export const membershipIsNew=(entry,now)=>entry.readAt===null&&entry.discoveredAt+MEMBERSHIP_WINDOW>now;
export function membershipEntries(state,mep,now) {
  const entries=state.entries.filter(entry=>entry.mep===String(mep)).sort((a,b)=>b.discoveredAt-a.discoveredAt||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {fresh:entries.filter(entry=>membershipIsNew(entry,now)),history:entries.filter(entry=>!membershipIsNew(entry,now))};
}
const empty=()=>({epoch:null,generation:null,availability:{outgoing:false,incoming:false},baselines:{},entries:[],members:{},persistent:true,storageError:false});
function decode(raw) {
  try {
    const value=JSON.parse(raw);
    if(!epoch(value?.epoch)||!generation(value.generation)||!value.baselines||!Array.isArray(value.entries)||!value.members)return null;
    if(!Object.entries(value.baselines).every(([id,b])=>personId(id)&&Number.isFinite(b.savedAt)&&(b.generation===null||generation(b.generation))))return null;
    if(!value.entries.every(entry=>validMembershipEvent(entry)&&entry.kind==='membership'&&Number.isFinite(entry.discoveredAt)&&(entry.readAt===null||Number.isFinite(entry.readAt))))return null;
    const availability={outgoing:!!value.availability?.outgoing,incoming:!!value.availability?.incoming};
    // Persistent status is refreshed from a validated public snapshot, never inferred from entries.
    return {...empty(),...value,availability,members:{},persistent:true,storageError:false};
  } catch {return null;}
}
export function createMembershipStore(storage,notify=()=>{},clock=Date.now) {
  let state=empty();
  try {state=decode(storage?.getItem(MEMBERSHIP_KEY))||state;}catch {state.persistent=false;}
  if(!storage)state.persistent=false;
  const publish=()=>{
    try {if(storage){storage.setItem(MEMBERSHIP_KEY,JSON.stringify(state));state={...state,persistent:true,storageError:false};}}
    catch {state={...state,persistent:false,storageError:true};}
    notify();return !state.storageError;
  };
  const syncFollows=items=>{
    const baselines={};
    for(const item of items.filter(item=>item.kind==='mep')) {
      const previous=state.baselines[item.id],savedAt=item.savedAt||0;
      baselines[item.id]=previous?.savedAt===savedAt?previous:{savedAt,generation:state.generation};
    }
    if(JSON.stringify(baselines)===JSON.stringify(state.baselines))return;
    state={...state,baselines,entries:state.entries.filter(entry=>baselines[entry.mep]&&baselines[entry.mep].savedAt===state.baselines[entry.mep]?.savedAt)};publish();
  };
  return {
    snapshot:()=>state,syncFollows,retryStorage:publish,
    reload(){try {const next=decode(storage?.getItem(MEMBERSHIP_KEY));if(next){state=next;notify();}}catch{}},
    unavailable(){state={...state,availability:{outgoing:false,incoming:false},members:{}};publish();},
    observe(snapshot,items) {
      if(!validMembershipSnapshot(snapshot))return false;
      if(state.epoch===snapshot.epoch&&state.generation>snapshot.generation)return false;
      syncFollows(items);
      const availability=Object.fromEntries(['outgoing','incoming'].map(list=>[list,snapshot.lists[list].status!=='unavailable']));
      const available=Object.values(availability).some(Boolean),reset=state.epoch!==snapshot.epoch||Object.keys(availability).some(list=>availability[list]&&!state.availability[list]);
      const baselines=Object.fromEntries(Object.entries(state.baselines).map(([id,baseline])=>[id,{...baseline,generation:available&&(reset||baseline.generation===null)?snapshot.generation:baseline.generation}]));
      const observed=new Map(snapshot.events.map(event=>[event.mep+':'+event.id,event]));
      const entries=state.entries.map(entry=>({...entry,...observed.get(entry.mep+':'+entry.id)})),known=new Set(entries.map(entry=>entry.mep+':'+entry.id));
      if(available&&!reset)for(const event of snapshot.events) {
        const baseline=baselines[event.mep];
        if(baseline&&event.mark>baseline.generation&&!known.has(event.mep+':'+event.id)) {
          entries.push({...event,kind:'membership',discoveredAt:clock(),readAt:null});known.add(event.mep+':'+event.id);
        }
      }
      state={...state,epoch:snapshot.epoch,generation:snapshot.generation,availability,baselines,entries,members:available?snapshot.members:{}};publish();return true;
    },
    markRead(mep,id) {
      state={...state,entries:state.entries.map(entry=>entry.mep===String(mep)&&(!id||entry.id===id)&&entry.readAt===null?{...entry,readAt:clock()}:entry)};return publish();
    },
  };
}
