import {createReadStream} from 'node:fs';
// ODP cache envelopes write url/fetchedAt before payload.data. Read one work at
// a time so a speech catalogue never becomes a complete object graph in RAM.
function dataStart(text,open){
 let depth=1,string=false,escape=false,start=0;
 for(let i=open+1;i<text.length;i++){
  const c=text[i];
  if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"'){string=false;if(depth===1&&text.slice(start,i+1)==='"data"'){const match=/^\s*:\s*\[/.exec(text.slice(i+1));if(match)return i+1+match[0].length;}}}
  else if(c==='"'){string=true;start=i;}
  else if(c==='{'||c==='[')depth++;
  else if(c==='}'||c===']')depth--;
 }
 return null;
}
export async function* topicCachedWorks(file){
 let header='',source=null,buffer='',envelope='',suffix='',depth=0,string=false,escape=false,started=false,done=false;
 for await(const chunk of createReadStream(file,{encoding:'utf8',highWaterMark:32768})){
  if(done){suffix+=chunk;if(suffix.length>65536)throw Error('Cached envelope exceeds source bound.');continue;}
  let text=chunk;
  if(!source){
   header+=text;const match=/"payload"\s*:\s*\{/.exec(header),offset=match?dataStart(header,match.index+match[0].length-1):null;
   if(offset===null){if(header.length>65536)return;continue;}
   source=JSON.parse(header.slice(0,match.index)+'"payload":null}');envelope=header.slice(0,offset-1)+'[]';text=header.slice(offset);header='';
   if(!source.url?.startsWith('https://data.europarl.europa.eu/api/v2/'))return;
  }
  let segment=0;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(!started){if(c===']'){done=true;suffix=text.slice(i+1);break;}if(/[\s,]/.test(c))continue;if(c!=='{')throw Error('Invalid cached work.');started=true;depth=0;buffer='';segment=i;}
   if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;}
   else if(c==='"')string=true;
   else if(c==='{'||c==='[')depth++;
   else if(c==='}'||c===']')depth--;
   if(!string&&depth===0){const json=buffer+text.slice(segment,i+1);buffer='';started=false;yield {json,source:{url:source.url,fetchedAt:source.fetchedAt}};}
  }
  if(done)continue;
  if(started)buffer+=text.slice(segment);
  if(buffer.length>12*1024*1024)throw Error('Cached work exceeds source bound.');
 }
 if(source&&!done)throw Error('Incomplete cached work array.');
 if(done)JSON.parse(envelope+suffix);
}
