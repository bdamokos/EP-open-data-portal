import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {syncBuiltinESMExports} from 'node:module';
import {CorpusStore} from './corpus-store.mjs';

test('unchanged corpus XML confirms provenance without allocating another compressed copy',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'corpus-ingestion-'));
  const corpus=new CorpusStore(directory,{clock:()=>Date.parse('2026-05-01T00:00:00Z')});
  const compress=zlib.zstdCompressSync;let calls=0;
  zlib.zstdCompressSync=(...args)=>{calls++;return compress(...args);};syncBuiltinESMExports();
  const sourceId='MTG-PL-2026-05-01-OTH-1',firstAt='2026-05-01T00:00:00.000Z',checkedAt='2026-05-02T00:00:00.000Z';
  const document={sourceId,kind:'speech',date:'2026-05-01',term:10,originalLanguages:['en']};
  const text=(language,body)=>({sourceKey:language,language,translationType:'original',sourceFormat:'xml-fragment',sourceUrl:'https://example.test/first',fetchedAt:firstAt,body,raw:`<p xml:lang="${language}">${body}</p>`});
  const texts=[text('en','Ocean protection.'),text('fr','Protection marine.')];
  const rows=()=>corpus.db.prepare('SELECT * FROM texts ORDER BY source_key').all().map(row=>({...row}));
  try{
    assert.equal(corpus.acquire(),true);
    corpus.putDocument(document,texts);assert.equal(calls,2);
    const first=rows();
    assert.equal(first.length,2,'one stored row per language variant');
    calls=0;
    corpus.putDocument(document,texts.map(value=>({...value,fetchedAt:checkedAt,sourceUrl:'https://example.test/rechecked'})));
    assert.equal(calls,0,'an unchanged raw hash must bypass compression');
    const confirmed=rows();
    assert.deepEqual(confirmed,first.map(row=>({...row,checked_at:checkedAt,source_url:'https://example.test/rechecked'})));
    for(const value of texts)assert.equal(corpus.raw(sourceId,value.sourceKey),value.raw);
    assert.equal(corpus.search({query:'ocean',language:'en'}).total,1);

    calls=0;
    const changed=text('en','Agriculture policy.');
    corpus.putDocument(document,[{...changed,fetchedAt:checkedAt},texts[1]]);
    assert.equal(calls,1,'only the changed variant is compressed');
    const updated=rows().find(row=>row.language==='en'),original=first.find(row=>row.language==='en');
    assert.equal(updated.id,original.id);assert.notEqual(updated.sha256,original.sha256);
    assert.equal(corpus.raw(sourceId,'en'),changed.raw);
    assert.equal(corpus.search({query:'ocean'}).total,0);assert.equal(corpus.search({query:'agriculture'}).total,1);

    calls=0;
    corpus.putDocument({sourceId:'E-10-2026-000001',kind:'question'},[{...text('en','Question text.'),sourceFormat:'docx',raw:null}]);
    assert.equal(calls,0);assert.equal(corpus.raw('E-10-2026-000001','en'),null);
    assert.equal(corpus.search({query:'question'}).total,1);
  }finally{
    zlib.zstdCompressSync=compress;syncBuiltinESMExports();
    corpus.close();rmSync(directory,{recursive:true,force:true});
  }
});
