import {defaultUi} from './uiDefault.mjs';
import {matchesCommittee} from './memberFilters.mjs';
import {filterCountry} from './countries.mjs';
import {countryName} from './interfaceLabels.mjs';
export const COVERAGE_KEY='ep.following.coverage.v1';
const dimensions=['country','group','committee'];
const ids=value=>Array.isArray(value)&&value.every(id=>typeof id==='string'&&/^[1-9]\d{0,8}$/.test(id));
const values=member=>({country:member.countryCode?filterCountry(member.countryCode):null,group:member.groupCode||null,
  committee:member.memberships===null?null:[...new Set(member.memberships.filter(v=>matchesCommittee({memberships:[v]},v.id)).map(v=>v.id))]});
const matches=(value,target)=>Array.isArray(value)?value.includes(target):value===target;
const filter=value=>dimensions.includes(value?.dimension)&&typeof value.value==='string'&&Boolean(value.value);
const observation=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([id,value])=>ids([id])&&(value===null||typeof value==='string'||Array.isArray(value)&&value.every(v=>typeof v==='string')));
const timestamp=value=>Number.isFinite(value)&&value>=0;
const initialState=()=>({version:4,coverages:[],followed:[],last:{},cancelled:[],unresolvedFollows:{},nearDismissed:{},storageError:false});
const completeDimension=(directory,dimension)=>dimension!=='committee'||directory.index.complete&&!directory.index.error&&!directory.members.some(m=>m.memberships===null);
function decode(raw,now) {
  try {
    const data=JSON.parse(raw);
    if(![1,2,3,4].includes(data?.version)||!ids(data.followed)||!Array.isArray(data.coverages))return null;
    if(!data.coverages.every(c=>filter(c)&&Number.isFinite(c.enrolledAt)&&ids(c.members)&&ids(c.dismissed)&&ids(c.pending)))return null;
    if(data.version===1){
      const last={};
      for(const c of data.coverages){
        if(!observation(c.last))return null;
        const shared=last[c.dimension]??={};
        // Old coverages may have different baselines. Preserve all seen IDs;
        // conflicting values become unknown rather than inventing a switch.
        for(const [id,value] of Object.entries(c.last))shared[id]=Object.hasOwn(shared,id)&&JSON.stringify(shared[id])!==JSON.stringify(value)?null:value;
      }
      return {...initialState(),followed:data.followed,last,coverages:data.coverages.map(({last,...c})=>c)};
    }
    if(!data.last||!Object.entries(data.last).every(([dimension,value])=>dimensions.includes(dimension)&&observation(value))||!Array.isArray(data.cancelled)||!data.cancelled.every(c=>filter(c)&&(c.cancelledAt===undefined||timestamp(c.cancelledAt))))return null;
    if(data.unresolvedFollows!==undefined&&(!data.unresolvedFollows||Array.isArray(data.unresolvedFollows)||typeof data.unresolvedFollows!=='object'||!Object.entries(data.unresolvedFollows).every(([dimension,value])=>dimensions.includes(dimension)&&Array.isArray(value)&&value.every(action=>typeof action==='string'?ids([action]):action&&ids([action.id])&&(action.followedAt===undefined||timestamp(action.followedAt))))))return null;
    if(data.version===4&&(!data.nearDismissed||Array.isArray(data.nearDismissed)||typeof data.nearDismissed!=='object'||!Object.entries(data.nearDismissed).every(([dimension,filters])=>dimensions.includes(dimension)&&filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.entries(filters).every(([value,dismissed])=>value&&ids(dismissed)))))return null;
    // Unknown follow times are oldest; unknown cancellations are at least as
    // recent as every saved follow, so migration cannot undo an explicit unfollow.
    const unresolvedFollows=Object.fromEntries(Object.entries(data.unresolvedFollows||{}).map(([dimension,actions])=>[dimension,actions.map(action=>typeof action==='string'?{id:action,followedAt:0}:{...action,followedAt:action.followedAt??0})]));
    const migratedCancellationAt=Math.max(now,0,...Object.values(unresolvedFollows).flat().map(action=>action.followedAt));
    const cancelled=data.cancelled.map(c=>({...c,cancelledAt:c.cancelledAt??migratedCancellationAt}));
    return {...initialState(),...data,version:4,cancelled,unresolvedFollows,nearDismissed:data.version===4?data.nearDismissed:{}};
  }catch{return null;}
}
export function createCoverageStore(storage,notify=()=>{},clock=Date.now, ui = defaultUi) {
  let state=initialState(),directory=null,events=[];
  try {state={...state,...decode(storage?.getItem(COVERAGE_KEY),clock()),storageError:!storage};}catch{state.storageError=true;}
  const publish=()=>{
    try {if(!storage)throw Error('Storage unavailable');storage.setItem(COVERAGE_KEY,JSON.stringify(state));state={...state,storageError:false};}
    catch{state={...state,storageError:true};}notify();return !state.storageError;
  };
  // Near-complete candidates are derived from the current trusted directory;
  // only dismissals persist, shared by dimension rather than roster copies.
  const nearCompleteFilters=(cancelled=state.cancelled)=>{
    if(!directory)return [];
    const followed=new Set(state.followed),filters=[];
    for(const dimension of dimensions){
      if(!completeDimension(directory,dimension))continue;
      const last=Object.fromEntries(directory.members.map(m=>[String(m.id),values(m)[dimension]]));
      const targets=new Set(Object.values(last).flatMap(value=>value===null?[]:Array.isArray(value)?value:[value]));
      for(const value of targets){
        if(state.coverages.some(c=>c.dimension===dimension&&c.value===value)||cancelled.some(c=>c.dimension===dimension&&c.value===value))continue;
        const members=Object.keys(last).filter(id=>matches(last[id],value)),missing=members.filter(id=>!followed.has(id));
        if(members.length>=3&&missing.length===1)filters.push({dimension,value,members,pending:missing});
      }
    }
    return filters;
  };
  const syncFollows=(items,observedDirectory=directory)=>{
    const followed=items.filter(i=>i.kind==='mep').map(i=>String(i.id)),current=new Set(followed),removed=state.followed.filter(id=>!current.has(id));
    if(JSON.stringify(followed)===JSON.stringify(state.followed)&&!Object.values(state.unresolvedFollows).some(value=>value.length))return;
    const added=followed.filter(id=>!state.followed.includes(id));
    // Preserve action order even within one clock tick, after reload, or if the
    // wall clock moves backwards. Resolution retains the original follow time.
    const actionAt=Math.max(clock(),1,...state.cancelled.map(c=>c.cancelledAt+1),...Object.values(state.unresolvedFollows).flat().map(action=>action.followedAt+1));
    const cancelled=[...state.cancelled];
    const coverages=state.coverages.filter(c=>{
      if(!removed.some(id=>c.members.includes(id)))return true;
      if(!cancelled.some(v=>v.dimension===c.dimension&&v.value===c.value))cancelled.push({dimension:c.dimension,value:c.value,cancelledAt:actionAt});
      return false;
    // A dismissed MEP followed later (e.g. from the profile) joins the set, so unfollowing them cancels it.
    }).map(c=>({...c,members:[...new Set([...c.members,...c.pending.filter(id=>current.has(id)),...c.dismissed.filter(id=>current.has(id))])],pending:c.pending.filter(id=>!current.has(id)),dismissed:c.dismissed.filter(id=>!current.has(id))}));
    for(const c of nearCompleteFilters())if(removed.some(id=>c.members.includes(id))&&!cancelled.some(v=>v.dimension===c.dimension&&v.value===c.value))cancelled.push({dimension:c.dimension,value:c.value,cancelledAt:actionAt});
    const unresolvedFollows={};
    for(const dimension of dimensions){
      const unresolved=[];
      // A profile follow can precede directory loading. Retain each unknown
      // dimension across observations and reloads until it can clear cancellation.
      for(const {id,followedAt} of [...(state.unresolvedFollows[dimension]||[]),...added.map(id=>({id,followedAt:actionAt}))]){
        if(!current.has(id))continue;
        const member=observedDirectory?.members.find(m=>String(m.id)===id);
        const value=member?values(member)[dimension]:state.last[dimension]?.[id];
        if(value==null){unresolved.push({id,followedAt});continue;}
        for(let i=cancelled.length-1;i>=0;i--)if(cancelled[i].cancelledAt<followedAt&&cancelled[i].dimension===dimension&&matches(value,cancelled[i].value))cancelled.splice(i,1);
      }
      if(unresolved.length)unresolvedFollows[dimension]=unresolved;
    }
    // Complete a near-complete set at the follow action, even if the next
    // directory observation already contains another newcomer.
    for(const c of nearCompleteFilters(cancelled))if(c.members.every(id=>current.has(id)))coverages.push({dimension:c.dimension,value:c.value,enrolledAt:actionAt,members:c.members,dismissed:[],pending:[]});
    const nextState={...state,followed,coverages,cancelled,unresolvedFollows};
    if(JSON.stringify(nextState)!==JSON.stringify(state)){state=nextState;publish();}
  };
  return {
    snapshot:()=>state,syncFollows,retryStorage:publish,
    reload(){try{const next=decode(storage?.getItem(COVERAGE_KEY),clock());state=next?{...next,storageError:false}:{...initialState(),storageError:false};notify();}catch{state={...state,storageError:true};notify();}},
    observe(next,items,error=false){
      const usable=next&&!error&&!next.directoryCache?.refreshError;
      syncFollows(items,usable?next:directory);if(!usable)return;
      const directoryChanged=directory!==next;
      directory=next;
      const followed=new Set(state.followed),coverages=state.coverages.map(c=>({...c})),observations={...state.last};
      for(const dimension of dimensions){
        if(!completeDimension(next,dimension))continue;
        const last=Object.fromEntries(next.members.map(m=>[String(m.id),values(m)[dimension]]));
        const previous=state.last[dimension]||{};
        observations[dimension]=last;
        const targets=new Set(Object.values(last).flatMap(value=>value===null?[]:Array.isArray(value)?value:[value]));
        for(const value of targets){
          const current=Object.keys(last).filter(id=>matches(last[id],value));
          let coverage=coverages.find(c=>c.dimension===dimension&&c.value===value);
          if(!coverage&&!state.cancelled.some(c=>c.dimension===dimension&&c.value===value)&&current.length&&current.every(id=>followed.has(id))){
            coverage={dimension,value,enrolledAt:clock(),members:current,dismissed:[],pending:[]};coverages.push(coverage);continue;
          }
        }
        for(const c of coverages.filter(c=>c.dimension===dimension)){
          const members=new Set(c.members),pending=new Set(c.pending);
          for(const [id,value] of Object.entries(last))if(matches(value,c.value)&&!members.has(id)&&!c.dismissed.includes(id)){
            if(followed.has(id)||previous[id]===null){members.add(id);pending.delete(id);}
            else if(!Object.hasOwn(previous,id)||!matches(previous[id],c.value))pending.add(id);
          }
          c.members=[...members];c.pending=[...pending].filter(id=>Object.hasOwn(last,id)&&matches(last[id],c.value)&&!followed.has(id));
        }
      }
      const nextState={...state,coverages,last:observations};
      if(JSON.stringify(nextState)!==JSON.stringify(state)){state=nextState;publish();}
      else if(directoryChanged){state={...state};notify();}
    },
    observeMembership(snapshot){events=snapshot.events.filter(e=>(e.lists||Object.keys(snapshot.lists)).some(list=>snapshot.lists[list].status!=='unavailable'));state={...state};notify();},
    suggestions(formatter=ui){
      if(!directory)return [];
      const near=nearCompleteFilters();
      return directory.members.flatMap(member=>{
        const reasons=state.coverages.filter(c=>c.pending.includes(String(member.id))).map(c=>coverageReason(c,member,directory,events, formatter.locale, formatter));
        for(const c of near)if(c.pending.includes(String(member.id))&&!state.nearDismissed[c.dimension]?.[c.value]?.includes(String(member.id)))reasons.push(coverageReason({...c,nearComplete:true},member,directory, undefined, formatter.locale, formatter));
        return reasons.length?[{member,reasons}]:[];
      });
    },
    dismiss(id){
      const nearDismissed={...state.nearDismissed};
      for(const c of nearCompleteFilters())if(c.pending.includes(String(id)))nearDismissed[c.dimension]={...nearDismissed[c.dimension],[c.value]:[...new Set([...(nearDismissed[c.dimension]?.[c.value]||[]),String(id)])]};
      state={...state,nearDismissed,coverages:state.coverages.map(c=>c.pending.includes(String(id))?{...c,dismissed:[...new Set([...c.dismissed,String(id)])],pending:c.pending.filter(value=>value!==String(id))}:c)};return publish();
    },
  };
}
// A later group-event source can supply {type:'group-joined', value, date, mep}.
export function coverageReason(coverage,member,directory,events=[],language='en', ui = defaultUi) {
  const {dimension,value,enrolledAt}=coverage,code=directory.committees.find(c=>c.id===value)?.code||value;
  const contextKeys=coverage.nearComplete?{country:'followcoverage.you_follow_all_other_meps_from_country.5ece78',group:'followcoverage.you_follow_all_other_meps_in_the_group_group.bd78da',committee:'followcoverage.you_follow_all_other_meps_on_the_committee_committee.3532bc'}:{country:'followcoverage.you_follow_all_meps_from_country.3c99a7',group:'followcoverage.you_follow_all_meps_in_the_group_group.24a0a7',committee:'followcoverage.you_follow_all_meps_on_the_committee_committee.16c279'};
  const context=ui.t(contextKeys[dimension],{country:countryName(language,value,ui),group:value,committee:code});
  if(coverage.nearComplete)return {context,reason:dimension==='country'?ui.t("followcoverage.represents_countryname.295dfe", {country: String(countryName(language,value, ui))}):dimension==='group'?ui.t("followcoverage.in_the_group_group.5061f0", {group: String(value)}):ui.t("followcoverage.on_code.47ef27", {code: String(code)})};
  const dated=events.filter(e=>e.mep===String(member.id)&&Date.parse(e.date)>enrolledAt&&(e.type==='mandate-started'||dimension==='group'&&e.type==='group-joined'&&e.value===value)).sort((a,b)=>(a.type==='mandate-started'?0:1)-(b.type==='mandate-started'?0:1)||b.date.localeCompare(a.date))[0];
  const date=value=>new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  let reason;
  if(dated)reason=dated.type==='mandate-started'?ui.t(dated.subtype==='returned'?'followcoverage.returned_to_parliament_on_date.1fe8ce':'followcoverage.joined_parliament_on_date.012cb4',{date:date(dated.date)}):ui.t('followcoverage.joined_the_group_group_on_date.8f50e3',{group:value,date:date(dated.date)});
  else if(dimension==='committee'){
    const membership=member.memberships?.filter(v=>v.current&&v.id===value&&v.start&&Date.parse(v.start)>enrolledAt).sort((a,b)=>b.start.localeCompare(a.start))[0];
    reason=membership?ui.t(membership.role==='MEMBER_SUBSTITUTE'?'followcoverage.became_a_substitute_on_code_on_date.f1696f':membership.role.includes('VICE')?'followcoverage.became_a_vice_chair_on_code_on_date.310c9c':membership.role.includes('CHAIR')?'followcoverage.became_chair_on_code_on_date.81f46a':'followcoverage.became_a_member_on_code_on_date.4d48ab',{code,date:date(membership.start)}):ui.t('followcoverage.now_on_code.36d1ee',{code});
  }else reason=dimension==='group'?ui.t("followcoverage.now_in_the_group_group.2e223a", {group: String(value)}):ui.t("followcoverage.now_represents_countryname.1f4fbf", {country: String(countryName(language,value, ui))});
  return {context,reason};
}
