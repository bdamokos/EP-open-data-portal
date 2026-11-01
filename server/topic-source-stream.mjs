// Read selected root arrays one element at a time. SQLite JSON expansion keeps
// a parsed copy of the complete sitting in native memory; byte slices do not.
export function* rootSourceValues(chunks,{arrays=[],scalars=[]}={}){
 const wantedArrays=new Set(arrays),wantedScalars=new Set(scalars);
 let depth=0,string=false,escape=false,key='',keyText='',readingKey=false,expectKey=false,expectValue=false,arrayField=null,capture=null,text='',closed=false;
 const decoder=new TextDecoder();
 function* scan(chunk){
  for(const c of chunk){
   if(closed){if(!/\s/.test(c))throw Error('Invalid source envelope.');continue;}
   if(capture)text+=c;
   if(string){
    if(readingKey)keyText+=c;
    if(escape)escape=false;
    else if(c==='\\')escape=true;
    else if(c==='"'){
     string=false;
     if(readingKey){key=JSON.parse(keyText);readingKey=false;expectKey=false;}
     else if(capture?.scalar){yield {field:capture.field,value:JSON.parse(text)};capture=null;text='';expectValue=false;}
    }
    if(text.length>12*1024*1024)throw Error('Source item exceeds the bound.');
    continue;
   }
   if(c==='"'){
    string=true;
    if(depth===1&&expectKey){readingKey=true;keyText='"';}
    else if(depth===1&&expectValue&&wantedScalars.has(key)){capture={field:key,scalar:true};text='"';}
   }else if(c==='{'||c==='['){
    if(depth===0){if(c!=='{')throw Error('Invalid source envelope.');expectKey=true;}
    else if(depth===1&&expectValue){arrayField=c==='['&&wantedArrays.has(key)?key:null;expectValue=false;}
    else if(depth===2&&arrayField&&!capture){capture={field:arrayField,depth:3};text=c;}
    depth++;
   }else if(c==='}'||c===']'){
    depth--;if(depth<0)throw Error('Invalid source envelope.');
    if(capture&&!capture.scalar&&depth===capture.depth-1){yield {field:capture.field,value:JSON.parse(text)};capture=null;text='';}
    if(depth===1)arrayField=null;
    if(depth===0)closed=true;
   }else if(depth===1&&c===':')expectValue=true;
   else if(depth===1&&c===','){expectKey=true;expectValue=false;key='';}
  }
 }
 for(const chunk of chunks)yield* scan(typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true}));
 yield* scan(decoder.decode());
 if(!closed||string||capture)throw Error('Incomplete source envelope.');
}
export function* sourceByteChunks(db,rowid,{chunkSize=65536}={}){
 const read=db.prepare('SELECT substr(CAST(body AS BLOB),?,?) chunk FROM sources WHERE rowid=?');
 for(let offset=1;;offset+=chunkSize){const chunk=read.get(offset,chunkSize,rowid)?.chunk;if(!chunk?.length)break;yield chunk;if(chunk.length<chunkSize)break;}
}
