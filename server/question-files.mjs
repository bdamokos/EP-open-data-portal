import {allowedPdf} from './document-pages.mjs';
import {questionPdf} from './question-pdf.mjs';
import {documentFileEdition} from './document-file-edition.mjs';
import {array,tail,documentFiles} from './activity-index-model.mjs';
import {languageCode} from './ep-links.mjs';
import {allowedDownload} from './document-text.mjs';

export const questionFileEdition=documentFileEdition;

// Prefer DOCX for each language; PDF-only declarations own standalone tasks.
export function questionFiles(work,policy='all') {
  const id=work.identifier||tail(work.id);
  const entries=[{sourceId:id,kind:'question',parentId:null,work},...array(work.inverse_answers_to).filter(answer=>answer&&typeof answer==='object').map(answer=>({sourceId:answer.identifier||tail(answer.id),kind:'answer',parentId:id,work:answer}))];
  return entries.flatMap(entry=>{
    if(!/^[A-Z0-9-]{1,100}$/.test(entry.sourceId||''))return [];
    const originals=array(entry.work.originalLanguage).map(languageCode).filter(Boolean);
    const docxLanguages=new Set(documentFiles(entry.work).filter(file=>file.format==='DOCX'&&allowedDownload(file.url)).map(file=>file.language));
    return array(entry.work.is_realized_by).flatMap(expression=>array(expression.is_embodied_by).flatMap(manifestation=>{
      const file=documentFiles({originalLanguage:entry.work.originalLanguage,is_realized_by:[{language:expression.language,is_embodied_by:[manifestation]}]})[0];
      if(!file||!file.language)return [];
      const pdfOnly=file.format==='PDF'&&!docxLanguages.has(file.language)&&allowedPdf(file.url);
      if(!pdfOnly&&(file.format!=='DOCX'||!allowedDownload(file.url)))return [];
      const primary=originals.includes(file.language)||file.language==='en';
      if(policy==='primary' && !primary)return [];
      return [{sourceId:entry.sourceId,kind:entry.kind,parentId:entry.parentId,date:entry.work.document_date||null,originalLanguages:originals,language:file.language,translationType:file.translationType,url:file.url,primary,...(pdfOnly?{format:'pdf'}:{}),edition:questionFileEdition(manifestation),pdf:pdfOnly?{...file,...questionFileEdition(manifestation),expressionId:expression.id||null,manifestationId:manifestation.id||null,sourceId:entry.sourceId}:questionPdf(entry.work,file.language)}];
    }));
  });
}

