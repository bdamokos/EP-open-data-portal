export const SAVED_KEY='ep.bookmarks.v1';
export const savedKey=item=>item.kind+':'+item.id;
const valid=item=>item&&((item.kind==='mep'&&/^[1-9]\d{0,8}$/.test(item.id))||(item.kind==='question'&&/^[EPHO]-10-\d{4}-\d{6}$/.test(item.id)));
const validSource=id=>typeof id==='string'&&/^[A-Za-z0-9-]{1,180}$/.test(id);
const cleanIds=(values,limit=Infinity)=>Array.isArray(values)?[...new Set(values.filter(validSource))].slice(0,limit):[];
const titleLanguage=source=>typeof source?.titleLanguage==='string'?source.titleLanguage:null;
const cleanState=state=>state&&typeof state==='object'?{activityVersion:state.activityVersion===3?3:undefined,revision:typeof state.revision==='string'?state.revision.slice(0,128):undefined,answerIds:cleanIds(state.answerIds),latestIds:cleanIds(state.latestIds,100),total:Number.isSafeInteger(state.total)&&state.total>=0?state.total:0}:undefined;
const cleanEntries=(entries,limit=Infinity)=>Array.isArray(entries)?entries.filter(x=>x&&validSource(x.id)).slice(0,limit).map(x=>({id:x.id,date:/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')?x.date:'',title:String(x.title||(validSource(x.relatedQuestionId)?'Question '+x.relatedQuestionId:x.id)).slice(0,700),titleLanguage:x.title?titleLanguage(x):validSource(x.relatedQuestionId)?'en':null,recordKind:x.recordKind==='answer'?'answer':undefined,...(validSource(x.relatedQuestionId)?{relatedQuestionId:x.relatedQuestionId}:{})})):[];
export function readSaved(raw) {
  try{const parsed=JSON.parse(raw);if(parsed?.version!==1||!Array.isArray(parsed.items))return [];
    const seen=new Set(),counts={mep:0,question:0},result=[];
    for(const item of parsed.items.slice(0,400)){if(!valid(item)||seen.has(savedKey(item))||counts[item.kind]>=100)continue;seen.add(savedKey(item));counts[item.kind]++;
      result.push({kind:item.kind,id:String(item.id),title:String(item.title||item.id).slice(0,700),titleLanguage:item.title?titleLanguage(item):null,memberId:/^[1-9]\d{0,8}$/.test(item.memberId)?String(item.memberId):null,date:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:null,savedAt:Number.isFinite(item.savedAt)?item.savedAt:undefined,checkedAt:Number.isFinite(item.checkedAt)?item.checkedAt:undefined,updated:item.updated===true,newAnswer:item.newAnswer===true,newActivity:item.newActivity===true,availability:['available','not-saved','outside-roster'].includes(item.availability)?item.availability:undefined,baseline:cleanState(item.baseline),current:cleanState(item.current),latest:cleanEntries(item.latest,10),unreadAnswers:cleanEntries(item.unreadAnswers)});
    }return result;
  }catch{return [];}
}
export function savedObservation(item,state) {
  if(state.status!=='available')return {...item,availability:state.status,checkedAt:Date.now()};
  // Older MEP snapshots contained only 100 answers: prime complete membership once.
  const previous=item.kind==='mep'&&item.baseline?.activityVersion!==3?undefined:item.baseline;
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
  const changed=newAnswers.length>0||Boolean(previous?.revision&&previous.revision!==state.revision);
  const activityIds=state.activityIds||(state.latest||[]).filter(a=>a.recordKind!=='answer').map(a=>a.id);
  const observed={activityVersion:3,revision:state.revision,answerIds:answers,total:state.total||0,latestIds:activityIds};
  const newActivity=item.kind==='mep'&&Boolean(previous?.revision)&&((state.total||0)>(previous.total||0)||activityIds.some(id=>!(previous.latestIds||[]).includes(id)));
  const selected=state.title?state:state.name?null:item;
  return {...item,title:state.title||state.name||item.title,titleLanguage:titleLanguage(selected),memberId:item.memberId||state.memberId||null,availability:'available',current:observed,baseline:previous?.revision?previous:{...observed,answerIds:previous?.answerIds||answers},updated:item.updated||changed,newAnswer:unreadAnswers.length>0,newActivity:item.newActivity||newActivity,unreadAnswers,latest:state.latest||item.latest,checkedAt:Date.now()};
}
export function savedLinks(item) {
  const unread=item.unreadAnswers||[],ids=new Set(unread.map(a=>a.id));
  return [...unread,...(item.latest||[]).filter(a=>!ids.has(a.id)).slice(0,3)];
}
export function createSavedStore(storage,notify=()=>void 0) {
  let items=[],persistent=Boolean(storage);try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}
  let snapshot={items,persistent};
  const publish=()=>{try{storage?.setItem(SAVED_KEY,JSON.stringify({version:1,items}));}catch{persistent=false;}snapshot={items,persistent};notify();};
  const update=(key,change)=>{items=items.map(item=>savedKey(item)===key?change(item):item);publish();};
  return {
    snapshot:()=>snapshot,
    reload(){try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}snapshot={items,persistent};notify();},
    toggle(item){if(!valid(item))throw Error('This item cannot be saved.');const key=savedKey(item);if(items.some(x=>savedKey(x)===key))items=items.filter(x=>savedKey(x)!==key);else {if(items.filter(x=>x.kind===item.kind).length>=100)throw Error('You can save up to 100 questions and 100 MEPs.');items=[...items,{...item,id:String(item.id),savedAt:Date.now(),updated:false}];}publish();},
    observe(states){items=items.map(item=>{const state=(item.kind==='question'?states.questions:states.members).find(s=>s.id===item.id);return state?savedObservation(item,state):item;});publish();},
    markRead(key){update(key,item=>({...item,baseline:item.current||item.baseline,updated:false,newAnswer:false,newActivity:false,unreadAnswers:[]}));},
    markActivityRead(key){update(key,item=>({...item,baseline:{...(item.current||item.baseline),answerIds:item.baseline?.answerIds||[]},updated:Boolean(item.unreadAnswers?.length),newActivity:false}));},
    markAnswerRead(key,id){update(key,item=>{
      if(!item.unreadAnswers?.some(a=>a.id===id))return item;
      const unreadAnswers=item.unreadAnswers.filter(a=>a.id!==id);
      return {...item,baseline:{...(item.current||item.baseline),answerIds:cleanIds([...(item.baseline?.answerIds||[]),id])},unreadAnswers,newAnswer:unreadAnswers.length>0,updated:unreadAnswers.length>0||Boolean(item.newActivity)};
    });},
  };
}
