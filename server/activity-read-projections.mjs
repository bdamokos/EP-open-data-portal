import {createHash} from 'node:crypto';
import {questionFiles} from './question-files.mjs';

export const activityReadVersion=1;
export const activityOnly="COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer'";
export const answersOnly="json_extract(body,'$.recordKind')='answer'";
// Match isMotion(), including the unqualified vocabulary value.
const motionType="COALESCE(json_extract(body,'$.work_type.id'),json_extract(body,'$.work_type'))";
export const motionDocuments=`kind='document' AND (${motionType} IN ('RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT') OR ${motionType} GLOB '*/RESOLUTION_MOTION' OR ${motionType} GLOB '*/RESOLUTION_MOTION_JOINT')`;

export function initializeActivityReads(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS motion_sitting_summary (
    generation INTEGER,source_key TEXT,sitting_id TEXT,decisions_present INTEGER NOT NULL,
    source_url TEXT,retrieved_at TEXT,fetched_at TEXT,PRIMARY KEY(generation,source_key));
    CREATE INDEX IF NOT EXISTS motion_sitting_weeks ON motion_sitting_summary(generation,decisions_present,source_key DESC);
    CREATE TABLE IF NOT EXISTS question_file_sources (generation INTEGER,source_key TEXT,signature TEXT NOT NULL,PRIMARY KEY(generation,source_key));
    CREATE TABLE IF NOT EXISTS question_files (generation INTEGER,source_key TEXT,ordinal INTEGER,url TEXT,language TEXT,is_primary INTEGER,body TEXT,PRIMARY KEY(generation,source_key,ordinal));
    CREATE INDEX IF NOT EXISTS motion_documents ON sources(generation,key) WHERE ${motionDocuments};
    CREATE INDEX IF NOT EXISTS saved_activity_sources ON items(generation,mep,source_id,date DESC) WHERE ${activityOnly};
    CREATE INDEX IF NOT EXISTS saved_answer_sources ON items(generation,mep,source_id,date DESC) WHERE ${answersOnly};`);
  const summary=source=>`SELECT ${source}.generation,${source}.key,substr(${source}.key,17),
    EXISTS(SELECT 1 FROM json_each(${source}.body,'$.decisions') decision
      WHERE json_extract(decision.value,'$.id') LIKE 'eli/dl/event/' || substr(${source}.key,17) || '-DEC-%'),
    json_extract(${source}.body,'$.decisionsUrl'),json_extract(${source}.body,'$.decisionsFetchedAt'),${source}.fetched_at
    WHERE ${source}.kind='motion-outcomes'`;
  for(const [name,event,ref] of [['insert','INSERT','NEW'],['update','UPDATE OF body,kind,fetched_at','NEW'],['delete','DELETE',null]])db.exec(`
    CREATE TRIGGER IF NOT EXISTS motion_sitting_${name} AFTER ${event} ON sources BEGIN
      DELETE FROM motion_sitting_summary WHERE generation=${ref||'OLD'}.generation AND source_key=${ref||'OLD'}.key;
      ${ref?'INSERT INTO motion_sitting_summary '+summary(ref)+';':''} END;`);
  db.exec(`INSERT OR REPLACE INTO motion_sitting_summary SELECT source.generation,source.key,substr(source.key,17),
    EXISTS(SELECT 1 FROM json_each(source.body,'$.decisions') decision
      WHERE json_extract(decision.value,'$.id') LIKE 'eli/dl/event/' || substr(source.key,17) || '-DEC-%'),
    json_extract(source.body,'$.decisionsUrl'),json_extract(source.body,'$.decisionsFetchedAt'),source.fetched_at
    FROM sources source WHERE source.kind='motion-outcomes'`);
  // REPLACE deletes fire too: putSource rebuilds the files in the same transaction.
  db.exec(`CREATE TRIGGER IF NOT EXISTS question_files_delete AFTER DELETE ON sources BEGIN
    DELETE FROM question_files WHERE generation=OLD.generation AND source_key=OLD.key;
    DELETE FROM question_file_sources WHERE generation=OLD.generation AND source_key=OLD.key; END;`);
}

export function projectQuestionFiles(db,generation,key,kind,work) {
  if(kind!=='document'||!key.startsWith('/parliamentary-questions/'))return;
  const files=questionFiles(work),signature=createHash('sha256').update(JSON.stringify(files)).digest('hex');
  db.prepare('INSERT OR REPLACE INTO question_file_sources VALUES (?,?,?)').run(generation,key,signature);
  const insert=db.prepare('INSERT INTO question_files VALUES (?,?,?,?,?,?,?)');
  for(const [ordinal,file] of files.entries())insert.run(generation,key,ordinal,file.url,file.language,Number(file.primary),JSON.stringify(file));
}

// Called inside the existing generation transaction; copies only small metadata.
export function copyQuestionFiles(db,generation,active) {
  db.prepare('INSERT INTO question_file_sources SELECT ?,source_key,signature FROM question_file_sources WHERE generation=?').run(generation,active);
  db.prepare('INSERT INTO question_files SELECT ?,source_key,ordinal,url,language,is_primary,body FROM question_files WHERE generation=?').run(generation,active);
}

export function prepareQuestionFiles(db,log=()=>{}) {
  const started=performance.now();let count=0;
  log('activity: question-file projection started');
  db.exec('DELETE FROM question_files; DELETE FROM question_file_sources;');
  for(const row of db.prepare("SELECT generation,key,body FROM sources WHERE kind='document' AND key>='/parliamentary-questions/' AND key<'/parliamentary-questions0' AND key LIKE '/parliamentary-questions/%'").iterate())
    {projectQuestionFiles(db,row.generation,row.key,'document',JSON.parse(row.body));count++;}
  log('activity: question-file projection completed: '+count+' sources in '+Math.round(performance.now()-started)+' ms');
}
