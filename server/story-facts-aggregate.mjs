import {topicBatches} from './topic-disk-map.mjs';
import {quarter,topicPeriods} from './topics-store.mjs';
import {STORY_FACTS_VERSION} from './story-facts-model.mjs';
import europe from './story-europe-countries.json' with {type:'json'};
export const storyCountFields=['questions','questionMentions','questionHome','questionElsewhere','questionUnknown','documents','documentsWithKnownOutcome','documentsWithUnknownOutcome','adoptedTexts','adoptedTextsWithTallies','adoptedTextsUndated','debates','debatesWithUnknownAgenda','debates3Plus','urgencyDebates','urgencyDebates3Plus','debateSpeakerAppearances','debateSpeakerAppearances3Plus','groups'];
export const emptyStoryCounts=()=>Object.fromEntries(storyCountFields.map(k=>[k,0]));
export function storyAggregateTables(db){db.exec(`
 CREATE INDEX IF NOT EXISTS story_topic_record ON story_topics(generation,kind,id,key);
 CREATE INDEX IF NOT EXISTS topic_record_kind_date ON record_topic_records(generation,kind,date,id);
 CREATE TABLE IF NOT EXISTS story_scope_records(generation INTEGER,scope TEXT,key TEXT,askers TEXT,kind TEXT,id TEXT,period TEXT,date TEXT,meps INTEGER DEFAULT 0,urgency INTEGER DEFAULT 0,primary_place INTEGER DEFAULT 0,home INTEGER DEFAULT 0,elsewhere INTEGER DEFAULT 0,unknown INTEGER DEFAULT 0,canonical INTEGER DEFAULT 1,known INTEGER DEFAULT 0,tallies INTEGER DEFAULT 0,for_votes INTEGER,margin INTEGER,PRIMARY KEY(generation,scope,key,askers,kind,id));
 CREATE INDEX IF NOT EXISTS story_count_input ON story_scope_records(generation,scope,key,askers,period,canonical,kind,home,elsewhere,unknown,meps,urgency,known,tallies);
 CREATE INDEX IF NOT EXISTS story_scope_period ON story_scope_records(generation,scope,key,askers,period,kind,canonical,date DESC,id DESC);
 CREATE INDEX IF NOT EXISTS story_scope_page ON story_scope_records(generation,scope,key,askers,kind,canonical,date DESC,id DESC);
 CREATE INDEX IF NOT EXISTS story_scope_urgency ON story_scope_records(generation,scope,key,askers,kind,urgency,period,date,id);
 CREATE TABLE IF NOT EXISTS story_scope_counts(generation INTEGER,scope TEXT,key TEXT,askers TEXT,period TEXT,body TEXT,PRIMARY KEY(generation,scope,key,askers,period));
 CREATE INDEX IF NOT EXISTS story_count_scope ON story_scope_counts(generation,scope,key,askers,period,body);
 CREATE INDEX IF NOT EXISTS story_count_grid ON story_scope_counts(generation,scope,askers,period,key,body);
 CREATE TABLE IF NOT EXISTS story_rank(generation INTEGER,scope TEXT,key TEXT,askers TEXT,period TEXT,metric TEXT,id TEXT,score REAL,secondary REAL,date TEXT,body TEXT,PRIMARY KEY(generation,scope,key,askers,period,metric,id));
 CREATE INDEX IF NOT EXISTS story_rank_winner ON story_rank(generation,scope,key,askers,period,metric,score DESC,secondary DESC,date DESC,id);
 CREATE TABLE IF NOT EXISTS story_place_rank(generation INTEGER,zoom TEXT,askers TEXT,period TEXT,metric TEXT,id TEXT,score REAL,secondary REAL,body TEXT,PRIMARY KEY(generation,zoom,askers,period,metric,id));
 CREATE INDEX IF NOT EXISTS story_place_winner ON story_place_rank(generation,zoom,askers,period,metric,score DESC,secondary DESC,id);
 CREATE TABLE IF NOT EXISTS story_map_groups(generation INTEGER,zoom TEXT,askers TEXT,period TEXT,id TEXT,PRIMARY KEY(generation,zoom,askers,period,id));
 `);}
const eu=new Set(europe.ids);
const lanes=(places,topics)=>[...places.map(id=>['place',id]),...topics.map(key=>['topic',key]),...(places.length?[['map','world']]:[]),...(places.some(id=>eu.has(id))?[['map','eu']]:[])];
export async function finishStoryProjection(store,generation){
 store.assertWriter();store.generationTransaction(()=>storyAggregateTables(store.db));store.set('storyProjection',null);
 const db=store.db,end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock?.()??Date.now());
 for(const table of ['story_scope_records','story_scope_counts','story_rank','story_place_rank','story_map_groups']){
  let n;do{store.transaction(()=>{store.assertWriter();n=db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE generation=? LIMIT 500)`).run(generation).changes;});store.renew();await new Promise(setImmediate);}while(n);
 }
 const bulk=(sql,...args)=>store.generationTransaction(()=>{store.assertWriter();return db.prepare(sql).run(...args);});
 const insert=db.prepare('INSERT OR IGNORE INTO story_scope_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const topicKeys=db.prepare('SELECT key FROM story_topics WHERE generation=? AND kind=? AND id=?');
 const add=(scope,key,askers,kind,id,date,{meps=0,urgency=0,primary=0,home=0,elsewhere=0,unknown=0,known=0,tallies=0,votes=null,margin=null,period=date?quarter(date):''}={})=>insert.run(generation,scope,key,askers,kind,id,period,date,meps,urgency,primary,home,elsewhere,unknown,1,known,tallies,votes,margin);
 await topicBatches(store,(function*(){for(const row of db.prepare('SELECT kind,id,date,body FROM story_facts WHERE generation=? ORDER BY kind,id').iterate(generation)){
  yield;const f=JSON.parse(row.body);if(row.kind==='debate'&&f.procedural)continue;
  const places=row.kind==='debate'?f.places.map(p=>p.id):f.places,topics=topicKeys.all(generation,row.kind,row.id).map(r=>r.key);
  for(const [scope,key] of lanes(places,topics))for(const askers of ['all','elsewhere']){
   if(row.kind==='debate')add(scope,key,askers,'debate',row.id,row.date,{meps:f.meps,known:Number(Boolean(f.agendaClassified)),urgency:Number(f.format==='urgency'),primary:Number(Boolean(f.primaryPlace&&(scope==='place'?key===f.primaryPlace:scope!=='map'||key==='world'||eu.has(f.primaryPlace))))});
   else {
    add(scope,key,askers,'document',row.id,row.date,{known:Number(f.outcomeStatus==='known')});
    if(f.outcome?.outcome==='ADOPTED'){
     const tallies=Number(Number.isSafeInteger(f.outcome.for)&&Number.isSafeInteger(f.outcome.against)),date=f.outcome.date||null;if(date&&(date<'2024-07-16'||date>end))continue;
     add(scope,key,askers,'adopted',row.id,date||'',{tallies,votes:f.outcome.for,margin:tallies?Math.abs(f.outcome.for-f.outcome.against):null});
    }
   }
  }
 }} )());
 const questionPlaces=db.prepare('SELECT substr(key,7) id,askers FROM record_topic_question_places WHERE generation=? AND record_id=?');
 const questionTopics=db.prepare("SELECT m.key FROM record_topic_memberships m JOIN record_topic_concepts c ON c.generation=m.generation AND c.key=m.key WHERE m.generation=? AND m.record_id=? AND c.role IN ('topic','keyword')");
 await topicBatches(store,(function*(){for(const r of db.prepare("SELECT id,date FROM record_topic_records WHERE generation=? AND kind='question' AND date BETWEEN '2024-07-16' AND ? ORDER BY date,id").iterate(generation,end)){
  yield;const places=questionPlaces.all(generation,r.id),topics=questionTopics.all(generation,r.id).map(x=>x.key);
  for(const askers of ['all','elsewhere']){
   const selected=places.filter(p=>askers==='all'||p.askers==='elsewhere');
   for(const [scope,key] of lanes(selected.map(p=>p.id),askers==='all'||selected.length?topics:[])){
    const relevant=selected.filter(p=>scope==='place'?p.id===key:scope==='map'&&key==='eu'?eu.has(p.id):true),flags={home:0,elsewhere:0,unknown:0};for(const p of relevant)flags[p.askers]++;
    add(scope,key,askers,'question',r.id,r.date,flags);
   }
  }
 }} )());
 // A joint text replaces only originals that also qualify for this same scope.
 bulk(`UPDATE story_scope_records AS original SET canonical=0 WHERE generation=? AND kind IN ('document','adopted') AND EXISTS(SELECT 1 FROM story_links l JOIN story_scope_records joint ON joint.generation=l.generation AND joint.scope=original.scope AND joint.key=original.key AND joint.askers=original.askers AND joint.kind='document' AND joint.id=l.from_id WHERE l.generation=original.generation AND l.relation='document-original' AND l.to_id=original.id)`,generation);store.renew();await new Promise(setImmediate);
 const aggregate=()=>`json_object('questions',SUM(kind='question'),'questionMentions',SUM(home+elsewhere+unknown),'questionHome',SUM(home),'questionElsewhere',SUM(elsewhere),'questionUnknown',SUM(unknown),'documents',SUM(kind='document'),'documentsWithKnownOutcome',SUM(kind='document' AND known=1),'documentsWithUnknownOutcome',SUM(kind='document' AND known=0),'adoptedTexts',SUM(kind='adopted'),'adoptedTextsWithTallies',SUM(kind='adopted' AND tallies=1),'adoptedTextsUndated',SUM(kind='adopted' AND date=''),'debates',SUM(kind='debate'),'debatesWithUnknownAgenda',SUM(kind='debate' AND known=0),'debates3Plus',SUM(kind='debate' AND meps>=3),'urgencyDebates',SUM(kind='debate' AND urgency=1),'urgencyDebates3Plus',SUM(kind='debate' AND urgency=1 AND meps>=3),'debateSpeakerAppearances',SUM(CASE WHEN kind='debate' THEN meps ELSE 0 END),'debateSpeakerAppearances3Plus',SUM(CASE WHEN kind='debate' AND meps>=3 THEN meps ELSE 0 END),'groups',0)`;
 bulk(`INSERT INTO story_scope_counts SELECT generation,scope,key,askers,period,${aggregate()} FROM story_scope_records INDEXED BY story_count_input WHERE generation=? AND canonical=1 AND period<>'' GROUP BY scope,key,askers,period`,generation);
 bulk(`INSERT INTO story_scope_counts SELECT generation,scope,key,askers,'',${aggregate()} FROM story_scope_records INDEXED BY story_count_input WHERE generation=? AND canonical=1 GROUP BY scope,key,askers`,generation);store.renew();await new Promise(setImmediate);
 const zero=JSON.stringify(emptyStoryCounts()),putGroups=db.prepare("INSERT INTO story_scope_counts VALUES (?,?,?,?,?,json_set(?,'$.groups',?)) ON CONFLICT(generation,scope,key,askers,period) DO UPDATE SET body=json_set(story_scope_counts.body,'$.groups',?)");
 for(const [askers,table] of [['all','record_topic_group_summary'],['elsewhere','record_topic_filtered_groups']]){
  await topicBatches(store,(function*(){for(const r of db.prepare(`SELECT s.key,s.period,s.groups,c.role FROM ${table} s JOIN record_topic_concepts c ON c.generation=s.generation AND c.key=s.key WHERE s.generation=? ${askers==='all'?'':"AND s.askers='elsewhere'"} AND c.role IN ('topic','keyword','place')`).iterate(generation)){
   yield;putGroups.run(generation,r.role==='place'?'place':'topic',r.role==='place'?r.key.slice(6):r.key,askers,r.period,zero,r.groups,r.groups);
  }} )());
 }
 for(const zoom of ['world','eu'])for(const askers of ['all','elsewhere']){
  const geo=zoom==='eu'?" AND substr(m.key,7) IN (SELECT value FROM json_each(?))":'',filter=askers==='elsewhere'?" AND (m.kind<>'question' OR EXISTS(SELECT 1 FROM record_topic_question_places q WHERE q.generation=m.generation AND q.record_id=m.record_id AND q.key=m.key AND q.askers='elsewhere'))":'',args=[generation,zoom,askers,generation,end,...(zoom==='eu'?[JSON.stringify(europe.ids)]:[])];
  const where=`FROM record_topic_memberships m WHERE m.generation=? AND m.key LIKE 'place:%' AND m.kind IN ('question','document','debate','speech','vote') AND m.date BETWEEN '2024-07-16' AND ?${geo}${filter}`;
  bulk(`INSERT OR IGNORE INTO story_map_groups SELECT ?,?,?,substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER),m.group_key ${where}`,...args);
  bulk(`INSERT OR IGNORE INTO story_map_groups SELECT ?,?,?,'',m.group_key ${where}`,...args);store.renew();await new Promise(setImmediate);
 }
 for(const r of db.prepare('SELECT zoom,askers,period,COUNT(*) n FROM story_map_groups WHERE generation=? GROUP BY zoom,askers,period').iterate(generation))putGroups.run(generation,'map',r.zoom,r.askers,r.period,zero,r.n,r.n);
 const rank=db.prepare('INSERT OR REPLACE INTO story_rank VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 const relatedMeps=db.prepare("SELECT MAX(d.meps) n FROM story_links l JOIN story_scope_records d ON d.generation=l.generation AND d.scope=? AND d.key=? AND d.askers=? AND d.kind='debate' AND d.id=l.from_id WHERE l.generation=? AND l.relation='debate-document' AND l.to_id=? AND d.meps>=?");
 await topicBatches(store,(function*(){for(const r of db.prepare("SELECT * FROM story_scope_records WHERE generation=? AND canonical=1 AND kind IN ('debate','adopted')").iterate(generation)){
  yield;const periods=r.period?[r.period,'']:[''];
  const put=(metric,score,secondary=0,body=null)=>{for(const p of periods)rank.run(generation,r.scope,r.key,r.askers,p,metric,r.id,score,secondary,r.date,body?JSON.stringify(body):null);};
  if(r.kind==='debate'){
   put('busiestDebates',r.meps);if(!r.urgency)put('busiestNonUrgencyDebates',r.meps);if(r.primary_place&&!r.urgency)put('busiestPrimaryNonUrgencyDebates',r.meps);if(r.scope==='place'&&r.meps>=3)put('leadingPlaceDebates3Plus',r.primary_place,r.meps);
  }else{const meps=relatedMeps.get(r.scope,r.key,r.askers,generation,r.id,1).n||0;put('headlineAdoptedTexts',meps,r.for_votes??-1);put('headlineAdoptedTexts3Plus',relatedMeps.get(r.scope,r.key,r.askers,generation,r.id,3).n||0,r.for_votes??-1);if(r.tallies)put('closestAdoptedTexts',-r.margin,0,{margin:r.margin});}
 }} )());
 const placePut=db.prepare('INSERT OR REPLACE INTO story_place_rank VALUES (?,?,?,?,?,?,?,?,?)');
 await topicBatches(store,(function*(){for(const r of db.prepare("SELECT key,askers,period,body FROM story_scope_counts WHERE generation=? AND scope='place' ORDER BY key,askers,period").iterate(generation)){
  yield;const c=JSON.parse(r.body);for(const zoom of eu.has(r.key)?['world','eu']:['world'])for(const [metric,field] of [['mostQuestionedPlaces','questions'],['mostDebatedPlaces','debates'],['mostDebatedPlaces3Plus','debates3Plus'],['mostAdoptedPlaces','adoptedTexts']])if(c[field]>0)placePut.run(generation,zoom,r.askers,r.period,metric,r.key,c[field],0,JSON.stringify({count:c[field]}));
 }} )());
 const mapCounts=db.prepare("UPDATE story_scope_counts SET body=json_set(body,'$.placesWithQuestions',?,'$.placesWithDebates',?,'$.placesWithAdoptedTexts',?) WHERE generation=? AND scope='map' AND key=? AND askers=? AND period=?");
 await topicBatches(store,(function*(){for(const r of db.prepare("SELECT zoom,askers,period,SUM(metric='mostQuestionedPlaces') q,SUM(metric='mostDebatedPlaces') d,SUM(metric='mostAdoptedPlaces') a FROM story_place_rank WHERE generation=? AND metric IN ('mostQuestionedPlaces','mostDebatedPlaces','mostAdoptedPlaces') GROUP BY zoom,askers,period").iterate(generation)){yield;mapCounts.run(r.q,r.d,r.a,generation,r.zoom,r.askers,r.period);}})());
 const periods=topicPeriods(store.clock?.()??Date.now()),last=periods.at(-1),byPlace=db.prepare("SELECT period,body FROM story_scope_counts WHERE generation=? AND scope='place' AND key=? AND askers=?"),places=db.prepare("SELECT DISTINCT key,askers FROM story_scope_counts WHERE generation=? AND scope='place'");
 await topicBatches(store,(function*(){for(const place of places.iterate(generation)){
  yield;const cells=new Map(byPlace.all(generation,place.key,place.askers).map(r=>[r.period,JSON.parse(r.body)]));
  for(let i=2;i<periods.length;i++)if(periods[i]!==last)for(const [metric,field,min] of [['risingQuestionPlaces','questions',8],['risingDocumentPlaces','documents',3]]){
   const n=cells.get(periods[i])?.[field]||0,sum=periods.slice(1,i).reduce((s,p)=>s+(cells.get(p)?.[field]||0),0),quarters=i-1,mean=sum/quarters,ratio=n/Math.max(1,mean);if(n<min||ratio<1.5)continue;
   for(const zoom of eu.has(place.key)?['world','eu']:['world'])placePut.run(generation,zoom,place.askers,periods[i],metric,place.key,ratio,n,JSON.stringify({count:n,baselineTotal:sum,baselinePeriods:quarters,baselineMean:mean,ratio}));
  }
 }} )());
 store.set('storyProjection',{generation,version:STORY_FACTS_VERSION,builtAt:new Date().toISOString()});store.set('storyProjectionDirty',false);
}
