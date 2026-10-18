import {booleanFromEnvironment, absolutePathFromEnvironment} from './config.mjs';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {CorpusReader} from './corpus-reader.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';
import {setTimeout as delay} from 'node:timers/promises';

// Internal bounded reads only. Source workers keep fetching official updates;
// interactive consumers never create a corpus, acquire its lease or refresh it.
let directory,readers=[],waiting=0;
async function read(operation,params) {
  requestSignal()?.throwIfAborted();
  const current=absolutePathFromEnvironment('CORPUS_DIR');
  if(!booleanFromEnvironment('CORPUS_ENABLED')||!current||!existsSync(path.join(current,'corpus-v1.sqlite')))return null;
  if(directory!==current){directory=current;readers=Array.from({length:2},()=>new CorpusReader(current,{timeoutMs:2000}));}
  const pool=readers;let reader=pool.find(candidate=>!candidate.busy);
  try {
    // Parallel cloud/statistics walks can request their next page before the
    // previous worker exits. Wait briefly within the same bounded capacity.
    if(!reader) {
      if(waiting>=8)return null;
      waiting++;
      try {
        const deadline=performance.now()+250;
        do {await delay(10,undefined,{signal:requestSignal()});reader=pool.find(candidate=>!candidate.busy);}while(!reader&&performance.now()<deadline);
      }finally {waiting--;}
    }
    if(!reader)return null;
    return await waitForRequest(reader.query(operation,params));
  }
  catch {requestSignal()?.throwIfAborted();return null;}
}
export const retainedSpeechData=params=>read('speech-data',params);
export const retainedSpeechPage=params=>read('speech-page',params);
export async function retainedSpeechMetadata(id) {
  const result=await retainedSpeechData({sourceIds:[id],metadataOnly:true});
  return result?.records[0]?.metadata||null;
}
