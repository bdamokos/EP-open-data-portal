import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';

// The generic index fetcher treats 204 as an empty page and discards 404
// bodies. Sitting readers require the foreground client's exact observations.
export async function snapshotHttpObservation(response,url,{signal,clock=Date.now}={}){
  if(response.status===204)throw new HttpError(502,'odp_no_content','Parliament supplied no content for this request.');
  if(response.status!==404)return;
  const hash=createHash('sha256');let responseBytes=0;
  if(response.body)for await(const chunk of response.body){
    responseBytes+=chunk.byteLength;
    if(responseBytes>8*1024*1024)throw new HttpError(502,'odp_size','Parliament response exceeded the allowed size.');
    hash.update(chunk);
  }
  signal?.throwIfAborted();
  throw Object.assign(new HttpError(502,'odp_unavailable','Parliament data is unavailable (404). Please try again.'),{
    upstreamStatus:404,responseBytes,source:{url:String(url),fetchedAt:clock(),contentHash:hash.digest('hex'),httpStatus:404},
  });
}
