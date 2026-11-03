import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertBareAnnexIndent} from './amendment-annex-indent-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {fixtureZip as zip,makeAnnexIndentCase as input} from './fixtures/bare-annex-indent-native.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const p=(text,style='Normal',id=null)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/>${id?`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`:''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const wrap=body=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
function source(a,from,to){assert.notEqual(from,to);a.parts['word/document.xml']=a.parts['word/document.xml'].replace(from,to);a.nativeQuoted.proposalBuffer=zip(a.parts);a.nativeQuoted.proposalBuffers[1]=a.nativeQuoted.proposalBuffer;a.proposal.sourceHash=hash(a.nativeQuoted.proposalBuffer);}
test('independent native list decoding proves interior indent order and bare first annex identity',()=>{
 const a=input();for(const item of a.items)Object.defineProperty(item.proposal,'units',{get(){throw Error('placer tree forbidden');}});assert.equal(assertBareAnnexIndent(a).status,'verified');assert.equal(verifyPlacement(a).status,'verified');
 for(const before of [7,8,12,14]){const a=input();a.placement.insertBefore=before;a.placement.insertAfter=before-1;assert.equal(assertBareAnnexIndent(a).status,'failed');}
});
test('source identity, native numbering and every projected row must agree',()=>{
 for(const mutate of [a=>a.proposal.sourceHash='wrong',a=>a.nativeQuoted.proposalBuffers.pop(),a=>a.items.push({kind:'annex'}),a=>a.wording.targetLabel=a.wording.targetLabel.replace('Annex I','Annex II'),a=>a.wording.targetLabel=a.wording.targetLabel.replace('6 a','6 b'),a=>a.proposal.paragraphs[12].source.ordinal++,a=>a.proposal.paragraphs[12].complete=false,a=>a.proposal.paragraphs[12].text='Clipped.',a=>source(a,'ANNEX','ANNEX I'),a=>source(a,p('Native bullet 2.','Bullet0','12'),''),a=>source(a,'Native bullet 4.','<w:object/>Native bullet 4.'),a=>source(a,'</w:body>','<w:altChunk/></w:body>')]){const a=input();mutate(a);assert.equal(assertBareAnnexIndent(a).status,'unverified',String(mutate));}
});
test('numbering changes cannot preserve a synthetic ordinal answer',()=>{
 for(const [from,to] of [['w:val="(%1)"','w:val="%1."'],['w:val="bullet"','w:val="decimal"'],['w:val=""','w:val="?"'],['w:ascii="Symbol"','w:ascii="Other"']]){const a=input();a.parts['word/numbering.xml']=a.parts['word/numbering.xml'].replace(from,to);a.nativeQuoted.proposalBuffer=zip(a.parts);a.nativeQuoted.proposalBuffers[1]=a.nativeQuoted.proposalBuffer;a.proposal.sourceHash=hash(a.nativeQuoted.proposalBuffer);assert.equal(assertBareAnnexIndent(a).status,'unverified');}
});

test('bookmarks carry no ordinal, but additional annex headings and act identity conflicts stay unavailable',()=>{
 const a=input();source(a,p('Native bullet 4.','Bullet0','12'),'<w:bookmarkEnd w:id="2"/>'+p('Native bullet 4.','Bullet0','12'));assert.equal(assertBareAnnexIndent(a).status,'verified');
 const extra=input();source(extra,p('Funding actions'),p('ANNEX II'));assert.equal(assertBareAnnexIndent(extra).status,'unverified');
 const conflict=input();conflict.nativeQuoted.proposalBuffers[0]=zip({'word/document.xml':wrap(p('Eligible groups are listed in the Annex II.'))});conflict.items[0].proposal.sourceHash=hash(conflict.nativeQuoted.proposalBuffers[0]);assert.equal(assertBareAnnexIndent(conflict).status,'unverified');
});

test('simple fields and unknown inline constructs cannot certify native list rows',()=>{
 for(const transform of [xml=>xml.replace('<w:r><w:t>Native bullet 4.</w:t></w:r>','<w:fldSimple w:instr="INCLUDETEXT &quot;unavailable.docx&quot;"><w:r><w:t>Native bullet 4.</w:t></w:r></w:fldSimple>'),xml=>xml.replace('Native bullet 4.','<w:unknown/>Native bullet 4.')]){
  const a=input();a.parts['word/document.xml']=transform(a.parts['word/document.xml']);a.nativeQuoted.proposalBuffer=zip(a.parts);a.nativeQuoted.proposalBuffers[1]=a.nativeQuoted.proposalBuffer;a.proposal.sourceHash=hash(a.nativeQuoted.proposalBuffer);assert.equal(assertBareAnnexIndent(a).status,'unverified');
 }
});
