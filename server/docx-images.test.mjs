import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync,crc32} from 'node:zlib';
import {docxContent} from './document-text.mjs';
import {documentImages,imageInfo,IMAGE_LIMITS} from './docx-images.mjs';
import {parseProposal} from './proposal-structure.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=','base64');
function zip(entries){const locals=[],directory=[];let offset=0;for(const [file,value] of Object.entries(entries)){
 const name=Buffer.from(file),body=Buffer.from(value),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(body),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(body),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
 locals.push(local,name,compressed);directory.push(central,name);offset+=30+name.length+compressed.length;
 }const d=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,d,end]);}
const drawing='<w:r><w:drawing><wp:inline><wp:docPr id="1" descr="Published description"/><a:graphic><a:graphicData><pic:pic><a:blip r:embed="rId1"/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const rels=(target='media/picture.png',extra='')=>`<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}" ${extra}/></Relationships>`;
function fixture(body=drawing,extra={}){return zip({'word/document.xml':`<w:document xmlns:w="urn:word" xmlns:r="urn:rel" xmlns:a="urn:draw" xmlns:wp="urn:wp" xmlns:pic="urn:pic"><w:body><w:p><w:r><w:t>Before</w:t></w:r>${body}<w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`,'word/_rels/document.xml.rels':rels(),'word/media/picture.png':png,...extra});}
test('embedded pictures retain source text offsets, description and content-addressed bytes without changing legal completeness',()=>{
 const c=docxContent(fixture()),o=c.documentObjects[0],asset=c.imageAssets[o.image.id];
 assert.equal(c.paragraphs[0],'Before\uFFFCAfter');assert.equal(o.offset,6);assert.equal(o.status,'unresolved');assert.equal(c.paragraphSources[0].complete,false);
 assert.equal(o.image.relationshipId,'rId1');assert.equal(o.image.description,'Published description');assert.equal(o.image.target,'word/media/picture.png');assert.deepEqual(imageInfo(Buffer.from(asset.data,'base64')),{mime:'image/png',width:1,height:1});
 const proposal=parseProposal(fixture());assert.equal(proposal.imageAssets[o.image.id].data,asset.data);assert.equal(proposal.contentComplete,false);
});
test('image-only table cells survive and duplicate pictures share one asset',()=>{
 const c=docxContent(fixture(`</w:p><w:tbl><w:tr><w:tc><w:p>${drawing}</w:p></w:tc><w:tc><w:p>${drawing}</w:p></w:tc></w:tr></w:tbl><w:p>`));
 assert.equal(c.tables.length,1);assert.equal(Object.keys(c.imageAssets).length,1);assert.equal(c.documentObjects.filter(o=>o.image).length,2);assert.equal(c.paragraphSources[1].container,'table-cell');
});
test('hidden and deleted pictures are never extracted',()=>{
 const c=docxContent(fixture(drawing.replace('<w:r>','<w:r><w:rPr><w:vanish/></w:rPr>')+'<w:del>'+drawing+'</w:del>'));
 assert.deepEqual(c.documentObjects,[]);assert.deepEqual(c.imageAssets,{});
});
test('external, missing, unsafe, transformed and grouped pictures leave the source text and explicit gaps',()=>{
 for(const [body,parts] of [
  [drawing,{'word/_rels/document.xml.rels':rels('https://example.com/p.png','TargetMode="External"')}],
  [drawing,{'word/_rels/document.xml.rels':rels('../../../etc/passwd')}],
  [drawing,{'word/_rels/document.xml.rels':rels('media/%2e%2e/x.png')}],
  [drawing,{'word/_rels/document.xml.rels':rels('media/missing.png')}],
  [drawing.replace('<pic:pic>','<pic:pic><a:srcRect l="20000"/>'),{}],
  [drawing.replace('<pic:pic>','<pic:pic><w:txbxContent><w:p><w:r><w:t>Important shape text</w:t></w:r></w:p></w:txbxContent>'),{}],
  [drawing,{'word/media/picture.png':Buffer.from('<svg onload="alert(1)"/>')}]
 ]){const c=docxContent(fixture(body,parts));assert.equal(c.paragraphs[0],'Before\uFFFCAfter');assert.equal(c.documentObjects[0].image,undefined);assert(c.documentObjects[0].imageUnavailableReason);assert.deepEqual(c.imageAssets,{});}
});
test('oversize decoded dimensions and ZIP CRC corruption do not hide surrounding text',()=>{
 const huge=Buffer.from(png);huge.writeUInt32BE(IMAGE_LIMITS.pixels,16);assert.equal(imageInfo(huge),null);
 const b=fixture();const central=b.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),b.indexOf('word/media/picture.png')); // Directory contains the media CRC, independently of XML.
 const mediaName=b.lastIndexOf(Buffer.from('word/media/picture.png'));b.writeUInt32LE(0,mediaName-46+16);
 const c=docxContent(b);assert.equal(c.paragraphs[0],'Before\uFFFCAfter');assert.equal(c.documentObjects[0].image,undefined);assert(central>0);
});
test('cached image registries reject wrong digests, dimensions and executable MIME',()=>{
 const c=docxContent(fixture()),id=Object.keys(c.imageAssets)[0];assert.equal(Object.keys(documentImages(c)).length,1);
 for(const patch of [{width:123},{mime:'image/svg+xml'},{data:Buffer.from('bad').toString('base64')}])assert.deepEqual(documentImages({imageAssets:{[id]:{...c.imageAssets[id],...patch}}}),{});
 assert.equal(imageInfo(Buffer.from([255,216,255,255,255,255])),null);
});
test('note pictures resolve relationships in the note part rather than borrowing the body relationship',()=>{
 const c=docxContent(fixture('<w:r><w:footnoteReference w:id="1"/></w:r>',{
  'word/footnotes.xml':`<w:footnotes xmlns:w="urn:w" xmlns:r="urn:r" xmlns:a="urn:a" xmlns:wp="urn:wp" xmlns:pic="urn:pic"><w:footnote w:id="1"><w:p>${drawing}</w:p></w:footnote></w:footnotes>`,
  'word/_rels/footnotes.xml.rels':rels('media/missing.png')
 }),{includeNoteObjects:true});assert.equal(c.notes[0].objects[0].image,undefined);assert.deepEqual(c.imageAssets,{});
});

test('compatibility pictures select one supported representation without doubling the image or leaking shape text',()=>{
 const body='<mc:AlternateContent xmlns:mc="urn:compat"><mc:Choice Requires="wps"><w:r><w:drawing><wps:wsp xmlns:wps="urn:wps"><w:txbxContent><w:p><w:r><w:t>Shape text</w:t></w:r></w:p></w:txbxContent></wps:wsp></w:drawing></w:r></mc:Choice><mc:Fallback>'+drawing+'</mc:Fallback></mc:AlternateContent>';
 const c=docxContent(fixture(body));assert.equal(c.paragraphs[0],'Before\uFFFCAfter');assert.equal(c.documentObjects.length,1);assert(c.documentObjects[0].image);assert.equal(c.documentObjects[0].image.compatibility,'mc:Fallback');assert.equal(c.documentObjects[0].status,'unresolved');
});

test('compatibility pictures use shared visibility rules and never revive hidden or deleted drawings through fallbacks',()=>{
 const withoutRun=drawing.slice('<w:r>'.length,-'</w:r>'.length),styles='<w:styles xmlns:w="urn:word"><w:style w:type="character" w:styleId="Secret"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
 for(const suppressed of [
  drawing.replace('<w:r>','<w:r><w:rPr><w:vanish/></w:rPr>'),
  drawing.replace('<w:r>','<w:r><w:rPr><w:webHidden/></w:rPr>'),
  drawing.replace('<w:r>','<w:r><w:rPr><w:rStyle w:val="Secret"/></w:rPr>'),
  '<w:del>'+drawing+'</w:del>','<w:moveFrom>'+drawing+'</w:moveFrom>',
  withoutRun.replace('id="1" descr=', 'id="1" hidden="1" descr=')
 ]){
  const body='<mc:AlternateContent xmlns:mc="urn:compat"><mc:Choice>'+suppressed+'</mc:Choice><mc:Fallback>'+withoutRun+'</mc:Fallback></mc:AlternateContent>';
  const c=docxContent(fixture(body,{'word/styles.xml':styles}));assert.equal(c.documentObjects[0].image,undefined);assert.deepEqual(c.imageAssets,{});assert.equal(c.documentObjects[0].imageUnavailableReason,'picture-hidden');
 }
});
test('hidden VML shapes do not extract image bytes and published picture extents are retained',()=>{
 const vml=style=>'<w:r><w:pict xmlns:v="urn:vml"><v:shape style="'+style+'"><v:imagedata r:id="rId1"/></v:shape></w:pict></w:r>';
 for(const style of ['width:120pt;height:60pt;visibility:hidden','width:120pt;height:60pt;display:none','width:120pt;height:60pt;mso-hide:all']){
  const c=docxContent(fixture(vml(style)));assert.equal(c.documentObjects[0].image,undefined);assert.deepEqual(c.imageAssets,{});
 }
 const shape=docxContent(fixture(vml('width:120pt;height:60pt'))).documentObjects[0].image;assert.equal(shape.displayWidth,160);assert.equal(shape.displayHeight,80);
 const inline=docxContent(fixture(drawing.replace('<wp:inline>','<wp:inline><wp:extent cx="3048000" cy="762000"/>'))).documentObjects[0].image;
 assert.equal(inline.displayWidth,320);assert.equal(inline.displayHeight,80);assert.equal(inline.width,1);assert.equal(inline.height,1);
 assert.equal(docxContent(fixture(drawing.replace('<wp:inline>','<wp:inline><wp:extent cx="9999999999" cy="762000"/>'))).documentObjects[0].image,undefined);
});
test('the inflated media budget charges each unique part once across repeated placements',()=>{
 const large=Buffer.concat([png,Buffer.alloc(3*1024*1024-png.length)]),c=docxContent(fixture(drawing.repeat(5),{'word/media/picture.png':large}));
 assert.equal(Object.keys(c.imageAssets).length,1);assert.equal(c.documentObjects.filter(object=>object.image).length,5);
});
test('proposal cache accounting includes inflated image strings rather than compressed archive size',()=>{
 const one=Buffer.concat([png,Buffer.alloc(3*1024*1024-png.length)]),two=Buffer.from(one);two[two.length-1]=1;
 const source=fixture(drawing+drawing.replace('rId1','rId2'),{'word/media/picture.png':one,'word/media/second.png':two,'word/_rels/document.xml.rels':rels().replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/second.png"/></Relationships>')});
 const options={identity:{largeImageCacheTest:0}},first=parseProposal(source,options);assert.equal(Object.keys(first.imageAssets).length,2);
 assert.equal(parseProposal(source,options),first);
 for(let i=1;i<=4;i++)parseProposal(source,{identity:{largeImageCacheTest:i}});
 assert.notEqual(parseProposal(source,options),first,'inflated assets evict earlier entries before the eight-entry cap');
});

test('maximum accepted pictures use small public descriptors and a separate bounded source-addressed store',async t=>{
 const {DocumentImageStore}=await import('./document-image-store.mjs');
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(os.tmpdir(),'document-images-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const large=Buffer.alloc(IMAGE_LIMITS.bytes);png.copy(large);
 const buffer=fixture(drawing,{'word/media/picture.png':large}),content=docxContent(buffer),id=content.documentObjects[0].image.id;
 const store=new DocumentImageStore(),imageAssets=await store.publish(content,{directory});
 assert.equal(imageAssets[id].data,undefined);assert.equal(imageAssets[id].sourceHash,content.sourceHash);
 assert(Buffer.byteLength(JSON.stringify({...content,imageAssets}))<10_000,'source text stays below public JSON budgets');
 assert.deepEqual((await store.read(content.sourceHash,id,{directory})).body,large);
 const reopened=new DocumentImageStore();assert.deepEqual((await reopened.read(content.sourceHash,id,{directory})).body,large);
 const proposal=parseProposal(buffer);assert(Buffer.byteLength(JSON.stringify({...proposal,imageAssets:await store.publish(proposal,{directory})}))<3*1024*1024,'legal baseline projection remains available');
 await assert.rejects(store.read('../x',id,{directory}),error=>error.status===400);
 await assert.rejects(store.read('f'.repeat(64),id,{directory}),error=>error.status===404);
 reopened.memory.clear();await writeFile(path.join(directory,'document-images-v1',content.sourceHash+'-'+id+'.bin'),'corrupt');
 await assert.rejects(reopened.read(content.sourceHash,id,{directory}),error=>error.status===404);
 for(let n=0;n<10;n++)store.remember(String(n),large);
 assert(store.bytes<=32*1024*1024);assert.equal(store.memory.has('0'),false);
 const {documentText}=await import('./document-text.mjs');
 const url='https://data.europarl.europa.eu/distribution/test/large-image.docx';
 const text=await documentText({id:'eli/dl/doc/A-10-2026-0999',is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',is_exemplified_by:url}]}]},'en',{directory,download:async()=>content});
 assert.equal(text.status,'available');assert.equal(text.imageAssets[id].data,undefined);assert(Buffer.byteLength(JSON.stringify(text))<10000);
});
