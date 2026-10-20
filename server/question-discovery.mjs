// The anti-joins read small manifests and indexed URLs, never source bodies or
// corpus text. Acknowledgements survive generation copies and worker restarts.
export const changedQuestionsSql=`SELECT source.source_key FROM idx.question_file_sources source
  WHERE source.generation=? AND source.source_key>?
  AND NOT EXISTS (SELECT 1 FROM question_discovery seen
    WHERE seen.source_key=source.source_key AND seen.signature=source.signature AND seen.policy=?)
  ORDER BY source.source_key LIMIT 100`;
export const missingQuestionFilesSql=`SELECT file.body FROM idx.question_files file
  WHERE file.generation=? AND file.source_key=? AND (?='all' OR file.is_primary=1)
  AND NOT EXISTS (SELECT 1 FROM texts text INDEXED BY text_source_url WHERE text.source_url=file.url)
  ORDER BY file.ordinal`;

export async function discoverQuestionFiles(worker,generation) {
  const {store,languages}=worker;let after='';
  for(;;) {
    const sources=store.db.prepare(changedQuestionsSql).all(generation,after,languages);
    if(!sources.length)return;
    for(const source of sources) {
      // Read the current signature and files in one snapshot, then commit the
      // queue and acknowledgement together. A yield cannot lose changed files.
      store.transaction(()=>{
        store.assertWriter();
        const manifest=store.db.prepare('SELECT signature FROM idx.question_file_sources WHERE generation=? AND source_key=?').get(generation,source.source_key);
        if(!manifest)return;
        for(const row of store.db.prepare(missingQuestionFilesSql).iterate(generation,source.source_key,languages)) {
          const file=JSON.parse(row.body),priority=file.primary?50:10,key='docx:'+file.url;
          if(!store.enqueue(key,'docx',file,priority))store.reopen(key,file,priority);
        }
        store.db.prepare('INSERT OR REPLACE INTO question_discovery VALUES (?,?,?)').run(source.source_key,manifest.signature,languages);
      });
      after=source.source_key;
      await worker.checkpoint();
    }
  }
}
