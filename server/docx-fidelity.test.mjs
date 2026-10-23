import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileAsync} from './test-support/subprocess.mjs';
import os from 'node:os';
import path from 'node:path';
import {docxContent,documentText,documentStructure} from './document-text.mjs';
import {runWithRequestSignal,cancelledRequest} from './request-budget.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {HttpError} from './http-utils.mjs';

function zip(document,extra={}) {
  const locals=[],centrals=[],entries=Object.entries({'word/document.xml':document,...extra});let offset=0;
  for(const [file,xml] of entries) {
    const name=Buffer.from(file),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);centrals.push(central,name);offset+=30+name.length+compressed.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
const doc=body=>`<w:document xmlns:w="urn:word" xmlns:r="urn:rel" xmlns:m="urn:math" xmlns:a="urn:drawing" xmlns:mc="urn:compat"><w:body>${body}</w:body></w:document>`;
const run=(text,properties='')=>`<w:r>${properties?`<w:rPr>${properties}</w:rPr>`:''}<w:t>${text}</w:t></w:r>`;
const p=text=>`<w:p>${run(text)}</w:p>`;
const symbol=(font='Symbol',code='F02D')=>`<w:sym w:font="${font}" w:char="${code}"/>`;
const noWait=t=>{const queue=new UpstreamQueue({interval:0});t.mock.method(UpstreamQueue.prototype,'acquire',queue.acquire.bind(queue));};

test('the public CBAM annex continues Point0number across explicit and style-derived numIds',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/docx-numbering-cbam.json',import.meta.url),'utf8'));
  const content=docxContent(zip(fixture.documentXml,{'word/styles.xml':fixture.stylesXml,'word/numbering.xml':fixture.numberingXml}));
  assert.deepEqual(content.paragraphs,fixture.expectedParagraphs);
  assert.deepEqual(content.extractionWarnings,[]);
  assert(content.paragraphSources.every(source=>source.complete));
});

test('a public EP motion with literal labels is identical with unused automatic numbering definitions',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/motion-text-live-20261016.json',import.meta.url),'utf8'));
  const numbering=JSON.parse(await readFile(new URL('./fixtures/docx-numbering-cbam.json',import.meta.url),'utf8'));
  const plain=docxContent(zip(fixture.documentXml,{'word/styles.xml':fixture.stylesXml}));
  const unused=docxContent(zip(fixture.documentXml,{'word/styles.xml':fixture.stylesXml,'word/numbering.xml':numbering.numberingXml}));
  assert.deepEqual(unused,plain);
});

test('all 18 public report citations retain the exact Symbol minus, tab and complete readable wording',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/report-symbol-citations.json',import.meta.url),'utf8'));
  const result=docxContent(zip(fixture.documentXml,{'word/footnotes.xml':fixture.footnotesXml}));
  assert.equal(result.paragraphs.length,18);assert.deepEqual(result.paragraphs,fixture.expectedParagraphs);
  assert(result.paragraphs.every(text=>text.startsWith('−\thaving regard')));
  assert.equal(result.documentObjects.length,18);
  assert(result.documentObjects.every(object=>object.status==='mapped'&&object.replacement==='−'&&object.font==='Symbol'&&object.code==='F02D'&&object.offset===0&&object.role==='leading-marker'));
  assert(result.paragraphSources.every(source=>source.complete&&source.container==='body'));
  assert.equal(result.paragraphSources.length,result.paragraphs.length);
  assert(!result.extractionWarnings.some(warning=>/symbol|object/.test(warning)));
});

test('only explicitly known font/code pairs map; unknown symbols retain metadata and surrounding text',()=>{
  const xml=doc(`<w:p><w:r><w:rPr><w:rFonts w:ascii="Wingdings"/></w:rPr>${symbol()}<w:tab/><w:t>having regard &lt; 5 {visible} </w:t>${symbol('Unknown','F02D')}<w:t> middle </w:t>${symbol('Symbol','F041')}<w:t> end </w:t>${symbol('Symbol','002d')}</w:r></w:p>`);
  const result=docxContent(zip(xml));
  assert.deepEqual(result.paragraphs,['−\thaving regard < 5 {visible} \uFFFC middle \uFFFC end −']);
  assert.deepEqual(result.documentObjects.map(o=>[o.status,o.font,o.code]),[['mapped','Symbol','F02D'],['unresolved','Unknown','F02D'],['unresolved','Symbol','F041'],['mapped','Symbol','002d']]);
  for(const object of result.documentObjects)assert.equal(result.paragraphs[object.paragraph].slice(object.offset,object.offset+1),object.replacement);
  assert.equal(result.paragraphSources[0].complete,false);
});

test('webHidden cascades without toggling, vanish remains independent, and direct false clears only its own property',()=>{
  const styles='<w:styles xmlns:w="urn:word"><w:docDefaults><w:rPrDefault><w:rPr><w:webHidden/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"/><w:style w:type="character" w:styleId="Base"><w:rPr><w:webHidden/></w:rPr></w:style><w:style w:type="character" w:styleId="Again"><w:basedOn w:val="Base"/><w:rPr><w:webHidden/></w:rPr></w:style><w:style w:type="character" w:styleId="Visible"><w:basedOn w:val="Again"/><w:rPr><w:webHidden w:val="false"/></w:rPr></w:style><w:style w:type="character" w:styleId="Both"><w:basedOn w:val="Base"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  const xml=doc(`<w:p>${run('default hidden')}${run('still hidden','<w:rStyle w:val="Again"/>')}${run('styled visible ','<w:rStyle w:val="Visible"/>')}${run('direct visible ','<w:webHidden w:val="0"/>')}${run('vanish remains hidden','<w:rStyle w:val="Both"/><w:webHidden w:val="false"/>')}${run('web remains hidden','<w:rStyle w:val="Both"/><w:vanish w:val="false"/>')}${run('&lt;angle&gt; {brace}','<w:rStyle w:val="Both"/><w:vanish w:val="0"/><w:webHidden w:val="off"/>')}</w:p>`);
  assert.deepEqual(docxContent(zip(xml,{'word/styles.xml':styles})).paragraphs,['styled visible direct visible <angle> {brace}']);
  const defaults='<w:styles xmlns:w="urn:word"><w:style w:type="character" w:default="1" w:styleId="Hidden"><w:rPr><w:webHidden/></w:rPr></w:style></w:styles>';
  assert.deepEqual(docxContent(zip(doc(`<w:p>${run('hidden')}${run('shown','<w:webHidden w:val="false"/>')}</w:p>`),{'word/styles.xml':defaults})).paragraphs,['shown']);
});

test('deleted and moved-from text is excluded at block and inline levels; inserted and moved-to text remains visible',()=>{
  const xml=doc(`<w:p>${run('Current ')}<w:del>${run('deleted')}</w:del><w:moveFrom>${run('moved away')}</w:moveFrom><w:ins>${run('inserted ')}</w:ins><w:moveTo>${run('moved here')}</w:moveTo></w:p><w:del>${p('deleted paragraph')}</w:del><w:moveFrom>${p('old location')}</w:moveFrom><w:ins>${p('new paragraph')}</w:ins><w:moveTo>${p('new location')}</w:moveTo>`);
  const result=docxContent(zip(xml));
  assert.deepEqual(result.paragraphs,['Current inserted moved here','new paragraph','new location']);
  assert.deepEqual(result.paragraphSources.map(s=>s.ordinal),[0,3,4]);
  assert.notEqual(result.paragraphSources[0].segment,result.paragraphSources[1].segment);
});

test('drawings, textual mathematics, ruby and alternate shapes stay explicit objects without leaking child text',()=>{
  const xml=doc(`<w:p>${run('Before ')}<w:r><w:drawing><a:t>drawing text</a:t><w:txbxContent>${p('text box')}</w:txbxContent></w:drawing></w:r>${run(' between ')}<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath><w:r><w:object>${run('object text')}</w:object><w:ruby><w:rubyBase>${run('ruby base')}</w:rubyBase></w:ruby></w:r><mc:AlternateContent><mc:Choice>${run('choice')}</mc:Choice><mc:Fallback>${run('fallback')}</mc:Fallback></mc:AlternateContent>${run(' after')}</w:p>`);
  const result=docxContent(zip(xml));
  assert.deepEqual(result.paragraphs,['Before \uFFFC between \uFFFC\uFFFC\uFFFC\uFFFC after']);
  assert.deepEqual(result.documentObjects.map(o=>o.kind),['drawing','math','object','unsupported','unsupported']);
  assert(result.documentObjects.every(o=>o.status==='unresolved'&&o.role==='content'));
  assert.equal(result.paragraphSources[0].complete,false);
});

test('source paths and segments prevent matching over omitted paragraphs, unsupported blocks, tables and cells',()=>{
  const xml=doc(`${p('First')}${p('Second')}<w:p/>${p('After empty')}<w:p>${run('hidden','<w:vanish/>')}</w:p>${p('After hidden')}<w:altChunk r:id="chunk"/>${p('After block')}<w:tbl><w:tr><w:tc>${p('Cell one A')}${p('Cell one B')}</w:tc><w:tc>${p('Cell two')}</w:tc></w:tr></w:tbl>${p('After table')}`);
  const result=docxContent(zip(xml)),sources=result.paragraphSources;
  assert.deepEqual(result.paragraphs,['First','Second','After empty','After hidden','After block','Cell one A','Cell one B','Cell two','After table']);
  assert.deepEqual(sources.map(s=>s.ordinal),[0,1,3,5,6,7,8,9,10]);
  assert.equal(sources[0].path,'/w:document[1]/w:body[1]/w:p[1]');
  assert.equal(sources[1].segment,sources[0].segment);
  for(const [a,b] of [[1,2],[2,3],[3,4],[4,5],[6,7],[7,8]])assert.notEqual(sources[a].segment,sources[b].segment);
  assert.equal(sources[5].container,'table-cell');assert.equal(sources[5].containerPath,'/w:document[1]/w:body[1]/w:tbl[1]/w:tr[1]/w:tc[1]');
  assert.equal(sources[5].segment,sources[6].segment);assert.equal(sources[5].containerPath,sources[6].containerPath);
  assert.notEqual(sources[6].containerPath,sources[7].containerPath);
  assert.equal(sources[8].container,'body');assert.equal(sources[8].containerPath,sources[0].containerPath);
});

test('note section settings stay aligned after section-ending paragraphs inside omitted blocks',()=>{
  const section=(format,start)=>`<w:sectPr><w:footnotePr><w:numFmt w:val="${format}"/><w:numStart w:val="${start}"/><w:numRestart w:val="eachSect"/></w:footnotePr></w:sectPr>`;
  const skipped=`<w:p><w:pPr>${section('upperLetter',4)}</w:pPr>${run('omitted')}</w:p>`;
  const note='<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Source</w:t></w:r></w:p></w:footnote></w:footnotes>';
  for(const wrapper of ['mc:AlternateContent','w:del','w:moveFrom']) {
    const xml=doc(`<${wrapper}>${skipped}</${wrapper}><w:p>${run('Visible')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>${section('decimal',1)}`);
    const result=docxContent(zip(xml,{'word/footnotes.xml':note}));
    assert.deepEqual(result.paragraphs,['Visible']);assert.equal(result.notes[0].label,'1',wrapper);assert.equal(result.anchors[0].label,'1',wrapper);
  }
});

test('skipped list items and note references leave later automatic labels explicitly unknown',()=>{
  const numbering='<w:numbering><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const item=(text,id)=>`<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}<w:r><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
  const notes='<w:footnotes>'+[1,2,3].map(id=>`<w:footnote w:id="${id}">${p('Source '+id)}</w:footnote>`).join('')+'</w:footnotes>';
  const extra={'word/numbering.xml':numbering,'word/footnotes.xml':notes};
  const result=docxContent(zip(doc(item('First',1)+`<mc:AlternateContent><mc:Choice>${item('Unobserved',2)}</mc:Choice></mc:AlternateContent>`+item('Last',3)),extra));
  assert.deepEqual(result.paragraphs,['1.\tFirst','?\tLast']);
  assert.deepEqual(result.notes.map(note=>[note.id,note.label]),[['1','1'],['3','?']]);
  assert.equal(result.paragraphSources[1].complete,false);
  assert(result.extractionWarnings.some(warning=>/list labels are unknown/.test(warning)));
  assert(result.extractionWarnings.some(warning=>/note labels are unknown/.test(warning)));
  // A single unresolved glyph cannot consume paragraph or note counters.
  const glyph=docxContent(zip(doc(item('First',1).replace('<w:t>First</w:t>',`${symbol('Unknown')}<w:t>First</w:t>`)+item('Last',3)),extra));
  assert.deepEqual(glyph.paragraphs,['1.\t\uFFFCFirst','2.\tLast']);assert.deepEqual(glyph.notes.map(note=>note.label),['1','2']);
  for(const wrapper of ['w:del','w:moveFrom']) {
    const deleted=docxContent(zip(doc(item('First',1)+`<${wrapper}>${item('Deleted',2)}</${wrapper}>`+item('Last',3)),extra));
    assert.deepEqual(deleted.paragraphs,['1.\tFirst','2.\tLast']);assert.deepEqual(deleted.notes.map(note=>note.label),['1','2']);
  }
  // Inline shapes containing unobserved paragraphs also retain the counter gap.
  const shape=docxContent(zip(doc(`<w:p>${run('Before')}<w:r><w:drawing><w:txbxContent>${item('Unobserved',2)}</w:txbxContent></w:drawing></w:r></w:p>`+item('Last',3)),extra));
  assert.deepEqual(shape.paragraphs,['Before\uFFFC','?\tLast']);assert.equal(shape.notes[0].label,'?');
});

test('symbol and object positions remain aligned with numbering, hyperlinks and mixed note anchors',()=>{
  const numbering='<w:numbering><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const xml=doc(`<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r>${symbol()}<w:tab/></w:r><w:hyperlink r:id="link">${run('citation')}</w:hyperlink><w:r><w:footnoteReference w:id="1"/>${symbol('Other','F02D')}<w:endnoteReference w:id="2"/></w:r></w:p>`);
  const result=docxContent(zip(xml,{'word/numbering.xml':numbering,'word/_rels/document.xml.rels':'<Relationships><Relationship Id="link" TargetMode="External" Target="https://example.org/source"/></Relationships>','word/footnotes.xml':'<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Footnote</w:t></w:r></w:p></w:footnote></w:footnotes>','word/endnotes.xml':'<w:endnotes><w:endnote w:id="2"><w:p><w:r><w:endnoteRef/><w:t>Endnote</w:t></w:r></w:p></w:endnote></w:endnotes>'}));
  assert.deepEqual(result.paragraphs,['1.\t−\tcitation\uFFFC']);
  assert.deepEqual(result.links,[{paragraph:0,start:5,end:13,url:'https://example.org/source'}]);
  assert.deepEqual(result.anchors,[{paragraph:0,offset:13,note:'1',label:'1'},{paragraph:0,offset:14,note:'endnote:2',label:'1'}]);
  assert.deepEqual(result.documentObjects.map(o=>o.offset),[3,13]);
});

test('legacy and malformed structure is unknown even when cached paragraphs are readable',()=>{
  const content=docxContent(zip(doc(p('Readable')))),record={extractionVersion:8,...content};
  assert.equal(documentStructure(record).structureStatus,'extracted');
  for(const bad of [{...record,extractionVersion:6},{...record,paragraphSources:[]},{...record,paragraphSources:[{...record.paragraphSources[0],ordinal:-1}]},{...record,structureStatus:undefined}]) {
    assert.deepEqual(documentStructure(bad),{structureStatus:'not-extracted',paragraphSources:[],documentObjects:[]});
  }
  const object=docxContent(zip(doc(`<w:p><w:r>${symbol('Unknown')}</w:r></w:p>`)));
  assert.equal(documentStructure({extractionVersion:8,...object}).structureStatus,'extracted');
  assert.equal(documentStructure({extractionVersion:8,...object,paragraphSources:[{...object.paragraphSources[0],complete:true}]}).structureStatus,'not-extracted');
});

test('structure and source provenance survive persistence and settled retention without a cold refresh',async t=>{
  noWait(t);const directory=await mkdtemp(path.join(os.tmpdir(),'docx-structure-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const url=`https://data.europarl.europa.eu/distribution/structure-${Date.now()}/report.docx`,source={byteSize:89244,issued:'2026-09-23T13:04:11+02:00'};
  const work={identifier:'A-10-2026-0237',document_date:'2026-09-16',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url,...source}]}]};
  const content=docxContent(zip(doc(p('Retained'))));let calls=0;
  const result=await documentText(work,'en',{directory,clock:()=>Date.parse('2026-12-01'),download:async()=>{calls++;return content;}});
  assert.equal(calls,1);assert.equal(result.extractionVersion,8);assert.deepEqual(result.sourceVersion,source);assert.equal(result.structureStatus,'extracted');
  const file=path.join(directory,'document-text-v1',createHash('sha256').update(url).digest('hex')+'.json'),saved=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(saved.paragraphSources,content.paragraphSources);
  const script=`const {documentText}=await import(${JSON.stringify(new URL('./document-text.mjs',import.meta.url).href)});console.log(JSON.stringify(await documentText(${JSON.stringify(work)},'en',{directory:${JSON.stringify(directory)},clock:()=>Date.parse('2027-12-01'),download:async()=>{throw new Error('Unexpected cold refresh');}})));`;
  const restarted=JSON.parse((await execFileAsync(t,process.execPath,['--input-type=module','-e',script],{encoding:'utf8'})).stdout);
  assert.equal(restarted.stale,false);assert.equal(restarted.refreshInProgress,false);assert.equal(restarted.structureStatus,'extracted');assert.deepEqual(restarted.paragraphSources,result.paragraphSources);assert.deepEqual(restarted.sourceVersion,source);
});

test('local reader cancellation leaves the shared extraction and later retained structure usable',async t=>{
  noWait(t);const url=`https://data.europarl.europa.eu/distribution/cancel-structure-${Date.now()}/report.docx`;
  const work={identifier:'A-10-2026-0237',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]},controller=new AbortController();
  let finish,calls=0;const download=()=>{calls++;return new Promise(resolve=>{finish=()=>resolve(docxContent(zip(doc(p('Survives')))));});};
  const first=runWithRequestSignal(controller.signal,()=>documentText(work,'en',{directory:null,download}));
  const rejected=assert.rejects(first,error=>error.code==='request_cancelled');
  const second=documentText(work,'en',{directory:null,download});
  for(let i=0;i<100&&!finish;i++)await new Promise(resolve=>setImmediate(resolve));
  assert(finish);controller.abort(cancelledRequest());await rejected;finish();
  const result=await second;assert.equal(calls,1);assert.equal(result.structureStatus,'extracted');assert.deepEqual(result.paragraphs,['Survives']);
  assert.equal((await documentText(work,'en',{directory:null,download:()=>{throw new Error('Must stay retained');}})).structureStatus,'extracted');
});

for(const code of ['upstream_busy','request_timeout'])test(`cold DOCX reads propagate ${code} while stale retained text survives a background local failure`,async t=>{
  noWait(t);const url=`https://data.europarl.europa.eu/distribution/local-failure-${code}-${Date.now()}/report.docx`;
  const work={identifier:'A-10-2026-0237',document_date:'2026-10-01',is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'file-type/DOCX',is_exemplified_by:url}]}]};
  const failure=Object.assign(new HttpError(503,code,'Retry this reader later.'),{retryAfter:1});let calls=0;
  await assert.rejects(documentText(work,'en',{directory:null,download:async()=>{calls++;throw failure;}}),error=>error===failure&&error.status===503);
  const content=docxContent(zip(doc(p('Retained')))),clock=()=>Date.parse('2026-10-02');
  const recovered=await documentText(work,'en',{directory:null,clock,download:async()=>{calls++;return content;}});
  assert.equal(calls,2,'a local failure must not poison source retry state');assert.deepEqual(recovered.paragraphs,['Retained']);
  let refreshFailed=false;
  const stale=await documentText(work,'en',{directory:null,clock:()=>clock()+8*86400000,download:async()=>{calls++;refreshFailed=true;throw failure;}});
  assert.equal(stale.status,'available');assert.equal(stale.stale,true);assert.deepEqual(stale.paragraphs,['Retained']);
  for(let i=0;i<100&&!refreshFailed;i++)await new Promise(resolve=>setImmediate(resolve));
  assert(refreshFailed);await new Promise(resolve=>setImmediate(resolve));
  const retained=await documentText(work,'en',{directory:null,clock,download:()=>{throw new Error('No cold refresh after local failure');}});
  assert.equal(retained.status,'available');assert.deepEqual(retained.paragraphSources,recovered.paragraphSources);assert.equal(retained.refreshError,null);
});
