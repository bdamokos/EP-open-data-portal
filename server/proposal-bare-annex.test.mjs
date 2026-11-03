import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {deflateRawSync} from 'node:zlib';
import {parseProposal} from './proposal-structure.mjs';import {resolveProposalPlacement} from './proposal-placement.mjs';import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const examples=JSON.parse(readFileSync(new URL('./fixtures/proposal-bare-annex-excerpts.json',import.meta.url)));
function zip(xml){const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),data=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+data.length,16);return Buffer.concat([local,name,data,central,name,end]);}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const buffer=(rows,blank='<w:p/>',tail='')=>zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+rows.map(row=>blank.repeat(row.blankBefore??0)+'<w:p><w:pPr><w:pStyle w:val="'+row.style+'"/></w:pPr><w:r><w:t>'+escape(row.text).replaceAll('\n','</w:t><w:br/><w:t>').replaceAll('\t','</w:t><w:tab/><w:t>')+'</w:t></w:r></w:p>').join('')+tail+'</w:body></w:document>');
for(const example of examples)test(`new Annex Ia follows the sole bare annex: ${example.id}`,()=>{
 const native=buffer(example.rows),proposal=parseProposal(native,{language:'en',item:'annex',sourceUrl:example.source.url}),items=[{kind:'annex',proposal}],placement=resolveProposalPlacement(items,example.wording);
 assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.insertBefore,proposal.paragraphs.length);assert.equal(placement.insertAfter,proposal.paragraphs.length-1);
 assert.equal(verifyPlacement({placement,wording:example.wording,items,nativeQuoted:{proposalBuffer:native}}).status,'verified');
 assert.equal(verifyPlacement({placement:{...placement,insertAfter:0,insertBefore:1},wording:example.wording,items,nativeQuoted:{proposalBuffer:native}}).status,'failed');
 assert.equal(resolveProposalPlacement([items[0],items[0]],example.wording).status,'unresolved');
 if(example.rows.some(row=>row.blankBefore))assert.equal(verifyPlacement({placement,wording:example.wording,items,nativeQuoted:{proposalBuffer:buffer(example.rows,'<w:p><w:r><w:t>Unobserved source text.</w:t></w:r></w:p>')}}).status,'unverified');
});

test('bare annex append withholds an unlocated extraction gap after its retained tail',()=>{
 const example=examples[0],native=buffer(example.rows,undefined,'<w:altChunk/>'),proposal=parseProposal(native,{language:'en',item:'annex',sourceUrl:example.source.url}),items=[{kind:'annex',proposal}];
 assert(proposal.gaps.some(gap=>gap.code==='extraction-gap'&&gap.paragraph===undefined));
 assert.equal(resolveProposalPlacement(items,example.wording).status,'unresolved');
 const forced={status:'placed',operation:'insert',itemIndex:0,insertAfter:proposal.paragraphs.length-1,insertBefore:proposal.paragraphs.length};
 // Removing the runtime gap must not fool the independent native-tail proof.
 const cleanProjection={...proposal,gaps:[]};
 assert.equal(verifyPlacement({placement:forced,wording:example.wording,items:[{kind:'annex',proposal:cleanProjection}],nativeQuoted:{proposalBuffer:native}}).status,'unverified');
});
