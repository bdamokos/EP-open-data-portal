import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureZip} from './fixtures/bare-annex-indent-native.mjs';
import {assertNativeProposalTitle,assertRecastReading} from './amendment-recast-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p=(style,text)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
function input(replaceSubject=null) {
 const values=['2025/580 (CNS)','Proposal for a','COUNCIL DIRECTIVE','on the subject (recast)','THE COUNCIL OF THE EUROPEAN UNION,'];
 const styles=['Rfrenceinterinstitutionnelle','Statut','Typedudocument','Titreobjet','Institutionquiagit'];
 const rows=values.map((v,i)=>p(styles[i],v));if(replaceSubject)rows[3]=`<w:p><w:pPr><w:pStyle w:val="Titreobjet"/></w:pPr>${replaceSubject}</w:p>`;
 const document=`<w:document xmlns:w="${ns}"><w:body>${rows.join('')}</w:body></w:document>`;
 const styleXml=`<w:styles xmlns:w="${ns}"><w:style w:type="character" w:styleId="CRMarker"><w:name w:val="CR Marker"/></w:style><w:style w:type="character" w:styleId="deleted"><w:name w:val="CR Deleted"/><w:rPr><w:strike/></w:rPr></w:style></w:styles>`;
 const proposal={paragraphs:values.map((text,index)=>({index,text,complete:true,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`,ordinal:index,segment:0,container:'body',containerPath:'body',complete:true}}))};
 return {proposal,wording:{language:'en',baseline:'commission-proposal',targetLabel:'Title 1',originalText:values.slice(1,4).join('\n'),proposedText:'Replacement title'},placement:{status:'placed',operation:'replace',span:{start:1,end:3},splice:{start:{paragraph:1,offset:0},end:{paragraph:3,offset:values[3].length}}},nativeQuoted:{proposalBuffer:fixtureZip({'word/document.xml':document,'word/styles.xml':styleXml})}};
}
test('native recast title proof checks unique complete source and exact splice',()=>{
 const a=input();assert.equal(assertNativeProposalTitle(a).status,'verified');assert.equal(assertRecastReading(a).status,'verified');
 for(const mutate of [x=>x.wording.originalText+=' altered',x=>x.placement.span.end=2,x=>x.proposal.paragraphs[2].source.complete=false,x=>x.proposal.paragraphs[2].source.ordinal=8]){const b=input();mutate(b);assert.notEqual(assertNativeProposalTitle(b).status,'verified');}
});

test('native title oracle rejects substantive and unsupported field results through full verification',()=>{
 const subject='on the subject (recast)';
 const field=(instruction,result,style='')=>`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r>${style?`<w:rPr><w:rStyle w:val="${style}"/></w:rPr>`:''}<w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
 for(const body of [`<w:fldSimple w:instr="DOCPROPERTY Title"><w:r><w:t>${subject}</w:t></w:r></w:fldSimple>`,field('DOCPROPERTY Title',subject),field('QUOTE &quot;ð&quot;',subject),field('QUOTE &quot;ð&quot;',subject,'CRMarker')]){
  const a=input(body);a.placement.itemIndex=0;
  assert.notEqual(assertNativeProposalTitle(a).status,'verified');
  assert.notEqual(verifyPlacement({items:[{kind:'act',proposal:a.proposal}],wording:a.wording,placement:a.placement,nativeQuoted:a.nativeQuoted}).status,'verified');
 }
 const a=input(`<w:r><w:t>${subject}</w:t></w:r>`+field('QUOTE &quot;ð&quot;','ð','CRMarker'));assert.equal(assertNativeProposalTitle(a).status,'verified');
});

test('native title verification withholds absent evidence and invalid item selection',()=>{
 const a=input();a.placement.itemIndex=0;const items=[{kind:'act',proposal:a.proposal}];
 assert.equal(verifyPlacement({items,wording:a.wording,placement:a.placement}).status,'unverified');
 assert.equal(verifyPlacement({items,wording:a.wording,placement:{...a.placement,itemIndex:9},nativeQuoted:a.nativeQuoted}).status,'unverified');
});
