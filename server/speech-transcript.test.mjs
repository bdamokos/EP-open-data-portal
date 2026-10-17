import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusReader} from './corpus-reader.mjs';
import {server} from './index.mjs';

const id='MTG-PL-2026-10-07-OTH-1',date='2026-10-16T10:00:00Z';
const xml='<oralStatements><speech xml:lang="de"><p>Exact <inline name="i">editorial note</inline> retained.</p></speech></oralStatements>';
test('corpus transcript reads retain XML, exact keys, languages and provenance without writes or upstream requests',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'retained-speech-'));
  const old={CORPUS_ENABLED:process.env.CORPUS_ENABLED,CORPUS_DIR:process.env.CORPUS_DIR};
  const store=new CorpusStore(directory);store.acquire();
  const sourceUrl='https://data.europarl.europa.eu/api/v2/speeches?include-output=xml_fragment';
  store.putDocument({sourceId:id,kind:'speech',date:'2026-10-07',term:10,originalLanguages:['de']},[
    {sourceKey:'mul',language:'de',translationType:'original',sourceFormat:'xml-fragment',sourceUrl,fetchedAt:date,body:'Exact editorial note retained.',raw:xml},
    {sourceKey:'en',language:'en',translationType:'machine',sourceFormat:'xml-fragment',sourceUrl,fetchedAt:date,body:'English retained.',raw:'<speech xml:lang="de-t-en-mtec"><p>English retained.</p></speech>'},
  ]);store.release();
  const before=store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all();
  process.env.CORPUS_ENABLED='true';process.env.CORPUS_DIR=directory;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,originalFetch=globalThis.fetch;
  let upstream=0;
  t.mock.method(globalThis,'fetch',(url,options)=>{if(!String(url).startsWith(base)){upstream++;throw new Error('Upstream forbidden');}return originalFetch(url,options);});
  try {
    const get=(language,suffix='')=>fetch(`${base}/api/poc/speech-transcript/${id}?lang=${language}${suffix}`);
    const response=await get('de'),result=await response.json();
    assert.equal(response.status,200);assert.equal(result.xml,xml);
    assert.equal(result.sourceFragmentKey,'mul');assert.equal(result.textLanguage,'de');assert.equal(result.translationType,'original');
    assert.equal(result.sourceUrl,sourceUrl);assert.equal(result.fetchedAt,date);assert.equal(result.checkedAt,date);
    assert.deepEqual(result.availableTextLanguages,['en','de']);
    assert.equal((await (await get('en')).json()).translationType,'machine');
    assert.deepEqual(await (await get('fr')).json(),{id,available:false},'a missing language remains a miss');
    assert.deepEqual(await (await fetch(`${base}/api/poc/speech-transcript/${id}9?lang=en`)).json(),{id:id+'9',available:false});
    assert.equal((await get('xx')).status,400);assert.equal((await get('en','&lang=fr')).status,400);
    assert.equal((await get('en','&url=https://example.com')).status,400);
    const searchReader=new CorpusReader(directory);
    const searching=searchReader.query('search',{query:'retained'});
    assert.equal((await get('en')).status,200,'search has its own concurrency lane');await searching;
    const readOnly=new CorpusStore(directory,{readOnly:true});
    try{assert.equal(readOnly.speechTranscript({sourceId:id,language:'de'}).xml,xml);}finally{readOnly.close();}
    assert.deepEqual(store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all(),before);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lease').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
    assert.equal(upstream,0);
    store.db.prepare("UPDATE texts SET sha256='invalid' WHERE source_key='en'").run();
    assert.equal((await get('en')).status,500,'corruption is an error, not a miss or an upstream fetch');
    assert.equal(upstream,0);
    process.env.CORPUS_ENABLED='false';assert.deepEqual(await (await get('en')).json(),{id,available:false});
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();
    for(const [key,value] of Object.entries(old))value===undefined?delete process.env[key]:process.env[key]=value;
    rmSync(directory,{recursive:true,force:true});
  }
});
