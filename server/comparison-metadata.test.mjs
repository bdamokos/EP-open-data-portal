import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';
import {sourceObservation,comparisonMetadata,xhtmlNoteMetadata} from './comparison-metadata.mjs';
import {amendmentOperation} from './document-context-model.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/comparison-metadata-excerpts.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const input=example=>({observation:example.observation,native:{...example.native,observationId:sourceObservation(example.observation).observationId},amendment:example.expectedFields});
const parse=xml=>new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);

// Independent read of the attributed native XML excerpts. This does not use
// amendment extraction, its normaliser, a placement parser or benchmark oracle.
function nativeNodes(xml,rootPath) {
  const found=new Map();
  function visit(nodes,parent,first=false) {
    const counts=new Map();
    for(const node of nodes)for(const [name,value] of Object.entries(node)) {
      if(name===':@'||name==='#text'||name.startsWith('?'))continue;
      const count=(counts.get(name)||0)+1;counts.set(name,count);
      const path=first?rootPath:parent+'/'+name+'['+count+']';
      found.set(path,{name,value});if(Array.isArray(value))visit(value,path);
    }
  }
  visit(parse(xml),'',true);return found;
}
function wordText(node) {
  if(node.name==='w:t')return node.value.map(x=>x['#text']||'').join('');
  if(node.name==='w:tab')return '\t';
  if(['w:br','w:cr'].includes(node.name))return '\n';
  if(node.name==='w:noBreakHyphen')return '\u2011';
  if(node.name==='w:softHyphen')return '\u00ad';
  return (node.value||[]).flatMap(x=>Object.entries(x).filter(([key])=>key!==':@').map(([name,value])=>wordText({name,value}))).join('');
}
function verifyField(field,nodes,example) {
  let rawAt=0,fieldAt=0;
  for(const region of field.regions) {
    assert.equal(region.rawStart,rawAt);assert.equal(region.rawEnd,rawAt+region.rawText.length);rawAt=region.rawEnd;
    assert.equal(region.native.partSha256,example.native.partSha256);
    assert(nodes.has(region.native.path),region.native.path);
    if(region.kind!=='structural-join') {
      assert.equal(region.rawText,wordText(nodes.get(region.native.path)));
      assert.deepEqual(region.native.range,{start:0,end:region.rawText.length,unit:'utf16'});
    } else {
      assert.equal(region.rawText,'\n');assert(region.join==='row-newline'||region.join==='paragraph-newline');
      for(const endpoint of region.between)assert(nodes.has(endpoint.path));
    }
    const slice=region.fieldSlice;
    assert.equal(slice.fieldSha256,sha(field.text));assert.equal(slice.start,fieldAt);fieldAt=slice.end;
    if(slice.mapping==='exact')assert.equal(field.text.slice(slice.start,slice.end),region.rawText);
    else assert.equal(slice.mapping,'explicit-whitespace-map');
  }
  assert.equal(rawAt,field.rawText.length);assert.equal(fieldAt,field.text.length);
  assert.equal(field.regions.map(r=>r.rawText).join(''),field.rawText);
  assert.equal(field.mapping.segments.map(s=>s.rawText).join(''),field.rawText);
  assert.equal(field.mapping.segments.map(s=>s.text).join(''),field.text);
  for(const segment of field.mapping.segments) {
    assert.equal(field.rawText.slice(segment.rawStart,segment.rawEnd),segment.rawText);
    assert.equal(field.text.slice(segment.start,segment.end),segment.text);
  }
  for(const marker of field.markers) {
    assert.equal(wordText(nodes.get(marker.native.path)),marker.rawText);
    assert.equal(marker.native.range.start,0);assert.equal(marker.native.range.end,marker.rawText.length);
    assert.equal(field.text.slice(marker.fieldSlice.start,marker.fieldSlice.end),marker.rawText);
    assert.equal(marker.nativeReferenceId,null);assert.equal(marker.targetNativeId,null);
  }
  for(const separator of field.separators) {
    assert.equal(wordText(nodes.get(separator.native.path)),separator.rawText);
    if(separator.fieldSlice.mapping==='exact')assert.equal(field.text.slice(separator.fieldSlice.start,separator.fieldSlice.end),separator.rawText);
    else assert.equal(separator.fieldSlice.start,separator.fieldSlice.end,'The published trailing tab is retained as an explicit field omission');
    assert.match(separator.kind,/^word-(?:tab|ptab|br|cr)$/);
  }
  for(const definition of field.definitions) {
    assert.equal(wordText(nodes.get(definition.native[0].path)),definition.text);
    assert.equal(definition.textHash,sha(definition.text));
    assert.equal(field.text.slice(definition.fieldSlice.start,definition.fieldSlice.end),definition.text);
    assert.deepEqual(definition.links,[],'The selected Word URLs have no native link');
    for(const url of definition.literalUrls) {
      assert.equal(definition.text.slice(url.native.range.start,url.native.range.end),url.rawText);
      assert.equal(url.href,null);
    }
    const label=field.markers.find(m=>m.key===definition.labelKey);
    if(label)assert.equal(label.kind,'typed-definition-label');
    for(const key of definition.referenceOccurrences)assert.equal(field.markers.find(m=>m.key===key).kind,'typed-reference-candidate');
  }
}

test('eight native comparisons retain all characters, boundaries, blanks and old fields',()=>{
  for(const example of fixture.word) {
    const request=input(example),before=JSON.stringify(request),result=comparisonMetadata(request);
    assert.equal(JSON.stringify(request),before,'Metadata must not mutate an existing extraction');
    assert.equal(result.status,'candidate');assert.deepEqual(result.gaps,[]);
    const nodes=nativeNodes(example.nativeTableXml,example.native.tablePath);
    for(const field of ['originalText','proposedText']) {
      assert.equal(result.fields[field].text,example.expectedFields[field]);
      verifyField(result.fields[field],nodes,example);
    }
    assert.equal(amendmentOperation(example.expectedFields),example.expectedOperation);
    for(const key of ['operation','classification','legalAddress','span','splice','application'])assert(!Object.hasOwn(result,key));
  }
});

test('body references and leading labels have separate ownership; missing BG reference stays missing',()=>{
  for(const example of fixture.word.filter(e=>e.expectedFields.number===53)) {
    const result=comparisonMetadata(input(example)),original=result.fields.originalText,proposed=result.fields.proposedText;
    assert.equal(original.definitions[0].printedLabel,'15');
    const references=original.markers.filter(m=>m.kind==='typed-reference-candidate');
    assert.equal(references.length,example.observation.language==='bg'?0:1);
    assert.equal(original.markers.filter(m=>m.kind==='typed-definition-label').length,1);
    assert.equal(proposed.markers.filter(m=>m.kind==='typed-reference-candidate').length,0);
    if(['bg','nl','sk'].includes(example.observation.language)) {
      assert.match(original.definitions[0].text,/https:\/\/www\.sprfmo\.int\/science\//);
      assert.match(proposed.definitions[0].text,/fisheries-operation-plans/);
      assert.equal(documentContextPlacement({chosen:example.expectedFields}).reason,'language_scope_mixed');
      if(example.observation.language==='bg')assert.deepEqual(original.definitions[0].gaps,['missing-body-reference']);
      if(example.observation.language==='nl') {
        assert(original.definitions[0].literalUrls[0].rawText.endsWith('/.'));
        assert(proposed.definitions[0].literalUrls[0].rawText.endsWith('plans.'));
      }
    }
  }
});

test('empty NGT/Spanish note cells and three Slovak body notices do not acquire deletion semantics',()=>{
  const ngt=fixture.word.find(e=>e.observation.documentId.endsWith('0175'));
  const n=comparisonMetadata(input(ngt));
  assert.equal(n.fields.originalText.definitions[0].printedLabel,'23');
  assert.equal(n.fields.proposedText.definitions[0].explicitEmpty,true);
  assert(n.fields.proposedText.rawText.endsWith('\n\n'));
  assert(!n.fields.proposedText.text.endsWith('\n'));
  const sk=fixture.word.find(e=>e.expectedFields.number===30),s=comparisonMetadata(input(sk));
  assert.deepEqual(s.fields.proposedText.definitions,[]);assert.deepEqual(s.fields.proposedText.markers,[]);
  assert.equal(s.fields.proposedText.regions.filter(r=>r.kind==='body-wording').length,3);
  assert.equal(documentContextPlacement({chosen:sk.expectedFields}).reason,'language_version_unaffected');
  const es=fixture.word.find(e=>e.observation.language==='es'),e=comparisonMetadata(input(es));
  assert(e.fields.proposedText.definitions[0].explicitEmpty);
  assert.equal(e.fields.proposedText.definitions[0].fieldSlice.start,e.fields.proposedText.text.length);
  assert.equal(documentContextPlacement({chosen:es.expectedFields}).reason,'language_version_unaffected');
});

test('Council Word candidates and exact XHTML edges remain separate; railway punctuation stays literal',()=>{
  for(const example of fixture.xhtml) {
    const observation=sourceObservation(example.observation),native={...example.native,observationId:observation.observationId};
    const result=xhtmlNoteMetadata({observation,native}),reference=result.references[0],definition=reference.definitions[0];
    assert.equal(reference.binding,'explicit-native-edge');assert.equal(definition.backlink.binding,'explicit-native-edge');
    assert.equal(reference.occurrences.length,1);assert.equal(reference.occurrenceCoverage,'complete-source-observation');
    assert.equal(reference.attributes.href,'#'+definition.backlink.native.nativeId);
    assert.equal(definition.backlink.attributes.href,'#'+reference.native.nativeId);
    assert.equal(definition.text,example.native.references[0].targets[0].text);
    assert.equal(definition.links.length,3);assert(definition.links.every(link=>link.native.partSha256===observation.sha256));
    const word=fixture.word.find(w=>w.observation.documentId===example.documentId),w=comparisonMetadata(input(word));
    assert.notEqual(reference.native.observationId,w.source.observationId);
    assert(w.fields.originalText.markers.every(m=>m.binding!=='explicit-native-edge'));
    assert.equal(word.expectedReason,'conflicting_target_evidence');
    if(example.documentId.endsWith('0126')) {
      assert.match(w.fields.originalText.definitions[0].text,/p\.1/);
      assert.match(definition.text,/p\.[\s\u00a0]+1/);
    }
  }
});

test('existing attributable powers and indices remain vertical text, without a scientific-note classifier',()=>{
  const example=fixture.scientific[0],observation=sourceObservation(example.observation);
  const result=xhtmlNoteMetadata({observation,native:{...example.native,observationId:observation.observationId}});
  assert.deepEqual(result.references,[]);assert.equal(result.markers.length,2);
  assert.deepEqual(result.markers.map(m=>m.presentation),['superscript','subscript']);
  for(const marker of result.markers)assert.equal(marker.kind,'unresolved-vertical-text');
});

test('source identity includes declaration, response, edition, language, retrieval and representation',()=>{
  const example=fixture.word[0].observation,original=sourceObservation(example);
  for(const key of ['documentId','listId','resolvedResponseUrl','language','retrievedAt','representation','sha256','declaredDistributionUrl']) {
    const value=key==='sha256'?'0'.repeat(64):String(example[key])+'changed';
    assert.notEqual(sourceObservation({...example,[key]:value}).observationId,original.observationId);
  }
  const noDeclaration=sourceObservation({...example,declaredDistributionUrl:null});
  assert.equal(noDeclaration.declaredDistributionUrl,null);assert.equal(noDeclaration.identityStatus,'unresolved');
  assert.notEqual(noDeclaration.observationId,original.observationId);
  assert.throws(()=>sourceObservation({...example,identityStatus:'verified'}),/cannot verify/);
});

test('identity is checked before offsets: both supplied ES AM14 proof candidates stay distinct',()=>{
  const example=fixture.identityControl,source=sourceObservation(example.observation);
  assert.deepEqual(example.candidates.map(c=>[c.bodyChildZeroBased,c.native.number]),[[54,6],[106,14]]);
  for(const candidate of example.candidates) {
    const result=comparisonMetadata({observation:source,native:{...candidate.native,observationId:source.observationId},amendment:example.expectedFields});
    if(candidate.bodyChildZeroBased===54) {
      assert(result.gaps.includes('unresolved-comparison-identity'));
      assert.equal(result.fields.originalText.mapping.status,'unmapped');
    } else {
      assert.deepEqual(result.gaps,[]);assert.equal(result.fields.originalText.mapping.status,'mapped');
    }
  }
});

test('unproven field mappings and unsupported native objects retain their evidence',()=>{
  const example=fixture.word[0],request=structuredClone(input(example));
  request.amendment.originalText=request.amendment.originalText.replace('2050','2051');
  const result=comparisonMetadata(request);
  assert.equal(result.fields.originalText.mapping.status,'unmapped');
  assert(result.fields.originalText.regions.every(r=>r.fieldSlice.start===null&&r.fieldSlice.mapping==='unmapped'));
  assert(result.fields.originalText.definitions.every(d=>d.binding==='unresolved'));
  const opaque=structuredClone(input(example)),object={element:'ruby',path:opaque.native.rows[2].cells[0].paragraphs[0].path+'/w:ruby[1]',rawXml:'<w:ruby/>'};
  opaque.native.rows[2].cells[0].paragraphs[0].unsupported.push(object);
  const metadata=comparisonMetadata(opaque),definition=metadata.fields.originalText.definitions[0];
  assert.deepEqual(definition.objects,[object]);assert.equal(definition.complete,false);assert.equal(definition.binding,'unresolved');
});
