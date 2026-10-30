import {publicUrl} from './publicUrl';
import {useEffect,useRef,useState} from 'react';
import {API_ROOT} from './api';
import type {PDFDocumentProxy,RenderTask} from 'pdfjs-dist';
import './DocumentPages.css';

export function DocumentPages({documentId,language}:{documentId:string;language:string}){
  const [open,setOpen]=useState(false);
  return <div className="document-pages"><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Hide pages':'View original pages'}</button>{open&&<Pages key={documentId+':'+language} documentId={documentId} language={language}/>}</div>;
}
function Pages({documentId,language}:{documentId:string;language:string}){
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[number,setNumber]=useState(1),[zoom,setZoom]=useState(1),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(true),[pageText,setPageText]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let active=true,task:{destroy:()=>Promise<void>}|undefined;const controller=new AbortController();const timeout=window.setTimeout(()=>{controller.abort();void task?.destroy().catch(()=>{});if(active){setError('Document pages timed out.');setBusy(false);}},30000);
    void (async()=>{
      const library=await import('pdfjs-dist');if(!active)return;
      library.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
      const response=await fetch(API_ROOT+'/document-pages/'+encodeURIComponent(documentId)+'?lang='+encodeURIComponent(language),{signal:controller.signal,credentials:'same-origin'});
      if(!response.ok)throw Error(response.status===404?'No PDF in this language.':response.status===413?'Document exceeds the page-view size limit.':'Document pages unavailable.');
      if(Number(response.headers.get('content-length'))>16*1024*1024)throw Error('Document exceeds the page-view size limit.');
      const reader=response.body?.getReader();if(!reader)throw Error('Document pages unavailable.');const chunks:Uint8Array[]=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024){await reader.cancel();throw Error('Document exceeds the page-view size limit.');}chunks.push(value);}
      if(!active)return;const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const loading=library.getDocument({data:bytes,cMapUrl:publicUrl('assets/pdfjs-6.4.299/cmaps/'),cMapPacked:true,standardFontDataUrl:publicUrl('assets/pdfjs-6.4.299/standard_fonts/'),wasmUrl:publicUrl('assets/pdfjs-6.4.299/wasm/'),maxImageSize:20_000_000,canvasMaxAreaInBytes:32*1024*1024,enableXfa:false,useSystemFonts:true,stopAtErrors:true});task=loading;
      const document=await loading.promise;if(!active){await loading.destroy();return;}
      if(document.numPages>500){await loading.destroy();throw Error('Document exceeds the page-view page limit.');}window.clearTimeout(timeout);setPdf(document);
    })().catch(reason=>{window.clearTimeout(timeout);if(active){setError(reason instanceof Error?reason.message:'Document pages unavailable.');setBusy(false);}});
    return ()=>{active=false;window.clearTimeout(timeout);controller.abort();void task?.destroy().catch(()=>{});};
  },[documentId,language]);
  useEffect(()=>{
    if(!pdf||!canvas.current)return;let active=true,render:RenderTask|undefined;
    setBusy(true);setError(null);setPageText('');
    void (async()=>{
      const page=await pdf.getPage(number);if(!active)return;
      const original=page.getViewport({scale:1});if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)throw Error('Invalid page size.');
      const scale=Math.min(2*zoom,Math.sqrt(8_000_000/(original.width*original.height)),16000/original.width,16000/original.height),viewport=page.getViewport({scale});
      const target=canvas.current!;target.width=Math.max(1,Math.floor(viewport.width));target.height=Math.max(1,Math.floor(viewport.height));
      render=page.render({canvas:target,viewport});await render.promise;
      if(active)setBusy(false);
      try{const content=await page.getTextContent();if(active)setPageText(content.items.map(item=>'str' in item?item.str:'').join(' ').slice(0,2*1024*1024));}catch{/* The rendered page remains readable when its text layer is unavailable. */}
    })().catch(reason=>{if(active){setError(reason instanceof Error&&reason.name==='RenderingCancelledException'?null:'Page unavailable.');setBusy(false);}});
    return ()=>{active=false;render?.cancel();};
  },[pdf,number,zoom]);
  return <div className="document-pages-view" lang={language}>
    {pdf&&<div className="document-pages-tools"><button type="button" disabled={number===1} onClick={()=>setNumber(n=>n-1)}>Previous page</button><label>Page <input type="number" min={1} max={pdf.numPages} value={number} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=pdf.numPages)setNumber(n);}}/> of {pdf.numPages}</label><button type="button" disabled={number===pdf.numPages} onClick={()=>setNumber(n=>n+1)}>Next page</button><button type="button" aria-pressed={zoom===2} onClick={()=>setZoom(z=>z===1?2:1)}>{zoom===1?'Enlarge page':'Fit page'}</button></div>}
    {busy&&<p role="status">Loading page…</p>}{error&&<p role="alert">{error}</p>}
    <div className={'document-page-scroll'+(zoom===2?' document-page-enlarged':'')} hidden={busy||!!error||!pdf}><canvas ref={canvas} role="img" aria-label={'Original document, page '+number}/></div>
    {pageText&&<details><summary>Page text</summary><p>{pageText}</p></details>}
  </div>;
}
