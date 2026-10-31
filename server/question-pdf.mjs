import {array,tail} from './activity-index-model.mjs';
import {pdfEdition,downloadPdf} from './document-pages.mjs';
import {extractPdfText,PDF_TEXT_LIMITS} from './pdf-text-thread.mjs';
import {createHash} from 'node:crypto';

const questionTypes=new Set(['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_WRITTEN_ANSWER']);
export function questionPdf(work,language) {
  // PDF text is an alternative for questions/answers, never an amendment or a
  // normative proposal baseline. Ambiguous declarations are not a selection.
  const type=work?.work_type?.id||work?.work_type;
  if(typeof type!=='string'||!questionTypes.has(tail(type))||!new RegExp('^(?:https?://data\\.europarl\\.europa\\.eu/def/ep-document-types/)?'+tail(type)+'$').test(type)||array(work?.work_type).length!==1)return null;
  const file=pdfEdition(work,language);
  return file?{...file,sourceId:work.identifier||tail(work.id)}:null;
}

export async function downloadQuestionPdf(file,{signal,download=downloadPdf,extract=extractPdfText}={}) {
  signal?.throwIfAborted();
  const result=await download(file.url,{signal,maxBytes:PDF_TEXT_LIMITS.bytes});signal?.throwIfAborted();
  const body=result.body;
  if(!Buffer.isBuffer(body)||body.length>PDF_TEXT_LIMITS.bytes||body.toString('ascii',0,5)!=='%PDF-')throw new Error('Invalid or oversized PDF document.');
  const declaredSize=file.byteSize!=null&&Number.isSafeInteger(Number(file.byteSize))&&Number(file.byteSize)>=0?Number(file.byteSize):null;
  const byteSizeMatches=declaredSize===null?null:body.length===declaredSize;
  const text=await extract(body,{signal});signal?.throwIfAborted();
  // Some API PDF manifestations repeat their DOCX size. Do not call those
  // bytes an edition match: require the exact printed parliamentary reference
  // as additional evidence, retaining both the declaration and actual digest.
  if(byteSizeMatches===false) {
    const match=/^([EP])-\d+-(\d{4})-(\d{6})(?:-ASW)?$/.exec(file.sourceId||'');
    const reference=match&&new RegExp('(?<![A-Z0-9])'+match[1]+'\\s*[-–−]\\s*'+match[3]+'\\s*/\\s*'+match[2]+'(?![0-9])');
    if(!reference?.test(text.paragraphs.join('\n')))throw new Error('Official PDF size differs and its exact parliamentary reference could not be verified.');
  }
  return {...text,resolvedSourceUrl:result.resolvedSourceUrl,sourceHash:createHash('sha256').update(body).digest('hex'),observedByteSize:body.length,byteSizeMatches};
}
