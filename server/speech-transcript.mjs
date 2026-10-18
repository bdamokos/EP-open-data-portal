import {existsSync} from 'node:fs';
import path from 'node:path';
import {CorpusReader} from './corpus-reader.mjs';
import {HttpError} from './http-utils.mjs';
import {config, booleanFromEnvironment, absolutePathFromEnvironment} from './config.mjs';

// A separate, read-only lane: a search cannot occupy the transcript reader.
// Opening this reader never creates a corpus or starts its writer.
let readers=[],directory;
export async function speechTranscript(id,language) {
  const current=absolutePathFromEnvironment('CORPUS_DIR');
  if(!booleanFromEnvironment('CORPUS_ENABLED')||!current||!existsSync(path.join(current,'corpus-v1.sqlite')))
    return {id,available:false};
  if(directory!==current){directory=current;readers=Array.from({length:4},()=>new CorpusReader(current,{timeoutMs:2000}));}
  const reader=readers.find(candidate=>!candidate.busy);
  if(!reader)throw new HttpError(503,'corpus_busy','Transcript readers are busy. Please retry shortly.');
  const result=await reader.query('speech-transcript',{sourceId:id,language});
  if(Buffer.byteLength(JSON.stringify(result))+1>config.jsonResponseLimitBytes)
    throw new HttpError(413,'speech_transcript_too_large','This stored transcript exceeds the supported reading response size.');
  return result;
}
