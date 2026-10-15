export const SAVED_KEY='ep.bookmarks.v1';
export const savedKey=item=>item.kind+':'+item.id;
const valid=item=>item&&((item.kind==='mep'&&/^[1-9]\d{0,8}$/.test(item.id))||(item.kind==='question'&&/^[EPHO]-10-\d{4}-\d{6}$/.test(item.id)));
const cleanIds=values=>Array.isArray(values)?values.filter(v=>typeof v==='string'&&/^[A-Za-z0-9-]{1,180}$/.test(v)).slice(0,100):[];
const cleanState=state=>state&&typeof state==='object'?{revision:typeof state.revision==='string'?state.revision.slice(0,128):undefined,answerIds:cleanIds(state.answerIds),latestIds:cleanIds(state.latestIds),total:Number.isSafeInteger(state.total)&&state.total>=0?state.total:0}:undefined;
export function readSaved(raw) {
  try{const parsed=JSON.parse(raw);if(parsed?.version!==1||!Array.isArray(parsed.items))return [];
    const seen=new Set(),counts={mep:0,question:0},result=[];
    for(const item of parsed.items.slice(0,400)){if(!valid(item)||seen.has(savedKey(item))||counts[item.kind]>=100)continue;seen.add(savedKey(item));counts[item.kind]++;
      result.push({kind:item.kind,id:String(item.id),title:String(item.title||item.id).slice(0,700),memberId:/^[1-9]\d{0,8}$/.test(item.memberId)?String(item.memberId):null,date:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:null,savedAt:Number.isFinite(item.savedAt)?item.savedAt:undefined,checkedAt:Number.isFinite(item.checkedAt)?item.checkedAt:undefined,updated:item.updated===true,newAnswer:item.newAnswer===true,newActivity:item.newActivity===true,availability:['available','not-saved','outside-roster'].includes(item.availability)?item.availability:undefined,baseline:cleanState(item.baseline),current:cleanState(item.current),latest:Array.isArray(item.latest)?item.latest.filter(x=>x&&typeof x.id==='string'&&/^[A-Za-z0-9-]{1,180}$/.test(x.id)).slice(0,10).map(x=>({id:x.id,date:String(x.date||'').slice(0,10),title:String(x.title||x.id).slice(0,700)})):undefined});
    }return result;
  }catch{return [];}
}
export function savedObservation(item,state) {
  if(state.status!=='available')return {...item,availability:state.status,checkedAt:Date.now()};
  const answers=(state.answers||[]).map(a=>a.id).sort(),previous=item.baseline;
  const newAnswers=item.kind==='question'?previous?.answerIds?answers.filter(id=>!previous.answerIds.includes(id)):[]:[];
  const changed=item.kind==='question'?newAnswers.length>0||Boolean(previous?.revision&&previous.revision!==state.revision):Boolean(previous?.revision&&previous.revision!==state.revision);
  const observed={revision:state.revision,answerIds:answers,total:state.total||0,latestIds:(state.latest||[]).map(a=>a.id)};
  const newActivity=item.kind==='mep'&&Boolean(previous?.revision)&&((state.total||0)>(previous.total||0)||(state.latest||[]).some(a=>!(previous.latestIds||[]).includes(a.id)));
  return {...item,title:state.title||state.name||item.title,memberId:item.memberId||state.memberId||null,availability:'available',current:observed,baseline:previous?.revision?previous:{...observed,answerIds:previous?.answerIds||answers},updated:item.updated||changed,newAnswer:item.newAnswer||newAnswers.length>0,newActivity:item.newActivity||newActivity,latest:state.latest||item.latest,checkedAt:Date.now()};
}
export function createSavedStore(storage,notify=()=>{}) {
  let items=[],persistent=Boolean(storage);try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}
  let snapshot={items,persistent};
  const publish=()=>{try{storage?.setItem(SAVED_KEY,JSON.stringify({version:1,items}));}catch{persistent=false;}snapshot={items,persistent};notify();};
  return {snapshot:()=>snapshot,reload(){try{items=readSaved(storage?.getItem(SAVED_KEY));}catch{persistent=false;}snapshot={items,persistent};notify();},toggle(item){if(!valid(item))throw Error('This item cannot be saved.');const key=savedKey(item);if(items.some(x=>savedKey(x)===key))items=items.filter(x=>savedKey(x)!==key);else {if(items.filter(x=>x.kind===item.kind).length>=100)throw Error('You can save up to 100 questions and 100 MEPs.');items=[...items,{...item,id:String(item.id),savedAt:Date.now(),updated:false}];}publish();},observe(states){items=items.map(item=>{const state=(item.kind==='question'?states.questions:states.members).find(s=>s.id===item.id);return state?savedObservation(item,state):item;});publish();},markRead(key){items=items.map(item=>savedKey(item)===key?{...item,baseline:item.current||item.baseline,updated:false,newAnswer:false,newActivity:false}:item);publish();}};
}
