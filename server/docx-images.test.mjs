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
