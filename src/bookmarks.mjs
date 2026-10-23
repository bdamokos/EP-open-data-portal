export const LEGACY_KEY='ep.bookmarks.v1';
export const SAVED_KEY='ep.following.v2';
export const savedKey=item=>item.kind+':'+item.id;
const valid=item=>item&&((item.kind==='mep'&&/^[1-9]\d{0,8}$/.test(item.id))||(item.kind==='question'&&/^[EPHO]-10-\d{4}-\d{6}$/.test(item.id)));
const validSource=id=>typeof id==='string'&&/^[A-Za-z0-9-]{1,180}$/.test(id);
const cleanIds=(values,limit=Infinity)=>Array.isArray(values)?[...new Set(values.filter(validSource))].slice(0,limit):[];
const titleLanguage=source=>typeof source?.titleLanguage==='string'?source.titleLanguage:null;
const cleanState=state=>state&&typeof state==='object'?{activityVersion:state.activityVersion===3?3:undefined,revision:typeof state.revision==='string'?state.revision.slice(0,128):undefined,answerIds:cleanIds(state.answerIds),activityIdsComplete:state.activityIdsComplete===true,latestIds:cleanIds(state.latestIds),total:Number.isSafeInteger(state.total)&&state.total>=0?state.total:0}:undefined;
const cleanEntries=(entries,limit=Infinity)=>Array.isArray(entries)?entries.filter(x=>x&&validSource(x.id)).slice(0,limit).map(x=>({id:x.id,date:/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')?x.date:'',title:String(x.title||(validSource(x.relatedQuestionId)?'Question '+x.relatedQuestionId:x.id)).slice(0,700),titleLanguage:x.title?titleLanguage(x):validSource(x.relatedQuestionId)?'en':null,recordKind:x.recordKind==='answer'?'answer':undefined,...(validSource(x.relatedQuestionId)?{relatedQuestionId:x.relatedQuestionId}:{})})):[];
export function readSaved(raw) {
  try{const parsed=JSON.parse(raw);if(parsed?.version!==1||!Array.isArray(parsed.items))return [];
    const seen=new Set(),counts={mep:0,question:0},result=[];
    for(const item of parsed.items.slice(0,2200)){if(!valid(item)||seen.has(savedKey(item))||counts[item.kind]>=(item.kind==='mep'?1000:100))continue;seen.add(savedKey(item));counts[item.kind]++;
      result.push({kind:item.kind,id:String(item.id),title:String(item.title||item.id).slice(0,700),titleLanguage:item.title?titleLanguage(item):null,memberId:/^[1-9]\d{0,8}$/.test(item.memberId)?String(item.memberId):null,date:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:null,savedAt:Number.isFinite(item.savedAt)?item.savedAt:undefined,checkedAt:Number.isFinite(item.checkedAt)?item.checkedAt:undefined,updated:item.updated===true,newAnswer:item.newAnswer===true,newActivity:item.newActivity===true,availability:['available','not-saved','outside-roster'].includes(item.availability)?item.availability:undefined,baseline:cleanState(item.baseline),current:cleanState(item.current),latest:cleanEntries(item.latest,10),unreadAnswers:cleanEntries(item.unreadAnswers),unreadActivities:cleanEntries(item.unreadActivities),indexComplete:item.indexComplete===true});
    }return result;
  }catch{return [];}
}
// Questions retain revision-based detection and their exact answer-ID baseline.
export function savedObservation(item,state) {
  if(state.status!=='available')return {...item,availability:state.status,checkedAt:Date.now()};
  const previous=item.baseline,answers=cleanIds((state.answers||[]).map(a=>a.id)).sort(),known=new Set(previous?.answerIds);
  const added=previous?.answerIds?answers.filter(id=>!known.has(id)):[];
  const preview=new Map((state.latest||[]).map(a=>[a.id,a]));
  const unread=new Map((item.unreadAnswers||[]).map(a=>[a.id,a]));
  for(const answer of state.answers||[])if(added.includes(answer.id)) {
    const source=answer.title?answer:preview.get(answer.id)?.title?preview.get(answer.id):state.title?state:item;
    const entry=cleanEntries([{...answer,title:source.title,titleLanguage:titleLanguage(source),relatedQuestionId:item.id,recordKind:'answer'}])[0];
    unread.set(answer.id,entry);
  }
  const unreadAnswers=[...unread.values()],observed={revision:state.revision,answerIds:answers,total:state.total||0,latestIds:[]};
  return {...item,title:state.title||item.title,titleLanguage:titleLanguage(state.title?state:item),memberId:item.memberId||state.memberId||null,availability:'available',current:observed,
    baseline:previous?.revision?previous:{...observed,answerIds:previous?.answerIds||answers},updated:Boolean(item.updated||unreadAnswers.length||previous?.revision&&previous.revision!==state.revision),newAnswer:unreadAnswers.length>0,
    latest:state.latest||item.latest,unreadAnswers,checkedAt:Date.now()};
}
const mark=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const marks=row=>({activity:mark(row?.[0]),answer:mark(row?.[1])});
const maxMark=(a,b)=>a==null?b:b==null?a:Math.max(a,b);
const identity=entry=>(entry.kind==='answer'?'answer':'activity')+':'+entry.id;
const minimal=({kind,id,title,titleLanguage,memberId,savedAt})=>({kind,id,title,titleLanguage,memberId,savedAt});
const keys=items=>items.map(savedKey).sort();
// Old tabs can retain only 100 of each kind. Only those keys participate in
// legacy removals; the rest of the v2 follows belong exclusively to v2.
const legacyMirror=items=>{
  const counts={mep:0,question:0};
  return [...items].sort((a,b)=>(a.savedAt??0)-(b.savedAt??0)||(savedKey(a)<savedKey(b)?-1:savedKey(a)>savedKey(b)?1:0)).filter(item=>counts[item.kind]++<100).map(minimal);
};
const unreadEntries=entries=>Array.isArray(entries)?entries.filter(x=>x&&validSource(x.id)).map(entry=>({...cleanEntries([entry])[0],kind:entry.kind==='answer'||entry.recordKind==='answer'?'answer':'activity',mark:mark(entry.mark)})):[];
function migrate(item) {
  if(item.kind==='question')return item;
  const carried=[...(item.unreadActivities||[]).map(x=>({...x,kind:'activity'})),...(item.unreadAnswers||[]).map(x=>({...x,kind:'answer',recordKind:'answer'}))];
  const unread=[...new Map(carried.map(entry=>[identity(entry),entry])).values()];
  return {...minimal(item),seen:null,unread:unread.slice(0,200),unreadOmitted:Math.max(0,unread.length-200),legacyUpdated:Boolean(item.updated&&!unread.length),
    ...(item.baseline?.activityVersion===3&&item.baseline.activityIdsComplete?{legacy:item.baseline}:{})};
}
export function savedLinks(item) {return item.kind==='mep'?item.unread||[]:[...(item.unreadAnswers||[]),...(item.unreadActivities||[])];}
export function createSavedStore(storage,notify=()=>void 0) {
  let items=[],epoch=null,legacyKeys=[],manifest=null,storageError=null,unsavedSince=null,restarted=false,checkState='pending',questionCheckState='pending';
  let tabOnly=!storage,snapshot;
  const refresh=()=>{snapshot={items,persistent:!tabOnly,storageError,unsavedSince,restarted,checkState,questionCheckState,epoch,manifest};notify();};
  const failure=error=>{storageError=error?.name==='QuotaExceededError'?'quota':'unavailable';unsavedSince??=Date.now();};
  function load() {
    try {
      const raw=JSON.parse(storage?.getItem(SAVED_KEY)||'null');
      if(raw?.version===2&&Array.isArray(raw.items)) {
        const cleaned=readSaved(JSON.stringify({version:1,items:raw.items}));
        const originals=new Map(raw.items.filter(valid).map(item=>[savedKey(item),item]));
        items=cleaned.map(item=>{if(item.kind==='question')return item;const old=originals.get(savedKey(item));return {...minimal(item),seen:old.seen?{activity:mark(old.seen.activity),answer:mark(old.seen.answer)}:null,unread:unreadEntries(old.unread||[]).slice(0,200),unreadOmitted:Math.max(0,Number.isSafeInteger(old.unreadOmitted)?old.unreadOmitted:0)+Math.max(0,(old.unread?.length||0)-200),legacyUpdated:old.legacyUpdated===true,legacy:cleanState(old.legacy)};});
        epoch=typeof raw.epoch==='string'?raw.epoch:null;legacyKeys=Array.isArray(raw.legacyKeys)?raw.legacyKeys.filter(x=>typeof x==='string'):[];
        // Also protect stores written before the mirror was capped, even if an
        // old tab has already truncated v1 before this tab reloads.
        legacyKeys=keys(legacyMirror(items.filter(item=>legacyKeys.includes(savedKey(item)))));
        if(reconcile())publish(true);
      } else {const legacy=readSaved(storage?.getItem(LEGACY_KEY));items=legacy.map(migrate);legacyKeys=keys(legacy);}
    } catch {tabOnly=true;}
    derive();refresh();
  }
  function derive() {items=items.map(item=>{
    if(item.kind==='question')return item;
    const row=manifest?.members[item.id],pending=Boolean(row&&item.seen&&((row[0]??0)>(item.seen.activity??0)||(row[1]??0)>(item.seen.answer??0)));
    return {...item,updated:Boolean(item.unread?.length||item.unreadOmitted||item.legacyUpdated||pending),newActivity:pending||item.unread?.some(x=>x.kind==='activity'),newAnswer:item.unread?.some(x=>x.kind==='answer'),unresolved:pending,indexComplete:manifest?.indexComplete,availability:manifest?(row?'available':manifest.rosterBasis==='publication'?'outside-roster':undefined):undefined};
  });}
  function publish(mirror=false) {
    derive();let success=true;
    if(!tabOnly)try {
      const mirrored=mirror?legacyMirror(items):null,nextKeys=mirrored?keys(mirrored):legacyKeys;
      storage.setItem(SAVED_KEY,JSON.stringify({version:2,epoch,items,legacyKeys:nextKeys}));
      if(mirrored)storage.setItem(LEGACY_KEY,JSON.stringify({version:1,items:mirrored}));
      legacyKeys=nextKeys;storageError=null;unsavedSince=null;
    }catch(error){failure(error);success=false;}
    refresh();return success;
  }
  function reconcile() {
    const legacy=readSaved(storage?.getItem(LEGACY_KEY)),next=keys(legacy),old=new Set(legacyKeys),present=new Set(next);
    items=items.filter(item=>!old.has(savedKey(item))||present.has(savedKey(item)));
    for(const item of legacy)if(!old.has(savedKey(item))&&!items.some(x=>savedKey(x)===savedKey(item)))items.push({...migrate(item),...(item.kind==='mep'?{legacy:undefined,seen:manifest?.members[item.id]?marks(manifest.members[item.id]):null}:{})});
    const changed=JSON.stringify(legacyKeys)!==JSON.stringify(next);legacyKeys=next;return changed;
  }
  const update=(key,change)=>{items=items.map(item=>savedKey(item)===key?change(item):item);return publish();};
  const same=(item,expected)=>!expected||item.savedAt===expected.savedAt;
  load();let lastSavedAt=Math.max(0,...items.map(item=>item.savedAt||0));
  return {
    snapshot:()=>snapshot,publish,
    reload(key){if(storageError){if(key===LEGACY_KEY){try{reconcile();publish();}catch(error){failure(error);refresh();}}return;}load();},
    retryStorage:()=>publish(true),
    setCheckState(state,kind='mep'){if(kind==='question')questionCheckState=state;else checkState=state;refresh();},
    toggle(item) {
      if(!valid(item))throw Error('This item cannot be saved.');
      const before=items,previousKeys=legacyKeys,key=savedKey(item);
      if(items.some(x=>savedKey(x)===key))items=items.filter(x=>savedKey(x)!==key);
      else {
        const limit=item.kind==='mep'?1000:100;
        if(items.filter(x=>x.kind===item.kind).length>=limit)throw Error(item.kind==='mep'?'The MEP selection is too large.':'You can save up to 100 questions.');
        const added={...item,id:String(item.id),savedAt:lastSavedAt=Math.max(Date.now(),lastSavedAt+1),updated:false};
        items=[...items,item.kind==='mep'?{...minimal(added),seen:manifest?.members[item.id]?marks(manifest.members[item.id]):null,unread:[],unreadOmitted:0,legacyUpdated:false}:added];
      }
      if(!publish(true)){items=before;legacyKeys=previousKeys;try{storage.setItem(SAVED_KEY,JSON.stringify({version:2,epoch,items,legacyKeys}));storage.setItem(LEGACY_KEY,JSON.stringify({version:1,items:legacyMirror(items)}));}catch{}derive();refresh();throw Error("Couldn't save in this browser: storage is full or blocked. This follow change was not kept.");}
    },
    applyManifest(data) {
      const reset=epoch!==null&&epoch!==data.epoch;manifest=data;
      items=items.map(item=>item.kind!=='mep'?item:{...item,seen:reset||!item.seen&&!item.legacy?(data.members[item.id]?marks(data.members[item.id]):null):item.seen,...(reset?{legacy:undefined}:{})});
      if(reset)restarted=true;epoch=data.epoch;checkState='available';return publish(true);
    },
    observe(states,expected=items) {
      const selected=new Map(expected.map(item=>[savedKey(item),item]));
      items=items.map(item=>{const prior=selected.get(savedKey(item)),state=states.questions?.find(s=>s.id===item.id);return item.kind==='question'&&prior&&same(item,prior)&&state?{...savedObservation(item,state),indexComplete:states.coverage?.indexComplete===true}:item;});return publish(true);
    },
    materialize(data,expected) {
      if(data.epoch!==epoch||data.generation!==manifest?.generation) return false;
      update('mep:'+data.member,item=>{
        if(!same(item,expected)||data.status!=='available')return item;
        const unread=new Map((item.unread||[]).map(entry=>[identity(entry),entry]));
        const rich=new Map((data.entries||[]).map(entry=>[identity(entry),entry]));
        // Refresh metadata only for identities that are still unread. Seen
        // entries stay read, including when details are requested in a new language.
        for(const [key,entry] of unread)if(rich.has(key)){
          const {title,titleLanguage,date,relatedQuestionId}=cleanEntries([rich.get(key)])[0];
          unread.set(key,{...entry,title,titleLanguage,date,relatedQuestionId});
        }
        const seen={activity:null,answer:null,...item.seen},legacy=item.legacy,known={activity:new Set(legacy?.latestIds),answer:new Set(legacy?.answerIds)};
        for(const [id,code,value] of data.ids) {
          const kind=code===1?'answer':'activity',entry={id,kind,mark:value,recordKind:kind==='answer'?'answer':undefined};
          if(legacy?!known[kind].has(id):item.seen&&value>(item.seen[kind]??0)) {
            const key=identity(entry);if(!unread.has(key))unread.set(key,{...cleanEntries([rich.get(key)||entry])[0],...entry});
          }
          seen[kind]=maxMark(seen[kind],value);
        }
        if(!item.seen&&!legacy)Object.assign(seen,marks(manifest.members[item.id]));
        const entries=[...unread.values()];
        return {...item,seen,legacy:undefined,unread:entries.slice(0,200),unreadOmitted:(item.unreadOmitted||0)+Math.max(0,entries.length-200)};
      });
      // Acceptance is independent of persistence: failed writes keep the
      // materialized entries in memory and expose the existing storage banner.
      return true;
    },
    markRead(key){return update(key,item=>item.kind==='mep'?{...item,seen:manifest?{activity:maxMark(item.seen?.activity,manifest.members[item.id]?.[0]??null),answer:maxMark(item.seen?.answer,manifest.members[item.id]?.[1]??null)}:item.seen,unread:[],unreadOmitted:0,legacyUpdated:false}:{...item,baseline:item.current||item.baseline,updated:false,newAnswer:false,newActivity:false,unreadAnswers:[],unreadActivities:[]});},
    markVisitRead(displayed) {
      const viewed=new Map(displayed.map(item=>[savedKey(item),item]));
      items=items.map(item=>{
        const old=viewed.get(savedKey(item));if(!old||old.savedAt!==item.savedAt)return item;
        if(item.kind==='mep') {const ids=new Set((old.unread||[]).map(identity));return {...item,unread:(item.unread||[]).filter(entry=>!ids.has(identity(entry))),legacyUpdated:item.legacyUpdated&&!old.legacyUpdated};}
        if(!old.current)return item;
        const ids=new Set(old.unreadAnswers?.map(a=>a.id)),unreadAnswers=(item.unreadAnswers||[]).filter(a=>!ids.has(a.id));
        return {...item,baseline:{...old.current,answerIds:cleanIds([...(item.baseline?.answerIds||[]),...(old.current.answerIds||[])])},unreadAnswers,newAnswer:unreadAnswers.length>0,updated:unreadAnswers.length>0||item.current?.revision!==old.current.revision};
      });return publish();
    },
    markActivityRead(key,id){return update(key,item=>item.kind==='mep'?{...item,unread:(item.unread||[]).filter(a=>a.kind==='answer'||(id&&a.id!==id))}:item);},
    markAnswerRead(key,id){return update(key,item=>{
      if(item.kind==='mep')return {...item,unread:(item.unread||[]).filter(a=>a.kind!=='answer'||a.id!==id)};
      const unreadAnswers=(item.unreadAnswers||[]).filter(a=>a.id!==id);
      return {...item,baseline:{...(item.current||item.baseline),answerIds:cleanIds([...(item.baseline?.answerIds||[]),id])},unreadAnswers,newAnswer:unreadAnswers.length>0,updated:unreadAnswers.length>0};
    });},
  };
}
