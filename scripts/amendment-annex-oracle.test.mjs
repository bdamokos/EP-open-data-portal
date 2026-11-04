import test from 'node:test';import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {assertBareAnnexInsertion,assertNumberedAnnexInsertion} from './amendment-annex-oracle.mjs';
const wording={language:'en',targetLabel:'Annex I a (new)'};
const item=()=>({kind:'annex',proposal:{sourceKind:'docx',paragraphs:['ANNEX','Actions eligible for funding.'].map((text,index)=>({index,text,complete:true,properties:{styleId:index?'Normal':'Annexetitre'},source:{complete:true,container:'body',containerPath:'body',segment:0,ordinal:index,path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}})),gaps:[]}});
function native(tail='<w:sectPr/>',heading='ANNEX') {
 const name=Buffer.from('word/document.xml'),body=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Annexetitre"/></w:pPr><w:r><w:t>'+heading+'</w:t></w:r></w:p><w:p><w:r><w:t>Actions eligible for funding.</w:t></w:r></w:p>'+tail+'</w:body></w:document>'),data=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+data.length,16);return {proposalBuffer:Buffer.concat([local,name,data,central,name,end])};
}
const placement={operation:'insert',itemIndex:0,insertAfter:1,insertBefore:2};
test('bare annex end assertion reads only raw rows and verifies exact item coordinates',()=>{
 assert.equal(assertBareAnnexInsertion([item()],wording,placement,native()).status,'verified');
 assert.equal(assertBareAnnexInsertion([item()],wording,{...placement,insertAfter:0,insertBefore:1},native()).status,'failed');
 assert.equal(assertBareAnnexInsertion([item(),item()],wording,placement,native()),null);
 const broken=item();broken.proposal.paragraphs[1].source.complete=false;
 assert.equal(assertBareAnnexInsertion([broken],wording,placement,native()).status,'unverified');
});

test('bare annex EOF cannot be inferred from retained rows before an unreadable native tail',()=>{
 // The projected gap can be absent: native EOF proof must independently fail.
 assert.equal(assertBareAnnexInsertion([item()],wording,placement,native('<w:altChunk/>')).status,'unverified');
 assert.equal(assertBareAnnexInsertion([item()],wording,placement,native('<w:p><w:r><w:t>Unretained trailing text.</w:t></w:r></w:p>')).status,'unverified');
 assert.equal(assertBareAnnexInsertion([item()],wording,placement).status,'unverified');
 const gap=item();gap.proposal.gaps=[{code:'extraction-gap',message:'A native block could not be read.'}];
 assert.equal(assertBareAnnexInsertion([gap],wording,placement,native()).status,'unverified');
});


test('numbered annex additions use the complete native predecessor and next heading',()=>{
 const i=item(),p=i.proposal;p.paragraphs[0].text='ANNEX I';
 p.paragraphs.push({...p.paragraphs[0],index:2,text:'ANNEX II',source:{...p.paragraphs[0].source,ordinal:2,path:'/w:document[1]/w:body[1]/w:p[3]'}});
 const bytes=native('<w:p><w:pPr><w:pStyle w:val="Annexetitre"/></w:pPr><w:r><w:t>ANNEX II</w:t></w:r></w:p>','ANNEX I');
 const w={...wording,baseline:'commission-proposal',originalText:'',targetLabel:'Annex I a (new)\nRegulation (EU) 2023/956 — Annex II'};
 assert.equal(assertNumberedAnnexInsertion([i],w,placement,bytes).status,'verified');
 assert.equal(assertNumberedAnnexInsertion([i],w,{...placement,insertBefore:1,insertAfter:0},bytes).status,'failed');
 assert.equal(assertNumberedAnnexInsertion([i,i],w,placement,bytes).status,'unverified');
 p.paragraphs[1].complete=false;
 assert.equal(assertNumberedAnnexInsertion([i],w,placement,bytes).status,'verified');
 p.paragraphs[1].complete=true;
 const hidden=native('<w:altChunk/><w:p><w:pPr><w:pStyle w:val="Annexetitre"/></w:pPr><w:r><w:t>ANNEX II</w:t></w:r></w:p>','ANNEX I');
 assert.equal(assertNumberedAnnexInsertion([i],w,placement,hidden).status,'unverified');
});


test('a native annex heading in Normal style cannot disappear from the independent heading census',()=>{
 const i=item(),p=i.proposal;p.paragraphs[0].text='ANNEX I';
 p.paragraphs.push({...p.paragraphs[0],index:2,text:'ANNEX Ia',properties:{styleId:'Normal'},source:{...p.paragraphs[0].source,ordinal:2,path:'/w:document[1]/w:body[1]/w:p[3]'}}, {...p.paragraphs[0],index:3,text:'ANNEX II',source:{...p.paragraphs[0].source,ordinal:3,path:'/w:document[1]/w:body[1]/w:p[4]'}});
 const bytes=native('<w:p><w:r><w:t>ANNEX Ia</w:t></w:r></w:p><w:p><w:r><w:t>ANNEX II</w:t></w:r></w:p>','ANNEX I');
 const w={...wording,baseline:'commission-proposal',originalText:''};
 assert.equal(assertNumberedAnnexInsertion([i],w,{...placement,insertAfter:2,insertBefore:3},bytes).status,'unverified');
});

test('numbered annex EOF requires native tail proof, even when the new annex supplies only a table sentence',()=>{
 const i=item();i.proposal.paragraphs[0].text='ANNEX I';
 const w={...wording,baseline:'commission-proposal',originalText:'',targetLabel:'Annex I a (new) - table'};
 assert.equal(assertNumberedAnnexInsertion([i],w,placement,native('<w:sectPr/>','ANNEX I')).status,'verified');
 assert.equal(assertNumberedAnnexInsertion([i],w,placement,native('<w:altChunk/>','ANNEX I')).status,'unverified');
});
