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

test('new outer numbered Annex Ia follows Annex I before Annex II, preserving incomplete/EOF guards',()=>{
 const native=buffer([{style:'Annexetitre',text:'ANNEX I'},{style:'Normal',text:'The first annex is amended.'},{style:'Annexetitre',text:'ANNEX II'},{style:'Normal',text:'The second annex is amended.'},{style:'Annexetitre',text:'ANNEX III'},{style:'Normal',text:'The final annex is amended.'}]);
 const proposal=structuredClone(parseProposal(native,{language:'en',item:'annex'})),items=[{kind:'annex',proposal}],wording={language:'en',baseline:'commission-proposal',targetLabel:'Annex I a (new)\nRegulation (EU) 2023/956 — Annex II',originalText:'',proposedText:'In point 1 of ANNEX II, an exception is added.'};
 const placement=resolveProposalPlacement(items,wording,{nativeProposalInputs:[native]});
 assert.equal(placement.status,'placed');assert.equal(placement.insertBefore,2);assert.equal(placement.insertAfter,1);
 assert.equal(verifyPlacement({items,wording,placement,nativeQuoted:{proposalBuffers:[native]}}).status,'verified');
 assert.equal(resolveProposalPlacement(items,wording).status,'unresolved');
 proposal.paragraphs[1].complete=false;
 assert.equal(resolveProposalPlacement(items,wording,{nativeProposalInputs:[native]}).status,'placed');
 proposal.paragraphs[1].complete=true;
 assert.equal(resolveProposalPlacement(items,{...wording,targetLabel:'Annex III a (new)'},{nativeProposalInputs:[native]}).status,'placed');
 assert.equal(resolveProposalPlacement([items[0],items[0]],wording,{nativeProposalInputs:[native,native]}).status,'unresolved');
});

test('native annex boundaries ignore a formula in the predecessor but reject undisclosed source blocks',()=>{
 const head=n=>'<w:p><w:pPr><w:pStyle w:val="Annexetitre"/></w:pPr><w:r><w:t>ANNEX '+n+'</w:t></w:r></w:p>';
 const body=middle=>zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+head('I')+middle+head('II')+'<w:p><w:r><w:t>Complete final annex.</w:t></w:r></w:p></w:body></w:document>');
 const w={language:'en',baseline:'commission-proposal',originalText:'',proposedText:'New annex wording.',targetLabel:'Annex I a (new)'};
 const run=bytes=>{const proposal=parseProposal(bytes,{language:'en',item:'annex'}),items=[{kind:'annex',proposal}],placement=resolveProposalPlacement(items,w,{nativeProposalInputs:[bytes]});return {placement,verification:placement.status==='placed'?verifyPlacement({items,wording:w,placement,nativeQuoted:{proposalBuffers:[bytes]}}):null};};
 const formula=run(body('<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>'));
 assert.equal(formula.placement.status,'placed');assert.equal(formula.verification.status,'verified');
 assert.equal(run(body('<w:altChunk/>')).placement.status,'unresolved');
 const hidden=run(body('<w:p><w:pPr><w:pStyle w:val="Annexetitre"/></w:pPr><w:r><w:rPr><w:vanish/></w:rPr><w:t>ANNEX Ia</w:t></w:r></w:p>'));
 assert.equal(hidden.placement.status,'unresolved');
});
