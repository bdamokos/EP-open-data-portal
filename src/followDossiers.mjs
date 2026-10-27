import {compactEntries,followEntries,isNewEntry,itemHasNew,markAllRead,markEntryRead} from './followUpdates.mjs';
export const DOSSIERS_KEY='ep.following.dossiers.v1';
export const dossierReference=value=>typeof value==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(value);
export const dossierHref=(reference,language='en')=>'?'+new URLSearchParams({view:'legislation','pl-mode':'dossier','dossier-ref':reference,lang:language});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const at=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;
const identity=entry=>entry.id;
const cleanEntry=entry=>entry&&typeof entry.id==='string'&&entry.id.length<=700&&typeof entry.title==='string'&&typeof entry.eventKind==='string'?{...entry,kind:'activity',title:entry.title.slice(0,700)}:null;
function compact(item,now) {
  const result=compactEntries(item.entries||[],now),kept=new Set(result.entries.map(identity));
  const dropped=(item.entries||[]).filter(entry=>isNewEntry(entry,now)&&!kept.has(identity(entry)));
  const omittedFresh=item.unreadOmittedAt+24*3600_000>now;
  return {...item,...result,historyOmitted:(item.historyOmitted||0)+result.historyOmitted,unreadOmitted:(omittedFresh?item.unreadOmitted||0:0)+dropped.length,unreadOmittedAt:dropped.length?now:omittedFresh?item.unreadOmittedAt:undefined};
}
const freshSource=source=>source&&at(source.fetchedAt)!==null&&!source.stale&&!source.refreshError;

export function createDossiersStore(storage,notify=()=>{},clock=Date.now) {
  let items=[],persistent=Boolean(storage),storageError=false,restarted=false,snapshot;
  const refresh=()=>{snapshot={items,persistent,storageError,restarted};notify();};
  const publish=()=>{items=items.map(item=>compact(item,clock()));if(persistent)try{storage.setItem(DOSSIERS_KEY,JSON.stringify({version:1,items}));storageError=false;}catch{storageError=true;}refresh();return !storageError;};
  function load() {
    try {
      const raw=JSON.parse(storage?.getItem(DOSSIERS_KEY)||'null'),seen=new Set();
      items=raw?.version===1&&Array.isArray(raw.items)?raw.items.filter(item=>item&&dossierReference(item.id)&&!seen.has(item.id)&&seen.add(item.id)).slice(0,50).map(item=>compact({...item,title:String(item.title||item.id).slice(0,700),savedAt:Number.isFinite(item.savedAt)?item.savedAt:clock(),entries:(item.entries||[]).map(cleanEntry).filter(Boolean).filter(entry=>Number.isFinite(entry.discoveredAt)&&(entry.readAt===null||Number.isFinite(entry.readAt))),gaps:item.gaps&&typeof item.gaps==='object'?item.gaps:{},observations:item.observations&&typeof item.observations==='object'?item.observations:{}},clock())):[];
    }catch{persistent=false;}refresh();
  }
  const update=(id,expected,change)=>{
    items=items.map(item=>item.id===id&&(!expected||item.savedAt===expected.savedAt)?change(item):item);return publish();
  };
  const add=(item,entries)=>{
    const existing=new Map(item.entries.map(entry=>[entry.id,entry]));
    for(const value of entries){const entry=cleanEntry(value);if(entry&&!existing.has(entry.id))existing.set(entry.id,{...entry,discoveredAt:clock(),readAt:null});}
    return {...item,entries:[...existing.values()]};
  };
  const observation=(id,expected,source,read)=>update(id,expected,item=>{
    const result=read(item,item.observations[source]);
    if(!result)return {...item,gaps:{...item.gaps,[source]:true}};
    if(result.ignore)return item;
    return {...add(item,result.entries||[]),...(result.title?{title:result.title,titleLanguage:result.titleLanguage}:{}),observations:{...item.observations,[source]:result.baseline},gaps:{...item.gaps,[source]:Boolean(result.partial)},checkedAt:clock()};
  });
  load();let serial=Math.max(clock(),...items.map(item=>item.savedAt));
  return {
    snapshot:()=>snapshot,reload(){if(!storageError)load();},retryStorage:publish,
    toggle({id,title=id,titleLanguage=null}) {
      if(!dossierReference(id))throw Error('Choose an official procedure reference.');
      const previous=items;
      if(items.some(item=>item.id===id))items=items.filter(item=>item.id!==id);
      else {if(items.length>=50)throw Error('You can follow up to 50 dossiers.');items=[...items,{kind:'dossier',id,title,titleLanguage,savedAt:serial=Math.max(clock(),serial+1),entries:[],observations:{},gaps:{}}];}
      if(!publish()){items=previous;publish();throw Error("Couldn't save this follow in your browser.");}
    },
    unavailable(id,expected,source){return update(id,expected,item=>({...item,gaps:{...item.gaps,[source]:true}}));},
    observeIndex(data,expected) {
      if(!data||typeof data.epoch!=='string'||!integer(data.generation)||!Array.isArray(data.items))return false;
      for(const row of data.items)if(expected.some(item=>item.id===row.reference))observation(row.reference,expected.find(item=>item.id===row.reference),'index',(item,old)=>{
        if(!expected.some(value=>value.id===item.id)||row.status!=='available'||row.limited||!Array.isArray(row.entries)||row.entries.some(entry=>!cleanEntry(entry)||!integer(entry.mark)))return null;
        if(old?.epoch===data.epoch&&old.generation>data.generation)return {ignore:true};
        const reset=old&&old.epoch!==data.epoch;if(reset)restarted=true;
        return {baseline:{epoch:data.epoch,generation:data.generation},entries:old&&!reset?row.entries.filter(entry=>entry.mark>old.generation):[],title:row.title,titleLanguage:row.titleLanguage,partial:!data.indexComplete};
      });return true;
    },
    observeProgress(id,data,expected) {return observation(id,expected,'progress',(item,old)=>{
      if(data?.reference!==id||data.basis==='oeil'||data.state!=='mapped'||data.coverage?.limited||data.coverage?.invalidRows||!freshSource(data.source)||!Array.isArray(data.events)||data.events.some(event=>event.issues?.some(issue=>['date','status','type'].includes(issue))))return null;
      const fetched=at(data.source.fetchedAt);if(old&&fetched<=old.at)return {ignore:true};
      const known={...old?.known},entries=[];
      for(const event of data.events) {
        const fingerprint=JSON.stringify([event.status,event.date,event.statuses?.map(status=>status.code).sort()||[]]),previous=known[event.id];
        if(old&&previous!==fingerprint)entries.push({id:'progress:'+event.id+':'+fingerprint,eventKind:'progress',title:event.label||'Legislative progress',titleLanguage:event.labelLanguage||'en',date:event.date||'',previousDate:previous?JSON.parse(previous)[1]:undefined,change:previous?event.status==='cancelled'?'cancelled':JSON.parse(previous)[1]!==event.date?'date':'status':event.status==='projected'?'scheduled':event.status==='cancelled'?'cancelled':'event',source:data.source});
        known[event.id]=fingerprint;
      }
      return {baseline:{at:fetched,known},entries};
    });},
    observePress(id,data,expected) {
      observation(id,expected,'oeil',(item,old)=>{
        const dossier=data?.dossier;if(data?.reference!==id||!dossier||!freshSource(dossier.source))return null;
        const fetched=at(dossier.source.fetchedAt);if(old&&fetched<=old.at)return {ignore:true};
        const known={...old?.known},entries=[];
        for(const summary of dossier.summaries||[]) {
          const key='summary:'+summary.id;if(old&&!known[key])entries.push({id:key,eventKind:'summary',title:'Dossier summary',titleLanguage:'en',date:summary.date||'',summaryId:summary.id,source:{url:summary.url,fetchedAt:dossier.source.fetchedAt}});known[key]=true;
        }
        // Indexed documents already have durable publication marks. OEIL adds
        // summaries only, so the same document is never announced twice.
        return {baseline:{at:fetched,known},entries,title:dossier.title,titleLanguage:dossier.language};
      });
      return observation(id,expected,'press',(item,old)=>{
        if(data?.reference!==id||data.limited||!integer(data.watermark)||!data.coverage?.followingSince||!freshSource(data.dossier?.source)||data.coverage.procedureLinks?.status!=='available'||!Array.isArray(data.items)||data.items.some(entry=>!integer(entry.linkedAt)))return null;
        const since=data.coverage.followingSince,baseline=old?.since===since&&Array.isArray(old.known)?old:null;
        if(baseline&&data.watermark<baseline.mark)return {ignore:true};
        if(old&&old.since&&old.since!==since)restarted=true;
        const known=new Set(baseline?.known),added=baseline?data.items.filter(entry=>!known.has(entry.id)):[];
        for(const entry of data.items)known.add(entry.id);
        return {baseline:{mark:data.watermark,since,known:[...known]},entries:added.map(entry=>({id:'press:'+entry.id,eventKind:'press',title:entry.title||entry.id,titleLanguage:entry.titleLanguage||'en',date:entry.publishedAt?.slice(0,10)||'',url:entry.url,source:{url:entry.url,fetchedAt:entry.fetchedAt}})),partial:data.coverage.feeds?.some(feed=>!feed.lastSuccessAt||feed.lastError)||data.coverage.unreadableReleases>0};
      });
    },
    markRead(id){return update(id,null,item=>({...item,entries:markAllRead(item.entries,clock()),unreadOmitted:0}));},
    markEntryRead(id,entryId){return update(id,null,item=>({...item,entries:markEntryRead(item.entries,'activity',entryId,clock())}));},
    finishCheck(id,expected){return update(id,expected,item=>({...item,lastAttempt:clock()}));},
  };
}
export {followEntries,itemHasNew};
