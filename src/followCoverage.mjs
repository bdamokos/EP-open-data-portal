import {matchesCommittee} from './memberFilters.mjs';
import {filterCountry} from './countries.mjs';
import {countryName} from './interfaceLabels.mjs';
export const COVERAGE_KEY='ep.following.coverage.v1';
const dimensions=['country','group','committee'];
const ids=value=>Array.isArray(value)&&value.every(id=>typeof id==='string'&&/^[1-9]\d{0,8}$/.test(id));
const values=member=>({country:member.countryCode?filterCountry(member.countryCode):null,group:member.groupCode||null,
  committee:member.memberships===null?null:[...new Set(member.memberships.filter(v=>matchesCommittee({memberships:[v]},v.id)).map(v=>v.id))]});
const matches=(value,target)=>Array.isArray(value)?value.includes(target):value===target;
function decode(raw) {
  try {
    const data=JSON.parse(raw);
    if(data?.version!==1||!ids(data.followed)||!Array.isArray(data.coverages))return null;
    if(!data.coverages.every(c=>dimensions.includes(c.dimension)&&typeof c.value==='string'&&c.value&&Number.isFinite(c.enrolledAt)&&ids(c.members)&&ids(c.dismissed)&&ids(c.pending)&&c.last&&Object.entries(c.last).every(([id,value])=>ids([id])&&(value===null||typeof value==='string'||Array.isArray(value)&&value.every(v=>typeof v==='string')))))return null;
    return data;
  }catch{return null;}
}
export function createCoverageStore(storage,notify=()=>{},clock=Date.now) {
  let state={version:1,coverages:[],followed:[],storageError:false},directory=null,events=[];
  try {state={...state,...decode(storage?.getItem(COVERAGE_KEY)),storageError:!storage};}catch{state.storageError=true;}
  const publish=()=>{
    try {if(!storage)throw Error('Storage unavailable');storage.setItem(COVERAGE_KEY,JSON.stringify(state));state={...state,storageError:false};}
    catch{state={...state,storageError:true};}notify();return !state.storageError;
  };
  const syncFollows=items=>{
    const followed=items.filter(i=>i.kind==='mep').map(i=>String(i.id)),current=new Set(followed),removed=state.followed.filter(id=>!current.has(id));
    if(JSON.stringify(followed)===JSON.stringify(state.followed))return;
    state={...state,followed,coverages:state.coverages.filter(c=>!removed.some(id=>c.members.includes(id))).map(c=>({...c,members:[...new Set([...c.members,...c.pending.filter(id=>current.has(id))])],pending:c.pending.filter(id=>!current.has(id))}))};publish();
  };
  return {
    snapshot:()=>state,syncFollows,retryStorage:publish,
    reload(){try{const next=decode(storage?.getItem(COVERAGE_KEY));state=next?{...next,storageError:false}:{...state,coverages:[]};notify();}catch{state={...state,storageError:true};notify();}},
    observe(next,items,error=false){
      syncFollows(items);if(!next||error||next.directoryCache?.refreshError)return;
      directory=next;
      const followed=new Set(state.followed),coverages=state.coverages.map(c=>({...c}));
      for(const dimension of dimensions){
        if(dimension==='committee'&&(!next.index.complete||next.index.error||next.members.some(m=>m.memberships===null)))continue;
        const last=Object.fromEntries(next.members.map(m=>[String(m.id),values(m)[dimension]]));
        const targets=new Set(Object.values(last).flatMap(value=>value===null?[]:Array.isArray(value)?value:[value]));
        for(const value of targets){
          const current=Object.keys(last).filter(id=>matches(last[id],value));
          let coverage=coverages.find(c=>c.dimension===dimension&&c.value===value);
          if(!coverage&&current.length&&current.every(id=>followed.has(id))){
            coverage={dimension,value,enrolledAt:clock(),members:current,dismissed:[],pending:[],last};coverages.push(coverage);continue;
          }
        }
        for(const c of coverages.filter(c=>c.dimension===dimension)){
          const members=new Set(c.members),pending=new Set(c.pending);
          for(const [id,value] of Object.entries(last))if(matches(value,c.value)&&!members.has(id)&&!c.dismissed.includes(id)){
            if(followed.has(id)||c.last[id]===null){members.add(id);pending.delete(id);}
            else if(!Object.hasOwn(c.last,id)||!matches(c.last[id],c.value))pending.add(id);
          }
          c.members=[...members];c.pending=[...pending].filter(id=>Object.hasOwn(last,id)&&matches(last[id],c.value)&&!followed.has(id));c.last=last;
        }
      }
      const nextState={...state,coverages};
      if(JSON.stringify(nextState)!==JSON.stringify(state)){state=nextState;publish();}
    },
    observeMembership(snapshot){events=snapshot.events.filter(e=>!e.lists||e.lists.some(list=>snapshot.lists[list].status!=='unavailable'));state={...state};notify();},
    suggestions(){
      if(!directory)return [];
      return directory.members.flatMap(member=>{
        const reasons=state.coverages.filter(c=>c.pending.includes(String(member.id))).map(c=>coverageReason(c,member,directory,events));
        return reasons.length?[{member,reasons}]:[];
      });
    },
    dismiss(id){state={...state,coverages:state.coverages.map(c=>c.pending.includes(String(id))?{...c,dismissed:[...new Set([...c.dismissed,String(id)])],pending:c.pending.filter(value=>value!==String(id))}:c)};return publish();},
  };
}
// A later group-event source can supply {type:'group-joined', value, date, mep}.
export function coverageReason(coverage,member,directory,events=[],language='en') {
  const {dimension,value,enrolledAt}=coverage,code=directory.committees.find(c=>c.id===value)?.code||value;
  const context=dimension==='country'?`You follow all MEPs from ${countryName('en',value)}.`:dimension==='group'?`You follow all MEPs in the ${value} group.`:`You follow all MEPs on the ${code} committee.`;
  const dated=events.filter(e=>e.mep===String(member.id)&&Date.parse(e.date)>enrolledAt&&(e.type==='mandate-started'||dimension==='group'&&e.type==='group-joined'&&e.value===value)).sort((a,b)=>(a.type==='mandate-started'?0:1)-(b.type==='mandate-started'?0:1)||b.date.localeCompare(a.date))[0];
  const date=value=>new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  let reason;
  if(dated)reason=dated.type==='mandate-started'?`${dated.subtype==='returned'?'Returned to':'Joined'} Parliament on ${date(dated.date)}`:`Joined the ${value} group on ${date(dated.date)}`;
  else if(dimension==='committee'){
    const membership=member.memberships?.filter(v=>v.current&&v.id===value&&v.start&&Date.parse(v.start)>enrolledAt).sort((a,b)=>b.start.localeCompare(a.start))[0];
    reason=membership?`Became ${membership.role==='MEMBER_SUBSTITUTE'?'a substitute':membership.role.includes('VICE')?'a vice-chair':membership.role.includes('CHAIR')?'chair':'a member'} on ${code} on ${date(membership.start)}`:`Now on ${code}`;
  }else reason=dimension==='group'?`Now in the ${value} group`:`Now represents ${countryName('en',value)}`;
  return {context,reason};
}
