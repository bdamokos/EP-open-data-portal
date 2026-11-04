import {firstAnnexNative,firstAnnexZip} from './first-annex-native.mjs';
import {quotedWordParts} from '../amendment-benchmark-quoted-oracle.mjs';
export function sequentialAnnexNative({change=xml=>xml,sourceChange=xml=>xml}={}) {
 const input=firstAnnexNative({sourceChange}),parts=quotedWordParts(input.nativeQuoted.amendmentBuffer),p=(text,style='Normal')=>'<w:p><w:pPr><w:pStyle w:val="'+style+'"/></w:pPr><w:r><w:t>'+text+'</w:t></w:r></w:p>',cell=text=>'<w:tc>'+p(text)+'</w:tc>',row=(...cells)=>'<w:tr>'+cells.map(cell).join('')+'</w:tr>';
 const target='Annex 2 – Budget',prefix='ANNEX\nThe programme includes these budget lines:',data='Title\tDescription\nXX\tPublished budget wording.';
 const appended=p('Amendment\t\t2')+p('Proposal for a regulation','NormalBold')+p(target,'NormalBold')+'<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid>'+row('Text proposed by the Commission')+row('Amendment')+'</w:tbl>'+p('ANNEX')+p('The programme includes these budget lines:')+'<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'+row('Title','Description')+row('XX','Published budget wording.')+'</w:tbl>';
 parts.set('word/document.xml',change(parts.get('word/document.xml').replace('</w:body>',appended+'</w:body>')));
 input.nativeQuoted.amendmentBuffer=firstAnnexZip(Object.fromEntries(parts));input.nativeQuoted.number=2;
 input.wording={...input.wording,number:2,listId:'A-10-2026-0001-AM-001-002',targetLabel:target,originalText:'',proposedText:prefix+'\n'+data,documentReferences:[{field:'DocumentClass',raw:'Proposal for a regulation',scope:'amendment'},{field:'PrecedingAnnex',raw:'1',sourceRaw:'Annex 1 - Indicators',scope:'amendment',basis:'native-annex-order'}]};
 return input;
}
