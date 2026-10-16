import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {docxParagraphs,docxContent,allowedDownload,documentText,documentNotes} from './document-text.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';

function zip(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
test('DOCX extraction preserves paragraph/run breaks and omits deleted text and field instructions',()=>{
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Question &amp; answer</w:t></w:r><w:r><w:br/><w:t>Second line</w:t></w:r><w:del><w:r><w:t>deleted</w:t></w:r></w:del><w:r><w:instrText>HYPERLINK secret-field</w:instrText></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table paragraph</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  assert.deepEqual(docxParagraphs(zip(xml)),['Question & answer\nSecond line','Table paragraph']);
  assert.throws(()=>docxParagraphs(Buffer.from('not zip')));
  assert.throws(()=>docxParagraphs(zip('<!DOCTYPE x><w:document xmlns:w="urn:word"/>')));
  assert.throws(()=>docxParagraphs(zip('<w:document xmlns:w="urn:word"><w:p>'+('a'.repeat(4*1024*1024))+'</w:p></w:document>')));
});
function zipEntries(entries) {
  const locals=[],centrals=[];let offset=0;
  for(const [file,xml] of Object.entries(entries)) {
    const name=Buffer.from(file),body=Buffer.from(xml),compressed=deflateRawSync(body);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);centrals.push(central,name);offset+=30+name.length+compressed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
// Mirrors the Commission answer markup observed in E-10-2026-000043: a custom mark follows each footnote reference.
test('DOCX footnotes are returned separately with exact marker positions and hyperlink targets',()=>{
  const w='xmlns:w="urn:word" xmlns:r="urn:rel"';
  const document=`<w:document ${w}><w:body><w:p><w:r><w:t xml:space="preserve">  the EMFA with Regulation 139/2004</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:customMarkFollows="1" w:id="3"/><w:t>1</w:t></w:r><w:r><w:t xml:space="preserve"> on concentrations.</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r><w:r><w:footnoteReference w:id="4"/></w:r><w:r><w:t> and again</w:t></w:r><w:r><w:footnoteReference w:id="3"/></w:r></w:p></w:body></w:document>`;
  const footnotes=`<w:footnotes ${w}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="3"><w:p><w:r><w:t>1</w:t></w:r><w:r><w:tab/><w:t>OJ L 24, 29.1.2004, ELI: http://data.europa.eu/eli/reg/2004/139/oj.</w:t></w:r></w:p></w:footnote><w:footnote w:id="4"><w:p><w:r><w:footnoteRef/></w:r><w:hyperlink r:id="rId9"><w:r><w:t>Communication</w:t></w:r></w:hyperlink></w:p></w:footnote><w:footnote w:id="7"><w:p><w:r><w:t>Unreferenced</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const rels='<Relationships xmlns="urn:pkg"><Relationship Id="rId9" Type="hyperlink" Target="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52024DC0225" TargetMode="External"/><Relationship Id="rId10" Type="hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>';
  const content=docxContent(zipEntries({'word/document.xml':document,'word/footnotes.xml':footnotes,'word/_rels/footnotes.xml.rels':rels}));
  assert.deepEqual(content.paragraphs,['the EMFA with Regulation 139/2004 on concentrations.','Second and again']);
  const celexLink='https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52024DC0225';
  assert.deepEqual(content.notes,[{id:'3',label:'1',text:'OJ L 24, 29.1.2004, ELI: http://data.europa.eu/eli/reg/2004/139/oj.',links:[],linkSpans:[]},{id:'4',label:'2',text:'Communication',links:[celexLink],linkSpans:[{start:0,end:13,url:celexLink}]}]);
  assert.deepEqual(content.links,[]);
  assert.deepEqual(content.anchors,[{paragraph:0,offset:33,note:'3',label:'1'},{paragraph:1,offset:6,note:'4',label:'2'},{paragraph:1,offset:16,note:'3',label:'1'}]);
  assert.deepEqual(docxContent(zipEntries({'word/document.xml':document})).notes,[]);
  // Body hyperlinks keep their exact span; a link without text or with a non-web target is not kept.
  const linked=`<w:document ${w}><w:body><w:p><w:r><w:t xml:space="preserve"> See </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>the GDPR</w:t></w:r></w:hyperlink><w:r><w:t> and </w:t></w:r><w:hyperlink r:id="rId2"><w:r><w:t>this file</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId1"/></w:p></w:body></w:document>`;
  const bodyRels='<Relationships xmlns="urn:pkg"><Relationship Id="rId1" Target="http://data.europa.eu/eli/reg/2016/679/oj" TargetMode="External"/><Relationship Id="rId2" Target="file:///C:/template.dotm" TargetMode="External"/></Relationships>';
  const body=docxContent(zipEntries({'word/document.xml':linked,'word/_rels/document.xml.rels':bodyRels}));
  assert.deepEqual(body.paragraphs,['See the GDPR and this file']);
  assert.deepEqual(body.links,[{paragraph:0,start:4,end:12,url:'http://data.europa.eu/eli/reg/2016/679/oj'}]);
  // Records saved before footnote extraction keep their text and report notes as not extracted.
  assert.deepEqual(documentNotes({schemaVersion:1,paragraphs:['Text']}),{notesStatus:'not-extracted',notes:[],noteAnchors:[],documentLinks:[]});
  const note={id:'1',label:'1',text:'n',links:[],linkSpans:[]};
  assert.equal(documentNotes({extractionVersion:3,paragraphs:['Text'],notes:[note],anchors:[{paragraph:3,offset:0,note:'1',label:'1'}],links:[]}).notesStatus,'not-extracted');
  assert.equal(documentNotes({extractionVersion:2,paragraphs:['Text'],notes:[note],anchors:[],links:[]}).notesStatus,'not-extracted');
  assert.equal(documentNotes({extractionVersion:3,paragraphs:['Text'],notes:[note],anchors:[],links:[{paragraph:0,start:0,end:9,url:'https://x.eu'}]}).notesStatus,'not-extracted');
  assert.deepEqual(documentNotes({extractionVersion:3,paragraphs:['Text'],notes:[note],anchors:[{paragraph:0,offset:4,note:'1',label:'1'}],links:[{paragraph:0,start:0,end:4,url:'https://x.eu'}]}).documentLinks,[{paragraph:0,start:0,end:4,url:'https://x.eu'}]);
});
test('document download accepts only API distributions and the observed official redirect host/path',()=>{
  assert(allowedDownload('https://data.europarl.europa.eu/distribution/id/file.docx'));
  assert(allowedDownload('https://redmapl3.europarl.europa.eu/RedmapFront/media/id/file.docx'));
  for(const url of ['https://evil.example/file.docx','http://data.europarl.europa.eu/distribution/file.docx','https://redmapl3.europarl.europa.eu/private/file.docx','https://data.europarl.europa.eu/distribution/file.docx?url=elsewhere','https://user@data.europarl.europa.eu/distribution/file.docx'])assert(!allowedDownload(url));
});
test('background work reserves capacity for interactive reads and queued reads take precedence',async()=>{
  const q=new UpstreamQueue({interval:0});const finishBackground=await q.acquire('background');
  let backgroundStarted=false;const second=q.acquire('background').then(release=>{backgroundStarted=true;return release;});
  const finishRead=await q.acquire('interactive');assert.equal(backgroundStarted,false);assert.equal(q.active,2);
  finishRead();assert.equal(backgroundStarted,false);finishBackground();(await second)();
  const one=await q.acquire(),two=await q.acquire();let order=[];
  const bg=q.acquire('background').then(release=>{order.push('background');return release;});
  const read=q.acquire('interactive').then(release=>{order.push('interactive');return release;});
  one();const done=await read;assert.deepEqual(order,['interactive']);two();(await bg)();done();assert.equal(q.active,0);
});
test('all supplied speech languages survive expired disk cache and failed refresh without interactive waiting',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'speech-text-test-'));
  try {
    const id='MTG-PL-2026-10-07-OTH-2017097993206';
    const url='https://data.europarl.europa.eu/api/v2/speeches/'+id+'?include-output=xml_fragment&format=application%2Fld%2Bjson';
    const langs='bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ');
    const fragments=Object.fromEntries(langs.map(lang=>[lang,`<oralStatements><speech xml:lang="${lang==='es'?'es':'es-t-'+lang+'-mtec'}"><p>Saved ${lang}</p></speech></oralStatements>`]));
    const record={url,fetchedAt:Date.now()-7*3600000,payload:{data:[{activity_id:id,had_activity_type:'def/PLENARY_DEBATE_SPEECH',recorded_in_a_realization_of:[{originalLanguage:['http://publications.europa.eu/resource/authority/language/SPA'],'api:xmlFragment':fragments}]}]}};
    const filename=path.join(dir,createHash('sha256').update(url).digest('hex')+'.json');await writeFile(filename,JSON.stringify(record));
    const script=`let requests=0,finish,refreshCompleted=false;globalThis.fetch=()=>{requests++;return new Promise(resolve=>finish=()=>{refreshCompleted=true;resolve(new Response('{}',{status:500,headers:{'content-type':'application/json'}}));})};const {odpSpeech}=await import(${JSON.stringify(new URL('./odp.mjs',import.meta.url).href)});const began=Date.now();const hu=await odpSpeech(${JSON.stringify(id)},'hu');const elapsed=Date.now()-began,returnedBeforeRefresh=!refreshCompleted;await new Promise(r=>setImmediate(r));finish();await new Promise(r=>setTimeout(r,40));const en=await odpSpeech(${JSON.stringify(id)},'en');console.log(JSON.stringify({hu,en,elapsed,requests,returnedBeforeRefresh}));`;
    const out=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,ODP_CACHE_DIR:dir},encoding:'utf8',timeout:30000}));
    assert(out.returnedBeforeRefresh);assert.equal(out.hu.availableTextLanguages.length,24);assert.equal(out.hu.textLanguage,'hu');assert.equal(out.hu.translationType,'machine');assert(out.hu.textCache.stale);assert(out.en.textCache.refreshError.includes('500'));assert.equal(out.requests,1);
    assert.deepEqual(JSON.parse(await readFile(filename,'utf8')),record);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('document text coalesces cold reads, persists actual language and serves last-good text after refresh failure',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'document-text-test-'));
  const url='https://data.europarl.europa.eu/distribution/test-'+Date.now()+'/answer_ga.docx';
  const work={identifier:'E-10-2026-003031-ASW',originalLanguage:['http://publications.europa.eu/resource/authority/language/ENG'],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/GLE',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
  try {
    let calls=0;const download=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {paragraphs:['Actual answer text']};};
    const [a,b]=await Promise.all([documentText(work,'en',{directory:dir,download}),documentText(work,'ga',{directory:dir,download})]);
    assert.equal(calls,1);assert.equal(a.textLanguage,'ga');assert.equal(a.translationType,'unspecified');assert.equal(a.status,'available');assert.deepEqual(a.paragraphs,b.paragraphs);
    const saved=JSON.parse(await readFile(path.join(dir,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json'),'utf8'));assert.deepEqual(saved.paragraphs,a.paragraphs);
    const clock=()=>Date.now()+2*86400000;
    const stale=await documentText(work,'en',{directory:dir,clock,download:async()=>{throw new Error('upstream500');}});
    assert(stale.stale);assert.deepEqual(stale.paragraphs,a.paragraphs);
    await new Promise(r=>setTimeout(r,2200));
    const after=await documentText(work,'en',{directory:dir,clock,download:async()=>{throw new Error('must not immediately retry');}});
    assert.equal(after.status,'available');assert.equal(after.refreshError,'upstream500');assert.deepEqual(after.paragraphs,a.paragraphs);
  }finally{await rm(dir,{recursive:true,force:true});}
});
