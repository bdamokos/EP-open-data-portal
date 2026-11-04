import {firstAnnexZip} from './first-annex-native.mjs';
import {parseProposal} from '../../server/proposal-structure.mjs';
export const tableParagraph=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</w:t></w:r></w:p>';
export const contextTable=rows=>'<w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid>'+rows.map(row=>'<w:tr>'+row.map(text=>'<w:tc>'+tableParagraph(text)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
export function tableContextNative({inherited=false,instruction=false,change=xml=>xml}={}){
 const header=['CN code','Description'],data=[['28342100','Nitrate of potassium'],['31021010','Other retained native row']];
 const owner='(1)\tin point 2, the table ‘Fertilisers’ is replaced by the following:';
 const body=tableParagraph(instruction?'ANNEX I':'ANNEX')+(instruction?tableParagraph('Annex II is amended as follows:')+tableParagraph(owner):'')+(inherited?tableParagraph('Aluminium')+contextTable([header,['76010000','Aluminium']]):'')+tableParagraph('Fertilisers')+contextTable(inherited?data:[header,...data]);
 const native=firstAnnexZip({'word/document.xml':change('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>')});
 const proposal=structuredClone(parseProposal(native,{language:'en',item:'annex'})),items=[{kind:'annex',proposal}];
 const paragraphs=proposal.paragraphs.filter(p=>p.source?.path.startsWith('/w:document[1]/w:body[1]/w:tbl['+(inherited?2:1)+']/'));
 const wording={language:'en',baseline:'commission-proposal',targetLabel:'Annex – table – Fertilisers',originalText:'Fertilisers\nCN code\tDescription\n28342100\tNitrate of potassium\n…\t…',proposedText:'Fertilisers\nCN code\tDescription\n28342100\tNitrate of potassium\n…\t…\n31000000\tNew published row'};
 if(instruction){wording.targetLabel='Annex I – point 1\nRegulation (EU) 2023/956 — Annex II – point 2 – Table Fertilisers';wording.targetPath={proposal:[{raw:'Annex I – point 1'}],underlying:[{raw:'Annex II – point 2 – Table Fertilisers'}]};wording.originalText=owner+'\n'+wording.originalText;wording.proposedText=owner+'\n'+wording.proposedText;}
 return {items,proposal,wording,nativeProposalInputs:[native],nativeQuoted:{proposalBuffers:[native]},placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:paragraphs[0].index,end:paragraphs.at(-1).index}}};
}
