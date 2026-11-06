import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {measureRead} from './read-benchmark-metrics.mjs';
export function runWeekStoryReadBenchmark() {
 const dir=mkdtempSync(path.join(tmpdir(),'week-story-reads-')),file=path.join(dir,'fixture.sqlite'),db=new DatabaseSync(file);
 try {
  db.exec('CREATE TABLE speech_metadata(source_id TEXT PRIMARY KEY,body BLOB)');db.exec('BEGIN');
  const put=db.prepare('INSERT INTO speech_metadata VALUES (?,zeroblob(512))');
  for(let i=0;i<20000;i++)put.run('MTG-PL-2026-'+(i<1371?'10-19':'09-14')+'-OTH-'+i);
  db.exec('COMMIT');
  return {scenarios:[{name:'weekStory.speechFacts',...measureRead(file,"SELECT source_id,length(body) FROM speech_metadata WHERE source_id>='MTG-PL-2026-10-19-' AND source_id<'MTG-PL-2026-10-19-~' ORDER BY source_id")}]};
 }finally {db.close();rmSync(dir,{recursive:true,force:true});}
}
