import { outsidePerson } from './outside-model.mjs';
import { HttpError } from './http-utils.mjs';

const parse = value => JSON.parse(value);
export function outsideSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS outside_contributions (generation INTEGER, speech TEXT, person TEXT, date TEXT, body TEXT, PRIMARY KEY(generation,speech,person));
    CREATE INDEX IF NOT EXISTS outside_person ON outside_contributions(generation,person,date DESC);
    CREATE INDEX IF NOT EXISTS outside_date ON outside_contributions(generation,date);
    CREATE INDEX IF NOT EXISTS outside_source_date ON sources(generation,kind,json_extract(body,'$.outside.date'));`);
}
export function outsideCopy(db, generation, active) {
  db.prepare('DELETE FROM outside_contributions WHERE generation<>?').run(active);
  db.prepare('INSERT INTO outside_contributions SELECT ?,speech,person,date,body FROM outside_contributions WHERE generation=?').run(generation,active);
}
export function outsidePrune(db, generation, old) {
  db.prepare('DELETE FROM outside_contributions WHERE generation NOT IN (?,?)').run(generation,old || generation);
}
export function recordOutside(store, generation, speech) {
  if (!speech) return;
  store.assertWriter();
  const roster = store.source(generation, 'outside:roster:' + speech.date);
  if (!roster) {
    store.enqueue(generation, 'outside:roster:' + speech.date, 'outside-roster', {date:speech.date, offset:0, ids:[], sources:[]}, 102);
    return;
  }
  const members = new Set(roster.work.ids);
  // Reclassification removes any row previously accepted against older evidence.
  store.db.prepare('DELETE FROM outside_contributions WHERE generation=? AND speech=?').run(generation,speech.id);
  const put = store.db.prepare('INSERT OR REPLACE INTO outside_contributions VALUES (?,?,?,?,?)');
  const candidates = speech.participants.filter(id => !members.has(id));
  for (const personId of candidates) put.run(generation,speech.id,personId,speech.date,JSON.stringify({...speech,personId,header:speech.headers.find(header => header.personId === personId) || null,rosterSource:{date:speech.date,sources:roster.work.sources}}));
  if (candidates.some(id=>!speech.headers.find(header=>header.personId===id)?.name)) store.enqueue(generation,'outside:detail:' + speech.id,'outside-detail',{id:speech.id},102);
  if (candidates.length) for (const id of speech.parentIds) if (!store.source(generation,'outside:agenda:' + id)) store.enqueue(generation,'outside:agenda:' + id,'outside-agenda',{id},101);
}

export function outsideQuery(params) {
  for (const key of params.keys()) if (!['lang','term'].includes(key) || params.getAll(key).length !== 1) throw new HttpError(400,'invalid_query','Unsupported or repeated speaker query.');
  const term = params.get('term') || '10';
  if (!['9','10','all'].includes(term)) throw new HttpError(400,'invalid_term','Choose term 9, 10 or all.');
  return {term,language:params.get('lang') || 'en'};
}
function generationOf(store) {
  const active=store.get('active');
  return active && store.source(active,'outside:state') ? active : store.get('working')?.generation || active || 0;
}
function rowsFor(store, generation, {term='all',person=null}={}) {
  const rows = store.db.prepare("SELECT body FROM outside_contributions WHERE generation=?" + (person?' AND person=?':'') + (term!=='all'?" AND json_extract(body,'$.term')=?":'') + ' ORDER BY date DESC,speech LIMIT 50001').all(generation,...(person?[person]:[]),...(term!=='all'?[Number(term)]:[]));
  return {rows:rows.slice(0,50000).map(row => parse(row.body)),truncated:rows.length>50000};
}
function agendasFor(store, generation, ids) {
  return new Map([...ids].map(id => {
    const saved = store.source(generation,'outside:agenda:' + id);
    if (!saved) return [id,null];
    const work = saved.work;
    return [id,{...work,procedures:work.procedureIds.map(id => {
      const p = store.source(generation,'outside:procedure:' + id);
      return {id,type:p?.work.type || null,source:p?.work.source || null};
    })}];
  }));
}
function localizedTitles(titles,language) {
  const key=titles[language]?language:titles.en?'en':Object.keys(titles)[0];
  return key?{[key]:titles[key]}:{};
}
function publicContribution(row,language) {
  return Object.fromEntries(['id','personId','date','term','start','end','parentIds','documentId','parentDocumentId','reference','originalLanguages','websiteUrl','websiteLanguage','source','headerSource','rosterSource'].map(key=>[key,row[key]]).concat([['titles',localizedTitles(row.titles,language)],['header',row.header?Object.fromEntries(['personId','name','role','languageTag','original','capacity'].map(key=>[key,row.header[key]])):null]]));
}
export function outsideCoverage(store, generation, truncated=false) {
  const counts = store.db.prepare("SELECT kind,COUNT(*) AS total,SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) AS completed FROM tasks WHERE generation=? AND (kind LIKE 'outside-%' OR kind='speeches') GROUP BY kind").all(generation);
  const pending = counts.reduce((sum,row) => sum + row.total - row.completed,0);
  const initialized = Boolean(store.source(generation,'outside:state'));
  const unresolved=store.db.prepare("SELECT COUNT(DISTINCT speech) AS n FROM outside_contributions WHERE generation=? AND (json_extract(body,'$.header.name') IS NULL OR json_array_length(body,'$.parentIds')=0)").get(generation).n;
  const gaps=store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE generation=? AND kind='outside-gap'").get(generation).n;
  return {complete:initialized && !pending && !unresolved && !gaps && !truncated, pending, unresolved, gaps, truncated, initialized, generation,
    updatedAt:store.get('lastSuccess') || store.get('working')?.startedAt || null,
    tasks:counts.map(row => ({kind:row.kind,total:row.total,completed:row.completed})),
    source:'European Parliament Open Data API v2'};
}
export function outsideDirectory(store, query) {
  const generation = generationOf(store);
  const {rows,truncated} = rowsFor(store,generation,query);
  const agendas = agendasFor(store,generation,new Set(rows.flatMap(row => row.parentIds)));
  const grouped = new Map();
  for (const row of rows) { if (!grouped.has(row.personId)) grouped.set(row.personId,[]); grouped.get(row.personId).push(row); }
  const people = [...grouped.values()].map(rows => outsidePerson(rows,agendas,query.language)).sort((a,b) => b.appearances - a.appearances || a.name.localeCompare(b.name));
  return {term:query.term,people,coverage:outsideCoverage(store,generation,truncated)};
}
export function outsideSpeaker(store, person, query) {
  if (!/^[1-9]\d{0,12}$/.test(person)) throw new HttpError(400,'invalid_person','Invalid speaker identifier.');
  const generation = generationOf(store);
  const {rows,truncated} = rowsFor(store,generation,{person,term:query.term || 'all'});
  if (!rows.length) throw new HttpError(404,'speaker_not_found','This speaker is not indexed yet.');
  const agendas = agendasFor(store,generation,new Set(rows.flatMap(row => row.parentIds)));
  const coSpeeches = new Map();
  for (const date of new Set(rows.map(row => row.date))) for (const item of store.db.prepare('SELECT body FROM outside_contributions WHERE generation=? AND date=?').all(generation,date)) {
    const row = parse(item.body);
    if (row.personId !== person && row.parentIds.some(id => agendas.has(id))) coSpeeches.set(row.id + '|' + row.personId,row);
  }
  return {person:outsidePerson(rows,agendas,query.language),contributions:rows.map(row=>publicContribution(row,query.language)),agendas:[...agendas.values()].filter(Boolean).map(agenda=>({...agenda,titles:localizedTitles(agenda.titles,query.language)})),coSpeakers:[...coSpeeches.values()].map(row=>publicContribution(row,query.language)),coverage:outsideCoverage(store,generation,truncated)};
}
