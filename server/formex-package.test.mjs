import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crc32,deflateRawSync} from 'node:zlib';
import {readFormexPackage,FORMEX_PACKAGE_LIMITS,FORMEX_PARSER_REVISION} from './formex-package.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/formex-excerpts.json',import.meta.url)));
function zip(entries,{method=8}={}) {
  const locals=[],directory=[];let offset=0;
  for(const [filename,value] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(value),data=method===8?deflateRawSync(body):body,crc=crc32(body);
    const l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(body.length,22);l.writeUInt16LE(name.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,name,data);directory.push(c,name);offset+=l.length+name.length+data.length;
  }
  const d=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,d,end]);
}
const ngt=fixture.cases[0],entries=c=>c.parts.map(p=>[p.name,p.xml]);
const read=(c=ngt,items=entries(c),options={})=>readFormexPackage(zip(items),{source:c.source,coverage:{...c.coverage,originalPackageHash:c.packageHash},...options});

for(const c of fixture.cases)test('retained public Formex graph: '+c.celex,()=>{
  const r=read(c);
  assert.equal(r.parserVersion,FORMEX_PARSER_REVISION);assert.equal(r.preference,'held');assert.equal(r.sourceKind,'formex-package');
  assert.equal(r.source.celex,c.celex);assert.equal(r.source.retrievedAt,c.source.retrievedAt);assert.equal(r.source.url,c.source.url);assert.equal(r.source.binding,'caller-supplied');
  assert.equal(r.complete,false);assert.ok(r.gaps.some(g=>g.code==='excerpted-source'));
  assert.ok(r.fidelityGaps.some(g=>g.code==='legal-projection-unverified'));
  assert.equal(r.entries.length,c.parts.length);
  assert.equal(r.parts.length,c.celex.startsWith('02023')?1:c.celex==='32025R2083'?4:5);
  const byId=new Map(r.containers.map(row=>[row.id,row]));
  for(const b of r.blocks) {
    assert.ok(byId.get(b.container).content.includes(b.ordinal));assert.equal(b.source.part,byId.get(b.container).source.part);
    for(const o of b.objects)assert.equal(b.text[o.offset],'\uFFFC');
    for(const m of b.marks)assert.ok(m.start>=0&&m.end>m.start&&m.end<=b.text.length);
  }
  for(const row of r.containers)for(const child of row.children) {
    const nested=byId.get(child);assert.equal(nested.parent,row.id);assert.ok(nested.extent.start>=row.extent.start&&nested.extent.end<=row.extent.end);
  }
  for(const n of r.notes){assert.equal(n.label,null);assert.ok(n.nativeId);assert.ok(n.blocks.length);}
});

test('NGT preserves four annex identities, exact labels, nested notes, quotation codes and formatting',()=>{
  const r=read();
  assert.equal(r.manifest.seeds.length,5);assert.equal(r.packageComplete,true);
  assert.deepEqual(r.parts.map(p=>p.sequence),['0001','0001.0001','0001.0002','0001.0003','0001.0004']);
  assert.ok(r.containers.some(c=>c.kind==='article'&&c.label.text==='Article\u00a01'));
  assert.ok(r.containers.some(c=>c.kind==='quotation'&&c.quoted));
  assert.ok(r.blocks.some(b=>b.quotes.length&&b.text.includes('‘')));
  assert.ok(r.blocks.some(b=>b.marks.some(m=>m.kind==='italic')));
  assert.ok(r.notes.some(n=>n.blocks.some(b=>b.anchors.length)));
  assert.ok(r.notes.some(n=>n.blocks.some(b=>b.links.length)));
  assert.equal(r.notes.every(n=>n.complete),true);
});

test('recursive Annex VII stays linked beneath its native Annex II quotation',()=>{
  const r=read(fixture.cases[2]);
  const include=r.blocks.flatMap(b=>b.objects).find(o=>o.kind==='included-document');assert.ok(include);
  assert.equal(include.status,'linked');assert.ok(include.target.endsWith('002402.fmx.xml'));
  assert.ok(r.edges.filter(e=>e.kind==='formex-document').length>=2); // Metadata declaration and positioned inclusion.
  assert.ok(r.containers.some(c=>c.kind==='quotation'&&c.source.part.endsWith('002401.fmx.xml')));
  assert.equal(r.parts.filter(p=>p.name===include.target).length,1);
});

test('CBAM formulas remain positioned unresolved objects with local gaps',()=>{
  const r=read(fixture.cases[1]);
  assert.ok(r.objects.length);assert.ok(r.objects.every(o=>o.status==='unresolved'));
  assert.ok(r.objects.some(o=>o.kind==='formula'&&o.target?.endsWith('.tif')));
  assert.ok(r.objects.some(o=>o.kind==='formula'&&!o.target));
  for(const o of r.objects)if(o.block!==undefined){assert.equal(r.blocks[o.block].complete,false);assert.equal(r.blocks[o.block].text[o.offset],'\uFFFC');}
  const article=r.containers.find(c=>c.kind==='article'&&c.attributes.IDENTIFIER==='001');assert.equal(article.complete,true);
  const deleted=r.blocks.flatMap(b=>b.instructions).find(i=>i.attributes.ACTION==='DELETED');assert.ok(deleted);
  assert.ok(r.gaps.some(g=>g.code==='uninterpreted-consolidation-change'&&g.source.path===deleted.source.path));
  assert.ok(r.blocks.some(b=>b.text.startsWith('Any person accredited')));
  assert.equal(r.parts[0].complete,false);assert.equal(r.packageComplete,false);
  assert.ok(r.gaps.some(g=>g.code==='missing-package-entry'));
});

test('missing annexes and cyclic inclusions never make a main-only archive complete',()=>{
  const items=entries(ngt),missing=read(ngt,items.filter(([n])=>!n.endsWith('003701.fmx.xml')));
  assert.equal(missing.packageComplete,false);assert.ok(missing.gaps.some(g=>g.code==='missing-package-entry'));
  const cycle=entries(fixture.cases[2]);const index=cycle.findIndex(([n])=>n.endsWith('002402.fmx.xml'));
  cycle[index][1]=cycle[index][1].replace('</CONTENTS>','<P><INCL.ELEMENT TYPE="FORMEX.DOC" FILEREF="L_202502083EN.002401.fmx.xml"/></P></CONTENTS>');
  const r=read(fixture.cases[2],cycle);assert.equal(r.packageComplete,false);assert.ok(r.gaps.some(g=>g.code==='inclusion-cycle'));
});

test('unsafe ZIP paths, aliases, encryption, integrity and inflated limits are rejected',()=>{
  assert.throws(()=>read(ngt,[...entries(ngt),['../outside','x']]),{code:'zip-entry'});
  assert.throws(()=>read(ngt,[...entries(ngt),entries(ngt)[0]]),{code:'zip-entry'});
  const b=zip(entries(ngt),{method:0});b[b.indexOf(Buffer.from('<DOC '))]^=1;
  assert.throws(()=>readFormexPackage(b,{source:ngt.source}),{code:'zip-integrity'});
  assert.throws(()=>read(ngt,[...entries(ngt),['huge','x'.repeat(FORMEX_PACKAGE_LIMITS.entry+1)]]),{code:'zip-entry-budget'});
  assert.throws(()=>read(ngt,[...entries(ngt),...Array.from({length:FORMEX_PACKAGE_LIMITS.entries},(_,i)=>['extra'+i,''])]),{code:'zip-directory'});
  const encrypted=zip(entries(ngt));encrypted.writeUInt16LE(1,encrypted.readUInt32LE(encrypted.length-6)+8);assert.throws(()=>readFormexPackage(encrypted,{source:ngt.source}),{code:'zip-entry'});
  const aggregate=Array.from({length:3},(_,i)=>['large'+i,'x'.repeat(FORMEX_PACKAGE_LIMITS.entry)]);
  assert.throws(()=>read(ngt,[...entries(ngt),...aggregate]),{code:'zip-entry-budget'});
});

test('XML declarations, external entities, depth and unsafe inclusion references are rejected',()=>{
  function changed(transform){const items=entries(ngt),index=items.findIndex(([n])=>n.endsWith('000101.fmx.xml'));items[index][1]=transform(items[index][1]);return items;}
  assert.throws(()=>read(ngt,changed(xml=>'<!DOCTYPE ACT [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml)),{code:'unsafe-xml'});
  assert.throws(()=>read(ngt,changed(xml=>xml.replace('</ACT>','<P>&unknown;</P></ACT>'))),{code:'unsafe-xml'});
  assert.throws(()=>read(ngt,changed(xml=>xml.replace('</ACT>','<P><INCL.ELEMENT TYPE="FORMEX.DOC" FILEREF="../outside.xml"/></P></ACT>'))),{code:'unsafe-part-reference'});
  assert.throws(()=>read(ngt,changed(xml=>xml.replace('</ACT>','<P>'+('<P>'.repeat(65))+'x'+('</P>'.repeat(65))+'</P></ACT>'))),{code:'xml-depth'});
});

test('identity and language bindings are retained without guessing, unknown structures stay objects',()=>{
  assert.throws(()=>read(ngt,entries(ngt),{source:{...ngt.source,language:'fr'}}),{code:'native-language-mismatch'});
  assert.throws(()=>read(ngt,entries(ngt),{source:{...ngt.source,itemId:'invented'}}),{code:'source-binding'});
  const items=entries(ngt),index=items.findIndex(([n])=>n.endsWith('000101.fmx.xml'));
  items[index][1]=items[index][1].replace('</ACT>','<P><ALIEN>not flattened</ALIEN></P></ACT>');
  const r=read(ngt,items);assert.ok(r.gaps.some(g=>g.code==='unsupported-structure'));assert.ok(!r.blocks.some(b=>b.text.includes('not flattened')));
  assert.ok(JSON.stringify(r.parts[0].tree).includes('not flattened'));
});
