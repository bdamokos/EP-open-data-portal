import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertArticleNotes} from './amendment-article-notes-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=(s,style='Normal')=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${esc(s)}</w:t></w:r></w:p>`;
function zip(body){
 const raw=Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),name=Buffer.from('word/document.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);
 return Buffer.concat([local,name,raw,central,name,end]);
}
function input(report=false){
 const texts=['HAVE ADOPTED THIS REGULATION:','Article 4','Committee','1. Public body.','2. Other body.','Article 5'];
 const styles=['Normal','Titrearticle','Normal','ManualNumPar1','ManualNumPar1','Titrearticle'];
 let body=texts.map((s,i)=>p(s,styles[i])).join('');body=body.replace(esc(texts[3]),esc(texts[3].slice(0,14))+'</w:t><w:footnoteReference w:id="8"/><w:t>'+esc(texts[3].slice(14)));
 const originalText='Article 4\nCommittee\n1. Public body5.\n2. Other body.\n______\n5 Public note.',at=originalText.indexOf('5');
 const wording={language:'en',baseline:'commission-proposal',targetLabel:'Article 4',originalText,proposedText:'deleted',originalFormatting:[{kind:'superscript',start:at,end:at+1}]};
 const cell=s=>`<w:tc>${s.split('\n').map(t=>p(t)).join('')}</w:tc>`;
 const table=`<w:tbl><w:tr>${cell('Text proposed by the Commission')}${cell('Amendment')}</w:tr><w:tr>${cell(originalText)}${cell('deleted')}</w:tr></w:tbl>`;
 const amendment=report?p('Amendment\t\t37')+p('Proposal for a regulation')+p('Article 4')+table:p('<Amend><NumAm>37</NumAm>')+p('<Article>Article 4</Article>')+table+p('<Original>{EN}en</Original>')+p('</Amend>');
 const proposalBuffer=zip(body),proposal={sourceHash:createHash('sha256').update(proposalBuffer).digest('hex'),sourceKind:'docx',paragraphs:texts.map((text,index)=>({text,index,complete:true,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`,container:'body',ordinal:index,complete:true}})),anchors:[{paragraph:3,offset:14,note:'8'}],notes:[{id:'8',text:'Public note.',complete:true}]};
 return {proposal,wording,placement:{status:'placed',operation:'delete',itemIndex:0,span:{start:1,end:4},splice:{start:{paragraph:1,offset:0},end:{paragraph:4,offset:14}}},nativeQuoted:{proposalBuffer,amendmentBuffer:zip(amendment),number:37},body};
}
const replaceSource=(arg,body)=>{assert.notEqual(body,arg.body);arg.nativeQuoted.proposalBuffer=zip(body);arg.proposal.sourceHash=createHash('sha256').update(arg.nativeQuoted.proposalBuffer).digest('hex');};
test('native whole article and matching notes verify without the placement tree',()=>{
 const arg=input();Object.defineProperty(arg.proposal,'units',{get(){throw Error('placer tree forbidden');}});
 assert.equal(assertArticleNotes(arg).status,'verified');assert.equal(verifyPlacement({...arg,items:[{proposal:arg.proposal}]}).status,'verified');
});
test('clipped or shifted whole-article splices fail',()=>{
 for(const mutate of [a=>a.placement.span.end--,a=>a.placement.splice.end.offset--,a=>a.placement.splice.start.offset++,a=>a.placement.splice.end.paragraph--]){const a=input();mutate(a);assert.equal(assertArticleNotes(a).status,'failed');}
});
test('native ownership, source hash, complete rows and next heading are mandatory',()=>{
 for(const mutate of [a=>a.proposal.sourceHash='wrong',a=>a.proposal.paragraphs[3].complete=false,a=>a.proposal.paragraphs[3].source.ordinal++,a=>a.proposal.paragraphs[3].source.path='wrong',a=>replaceSource(a,a.body.replace(p('Article 5','Titrearticle'),'')),a=>replaceSource(a,a.body.replace('HAVE ADOPTED THIS REGULATION:','Draft text:')),a=>replaceSource(a,a.body.replace('<w:t>Committee','<w:object/><w:t>Committee')),a=>replaceSource(a,a.body.replace('<w:t>Committee','<w:vanish/><w:t>Committee')),a=>{delete a.nativeQuoted;}]){const a=input();mutate(a);assert.equal(assertArticleNotes(a).status,'unverified',String(mutate));}
});
test('native note IDs and positions must agree; payloads and wording cannot drift',()=>{
 for(const mutate of [a=>a.proposal.anchors[0].offset--,a=>a.proposal.anchors[0].note='9',a=>a.proposal.notes[0].text='Other note.',a=>a.wording.originalText+='Other',a=>a.wording.language='fr']){const a=input();mutate(a);assert.notEqual(assertArticleNotes(a).status,'verified');}
});
test('missing native evidence cannot fall through to a tree-based article extent',()=>{
 const a=input();delete a.nativeQuoted;assert.equal(verifyPlacement({...a,items:[{proposal:a.proposal}]}).status,'unverified');
});

test('printed committee report grid also binds the exact number, header and both columns',()=>{
 const a=input(true);assert.equal(assertArticleNotes(a).status,'verified');a.nativeQuoted.number=38;assert.equal(assertArticleNotes(a).status,'unverified');
});
