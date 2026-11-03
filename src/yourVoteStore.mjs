export const YOUR_VOTES_KEY='ep.your-votes.v1';
const sitting=x=>typeof x==='string'&&/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x.slice(7)))&&new Date(x.slice(7)).toISOString().slice(0,10)===x.slice(7);
const valid=x=>x&&sitting(x.sittingId)&&typeof x.key==='string'&&x.key.length<2000&&['for','against','abstaining'].includes(x.choice)&&typeof x.documentId==='string'&&typeof x.agendaItemId==='string'&&Number.isFinite(x.savedAt);
export function createYourVotesStore(storage,notify=()=>{},clock=Date.now) {
  let state={choices:[],stars:[],storageError:false};
  function load(){try {const raw=JSON.parse(storage?.getItem(YOUR_VOTES_KEY)||'null');state=raw?.version===1?{choices:Array.isArray(raw.choices)?raw.choices.filter(valid):[],stars:Array.isArray(raw.stars)?raw.stars.filter(x=>sitting(x.sittingId)&&typeof x.id==='string'):[],storageError:false}:{choices:[],stars:[],storageError:false};}catch{state={...state,storageError:true};}notify();}
  function publish(){try{if(!storage)throw Error();storage.setItem(YOUR_VOTES_KEY,JSON.stringify({version:1,...state}));state={...state,storageError:false};}catch{state={...state,storageError:true};}notify();}
  load();return {snapshot:()=>state,reload:load,choose(value){if(value.choice===null)state={...state,choices:state.choices.filter(x=>!(x.key===value.key))};else {const next={...value,savedAt:clock()};if(!valid(next))return;state={...state,choices:[...state.choices.filter(x=>!(x.key===next.key)),next]};}publish();},toggleStar(value){if(!sitting(value.sittingId)||typeof value.id!=='string')return;const found=state.stars.some(x=>x.id===value.id&&x.sittingId===value.sittingId);state={...state,stars:found?state.stars.filter(x=>!(x.id===value.id&&x.sittingId===value.sittingId)):[...state.stars,value]};publish();}};
}
export const choiceAgreement=(choice,position)=>choice&&position?choice===position:null;
export const outcomePosition=outcome=>outcome==='ADOPTED'?'for':outcome==='REJECTED'?'against':null;
