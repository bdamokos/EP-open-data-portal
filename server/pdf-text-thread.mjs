import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {HttpError} from './http-utils.mjs';

export const PDF_TEXT_LIMITS=Object.freeze({bytes:8*1024*1024,pages:100,items:250000,textBytes:2*1024*1024,timeMs:25000});
let active=false;
// Keep preload guards; CLI-only and V8 flags are not valid Worker arguments.
const workerImports=process.execArgv.flatMap((arg,index,args)=>/^--(?:import|require)=/.test(arg)?[arg]:['--import','--require','-r'].includes(arg)?[arg,args[index+1]]:[]);

// PDF parsing stays off the source writer's event loop. One bounded parser is
// enough for these short documents; contention is retried by the normal owner.
export async function extractPdfText(buffer,{signal}={}) {
  signal?.throwIfAborted();
  if(!Buffer.isBuffer(buffer)||buffer.length>PDF_TEXT_LIMITS.bytes||buffer.toString('ascii',0,5)!=='%PDF-')throw new Error('Invalid or oversized PDF document.');
  if(active)throw new HttpError(503,'upstream_busy','Document parser is busy.');
  active=true;let worker;
  try {
    worker=new Worker(new URL(import.meta.url),{workerData:{type:'question-pdf-text',buffer},execArgv:workerImports,resourceLimits:{maxOldGenerationSizeMb:128}});
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('PDF text extraction timed out.')),PDF_TEXT_LIMITS.timeMs);
      const abort=()=>reject(signal.reason || new Error('PDF text extraction cancelled.'));
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      signal?.addEventListener('abort',abort,{once:true});
      worker.once('message',value=>{cleanup();value.error?reject(new Error(value.error)):resolve(value);});
      worker.once('error',error=>{cleanup();reject(error);});
      worker.once('exit',code=>{cleanup();reject(new Error('PDF text parser exited ('+code+').'));});
      if(signal?.aborted)abort();
    });
  } finally {if(worker)await worker.terminate();active=false;}
}

if(!isMainThread&&workerData?.type==='question-pdf-text') {
  let task;
  try {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    task=getDocument({data:new Uint8Array(workerData.buffer),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,verbosity:0});
    const pdf=await task.promise;
    if(pdf.numPages>PDF_TEXT_LIMITS.pages)throw new Error('PDF document exceeds the page limit.');
    const paragraphs=[];let items=0,bytes=0;
    for(let number=1;number<=pdf.numPages;number++) {
      const page=await pdf.getPage(number),content=await page.getTextContent(),lines=[];let line='',position=null;
      const flush=()=>{const text=line.replace(/\s+/g,' ').trim();line='';if(text){bytes+=Buffer.byteLength(text)+1;if(bytes>PDF_TEXT_LIMITS.textBytes)throw new Error('PDF text exceeds the extraction limit.');lines.push({text,...position});}position=null;};
      for(const item of content.items) {
        if(++items>PDF_TEXT_LIMITS.items)throw new Error('PDF document exceeds the text item limit.');
        if(typeof item.str!=='string')continue;
        if(item.str.trim()&&!position)position={x:item.transform?.[4],y:item.transform?.[5],height:item.height};
        if(Buffer.byteLength(item.str)>PDF_TEXT_LIMITS.textBytes)throw new Error('PDF text exceeds the extraction limit.');
        line+=item.str;if(item.hasEOL)flush();
        if(Buffer.byteLength(line)>PDF_TEXT_LIMITS.textBytes)throw new Error('PDF text exceeds the extraction limit.');
      }
      flush();let paragraph='',previous;
      for(const row of lines) {
        const height=Math.max(row.height||0,previous?.height||0),gap=previous?.y-row.y;
        const wraps=previous&&height>0&&gap>0&&gap<=height*2.2&&Math.abs(previous.x-row.x)<=height*2;
        if(!wraps&&paragraph){paragraphs.push(paragraph);paragraph='';}
        paragraph+=(paragraph?' ':'')+row.text;previous=row;
      }
      if(paragraph)paragraphs.push(paragraph);page.cleanup();
    }
    if(!paragraphs.length)throw new Error('Official PDF contains no readable text.');
    parentPort.postMessage({paragraphs,pages:pdf.numPages});
  } catch(error) {parentPort.postMessage({error:String(error.message).slice(0,250)});}
  finally {await task?.destroy();}
}
