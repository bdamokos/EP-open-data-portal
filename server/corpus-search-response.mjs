import {CORPUS_LIMITS} from './corpus-store.mjs';
import {HttpError} from './http-utils.mjs';

// Keep every variant and legacy hit in a returned group. A byte-limited page
// continues at the first omitted group, rather than silently dropping languages.
export function corpusSearchResponse(result,maxBytes) {
  const page=count=>{
    const results=result.results.slice(0,count),next=result.offset+count,more=next<result.total;
    return {...result,results,hits:results.flatMap(group=>group.hits),
      nextOffset:more&&next<=CORPUS_LIMITS.searchOffset?next:null,
      truncated:more&&next>CORPUS_LIMITS.searchOffset,responseLimited:count<result.results.length};
  };
  const fits=value=>Buffer.byteLength(JSON.stringify(value),'utf8')+1<=maxBytes;
  const full=page(result.results.length);
  if(fits(full))return full;
  let low=1,high=result.results.length-1,best=null;
  while(low<=high){const middle=Math.floor((low+high)/2),candidate=page(middle);
    if(fits(candidate)){best=candidate;low=middle+1;}else high=middle-1;}
  if(best)return best;
  throw new HttpError(413,'corpus_search_result_too_large','A matching document has too many text variants for this response. Choose a text language or narrow the search, then retry.');
}
