import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CorpusStore} from '../corpus-store.mjs';
import {measureRead} from './read-benchmark-metrics.mjs';

export function runMemberReadBenchmark() {
  const directory=mkdtempSync(path.join(tmpdir(),'member-read-benchmark-'));
  let store;
  try {
    store=new CorpusStore(directory);store.acquire();store.db.exec('PRAGMA synchronous=OFF');
    const put=store.db.prepare('INSERT INTO speech_catalog VALUES (?,?,?,?,?,?,?,?,?)');
    store.transaction(()=>{
      for(let i=0;i<100000;i++)put.run('MTG-PL-2026-10-07-OTH-'+i,'2026-10-07',i%2?'PLENARY_DEBATE_SPEECH':'PLENARY_DEBATE_WRITTEN_STATEMENT','2026-10-07T12:00:00Z',i,JSON.stringify([String(i%720)]),'["en","hu"]',i,'2026-10-08T12:00:00Z');
    });
    store.release();store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const selection="FROM speech_member_catalog INDEXED BY speech_member_page WHERE kind IN ('PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT') AND date BETWEEN '2024-07-16' AND '9999-12-31' AND member='42'";
    const queries={
      speechKindFrontier:"SELECT MAX(date) date FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' AND date<='2026-11-01'",
      memberSpeechCount:'SELECT COUNT(*) n,COALESCE(SUM(revision),0) revision '+selection,
      memberSpeechPage:'SELECT source_id '+selection.replace('INDEXED BY speech_member_page','INDEXED BY speech_member_list')+' ORDER BY order_ms DESC,source_order ASC LIMIT 50 OFFSET 0',
    };
    return {scenarios:Object.entries(queries).map(([name,sql])=>({name:'member.'+name,...measureRead(store.filename,sql)}))};
  } finally {store?.close();rmSync(directory,{recursive:true,force:true});}
}
