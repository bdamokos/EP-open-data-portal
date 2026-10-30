// The anti-joins read small manifests and indexed URLs, never source bodies or
// corpus text. Acknowledgements survive generation copies and worker restarts.
export const changedQuestionsSql=`SELECT source.source_key FROM idx.question_file_sources source
  WHERE source.generation=? AND source.source_key>?
  AND NOT EXISTS (SELECT 1 FROM question_discovery seen
    WHERE seen.source_key=source.source_key AND seen.signature=source.signature AND seen.policy=?)
  ORDER BY source.source_key LIMIT 100`;
export const missingQuestionFilesSql=`SELECT file.body FROM idx.question_files file
  WHERE file.generation=? AND file.source_key=? AND (?='all' OR file.is_primary=1)
  AND (NOT EXISTS (SELECT 1 FROM texts text INDEXED BY text_source_url WHERE text.source_url=file.url AND text.chars>0)
    OR EXISTS (SELECT 1 FROM texts text INDEXED BY text_source_url WHERE text.source_url=file.url AND text.chars>0
      AND julianday(json_extract(file.body,'$.edition.issued'))>julianday(text.checked_at))
    OR EXISTS (SELECT 1 FROM tasks prior WHERE prior.key='docx:'||file.url AND (
      json_extract(file.body,'$.edition.byteSize') IS NOT NULL AND json_extract(prior.body,'$.edition.byteSize') IS NOT NULL
        AND json_extract(file.body,'$.edition.byteSize')<>json_extract(prior.body,'$.edition.byteSize')
      OR julianday(json_extract(file.body,'$.edition.issued')) IS NOT NULL AND julianday(json_extract(prior.body,'$.edition.issued')) IS NOT NULL
        AND julianday(json_extract(file.body,'$.edition.issued'))<>julianday(json_extract(prior.body,'$.edition.issued')))))
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
          const prior=store.task(key);
          // A URL's existing retry remains its owner. New metadata can update
          // that owner's selected edition, without resetting its retry clocks.
          if(prior&&!['sourceId','kind','language','url'].every(field=>prior.body[field]===file[field]))continue;
          if(!store.enqueue(key,'docx',file,priority)) {
            if(prior.done)store.reopen(key,file,priority);
            else store.db.prepare('UPDATE tasks SET body=? WHERE key=? AND done=0').run(JSON.stringify({...prior.body,...file}),key);
          }
          const issued=Date.parse(file.edition?.issued);
          if(issued>worker.clock())store.db.prepare('UPDATE tasks SET retry_at=MAX(retry_at,?) WHERE key=? AND done=0').run(issued,key);
        }
        store.db.prepare('INSERT OR REPLACE INTO question_discovery VALUES (?,?,?)').run(source.source_key,manifest.signature,languages);
      });
      after=source.source_key;
      await worker.checkpoint();
    }
  }
}
