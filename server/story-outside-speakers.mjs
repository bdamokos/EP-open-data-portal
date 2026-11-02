import {periodAvailability} from './source-availability.mjs';
import europe from './story-europe-countries.json' with {type:'json'};
import {quarter} from './topics-store.mjs';
import {outsideSpeakerCountries} from './outside-speaker-country.mjs';
import {outsideCoverage} from './outside-store.mjs';
import {debatePlaces} from './story-facts-model.mjs';
import {speechAgendaMembership} from './speech-agenda.mjs';
import {topicBatches} from './topic-disk-map.mjs';

// Runs inside the existing single-writer projection. Copy both evidence and
// coverage so readers never mix a published topic generation with newer inputs.
export async function projectOutsideSpeakers(store,generation,sourceGeneration){
 const put=store.db.prepare('INSERT OR REPLACE INTO story_facts VALUES (?,?,?,?,?)');
 const coverage=outsideCoverage(store,sourceGeneration,false,{term:'10'});
 put.run(generation,'outsideCoverage','outside','',JSON.stringify(coverage));
 const people=store.db.prepare('SELECT DISTINCT person FROM outside_contributions WHERE generation=? ORDER BY person');
 const rows=store.db.prepare('SELECT body FROM outside_contributions WHERE generation=? AND person=? ORDER BY date,speech');
 const debate=store.db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='debate' AND id=?");
 await topicBatches(store,(function*(){for(const {person} of people.iterate(sourceGeneration)){
  yield;const appearances=rows.all(sourceGeneration,person).map(r=>speechAgendaMembership(JSON.parse(r.body))).filter(a=>a.term===10&&a.date>='2024-07-16'&&a.date<=coverage.window.end).map(a=>{
   const item=a.parentIds?.length===1?store.source(sourceGeneration,'outside:agenda:'+a.parentIds[0])?.work:null;
   const title=item?.titles?.en||Object.values(item?.titles||{})[0]||'';
   const projected=a.parentIds?.length===1?debate.get(generation,a.parentIds[0]):null;
   return {...a,debatePlaces:projected?JSON.parse(projected.body).places.map(p=>p.id):item?debatePlaces(title,[],null).places.map(p=>p.id):[]};
  });
  const result=outsideSpeakerCountries(person,appearances);if(!result.size)continue;
  const addresses=new Map();
  for(const a of appearances.filter(a=>result.has(a.id))){
   const debateId=a.parentIds[0],id=person+':'+debateId;
   if(addresses.has(id))continue;
   addresses.set(id,{id,personId:person,name:a.header.name,role:a.header.role,language:a.header.languageTag,date:a.date,debateId,debateTitles:store.source(sourceGeneration,'outside:agenda:'+debateId)?.work?.titles||{},debateSource:store.source(sourceGeneration,'outside:agenda:'+debateId)?.work?.source,country:result.get(a.id).country,basis:result.get(a.id).basis,source:a.source,headerSource:a.headerSource,rosterSource:a.rosterSource});
  }
  for(const a of addresses.values())put.run(generation,'outsideSpeaker',a.id,a.date,JSON.stringify(a));
 }} )());
}

const quarterWindow=period=>{const [year,n]=period.split('-Q').map(Number);return {start:new Date(Date.UTC(year,(n-1)*3,1)).toISOString().slice(0,10),end:new Date(Date.UTC(year,n*3,0)).toISOString().slice(0,10)};};
export function readOutsideSpeakers(store,generation,q,key){
 if(q.scope==='topic')return [];
 const db=store.db,row=db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='outsideCoverage' AND id='outside'").get(generation);
 if(!row)return [];
 const coverage=JSON.parse(row.body),complete=new Map();
 const quarterComplete=period=>{
  if(!complete.has(period))complete.set(period,coverage.complete||periodAvailability(quarterWindow(period),coverage.availability,0,{today:coverage.window.end}).state==='observed');
  return complete.get(period);
 };
 const window=q.period?quarterWindow(q.period):null;
 return db.prepare("SELECT body FROM story_facts WHERE generation=? AND kind='outsideSpeaker'"+(window?' AND date>=? AND date<=?':'')+' ORDER BY date,id').all(generation,...(window?[window.start,window.end]:[])).map(r=>JSON.parse(r.body)).filter(a=>quarterComplete(quarter(a.date))&&(q.scope==='place'?a.country===key:q.zoom==='world'||europe.ids.includes(a.country)));
}
