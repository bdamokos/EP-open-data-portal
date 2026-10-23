import {groupHistorySnapshot} from './group-history.mjs';
import {CURRENT_TERM_START} from './analysis-period.mjs';

export const GROUP_ATTRIBUTION_VERSION=1;

const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const contains=(period,date)=>validDay(period.start)&&period.start<=date&&(period.end===null||validDay(period.end)&&period.end>=date);
const unavailable=()=> 'unavailable';
const resolvers=new WeakMap();

// One exact-ID index per frozen snapshot, never a bundle scan for each row.
export function createGroupOn(snapshot) {
  const members=new Map(Object.entries(snapshot?.members||{}));
  return function groupOn(mep,date) {
    // Term 10 began on 16 July 2024. Do not project its open intervals into
    // a later parliamentary term (the five-year anniversary is an upper bound).
    if(!validDay(date)||date<CURRENT_TERM_START||date>='2029-07-16')return 'unavailable';
    const person=members.get(String(mep));
    if(!person||person.coverage==='unavailable')return 'unavailable';
    const mandates=person.mandates||[];
    if(!mandates.some(period=>contains(period,date)))return person.mandateCoverage==='complete'&&mandates.length>0?'not-serving':'unavailable';
    if((person.ambiguous||[]).some(period=>contains(period,date)))return 'ambiguous';
    const groups=(person.groups||[]).filter(period=>contains(period,date));
    if(new Set(groups.map(group=>group.org)).size>1)return 'ambiguous';
    const group=groups[0];
    return group?.code&&group.org&&group.groupId?{code:group.code,orgId:group.org,groupId:group.groupId}:'unavailable';
  };
}

export function generationGroupOn(store,generation) {
  if(!store?.db||!generation)return unavailable;
  let cache=resolvers.get(store);
  if(!cache){cache=new Map();resolvers.set(store,cache);}
  if(!cache.has(generation)) {
    cache.set(generation,createGroupOn(groupHistorySnapshot(store,generation)));
    // In-flight responses retain their closure even if a later publish prunes it.
    while(cache.size>2)cache.delete(cache.keys().next().value);
  }
  return cache.get(generation);
}

// Keep group as the current-roster dimension for ordering/charts/filters.
// An explicit null suppresses affiliation for a known non-serving day.
export function datedPerson(person,date,groupOn) {
  const group=groupOn(person.id,date);
  return {...person,affiliationGroup:typeof group==='object'?group.code:group==='not-serving'?null:person.group??null};
}

export function attributeSpeechResponse(response,groupOn) {
  const person=(value,date)=>value?datedPerson(value,date,groupOn):value;
  const intervention=(value,date)=>value?{...value,speaker:person(value.speaker,date),chair:person(value.chair,date)}:value;
  const speech=row=>({...row,...(row.speakers?{speakers:row.speakers.map(value=>person(value,row.date))}:{}),...(row.intervention?{intervention:intervention(row.intervention,row.date)}:{})});
  const result=speech(response);
  if(response.metadata)result.metadata=speech(response.metadata);
  if(response.items)result.items=response.items.map(speech);
  if(response.debates)result.debates=response.debates.map(debate=>({...debate,records:debate.records.map(speech)}));
  // Context metadata belongs to the selected speech; its exact ID supplies date.
  if(response.speechId&&response.intervention)result.intervention=intervention(response.intervention,response.speechId.slice(7,17));
  return result;
}
