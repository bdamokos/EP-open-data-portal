import {questionPdf} from './question-pdf.mjs';
import {documentFileEdition} from './document-file-edition.mjs';
import {array,tail,documentFiles} from './activity-index-model.mjs';
import {languageCode} from './ep-links.mjs';
import {allowedDownload} from './document-text.mjs';

export const questionFileEdition=documentFileEdition;

// Question and answer DOCX files listed by a saved index record.
export function questionFiles(work,policy='all') {
  const id=work.identifier||tail(work.id);
  const entries=[{sourceId:id,kind:'question',parentId:null,work},...array(work.inverse_answers_to).filter(answer=>answer&&typeof answer==='object').map(answer=>({sourceId:answer.identifier||tail(answer.id),kind:'answer',parentId:id,work:answer}))];
  return entries.flatMap(entry=>{
    if(!/^[A-Z0-9-]{1,100}$/.test(entry.sourceId||''))return [];
    const originals=array(entry.work.originalLanguage).map(languageCode).filter(Boolean);
    return array(entry.work.is_realized_by).flatMap(expression=>array(expression.is_embodied_by).flatMap(manifestation=>{
      const file=documentFiles({originalLanguage:entry.work.originalLanguage,is_realized_by:[{language:expression.language,is_embodied_by:[manifestation]}]})[0];
      if(!file||file.format!=='DOCX'||!file.language||!allowedDownload(file.url))return [];
      const primary=originals.includes(file.language)||file.language==='en';
      if(policy==='primary' && !primary)return [];
      return [{sourceId:entry.sourceId,kind:entry.kind,parentId:entry.parentId,date:entry.work.document_date||null,originalLanguages:originals,language:file.language,translationType:file.translationType,url:file.url,primary,edition:questionFileEdition(manifestation),pdf:questionPdf(entry.work,file.language)}];
    }));
  });
}

