import {seedOutsideRoles,publishedOutsideRoles} from './outside-role-collector.mjs';
import {periodAvailability,validDay} from './source-availability.mjs';
import europe from './story-europe-countries.json' with {type:'json'};
import {quarter} from './topics-store.mjs';
import {resolveOutsideSpeaker} from './outside-speaker-country.mjs';
import {outsideCoverage} from './outside-store.mjs';
import {debatePlaces} from './story-facts-model.mjs';
import {speechAgendaMembership} from './speech-agenda.mjs';
import {topicBatches} from './topic-disk-map.mjs';

// Shared by collection and projection: exact speech/person rows, with the same
// current title-country classification. The collector never re-identifies people.
export function outsideSpeakerAppearances(store,sourceGeneration,person,factGeneration=null){
 const debate=factGeneration==null?null:store.db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='debate' AND id=?");
 return store.db.prepare('SELECT body FROM outside_contributions WHERE generation=? AND person=? ORDER BY date,speech').all(sourceGeneration,person).map(r=>speechAgendaMembership(JSON.parse(r.body))).map(a=>{
  const item=a.parentIds?.length===1?store.source(sourceGeneration,'outside:agenda:'+a.parentIds[0])?.work:null,title=item?.titles?.en||Object.values(item?.titles||{})[0]||'';
  const projected=a.parentIds?.length===1&&debate?debate.get(factGeneration,a.parentIds[0]):null;
  return {...a,debateSource:item?.source,debatePlaces:projected?JSON.parse(projected.body).places.map(p=>p.id):item?debatePlaces(title,[],null).places.map(p=>p.id):[]};
 });
}
// Runs inside the existing single-writer projection. Copy both evidence and
// coverage so readers never mix a published topic generation with newer inputs.
export async function projectOutsideSpeakers(store,generation,sourceGeneration){
 const put=store.db.prepare('INSERT OR REPLACE INTO story_facts VALUES (?,?,?,?,?)');
 const coverage={...outsideCoverage(store,sourceGeneration,false,{term:'10'}),europe:europe.ids,wikidataPolicyVersion:4,wikidataUnavailablePeriods:[],wikidataDiagnostics:[]};
 const people=store.db.prepare('SELECT DISTINCT person FROM outside_contributions WHERE generation=? ORDER BY person');
 await topicBatches(store,(function*(){for(const {person} of people.iterate(sourceGeneration)){
  yield;const appearances=outsideSpeakerAppearances(store,sourceGeneration,person,generation).filter(a=>a.date<=coverage.window.end);
  const wikidata=store.source(sourceGeneration,'wikidata:person:'+person)?.work;
  const resolution=resolveOutsideSpeaker(person,appearances,{wikidata}),result=resolution.addresses;
  coverage.wikidataDiagnostics.push(...resolution.diagnostics.map(d=>({...d,personId:person})));
  for(const a of appearances.filter(a=>a.term===10&&resolution.unavailable.includes(a.id)))coverage.wikidataUnavailablePeriods.push(quarter(a.date));
  if(!result.size)continue;
  const addresses=new Map();
  for(const a of appearances.filter(a=>a.term===10&&a.date>='2024-07-16'&&result.has(a.id)&&a.parentIds?.length===1)){
   const debateId=a.parentIds[0],id=person+':'+debateId;
   if(addresses.has(id))continue;
   seedOutsideRoles(store,a,person);const roles=publishedOutsideRoles(store,a.id,person);
   addresses.set(id,{id,roles,personId:person,name:a.header?.name||null,role:a.header?.role||null,language:a.header?.languageTag||null,date:a.date,debateId,debateTitles:store.source(sourceGeneration,'outside:agenda:'+debateId)?.work?.titles||{},debateSource:store.source(sourceGeneration,'outside:agenda:'+debateId)?.work?.source,country:result.get(a.id).country,basis:result.get(a.id).basis,...(result.get(a.id).wikidata?{wikidata:result.get(a.id).wikidata}:{}),source:a.source,headerSource:a.headerSource,rosterSource:a.rosterSource});
  }
  for(const a of addresses.values())put.run(generation,'outsideSpeaker',a.id,a.date,JSON.stringify(a));
 }} )());
 coverage.wikidataUnavailablePeriods=[...new Set(coverage.wikidataUnavailablePeriods)];
 put.run(generation,'outsideCoverage','outside','',JSON.stringify(coverage));
}

const speechRecordGapKey=/^(?:recovery:)?\/speeches\/MTG-PL-(\d{4}-\d{2}-\d{2})-OTH-\d+$/;
const datedSpeechRecordGap=gap=>gap.reason==='source-gap'&&validDay(gap.start)&&gap.start===gap.end&&speechRecordGapKey.exec(gap.sourceId||'')?.[1]===gap.start;
const quarterWindow=period=>{const [year,n]=period.split('-Q').map(Number);return {start:new Date(Date.UTC(year,(n-1)*3,1)).toISOString().slice(0,10),end:new Date(Date.UTC(year,n*3,0)).toISOString().slice(0,10)};};
export function outsideSpeakerCoverage(store,generation){const row=store.db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='outsideCoverage' AND id='outside'").get(generation);return row?JSON.parse(row.body):null;}
export function readOutsideSpeakers(store,generation,q,key,coverage=outsideSpeakerCoverage(store,generation)){
 if(q.scope==='topic')return [];
 const db=store.db,complete=new Map();
 if(!coverage)return [];
 if(coverage.wikidataPolicyVersion!==4)return [];
 // A missing exact speech is not evidence against the addresses we hold.
 // Filter only this read's gate; published coverage keeps every source gap.
 const availability=coverage.availability&&{...coverage.availability,gaps:coverage.availability.gaps.filter(gap=>!datedSpeechRecordGap(gap))};
 const quarterComplete=period=>{
  if(!complete.has(period))complete.set(period,coverage.initialized!==false&&!coverage.pending&&!coverage.truncated&&!coverage.wikidataUnavailablePeriods?.includes(period)&&(coverage.complete||periodAvailability(quarterWindow(period),availability,0,{today:coverage.window.end}).state==='observed'));
  return complete.get(period);
 };
 const window=q.period?quarterWindow(q.period):null;
 return db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='outsideSpeaker'"+(window?' AND date>=? AND date<=?':'')+' ORDER BY date,id').all(generation,...(window?[window.start,window.end]:[])).map(r=>JSON.parse(r.body)).filter(a=>quarterComplete(quarter(a.date))&&(q.scope==='place'?a.country===key:q.zoom==='world'||(coverage.europe||europe.ids).includes(a.country)));
}
