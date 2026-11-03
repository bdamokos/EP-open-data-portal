import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQuotedSectionPoint} from './amendment-quoted-section-oracle.mjs';
import {quotedSectionNative} from './fixtures/quoted-section-native.mjs';
test('native whole-section point proof binds report comparison, parent ordinal and exact final gap',()=>{
 const input=quotedSectionNative();input.proposal={...input.proposal};Object.defineProperty(input.proposal,'units',{get(){throw Error('placement tree forbidden');}});assert.equal(assertQuotedSectionPoint(input).status,'verified');
 for(const shift of [-1,1])assert.equal(assertQuotedSectionPoint({...input,placement:{...input.placement,insertAfter:input.placement.insertAfter+shift,insertBefore:input.placement.insertBefore+shift}}).status,'failed');
});
test('native counter, source scope, complete quote and comparison mutations withhold',()=>{
 const sources=[xml=>xml.replace('ANNEX I</w:t>','ANNEX III</w:t>'),xml=>xml.replace('section 1.6 is replaced','section 1.7 is replaced'),xml=>xml.replace('1272/2008','1272/2009'),xml=>xml.replace('(b) Last','(c) Last'),xml=>xml.replace('Last supplier.’;','Last supplier;'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:fldSimple w:instr="INCLUDETEXT"><w:r><w:t>(b) Last supplier.’;</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:t>(b) Last supplier.’;</w:t><w:unknown/>'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:rPr><w:vanish/></w:rPr><w:t>(b) Last supplier.’;</w:t>')];
 for(const sourceChange of sources)assert.notEqual(assertQuotedSectionPoint(quotedSectionNative({sourceChange})).status,'verified',sourceChange.toString());
 for(const numberingChange of [xml=>xml.replace('<w:startOverride w:val="1"/>','<w:startOverride w:val="2"/>'),xml=>xml.replace('(%1)','%1.'),xml=>xml.replace('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"','xmlns:w="urn:unsupported"')])assert.notEqual(assertQuotedSectionPoint(quotedSectionNative({numberingChange})).status,'verified');
 for(const amendmentChange of [xml=>xml.replace('Amendment\t\t42','Amendment\t\t43'),xml=>xml.replace('section 1.6','section 1.7'),xml=>xml.replace('New telephone','Wrong telephone'),xml=>xml.replace('Text proposed by the Commission','Other heading'),xml=>xml.replace('<w:gridSpan w:val="2"/>','<w:gridSpan w:val="3"/>'),xml=>xml.replace('<w:t>Amendment</w:t>','<w:t>Amendment</w:t><w:unknown/>'),xml=>xml.replace('</w:tbl>','</w:tbl><w:p><w:r><w:t>Unbound second comparison</w:t></w:r></w:p>')])assert.notEqual(assertQuotedSectionPoint(quotedSectionNative({amendmentChange})).status,'verified',amendmentChange.toString());
});
test('native projection parity and complete source rows are required independently',()=>{
 for(const mutate of [x=>x.proposal.sourceHash='wrong',x=>x.wording.number=43,x=>x.proposal.paragraphs[x.placement.insertAfter].text+=' extra',x=>x.proposal.paragraphs[x.placement.insertAfter].source.complete=false,x=>x.proposal.paragraphs[x.placement.insertBefore].source.segment++,x=>x.wording.targetLabel=x.wording.targetLabel.replace('(b a)','(a a)'),x=>x.nativeQuoted.amendmentBuffer=undefined]){const input=quotedSectionNative();input.proposal=structuredClone(input.proposal);mutate(input);assert.notEqual(assertQuotedSectionPoint(input).status,'verified',mutate.toString());}
});
test('parent numbering includes table competitors and rejects another level-zero instance',()=>{
 const p='<w:p><w:pPr><w:pStyle w:val="Point0number"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr></w:pPr><w:r><w:t>Competing parent;</w:t></w:r></w:p>';
 for(const sourceChange of [xml=>xml.replace('<w:body>','<w:body>'+p),xml=>xml.replace('</w:p><w:p><w:pPr><w:pStyle w:val="Text1"/>','</w:p><w:tbl><w:tr><w:tc>'+p+'</w:tc></w:tr></w:tbl><w:p><w:pPr><w:pStyle w:val="Text1"/>'),xml=>xml.replace('w:numId w:val="6"','w:numId w:val="7"')])assert.notEqual(assertQuotedSectionPoint(quotedSectionNative({sourceChange})).status,'verified');
});
test('substantive content controls and unsupported blocks cannot disappear from table, row or cell ownership',()=>{
 const paragraph='<w:p><w:r><w:t>Additional substantive proposed wording.</w:t></w:r></w:p>';
 for(const wrapper of ['<w:sdt><w:sdtContent>'+paragraph+'</w:sdtContent></w:sdt>','<w:customXml>'+paragraph+'</w:customXml>','<w:unknown/>'])for(const ending of ['</w:tc></w:tr></w:tbl>','</w:tr></w:tbl>','</w:tbl>']){
  const input=quotedSectionNative({amendmentChange:xml=>xml.replace(ending,wrapper+ending)});assert.notEqual(assertQuotedSectionPoint(input).status,'verified',wrapper+' before '+ending);
 }
 for(const amendmentChange of [xml=>xml.replace('<w:gridSpan w:val="2"/>','<w:gridSpan w:val="2"/>'+paragraph),xml=>xml.replace('<w:tbl>','<w:tbl><w:tblPr><w:unknown/></w:tblPr>'),xml=>xml.replace('<w:tbl>','<w:tbl><w:tblGrid><w:gridCol><w:sdt/></w:gridCol></w:tblGrid>')])assert.notEqual(assertQuotedSectionPoint(quotedSectionNative({amendmentChange})).status,'verified');
});
