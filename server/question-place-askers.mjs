import {memberCountry,countryCode} from './insights-countries.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import {savedMetadata} from './insights-store.mjs';
export function questionPlaceAskers(authors,place,members,metadata=new Map()){
 const codes=[...new Set(authors||[])].map(id=>memberCountry(id,members,metadata)),target=countryCode(countryIdentity(place)?.iso2);
 if(target&&codes.includes(target))return 'home';
 return codes.length&&codes.every(Boolean)?'elsewhere':'unknown';
}
export function questionPlaceTables(db){db.exec(`CREATE TABLE IF NOT EXISTS record_topic_question_places(generation INTEGER,key TEXT,record_id TEXT,askers TEXT,date TEXT,group_key TEXT,PRIMARY KEY(generation,key,record_id));CREATE INDEX IF NOT EXISTS topic_question_askers ON record_topic_question_places(generation,askers,key,date,record_id);CREATE INDEX IF NOT EXISTS topic_question_author ON record_topic_question_places(generation,record_id,key,askers);CREATE TABLE IF NOT EXISTS record_topic_author_countries(generation INTEGER,id TEXT,country TEXT,source TEXT,PRIMARY KEY(generation,id));CREATE TABLE IF NOT EXISTS record_topic_filtered_totals(generation INTEGER,askers TEXT,key TEXT,period TEXT,kind TEXT,n INTEGER,PRIMARY KEY(generation,askers,key,period,kind));CREATE TABLE IF NOT EXISTS record_topic_filtered_groups(generation INTEGER,askers TEXT,key TEXT,period TEXT,groups INTEGER,top TEXT,PRIMARY KEY(generation,askers,key,period));`);}
export async function questionCountryMetadata(store,generation,cache){
 const members=new Map(store.db.prepare('SELECT id,body FROM members').all().map(r=>[r.id,JSON.parse(r.body)])),ids=new Set();for(const row of store.db.prepare("SELECT json_extract(body,'$.members') authors FROM record_topic_records WHERE generation=? AND kind='question'").iterate(generation))for(const id of JSON.parse(row.authors||'[]'))ids.add(String(id));
 const metadata=new Map(),list=[...ids],view={db:store.db,get:key=>store.get(key),status:()=>({servingGeneration:generation})};
 for(let i=0;i<list.length;i+=700){const batch=new Map(list.slice(i,i+700).map(id=>[id,members.get(id)||{id}]));for(const [id,data] of await savedMetadata({directory:cache,members:batch,store:view}))if(batch.has(id))metadata.set(id,data);if(!store.renew())throw Error('Activity-index writer lease was lost.');}
 return {members,metadata,sourceGeneration:store.get('working')?.generation||generation};
}
export function writeQuestionPlaceAskers(store,generation,{members=new Map(store.db.prepare('SELECT id,body FROM members').all().map(r=>[r.id,JSON.parse(r.body)])),metadata=new Map(),sourceGeneration=generation}={}){
 questionPlaceTables(store.db);const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock?.()??Date.now());const stats={home:0,elsewhere:0,unknown:0},currentOnly={home:0,elsewhere:0,unknown:0},currentMetadata=new Map([...metadata].filter(([id])=>members.has(id))),former=new Set(),authors=new Set();
 store.transaction(()=>{store.assertWriter();store.db.prepare('DELETE FROM record_topic_question_places WHERE generation=?').run(generation);store.db.prepare('DELETE FROM record_topic_author_countries WHERE generation=?').run(generation);const put=store.db.prepare('INSERT INTO record_topic_question_places VALUES (?,?,?,?,?,?)'),country=store.db.prepare('INSERT OR REPLACE INTO record_topic_author_countries VALUES (?,?,?,?)');
 for(const row of store.db.prepare("SELECT r.id,r.date,r.group_key,json_extract(r.body,'$.members') authors,m.key FROM record_topic_records r JOIN record_topic_memberships m ON m.generation=r.generation AND m.record_id=r.id JOIN record_topic_concepts c ON c.generation=m.generation AND c.key=m.key WHERE r.generation=? AND r.kind='question' AND c.role='place'").iterate(generation)){
  const ids=JSON.parse(row.authors||'[]'),place=row.key.slice(6),askers=questionPlaceAskers(ids,place,members,metadata);put.run(generation,row.key,row.id,askers,row.date,row.group_key);if(row.date>='2024-07-16'&&row.date<=end){stats[askers]++;currentOnly[questionPlaceAskers(ids,place,members,currentMetadata)]++;}
  for(const id of ids)if(!authors.has(id)){authors.add(id);const code=memberCountry(id,members,metadata);if(code&&!members.has(id))former.add(id);country.run(generation,id,code,JSON.stringify(metadata.get(id)?.demographicProvenance?.['api:country-of-representation']||{source:'saved roster',fetchedAt:store.get('rosterFetchedAt')}));}
 }
 store.set('recordTopicAskerCoverage',{generation,countrySourceGeneration:sourceGeneration,...stats,currentOnly,formerAuthorsWithSavedCountry:former.size});});return stats;
}
