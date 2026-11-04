import {wholeInstructionNative,instructionZip} from './whole-instruction-native.mjs';
import {parseProposal} from '../../server/proposal-structure.mjs';
export const uniqueEntryText='ex- 8418 99 90 – Parts of refrigerating or freezing equipment and heat pumps, containing steel or aluminium';
export function uniqueEntryNative({changeSource=x=>x,changeAmendment=x=>x}={}){
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),p=text=>'<w:p><w:r><w:t>'+esc(text)+'</w:t></w:r></w:p>',row=(a,b)=>'<w:tr><w:tc>'+p(a)+'</w:tc><w:tc>'+p(b)+'</w:tc></w:tr>',grid='<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>';
 const original=uniqueEntryText,outer='Annex I – point 1',act='Regulation (EU) 2023/956',inner='Annex I – point 2 – table titled ‘Iron and Steel’';
 const a=wholeInstructionNative({sourceChange:xml=>{
  const caption='<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>‘Other table’</w:t></w:r></w:p>';
  const table=p('‘[Combined metal products')+'<w:tbl>'+grid+row('CN code','Greenhouse gas')+row(original,'Carbon dioxide and perfluorocarbons')+row('8419 Other plant','Carbon dioxide')+'</w:tbl>';
  return changeSource(xml.replace(caption,table).replace('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="15"/></w:numPr>',''));
 }});
 a.parts['word/styles.xml']=a.parts['word/styles.xml'].replace('<w:style w:type="paragraph" w:styleId="Point0number"><w:name w:val="Point0number"/></w:style>','<w:style w:type="paragraph" w:styleId="Point0number"><w:name w:val="Point0number"/><w:pPr><w:numPr><w:numId w:val="15"/></w:numPr></w:pPr></w:style>');
 const proposalBuffer=instructionZip(a.parts),proposal=structuredClone(parseProposal(proposalBuffer,{language:'en',item:'annex'}));
 const amendment=changeAmendment('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+p('<Amend><NumAm>42</NumAm>')+p('<Article>'+outer+'</Article>')+p('<DocAmend2>'+act+'</DocAmend2>')+p('<Article2>'+inner+'</Article2>')+'<w:tbl>'+grid+row('Text proposed by the Commission','Amendment')+row(original,'deleted')+'</w:tbl>'+p('<Original>{EN}en</Original>')+p('</Amend>')+'</w:body></w:document>');
 const target=proposal.paragraphs.find(p=>p.text===original),index=target?.index??0;
 return {items:[a.items[0],{kind:'annex',proposal}],wording:{number:42,language:'en',baseline:'commission-proposal',targetLabel:outer+'\n'+act+' — '+inner,targetPath:{proposal:[{raw:outer}],underlying:[{document:act,raw:inner}]},originalText:original,proposedText:'deleted'},placement:{status:'placed',operation:'delete',itemIndex:1,span:{start:index,end:index},splice:{start:{paragraph:index,offset:0},end:{paragraph:index,offset:original.length}}},nativeQuoted:{number:42,proposalBuffer,proposalBuffers:[a.nativeQuoted.proposalBuffers[0],proposalBuffer],amendmentBuffer:instructionZip({'word/document.xml':amendment})}};
}
