import {zstdCompressSync} from 'node:zlib';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WEEK_CLOUD_VERSION,prepareWeekClouds} from '../week-cloud-projection.mjs';
import {measureRead} from './read-benchmark-metrics.mjs';
export function runWeekCloudReadBenchmark() {
  const dir=mkdtempSync(path.join(tmpdir(),'week-cloud-reads-')),file=path.join(dir,'fixture.sqlite');
  const db=new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE speech_catalog(date TEXT);');prepareWeekClouds(db);
    db.exec('BEGIN');
    const revision=db.prepare('INSERT INTO week_cloud_revisions VALUES (?,?)'),put=db.prepare('INSERT INTO week_clouds VALUES (?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<10000;i++) {const week='fixture-'+i;revision.run(week,1);put.run(week,'en',1,WEEK_CLOUD_VERSION,'[]',1,0,zstdCompressSync(Buffer.from(JSON.stringify({words:Array.from({length:60},(_,j)=>({word:'term'+j,speechCount:1000,occurrences:10000,speechIds:['example']})),nextPage:null}))),'fixture');}
    db.exec('COMMIT');
    return {scenarios:[{name:'weekCloud.ready',...measureRead(file,`SELECT p.body,p.dates FROM week_clouds p JOIN week_cloud_revisions r USING(week) WHERE p.week='fixture-42' AND p.language='en' AND p.revision=r.revision AND p.version=${WEEK_CLOUD_VERSION} AND p.generation IS 1 AND p.demographics=0 AND p.inputs='fixture'`)} ]};
  }finally {db.close();rmSync(dir,{recursive:true,force:true});}
}
