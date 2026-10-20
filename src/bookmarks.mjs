export const SAVED_KEY='ep.bookmarks.v1';
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
    for(const item of parsed.items.slice(0,400)){if(!valid(item)||seen.has(savedKey(item))||counts[item.kind]>=100)continue;seen.add(savedKey(item));counts[item.kind]++;
      result.push({kind:item.kind,id:String(item.id),title:String(item.title||item.id).slice(0,700),titleLanguage:item.title?titleLanguage(item):null,memberId:/^[1-9]\d{0,8}$/.test(item.memberId)?String(item.memberId):null,date:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:null,savedAt:Number.isFinite(item.savedAt)?item.savedAt:undefined,checkedAt:Number.isFinite(item.checkedAt)?item.checkedAt:undefined,updated:item.updated===true,newAnswer:item.newAnswer===true,newActivity:item.newActivity===true,availability:['available','not-saved','outside-roster'].includes(item.availability)?item.availability:undefined,baseline:cleanState(item.baseline),current:cleanState(item.current),latest:cleanEntries(item.latest,10),unreadAnswers:cleanEntries(item.unreadAnswers),unreadActivities:cleanEntries(item.unreadActivities),indexComplete:item.indexComplete===true});
    }return result;
  }catch{return [];}
}
export function savedObservation(item,state) {
  if(state.status!=='available')return {...item,availability:state.status,checkedAt:Date.now()};
  // Older MEP snapshots contained only 100 answers: prime complete membership once.
  let previous=item.kind==='mep'&&item.baseline?.activityVersion!==3?undefined:item.baseline;
  const answers=cleanIds((state.answers||[]).map(a=>a.id)).sort();
  const knownAnswers=new Set(previous?.answerIds);
  const newAnswers=previous?.answerIds?answers.filter(id=>!knownAnswers.has(id)):[];
  const preview=new Map((state.latest||[]).map(a=>[a.id,a]));
  const titledAnswers=(state.answers||[]).map(a=>{
    const latest=preview.get(a.id),source=a.title?a:latest?.title?latest:item.kind==='question'?(state.title?state:item):null;
    return {...a,title:source?.title,titleLanguage:titleLanguage(source),relatedQuestionId:a.relatedQuestionId||(item.kind==='question'?item.id:undefined),recordKind:'answer'};
  });
  const answerEntries=new Map(cleanEntries(titledAnswers).map(a=>[a.id,a]));
  const unread=new Map((item.unreadAnswers||[]).map(a=>[a.id,a]));
  const suppliedTitles=new Map(titledAnswers.map(a=>[a.id,a.title]));
  for(const id of newAnswers){const entry=answerEntries.get(id),old=unread.get(id);unread.set(id,old&&!suppliedTitles.get(id)?{...entry,title:old.title,titleLanguage:titleLanguage(old)}:entry);}
  const unreadAnswers=[...unread.values()];
  const migrated=item.kind==='mep'&&state.activityIdsComplete&&!previous?.activityIdsComplete;
  const changed=newAnswers.length>0||!migrated&&Boolean(previous?.revision&&previous.revision!==state.revision);
  const activityIds=cleanIds(state.activityIds||(state.latest||[]).filter(a=>a.recordKind!=='answer').map(a=>a.id));
  const activityPreview=cleanEntries(state.activities||(state.latest||[]).filter(a=>a.recordKind!=='answer'));
  // Legacy snapshots stored only ten recent identities. Prime older membership
  // without presenting the archive as new; preserve detectable preview changes.
  if(item.kind==='mep'&&previous?.revision&&state.activityIdsComplete&& !previous.activityIdsComplete&&previous.total!==(previous.latestIds||[]).length){
    const known=new Set(previous.latestIds||[]);
    const candidates=new Set((state.total>previous.total?activityPreview:[]).filter(a=>!known.has(a.id)).map(a=>a.id));
    previous={...previous,activityIdsComplete:true,latestIds:cleanIds([...(previous.latestIds||[]),...activityIds.filter(id=>!candidates.has(id))])};
  }
  const knownActivities=new Set(previous?.latestIds||[]);
  const added=item.kind==='mep'&&previous?.revision?activityIds.filter(id=>!knownActivities.has(id)):[];
  if(migrated&&previous)previous={...previous,activityIdsComplete:true,revision:state.revision};
  const unreadActivityMap=new Map((item.unreadActivities||[]).map(a=>[a.id,a]));
  const details=new Map(activityPreview.map(a=>[a.id,a]));
  for(const id of added)unreadActivityMap.set(id,details.get(id)||unreadActivityMap.get(id)||{id,title:id,titleLanguage:null,date:''});
  for(const [id,entry] of unreadActivityMap)if(details.has(id))unreadActivityMap.set(id,{...entry,...details.get(id)});
  const unreadActivities=[...unreadActivityMap.values()];
  const observed={activityVersion:3,activityIdsComplete:state.activityIdsComplete===true,revision:state.revision,answerIds:answers,total:state.total||0,latestIds:activityIds};
  const newActivity=item.kind==='mep'&&(unreadActivities.length>0||Boolean(previous?.revision)&&(state.total||0)>(previous.total||0));
  const selected=state.title?state:state.name?null:item;
  return {...item,title:state.title||state.name||item.title,titleLanguage:titleLanguage(selected),memberId:item.memberId||state.memberId||null,availability:'available',current:observed,baseline:previous?.revision?previous:{...observed,answerIds:previous?.answerIds||answers},updated:item.updated||changed||newActivity,newAnswer:unreadAnswers.length>0,newActivity:item.newActivity||newActivity,unreadAnswers,unreadActivities,latest:state.latest||item.latest,checkedAt:Date.now()};
}
export function savedLinks(item) {
  return [...(item.unreadAnswers||[]),...(item.unreadActivities||[])];
}
export function createSavedStore(storage,notify=()=>void 0) {
  let items=[],persistent=Boolean(storage);try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}
  let lastSavedAt=Math.max(0,...items.map(item=>item.savedAt||0));
  let snapshot={items,persistent};
  const publish=()=>{try{storage?.setItem(SAVED_KEY,JSON.stringify({version:1,items}));}catch{persistent=false;}snapshot={items,persistent};notify();};
  const update=(key,change)=>{items=items.map(item=>savedKey(item)===key?change(item):item);publish();};
  return {
    snapshot:()=>snapshot,
    reload(){try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}snapshot={items,persistent};notify();},
    toggle(item){if(!valid(item))throw Error('This item cannot be saved.');const key=savedKey(item);if(items.some(x=>savedKey(x)===key))items=items.filter(x=>savedKey(x)!==key);else {if(items.filter(x=>x.kind===item.kind).length>=100)throw Error('You can save up to 100 questions and 100 MEPs.');items=[...items,{...item,id:String(item.id),savedAt:lastSavedAt=Math.max(Date.now(),lastSavedAt+1),updated:false}];}publish();},
    observe(states){items=items.map(item=>{const state=(item.kind==='question'?states.questions:states.members).find(s=>s.id===item.id);return state?{...savedObservation(item,state),indexComplete:states.coverage?.indexComplete===true}:item;});publish();},
    markRead(key){update(key,item=>({...item,baseline:item.current||item.baseline,updated:false,newAnswer:false,newActivity:false,unreadAnswers:[],unreadActivities:[]}));},
    markActivityRead(key,id){update(key,item=>{
      const unreadActivities=id?(item.unreadActivities||[]).filter(a=>a.id!==id):[];
      return {...item,baseline:{...(item.current||item.baseline),answerIds:item.baseline?.answerIds||[],...(id?{latestIds:cleanIds([...(item.baseline?.latestIds||[]),id])}:{})},unreadActivities,updated:Boolean(item.unreadAnswers?.length||unreadActivities.length),newActivity:unreadActivities.length>0};
    });},
    markVisitRead(displayed){
      const seen=new Map(displayed.map(item=>[savedKey(item),item]));
      items=items.map(item=>{
        const viewed=seen.get(savedKey(item));
        if(!viewed||viewed.savedAt!==item.savedAt||!viewed.current)return item;
        const answerIds=new Set(viewed.unreadAnswers?.map(a=>a.id)),activityIds=new Set(viewed.unreadActivities?.map(a=>a.id));
        const unreadAnswers=(item.unreadAnswers||[]).filter(a=>!answerIds.has(a.id)),unreadActivities=(item.unreadActivities||[]).filter(a=>!activityIds.has(a.id));
        const baseline={...viewed.current,answerIds:cleanIds([...(item.baseline?.answerIds||[]),...(viewed.current.answerIds||[])]),latestIds:cleanIds([...(item.baseline?.latestIds||[]),...(viewed.current.latestIds||[])])};
        return {...item,baseline,unreadAnswers,unreadActivities,newAnswer:unreadAnswers.length>0,newActivity:unreadActivities.length>0,updated:unreadAnswers.length>0||unreadActivities.length>0||item.current?.revision!==viewed.current.revision};
      });publish();
    },
    markAnswerRead(key,id){update(key,item=>{
      if(!item.unreadAnswers?.some(a=>a.id===id))return item;
      const unreadAnswers=item.unreadAnswers.filter(a=>a.id!==id);
      return {...item,baseline:{...(item.current||item.baseline),latestIds:item.baseline?.latestIds||[],answerIds:cleanIds([...(item.baseline?.answerIds||[]),id])},unreadAnswers,newAnswer:unreadAnswers.length>0,updated:unreadAnswers.length>0||Boolean(item.newActivity)};
    });},
  };
}
