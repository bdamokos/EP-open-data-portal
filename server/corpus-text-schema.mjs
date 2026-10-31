export const corpusTextVersion=1;
export const corpusTextTable=name=>`CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  language TEXT NOT NULL, source_key TEXT NOT NULL, translation_type TEXT NOT NULL CHECK(translation_type IN ('original','machine','unspecified')),
  source_format TEXT NOT NULL CHECK(source_format IN ('xml-fragment','docx','pdf')), source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL, checked_at TEXT NOT NULL, sha256 TEXT NOT NULL, chars INTEGER NOT NULL,
  body TEXT NOT NULL, raw BLOB, source_edition TEXT, UNIQUE(document_id,source_key))`;
export const corpusTextIndexes=`
  CREATE INDEX IF NOT EXISTS text_language ON texts(language,document_id);
  CREATE INDEX IF NOT EXISTS text_source_url ON texts(source_url);
  CREATE INDEX IF NOT EXISTS text_status_metadata ON texts(document_id,language,chars);
  CREATE TRIGGER IF NOT EXISTS texts_ai AFTER INSERT ON texts BEGIN INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;
  CREATE TRIGGER IF NOT EXISTS texts_ad AFTER DELETE ON texts BEGIN INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); END;
  CREATE TRIGGER IF NOT EXISTS texts_au AFTER UPDATE OF body ON texts BEGIN
    INSERT INTO texts_fts(texts_fts,rowid,body) VALUES ('delete',OLD.id,OLD.body); INSERT INTO texts_fts(rowid,body) VALUES (NEW.id,NEW.body); END;`;

// Called only inside the lease-fenced stopped-app preparation transaction.
// Preserve row IDs and the existing external-content FTS index, without reading
// or recompressing source bodies in JavaScript.
export function prepareCorpusTexts(db) {
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='texts'").get()?.sql;
  if(!schema?.includes("'pdf'")||!db.prepare('PRAGMA table_info(texts)').all().some(column=>column.name==='source_edition')) {
    db.exec(corpusTextTable('texts_pdf'));
    db.exec(`INSERT INTO texts_pdf(id,document_id,language,source_key,translation_type,source_format,source_url,fetched_at,checked_at,sha256,chars,body,raw)
      SELECT id,document_id,language,source_key,translation_type,source_format,source_url,fetched_at,checked_at,sha256,chars,body,raw FROM texts;
      DROP TRIGGER IF EXISTS texts_ai; DROP TRIGGER IF EXISTS texts_ad; DROP TRIGGER IF EXISTS texts_au;
      DROP TABLE texts; ALTER TABLE texts_pdf RENAME TO texts;`);
  }
  db.exec(corpusTextIndexes);
}
