import {languagePreference} from './language-order.mjs';
// Internal cache hint: Symbols survive local spreads but never enter JSON.
export const TRANSIENT_STORY_READ=Symbol('transient-week-story-read');
export {pressExcerpt} from './press-releases-model.mjs';
// Competition ranks keep every tie at the fifth rank. Input rows are facts,
// never reader-facing prose. Each list contains one entry per exact identity.
export function rankFacts(rows,value,{descending=false}={}) {
  const sorted=rows.slice().sort((a,b)=>(descending?-1:1)*(value(a)-value(b))||a.key.localeCompare(b.key));
  const seen=new Set(),unique=sorted.filter(row=>{if(seen.has(row.key))return false;seen.add(row.key);return true;});
  let previous,rank=0;
  return unique.map((row,index)=>{const score=value(row);if(score!==previous)rank=index+1;previous=score;return {...row,rank};});
}
export function storyLists({votes=[],speeches=[],blueCards=[],completeVotes=true}) {
  return {
    closest:completeVotes?rankFacts(votes,v=>Math.abs(v.totals.for-v.totals.against)):[],
    differing:completeVotes?rankFacts(votes.filter(v=>Number.isInteger(v.differing)&&v.differing>0),v=>v.differing,{descending:true}):[],
    speeches:rankFacts(speeches,v=>v.speeches,{descending:true}),
    blueCards:rankFacts(blueCards,v=>v.blueCards,{descending:true}),
  };
}
export function selectWeekStory(lists,{pressByKey=new Map(),voteByKey=new Map(),completeVotes=true}={}) {
  const keysOf=row=>row.keys?.length?row.keys:[row.key];
  const candidates=new Map();
  if(completeVotes)for(const [list,rows] of Object.entries(lists))for(const row of rows.filter(r=>r.rank<=5)) {
    if(!row.linked)continue;
    for(const key of keysOf(row).filter(key=>pressByKey.has(key))) {
      const entry=candidates.get(key)||{key,item:row,reasons:[]};
      if(!entry.reasons.some(reason=>reason.list===list))entry.reasons.push({list,rank:row.rank,value:list==='closest'?Math.abs(row.totals.for-row.totals.against):row[list],key,...(['closest','differing'].includes(list)?{voteId:row.id}:{})});
      // A vote reason must display exactly that decision, not another item on
      // the same procedure. Speech-only stories use the retained item lookup.
      if(['closest','differing'].includes(list)&&row.id&&!entry.vote)entry.vote={...voteByKey.get(key),id:row.id,agendaItemId:row.agendaItemId,method:row.method,label:row.label||null,outcome:row.outcome,totals:row.totals};
      candidates.set(key,entry);
    }
  }
  // A release may explicitly link several procedures. Quote it once, retaining
  // every qualifying key, item and reason; never select by title similarity.
  const byRelease=new Map();
  for(const row of candidates.values()) {
    const press=pressByKey.get(row.key),identity=press.id||press.url;
    const entry=byRelease.get(identity)||{...row,keys:[],items:[],reasons:[],press,vote:row.vote||voteByKey.get(row.key)||null};
    entry.keys.push(row.key);if(!entry.items.some(item=>item.id===row.item.id&&item.key===row.item.key))entry.items.push(row.item);
    for(const reason of row.reasons) {
      // Figures and vote-derived claims must describe the same decision, even
      // when a release links several separately voted procedures.
      if(reason.voteId&&reason.voteId!==entry.vote?.id)continue;
      const previous=entry.reasons.find(old=>old.list===reason.list);
      if(!previous)entry.reasons.push(reason);
      else if(reason.rank<previous.rank)Object.assign(previous,reason);
    }
    if(row.key<entry.key)entry.key=row.key;
    byRelease.set(identity,entry);
  }
  const stories=[...byRelease.values()].sort((a,b)=>b.reasons.length-a.reasons.length||Math.min(...a.reasons.map(r=>r.rank))-Math.min(...b.reasons.map(r=>r.rank))||a.key.localeCompare(b.key));
  const storyKeys=new Set(stories.flatMap(row=>row.keys)),storyVotes=new Set(stories.flatMap(row=>row.reasons.map(reason=>reason.voteId))),displayedVotes=new Set(stories.map(row=>row.vote?.id));
  const shown=new Set(),highlights=[],debates=new Map();
  // A vote counts as told only if a story keeps its reason; sharing a release or a procedure with a story isn't enough.
  const told=(list,row)=>['closest','differing'].includes(list)?storyVotes.has(row.id):keysOf(row).some(key=>storyKeys.has(key));
  for(const [list,rows] of Object.entries(lists))for(const row of rows.filter(r=>r.rank===1))if(!told(list,row)) {
    // A joint debate keeps one row with all agenda items and references.
    if(['speeches','blueCards'].includes(list)&&debates.has(row.id)) {debates.get(row.id).lists.push(list);continue;}
    const entry={...row,list,lists:[list]};highlights.push(entry);
    if(['speeches','blueCards'].includes(list))debates.set(row.id,entry);
    for(const key of keysOf(row))shown.add(key);
  }
  const rejected=lists.closest.find(row=>row.outcome==='REJECTED'&&!displayedVotes.has(row.id)&&!shown.has(row.key));
  if(rejected)highlights.push({...rejected,list:'rejected',lists:['rejected']});
  return {stories,highlights};
}

// Keep public labels bounded to the requested language and English; a held
// source-language fallback remains available when neither has a label.
export function projectStoryLanguage(value,language) {
  if(Array.isArray(value))return value.map(row=>projectStoryLanguage(row,language));
  if(!value||typeof value!=='object')return value;
  const projected=Object.fromEntries(Object.entries(value).map(([key,child])=>{
    if(key==='titles') {
      const selected=Object.fromEntries(Object.entries(child||{}).filter(([code])=>code===language||code==='en'));
      const fallback=languagePreference(Object.keys(child||{}),language)[0];
      if(!Object.keys(selected).length&&fallback)selected[fallback]=child[fallback];
      return [key,selected];
    }
    return [key,projectStoryLanguage(child,language)];
  }));
  if(value[TRANSIENT_STORY_READ])projected[TRANSIENT_STORY_READ]=true;
  return projected;
}
