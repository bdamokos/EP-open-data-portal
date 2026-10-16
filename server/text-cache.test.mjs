import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {docxParagraphs,docxContent,allowedDownload,documentText,documentNotes} from './document-text.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {motionBody,compareMotionBodies} from './motion-diff.mjs';

function zip(xml,styles,extra={}) {
  const entries=[['word/document.xml',xml],...(styles===undefined?[]:[['word/styles.xml',styles]]),...Object.entries(extra)],locals=[],directory=[];let offset=0;
  for(const [filename,xml] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
    central.writeUInt32LE(offset,42);locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
test('DOCX extraction preserves paragraph/run breaks and omits deleted text and field instructions',()=>{
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Question &amp; answer</w:t></w:r><w:r><w:br/><w:t>Second line</w:t></w:r><w:del><w:r><w:t>deleted</w:t></w:r></w:del><w:r><w:instrText>HYPERLINK secret-field</w:instrText></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table paragraph</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  assert.deepEqual(docxParagraphs(zip(xml)),['Question & answer\nSecond line','Table paragraph']);
  assert.throws(()=>docxParagraphs(Buffer.from('not zip')));
  assert.throws(()=>docxParagraphs(zip('<!DOCTYPE x><w:document xmlns:w="urn:word"/>')));
  assert.throws(()=>docxParagraphs(zip('<w:document xmlns:w="urn:word"><w:p>'+('a'.repeat(4*1024*1024))+'</w:p></w:document>')));
});
test('official motion hides translation tags and metadata while preserving visible headings, author, date and reference',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/motion-text-live-20261016.json',import.meta.url),'utf8'));
  const paragraphs=docxParagraphs(zip(fixture.documentXml,fixture.stylesXml));
  assert.deepEqual(paragraphs.slice(0,7),['European Parliament','2024-2029','Plenary sitting','B10\u20110431/2026','1.10.2026','MOTION FOR A RESOLUTION','pursuant to Rule 115(2) and (3) and (4)(c) of the Rules of Procedure']);
  assert(paragraphs.includes('Pietro Fiocchi'));assert(paragraphs.includes('on behalf of the ECR Group'));
  assert(paragraphs.includes('(D105447/07 – 2026/2824(RPS))'));
  assert(paragraphs.includes('The European Parliament,'));
  assert(!/[<>{}]/.test(paragraphs.join('\n')));
});
test('official English joint and adopted excerpts retain their literal decimal separators across split runs',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/motion-comparison-excerpts-live-20261016.json',import.meta.url),'utf8'));
  const texts=fixture.documents.map(doc=>docxContent(zip(doc.documentXml,doc.stylesXml)));
  assert.match(texts[0].paragraphs.join(' '),/59\.58/);assert.match(texts[1].paragraphs.join(' '),/59,58/);
  for(const doc of fixture.documents){assert.match(doc.stylesXml,/en-GB/);assert.doesNotMatch(doc.documentXml,/fldSimple|fldChar/);}
  const bodies=texts.map(text=>motionBody(text,'en'));
  assert(bodies.every(body=>body.status==='available'));
  const diff=compareMotionBodies(bodies[0].blocks,bodies[1].blocks);
  assert.equal(diff.summary.changed,2);assert.equal(diff.summary.added,0);assert.equal(diff.summary.removed,0);
  const decimal=diff.rows.find(row=>row.before?.label==='C');
  assert.equal(decimal.segments.filter(part=>part.type==='removed').map(part=>part.text).join(''),'.');
  assert.equal(decimal.segments.filter(part=>part.type==='added').map(part=>part.text).join(''),',');
});
test('hidden runs follow style inheritance and direct on/off overrides without stripping visible angle brackets or braces',()=>{
  const styles='<w:styles xmlns:w="urn:word"><w:style w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:styleId="Derived"><w:basedOn w:val="Hidden"/></w:style><w:style w:styleId="Toggled"><w:basedOn w:val="Hidden"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  const run=(properties,text)=>`<w:r><w:rPr>${properties}</w:rPr><w:t>${text}</w:t></w:r>`;
  const hidden=['','true','on','1'].map(value=>run(`<w:vanish${value?` w:val="${value}"`:''}/>`, 'hidden')).join('');
  const visible=['false','off','0'].map(value=>run(`<w:rStyle w:val="Derived"/><w:vanish w:val="${value}"/>`,'visible ')).join('');
  const xml=`<w:document xmlns:w="urn:word"><w:body><w:p>${hidden}${run('<w:rStyle w:val="Derived"/>','{ECR}')}${visible}${run('<w:rStyle w:val="Toggled"/>','toggled ')}${run('','&lt;Titre&gt; &lt; 5 &amp; {visible}')}<w:r><w:tab/><w:noBreakHyphen/><w:softHyphen/><w:br/><w:t>next line</w:t></w:r></w:p></w:body></w:document>`;
  assert.deepEqual(docxParagraphs(zip(xml,styles)),['visible visible visible toggled <Titre> < 5 & {visible}\t\u2011\u00ad\nnext line']);
});
test('paragraph styles and document defaults supply inherited hidden text with run overrides',()=>{
  const styles='<w:styles xmlns:w="urn:word"><w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"/><w:style w:styleId="Visible"><w:basedOn w:val="Normal"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>hidden</w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>override</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Visible"/></w:pPr><w:r><w:t>visible paragraph</w:t></w:r></w:p></w:body></w:document>';
  assert.deepEqual(docxParagraphs(zip(xml,styles)),['override','visible paragraph']);
});
test('the default character style applies to unstyled runs while explicit styles and visibility overrides take precedence',()=>{
  const styles='<w:styles xmlns:w="urn:word"><w:style w:styleId="Base"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultHidden"><w:basedOn w:val="Base"/></w:style><w:style w:type="character" w:styleId="Visible"/></w:styles>';
  const xml='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>&lt;Titre&gt;</w:t></w:r><w:r><w:rPr/><w:t>{ECR}</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Visible"/></w:rPr><w:t>explicit visible </w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>direct visible</w:t></w:r></w:p></w:body></w:document>';
  assert.deepEqual(docxParagraphs(zip(xml,styles)),['explicit visible direct visible']);
});
test('deep shared style chains preserve toggles across repeated runs and different paragraph visibility',()=>{
  const depth=4096;
  const chain=Array.from({length:depth},(_,i)=>`<w:style w:styleId="S${i}">${i?`<w:basedOn w:val="S${i-1}"/>`:''}${i===0||i===depth/2?'<w:rPr><w:vanish/></w:rPr>':''}</w:style>`).join('');
  const styles=`<w:styles xmlns:w="urn:word">${chain}<w:style w:styleId="HiddenParagraph"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`;
  const runs=`<w:r><w:rPr><w:rStyle w:val="S${depth-1}"/></w:rPr><w:t>A</w:t></w:r>`.repeat(4000);
  const xml=`<w:document xmlns:w="urn:word"><w:body><w:p>${runs}</w:p><w:p><w:pPr><w:pStyle w:val="HiddenParagraph"/></w:pPr>${runs}<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>override</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rStyle w:val="S${depth/2-1}"/></w:rPr><w:t>hidden</w:t></w:r><w:r><w:t>tail</w:t></w:r></w:p></w:body></w:document>`;
  assert.deepEqual(docxParagraphs(zip(xml,styles)),['A'.repeat(4000),'override','tail']);
});
test('cyclic style inheritance fails explicitly instead of depending on style lookup order',()=>{
  const xml='<w:document xmlns:w="urn:word"><w:p><w:r><w:rPr><w:rStyle w:val="A"/></w:rPr><w:t>text</w:t></w:r></w:p></w:document>';
  for(const links of [[['A','A']],[['A','B'],['B','A']]]) {
    const styles='<w:styles xmlns:w="urn:word">'+links.map(([id,parent])=>`<w:style w:styleId="${id}"><w:basedOn w:val="${parent}"/><w:rPr><w:vanish/></w:rPr></w:style>`).join('')+'</w:styles>';
    assert.throws(()=>docxParagraphs(zip(xml,styles)),/Cyclic DOCX style inheritance/);
  }
});
test('style XML receives the same validation and shared decompression bound as document XML',()=>{
  const xml='<w:document xmlns:w="urn:word"><w:p><w:r><w:t>visible</w:t></w:r></w:p></w:document>';
  for(const styles of ['<!DOCTYPE x><w:styles xmlns:w="urn:word"/>','<w:styles>','<w:styles>'+('a'.repeat(4*1024*1024))+'</w:styles>'])assert.throws(()=>docxParagraphs(zip(xml,styles)));
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
  assert.equal(documentNotes({extractionVersion:4,paragraphs:['Text'],notes:[note],anchors:[{paragraph:3,offset:0,note:'1',label:'1'}],links:[]}).notesStatus,'not-extracted');
  assert.equal(documentNotes({extractionVersion:4,paragraphs:['Text'],notes:[note],anchors:[],links:[{paragraph:0,start:0,end:9,url:'https://x.eu'}]}).notesStatus,'not-extracted');
  assert.deepEqual(documentNotes({extractionVersion:4,paragraphs:['Text'],notes:[note],anchors:[{paragraph:0,offset:4,note:'1',label:'1'}],links:[{paragraph:0,start:0,end:4,url:'https://x.eu'}]}).documentLinks,[{paragraph:0,start:0,end:4,url:'https://x.eu'}]);
});
test('ordinary footnotes accept an explicit normal type and exclude separator types',()=>{
  const document='<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>';
  for(const type of [undefined,'normal','separator','continuationSeparator','continuationNotice']) {
    const footnotes=`<w:footnotes xmlns:w="urn:word"><w:footnote w:id="1"${type?` w:type="${type}"`:''}><w:p><w:r><w:footnoteRef/><w:t>Regulation (EU) 2016/679</w:t></w:r></w:p></w:footnote></w:footnotes>`;
    const content=docxContent(zipEntries({'word/document.xml':document,'word/footnotes.xml':footnotes}));
    const ordinary=type===undefined||type==='normal';
    assert.deepEqual(content.paragraphs,['Body']);
    assert.deepEqual(content.notes,ordinary?[{id:'1',label:'1',text:'Regulation (EU) 2016/679',links:[],linkSpans:[]}]:[],String(type));
    assert.deepEqual(content.anchors,ordinary?[{paragraph:0,offset:4,note:'1',label:'1'}]:[],String(type));
  }
});
test('hidden styles apply inside footnotes, around markers and inside hyperlinks',()=>{
  const w='xmlns:w="urn:word" xmlns:r="urn:rel"';
  const styles='<w:styles xmlns:w="urn:word"><w:style w:styleId="Tag"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  const document=`<w:document ${w}><w:body><w:p><w:r><w:rPr><w:rStyle w:val="Tag"/></w:rPr><w:t>&lt;Titre&gt;</w:t></w:r><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`;
  const footnotes=`<w:footnotes ${w}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:rPr><w:rStyle w:val="Tag"/></w:rPr><w:t>{EN}</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>GDPR</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r></w:hyperlink></w:p></w:footnote></w:footnotes>`;
  const rels='<Relationships xmlns="urn:pkg"><Relationship Id="rId1" Target="http://data.europa.eu/eli/reg/2016/679/oj" TargetMode="External"/></Relationships>';
  const content=docxContent(zipEntries({'word/document.xml':document,'word/styles.xml':styles,'word/footnotes.xml':footnotes,'word/_rels/footnotes.xml.rels':rels}));
  assert.deepEqual(content.paragraphs,['Text']);
  assert.deepEqual(content.anchors,[{paragraph:0,offset:4,note:'1',label:'1'}]);
  assert.deepEqual(content.notes,[{id:'1',label:'1',text:'GDPR',links:['http://data.europa.eu/eli/reg/2016/679/oj'],linkSpans:[{start:0,end:4,url:'http://data.europa.eu/eli/reg/2016/679/oj'}]}]);
});
test('body text sharing a run with a footnote reference is kept, and only custom labels are stripped from notes',()=>{
  const w='xmlns:w="urn:word"';
  const document=`<w:document ${w}><w:body><w:p><w:r><w:t>Body before</w:t><w:footnoteReference w:id="1"/><w:t xml:space="preserve"> after.</w:t></w:r></w:p><w:p><w:r><w:t>Custom</w:t></w:r><w:r><w:footnoteReference w:customMarkFollows="1" w:id="2"/><w:t>*</w:t><w:t xml:space="preserve"> tail</w:t></w:r></w:p></w:body></w:document>`;
  const footnotes=`<w:footnotes ${w}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> 1.2 million businesses</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>* Starred note</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const content=docxContent(zipEntries({'word/document.xml':document,'word/footnotes.xml':footnotes}));
  assert.deepEqual(content.paragraphs,['Body before after.','Custom tail']);
  assert.deepEqual(content.anchors,[{paragraph:0,offset:11,note:'1',label:'1'},{paragraph:1,offset:6,note:'2',label:'*'}]);
  assert.deepEqual(content.notes.map(note=>note.text),['1.2 million businesses','Starred note']);
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
    const saved=JSON.parse(await readFile(path.join(dir,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json'),'utf8'));assert.deepEqual(saved.paragraphs,a.paragraphs);assert.equal(saved.extractionVersion,5);
    const clock=()=>Date.now()+2*86400000;
    const stale=await documentText(work,'en',{directory:dir,clock,download:async()=>{throw new Error('upstream500');}});
    assert(stale.stale);assert.deepEqual(stale.paragraphs,a.paragraphs);
    await new Promise(r=>setTimeout(r,2200));
    const after=await documentText(work,'en',{directory:dir,clock,download:async()=>{throw new Error('must not immediately retry');}});
    assert.equal(after.status,'available');assert.equal(after.refreshError,'upstream500');assert.deepEqual(after.paragraphs,a.paragraphs);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('old extracted text is refreshed on demand and current extraction survives a process restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'document-upgrade-test-'));
  try {
    await mkdir(path.join(dir,'document-text-v1'));
    const fixture=JSON.parse(await readFile(new URL('./fixtures/motion-text-live-20261016.json',import.meta.url),'utf8'));
    const paragraphs=docxParagraphs(zip(fixture.documentXml,fixture.stylesXml));
    for(const version of [undefined,1,2,3,4]) {
      const url=`https://data.europarl.europa.eu/distribution/upgrade-${Date.now()}-${version}/motion.docx`;
      const work={identifier:fixture.sourceId,is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
      const file=path.join(dir,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json');
      const old={schemaVersion:1,extractionVersion:version,sourceId:fixture.sourceId,sourceUrl:url,fetchedAt:new Date().toISOString(),paragraphs:['<Date>{01/10/2026}1.10.2026</Date>']};
      await writeFile(file,JSON.stringify(old));let calls=0;
      const result=await documentText(work,'en',{directory:dir,download:async()=>{calls++;return {paragraphs};}});
      assert.equal(result.status,'available');assert.deepEqual(result.paragraphs,paragraphs);assert.equal(calls,1);
      assert.equal(JSON.parse(await readFile(file,'utf8')).extractionVersion,5);
      const script=`const {documentText}=await import(${JSON.stringify(new URL('./document-text.mjs',import.meta.url).href)});const result=await documentText(${JSON.stringify(work)},'en',{directory:${JSON.stringify(dir)},download:async()=>{throw new Error('Unexpected redownload');}});console.log(JSON.stringify(result));`;
      const restarted=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:5000}));
      assert.equal(restarted.status,'available');assert.deepEqual(restarted.paragraphs,paragraphs);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('automatic recital and operative numbering includes style inheritance, overrides and list restarts',()=>{
  const numbering='<w:numbering xmlns:w="urn:word"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="41"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="42"><w:abstractNumId w:val="2"/></w:num><w:num w:numId="43"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num></w:numbering>';
  const styles='<w:styles xmlns:w="urn:word"><w:style w:styleId="Recital"><w:pPr><w:numPr><w:numId w:val="41"/></w:numPr></w:pPr></w:style><w:style w:styleId="Inherited"><w:basedOn w:val="Recital"/><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr></w:style></w:styles>';
  const p=(properties,text)=>`<w:p><w:pPr>${properties}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const num=id=>`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`;
  const xml='<w:document xmlns:w="urn:word"><w:body>'+p('<w:pStyle w:val="Inherited"/>','First recital')+p(num(41),'Second recital')+p(num(42),'First paragraph')+p(num(43),'Restarted paragraph')+p(num(42),'Second paragraph')+'</w:body></w:document>';
  assert.deepEqual(docxContent(zip(xml,styles,{'word/numbering.xml':numbering})),{paragraphs:['A.\tFirst recital','B.\tSecond recital','1.\tFirst paragraph','7.\tRestarted paragraph','2.\tSecond paragraph'],notes:[],anchors:[],links:[],extractionWarnings:[]});
  const unsupported=docxContent(zip(xml,styles,{'word/numbering.xml':numbering.replace('upperLetter','chicago')}));
  assert(unsupported.extractionWarnings.length);
  assert.throws(()=>docxContent(zip(xml,styles,{'word/numbering.xml':'<!DOCTYPE x><w:numbering/>'})));
});
test('footnotes retain visible text, multiple paragraphs and exact references without hidden translation markers',()=>{
  const xml='<w:document xmlns:w="urn:word"><w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="2"/></w:r></w:p></w:document>';
  const notes='<w:footnotes xmlns:w="urn:word"><w:footnote w:type="separator" w:id="-1"/><w:footnote w:id="2"><w:p><w:r><w:footnoteRef/><w:t>Public citation.</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:footnote></w:footnotes>';
  assert.deepEqual(docxContent(zip(xml,undefined,{'word/footnotes.xml':notes})),{paragraphs:['Body'],notes:[{id:'2',label:'1',text:'Public citation.\nSecond paragraph.',links:[],linkSpans:[]}],anchors:[{paragraph:0,offset:4,note:'2',label:'1'}],links:[],extractionWarnings:[]});
  assert.match(docxContent(zip(xml)).extractionWarnings[0],/missing/);
  assert.throws(()=>docxContent(zip(xml,undefined,{'word/footnotes.xml':'<broken>'})));
});
test('automatic numbering preserves citation spans and anchors, and footnote/endnote IDs remain distinct',()=>{
  const xml='<w:document xmlns:w="urn:word" xmlns:r="urn:rels"><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Text </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>CELEX</w:t></w:r></w:hyperlink><w:r><w:footnoteReference w:id="2"/><w:t> end</w:t><w:endnoteReference w:id="2"/></w:r></w:p></w:document>';
  const numbering='<w:numbering xmlns:w="urn:word"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  const note=kind=>`<w:${kind}s xmlns:w="urn:word"><w:${kind} w:type="normal" w:id="2"><w:p><w:r><w:t>${kind} citation</w:t></w:r></w:p></w:${kind}></w:${kind}s>`;
  const rels='<Relationships><Relationship Id="rId1" Target="https://eur-lex.europa.eu/eli/reg/2016/679/oj" TargetMode="External"/></Relationships>';
  const text=docxContent(zip(xml,undefined,{'word/numbering.xml':numbering,'word/_rels/document.xml.rels':rels,'word/footnotes.xml':note('footnote'),'word/endnotes.xml':note('endnote')}));
  assert.equal(text.paragraphs[0],'1.\tText CELEX end');
  assert.equal(text.paragraphs[0].slice(text.links[0].start,text.links[0].end),'CELEX');
  assert.equal(text.anchors[0].offset,text.links[0].end);
  assert.deepEqual(text.notes.map(note=>note.id),['2','endnote:2']);
  assert.deepEqual(text.extractionWarnings,[]);
  assert.equal(documentNotes(text).notesStatus,'extracted');
  assert.equal(motionBody({paragraphs:['The European Parliament,','1.\tBody'],notesStatus:'not-extracted'},'en').status,'unavailable');
});
test('failed extraction upgrade reports the gap and retains the previous disk record',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'document-upgrade-failure-'));
  try {
    await mkdir(path.join(dir,'document-text-v1'));
    const url=`https://data.europarl.europa.eu/distribution/failed-upgrade-${Date.now()}/motion.docx`;
    const work={identifier:'B-10-2026-0431',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
    const file=path.join(dir,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json');
    const old={schemaVersion:1,sourceUrl:url,fetchedAt:new Date().toISOString(),paragraphs:['<Titre>old text</Titre>']};
    await writeFile(file,JSON.stringify(old));
    const result=await documentText(work,'en',{directory:dir,download:async()=>{throw new Error('upstream unavailable');}});
    assert.equal(result.status,'error');assert.deepEqual(result.paragraphs,[]);assert.equal(result.reason,'upstream unavailable');
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),old);
  }finally{await rm(dir,{recursive:true,force:true});}
});
