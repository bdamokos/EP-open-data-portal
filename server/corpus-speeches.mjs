import {existsSync} from 'node:fs';
import path from 'node:path';
import {CorpusReader} from './corpus-reader.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';

// Internal bounded reads only. Source workers keep fetching official updates;
// interactive consumers never create a corpus, acquire its lease or refresh it.
let directory,readers=[];
async function read(operation,params) {
  requestSignal()?.throwIfAborted();
  const current=process.env.CORPUS_DIR;
  if(process.env.CORPUS_ENABLED!=='true'||!current||!existsSync(path.join(current,'corpus-v1.sqlite')))return null;
  if(directory!==current){directory=current;readers=Array.from({length:2},()=>new CorpusReader(current,{timeoutMs:2000}));}
  const reader=readers.find(candidate=>!candidate.busy);
  if(!reader)return null;
  try {return await waitForRequest(reader.query(operation,params));}
  catch {requestSignal()?.throwIfAborted();return null;}
}
export const retainedSpeechData=params=>read('speech-data',params);
export const retainedSpeechPage=params=>read('speech-page',params);
export async function retainedSpeechMetadata(id) {
  const result=await retainedSpeechData({sourceIds:[id],metadataOnly:true});
  return result?.records[0]?.metadata||null;
}
