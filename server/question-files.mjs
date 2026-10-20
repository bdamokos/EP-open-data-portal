import {array,tail,documentFiles} from './activity-index-model.mjs';
import {languageCode} from './ep-links.mjs';
import {allowedDownload} from './document-text.mjs';

// Question and answer DOCX files listed by a saved index record.
export function questionFiles(work,policy='all') {
  const id=work.identifier||tail(work.id);
  const entries=[{sourceId:id,kind:'question',parentId:null,work},...array(work.inverse_answers_to).filter(answer=>answer&&typeof answer==='object').map(answer=>({sourceId:answer.identifier||tail(answer.id),kind:'answer',parentId:id,work:answer}))];
  return entries.flatMap(entry=>{
    if(!/^[A-Z0-9-]{1,100}$/.test(entry.sourceId||''))return [];
    const originals=array(entry.work.originalLanguage).map(languageCode).filter(Boolean);
    const files=documentFiles(entry.work).filter(file=>file.format==='DOCX' && file.language && allowedDownload(file.url));
    return files.flatMap(file=>{
      const primary=originals.includes(file.language)||file.language==='en';
      if(policy==='primary' && !primary)return [];
      return [{sourceId:entry.sourceId,kind:entry.kind,parentId:entry.parentId,date:entry.work.document_date||null,originalLanguages:originals,language:file.language,translationType:file.translationType,url:file.url,primary}];
    });
  });
}

