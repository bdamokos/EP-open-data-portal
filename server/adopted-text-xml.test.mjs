import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {adoptedTextXmlSources,readAdoptedTextXml,ADOPTED_TEXT_XML_LIMITS} from './adopted-text-xml.mjs';
import {documentText,documentNotes,documentStructure,documentFormatting} from './document-text.mjs';
import {DOCX_EXTRACTION_VERSION} from './docx-source-structure.mjs';
import {DOCX_FORMATTING_VERSION} from './docx-formatting.mjs';

const fixtures=JSON.parse(await readFile(new URL('./fixtures/adopted-text-xml-excerpts.json',import.meta.url),'utf8'));
const fixture=(suffix,language='en')=>fixtures.find(f=>f.id.endsWith(suffix)&&f.language===language);
const read=f=>readAdoptedTextXml(Buffer.from(f.xml),{work:f.work,language:f.language,sourceUrl:f.source.url,fetchedAt:f.source.retrievedAt});
const mutate=(f,xml)=>({...f,xml,work:{...f.work,is_realized_by:f.work.is_realized_by.map(e=>({...e,is_embodied_by:e.is_embodied_by.map(m=>({...m,byteSize:undefined}))}))}});

test('public fixtures preserve original observations and expose excerpts as incomplete sources',()=>{
  for(const f of fixtures) {
    assert.equal(createHash('sha256').update(f.xml).digest('hex'),f.excerptHash);
    const result=read(f);
    assert.equal(result.source.documentId,f.id);assert.equal(result.source.language,f.language);
    assert.equal(result.source.url,f.source.url);assert.equal(result.source.fetchedAt,f.source.retrievedAt);
    assert.equal(result.source.contentHash,f.excerptHash);
    assert.equal(result.nativeComplete,f.coverage.complete);
    assert.deepEqual(result.gaps.map(g=>g.code),f.coverage.complete?[]:['source-size-conflict']);
    assert.equal(result.preference,'held');assert.equal(result.sourceKind,'ep-adopted-text-xml');
    assert(!('paragraphs' in result));assert(!('adoption' in result));
    assert.deepEqual(result.links,[]);
    assert(result.blocks.every(b=>!b.text.includes('Rapporteur:')));
    assert(result.hidden.length>0);
  }
});

test('decision labels retain Roman and unnumbered actions without a guessed hierarchy',()=>{
  const result=read(fixture('0001'));
  assert.deepEqual(result.components.map(c=>c.kind),['decision']);
  const actions=result.blocks.filter(b=>b.path.includes('/ACTION['));
  assert.equal(actions.length,28);
  assert.deepEqual(actions.map(b=>b.label?.text??null),['1.','I.','II.','III.','IV.','V.','VI.','VII.','VIII.','IX.','X.','XI.','XII.','XIII.','XIV.','XV.','XVI.','XVII.','XVIII.','XIX.','XX.',null,null,null,null,'2.','3.','4.']);
  assert.equal(result.source.version.status,'DEF1');
  assert(result.notes.every(n=>n.label===null));
  assert.deepEqual(result.notes.map(n=>n.ordinal),[0,1,2]);
});

test('resolution headings, separator rows, recitals and note-reference offsets remain ordered',()=>{
  const result=read(fixture('0247'));
  const headings=result.blocks.filter(b=>b.element==='ACTINIT');
  assert.equal(headings.length,6);
  assert.equal(result.containers.filter(c=>c.element==='ACTLST').length,6);
  const separator=result.containers.find(c=>c.element==='SEPARATION');
  assert.deepEqual(result.blocks.slice(separator.extent.start,separator.extent.end).map(b=>b.text),['°','°         °']);
  const reference=result.blocks.find(b=>b.notes.length===2);
  assert(reference);assert(reference.notes[0].offset<reference.notes[1].offset);
  for(const anchor of reference.notes)assert(result.notes.some(n=>n.path===anchor.path));
  assert(result.blocks.some(b=>b.element==='P'&&b.label?.text==='A.'));
});

test('multiple text lists and the legislative position retain their complete native extents',()=>{
  const result=read(fixture('0241'));
  assert.equal(result.textLists.length,2);
  assert.deepEqual(result.components.map(c=>c.kind),['resolution','legislative-position']);
  assert.equal(result.textLists[1].identifiers[0].text,'P10_TC1-COD(2025)0407');
  assert.equal(result.source.version.status,null);
  const [resolution,position]=result.components;
  assert(resolution.extent.end<=position.extent.start);
  assert(result.blocks.slice(resolution.extent.start,resolution.extent.end).every(b=>!b.path.includes('/TCONSOLID[')));
  const articles=result.containers.filter(c=>c.element==='ARTICLE');
  assert.equal(articles.length,3);
  assert.deepEqual(articles.map(a=>result.blocks[a.extent.start].text),['Article 1','Article 2','Article 3']);
  assert.equal(result.blocks.filter(b=>b.element==='PARAG').length,5);
  assert.equal(result.notes.length,6);assert(result.notes.every(n=>n.label===null));
  // Note ordinals are source order, never the Word section's restarting display labels.
  assert.equal(result.notes[1].ordinal,1);
  assert.equal(result.notes[1].text,result.notes[0].text.trim());
  const emphatic=result.blocks.find(b=>b.text.includes('territorial cohesion'));
  for(const kind of ['bold','italic'])assert(emphatic.marks.some(m=>m.kind===kind&&emphatic.text.slice(m.start,m.end).includes('territorial cohesion')));
  assert(result.blocks.some(b=>b.breaks.length===1&&b.text.endsWith('\n')));
});

test('adopted comparisons preserve repeated pairs, all eight superscripts and explicitly empty old columns',()=>{
  const result=read(fixture('0330'));
  assert.deepEqual(result.components.map(c=>c.kind),['resolution','adopted-amendments']);
  assert.deepEqual(result.amendments.map(a=>a.pairs.length),[3,3,2,6]);
  assert.deepEqual(result.amendments.map(a=>a.title.map(i=>result.blocks[i].text)),[['Amendment\t\t11'],['Amendment\t\t17'],['Amendment\t\t18'],['Amendment\t\t31']]);
  const amendments=result.components[1];
  assert.equal(amendments.parent,result.components[0].path);
  assert(result.components[0].content.every(i=>!amendments.content.includes(i)));
  assert.equal(result.blocks.flatMap(b=>b.marks).filter(m=>m.kind==='superscript').length,8);
  const pairs=result.amendments.flatMap(a=>a.pairs);
  assert.equal(pairs.filter(p=>p.old.empty).length,7);
  for(const pair of pairs) {
    assert(pair.old.extent.end<=pair.new.extent.start);
    if(pair.old.empty)assert.equal(pair.old.extent.start,pair.old.extent.end);
  }
  assert.deepEqual(result.blocks.filter(b=>['HEAD.OLD','HEAD.NEW'].includes(b.element)).map(b=>b.text),['Text proposed by the Council','Amendment']);
});

test('selected language and exact adopted-text identities determine the declared XML source',()=>{
  const f=fixture('0339','hu'),source=adoptedTextXmlSources(f.work,'hu');
  assert.equal(source.status,'declared');assert.equal(source.sources[0].language,'hu');
  assert(source.sources[0].url.endsWith('_hu.xml'));assert.equal(adoptedTextXmlSources(f.work,'en').status,'unavailable');
  assert.equal(adoptedTextXmlSources({...f.work,id:'eli/dl/doc/TA-10-2026-0001'},'hu').reason,'adopted-identity-unverified');
  assert.equal(adoptedTextXmlSources({...f.work,work_type:'def/ep-document-types/AMENDMENT_LIST'},'hu').reason,'adopted-identity-unverified');
  assert.equal(adoptedTextXmlSources({...f.work,identifier:'A-10-2026-0339'},'hu'),null);
  const replaced=structuredClone(f.work);replaced.is_realized_by[0].is_embodied_by.find(m=>m.format.endsWith('/XML')).is_exemplified_by='distribution/native/published-content';
  assert.equal(adoptedTextXmlSources(replaced,'hu').sources[0].url,'https://data.europarl.europa.eu/distribution/native/published-content');
  replaced.is_realized_by[0].is_embodied_by.find(m=>m.format.endsWith('/XML')).is_exemplified_by='https://example.test/content.xml';
  assert.equal(adoptedTextXmlSources(replaced,'hu').reason,'xml-distribution-unusable');
  assert.deepEqual(adoptedTextXmlSources(replaced,'hu').gaps,['xml-source-unapproved']);
  assert.throws(()=>readAdoptedTextXml(Buffer.from(f.xml),{work:f.work,language:'en',sourceUrl:f.source.url}),{code:'xml-not-declared'});
  assert.throws(()=>read({...f,xml:f.xml.replace('P10_TA(2026)0339','P10_TA(2026)0330')}),{code:'native-identity-mismatch'});
  assert.throws(()=>read({...f,work:{...f.work,notation_publicRegister:'P10_TA(2026)0330'}}),{code:'native-identity-mismatch'});
  assert.throws(()=>readAdoptedTextXml(Buffer.from(f.xml),{work:f.work,language:'hu',sourceUrl:f.source.url.replace('.xml','.docx')}),{code:'undeclared-xml-source'});
});

test('different issue dates and conflicting versions stay observations, never equivalence evidence',()=>{
  for(const f of [fixture('0001'),fixture('0339')]) {
    const source=adoptedTextXmlSources(f.work,f.language),declared=f.work.is_realized_by[0].is_embodied_by;
    assert.notEqual(source.sources[0].issued,declared.find(m=>m.format.endsWith('/DOCX')).issued);
    assert.equal(source.reason,'fidelity-verification-required');assert.equal(source.preference,'held');
  }
  const f=fixture('0339'),work=structuredClone(f.work),xml=work.is_realized_by[0].is_embodied_by.find(m=>m.format.endsWith('/XML'));
  work.is_realized_by[0].is_embodied_by.push({...xml,issued:'2026-10-20T00:00:00Z'});
  assert.equal(adoptedTextXmlSources(work,'en').status,'ambiguous');
  assert.throws(()=>read({...f,work}),{code:'conflicting-xml-distributions'});
});

test('unrecognised objects and formatting remain explicit; hidden material never supplies wording',()=>{
  const f=fixture('0241'),changed=mutate(f,f.xml.replace('Austria shall inform','<IMAGE SRC="published.png"/>Austria shall inform'));
  const parsed=read(changed);
  assert.equal(parsed.nativeComplete,false);assert(parsed.gaps.some(g=>g.code==='unsupported-object'));
  const object=parsed.objects[0];assert.equal(parsed.blocks[object.block].text[object.offset],'\uFFFC');
  const unknown=read(mutate(f,f.xml.replace('Austria shall inform','<STRING SUBSCRIPT="on">x</STRING>Austria shall inform')));
  assert.equal(unknown.nativeComplete,false);assert(unknown.gaps.some(g=>g.code==='unsupported-attribute'&&g.attribute==='SUBSCRIPT'));
  assert.equal(unknown.blocks.find(b=>b.text.startsWith('xAustria')).marks.length,0);
  const hidden=read(mutate(f,f.xml.replace('Austria shall inform','<STRING HIDDEN="on">not visible</STRING>Austria shall inform')));
  assert(hidden.blocks.every(b=>!b.text.includes('not visible')));
  const incomplete=read(mutate(f,f.xml.replace('<FIELD>','<UNSUPPORTED>',1).replace('</FIELD>','</UNSUPPORTED>',1)));
  assert(incomplete.gaps.some(g=>g.code==='unsupported-footnote'));
});

test('XML bounds, declarations, malformed content and invalid numeric references fail closed',()=>{
  const f=fixture('0001');
  for(const xml of ['<!DOCTYPE SDOCTA SYSTEM "https://example.test/TA.dtd">'+f.xml,f.xml.replace('<SDOCTA','<!ENTITY x "text"><SDOCTA'),f.xml.replace('</SDOCTA>',''),f.xml.replace('Numerical','&#xD800;'),f.xml.replace('Numerical','&unknown;')])assert.throws(()=>read({...f,xml}));
  assert.throws(()=>read({...f,xml:'x'.repeat(ADOPTED_TEXT_XML_LIMITS.bytes+1)}),{code:'xml-size'});
  assert.throws(()=>readAdoptedTextXml(Buffer.from([0xFF]),{work:f.work,language:f.language,sourceUrl:f.source.url}),{code:'xml-encoding'});
  // A quoted '>' must not defeat the parser's own nesting bound.
  assert.throws(()=>read(mutate(f,f.xml.replace('Numerical','<STRING A="/> ">'.repeat(70)+'x'+'</STRING>'.repeat(70)))));
});

test('the existing document reader keeps the complete DOCX result and source identity while XML preference is held',async()=>{
  const f=fixture('0241'),work=structuredClone(f.work),docx=work.is_realized_by[0].is_embodied_by.find(m=>m.format.endsWith('/DOCX'));
  docx.is_exemplified_by='distribution/doc/ta-xml-fallback-test.docx';
  const content={paragraphs:['Full source \uFFFC with a note.'],structureStatus:'extracted',paragraphSources:[{path:'/w:document[1]/w:body[1]/w:p[1]',ordinal:0,container:'body',containerPath:'/w:document[1]/w:body[1]',segment:0,complete:false}],
    documentObjects:[{paragraph:0,offset:12,path:'/w:document[1]/w:body[1]/w:p[1]/w:r[1]/w:drawing[1]',kind:'drawing',status:'unresolved',replacement:'\uFFFC',role:'content'}],
    notes:[{id:'n',label:'1',text:'Exact linked note.',links:['https://example.test/public'],linkSpans:[{start:6,end:12,url:'https://example.test/public'}]}],
    anchors:[{paragraph:0,offset:25,note:'n',label:'1'}],links:[{paragraph:0,start:0,end:4,url:'https://example.test/body'}],
    formattingVersion:DOCX_FORMATTING_VERSION,paragraphFormats:[{marks:[{start:0,end:4,kind:'bold'}]}],tables:[],resolvedSourceUrl:'https://redmapl3.europarl.europa.eu/RedmapFront/media/ta-xml-fallback-test.docx'};
  let calls=0;
  const result=await documentText(work,'en',{directory:null,clock:()=>Date.parse('2026-10-28T12:00:00Z'),download:async url=>{calls++;assert(url.endsWith('.docx'));return content;}});
  assert.equal(calls,1);assert.equal(result.sourceFormat,'DOCX');assert.equal(result.sourceUrl,'https://data.europarl.europa.eu/'+docx.is_exemplified_by);
  assert.deepEqual(result.paragraphs,content.paragraphs);
  const record={...content,extractionVersion:DOCX_EXTRACTION_VERSION};
  for(const contract of [documentNotes(record),documentStructure(record),documentFormatting(record)])for(const [key,value] of Object.entries(contract))assert.deepEqual(result[key],value,key);
  assert.equal(result.adoptedTextXml.preference,'held');assert.equal(result.adoptedTextXml.status,'declared');
  assert.deepEqual(result.sourceVersion,{byteSize:Number(docx.byteSize),issued:docx.issued});
  const onlyXml={...work,is_realized_by:work.is_realized_by.map(e=>({...e,is_embodied_by:e.is_embodied_by.filter(m=>m.format.endsWith('/XML'))}))};
  assert.equal((await documentText(onlyXml,'en',{directory:null,download:()=>assert.fail('unverified XML must not be preferred')})).status,'unavailable');
});
