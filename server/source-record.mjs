import {odp} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {sourceTarget,humanSourceUrl,recordMatches,recordTitle} from './source-links.mjs';

export function createSourceReader({request=odp}={}) {
  return async function readSource(value,language='en') {
    const target=sourceTarget(value);
    if(!target)throw new HttpError(400,'unsupported_source','Choose a supported Parliament source record.');
    const params={...target.params};delete params.format;
    if(target.collection)params.limit=Math.min(25,Number(params.limit)||25);
    const record=await request(target.endpoint,params,{staleWhileRevalidate:true});
    if(!Array.isArray(record.payload?.data))throw new HttpError(502,'source_invalid','The source record could not be read.');
    if(Buffer.byteLength(JSON.stringify(record.payload))>1024*1024)throw new HttpError(502,'source_size','This source is too large for the reader. Open the original source instead.');
    const data=target.collection?record.payload.data.slice(0,25):record.payload.data;
    if(data.some(value=>!value||typeof value!=='object'||Array.isArray(value)))throw new HttpError(502,'source_invalid','The source record could not be read.');
    if(!target.collection&&(data.length!==1||!recordMatches(target,data[0])))throw new HttpError(502,'source_identity','The source did not return the requested record.');
    const fetchedAt=new Date(record.fetchedAt).toISOString();
    return {sourceUrl:target.url,requestUrl:record.url,fetchedAt,stale:Boolean(record.stale),refreshError:record.refreshError||null,
      collection:target.collection,limited:target.collection&&(Number(target.params.limit)>25||data.length>=25),
      records:data.map(value=>({title:recordTitle(value,language),websiteUrl:humanSourceUrl(target.url,{language,record:value}),value})),payload:{...record.payload,data}};
  };
}
export const sourceRecord=createSourceReader();
