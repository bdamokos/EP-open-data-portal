import path from 'node:path';
import {XMLParser} from 'fast-xml-parser';
import {pathToFileURL} from 'node:url';

// All source/projection/placement modules come from the measured checkout.
// The harness and independent oracle stay fixed when --runtime-root is used.
export async function replayRuntime(root) {
  const load=file=>import(pathToFileURL(path.join(root,'server',file+'.mjs')).href);
  const [amendments,text,baseline,cellar,official,structure,placement,context,docx,model,order,amendmentModel,identity]=await Promise.all([
    load('amendment-documents'),load('document-text'),load('proposal-baseline'),load('cellar-documents'),load('official-context'),load('proposal-structure'),load('document-context-placement'),load('document-context'),load('docx-source-structure'),load('activity-index-model'),load('language-order'),load('amendments'),load('commission-proposal-identity'),
  ]);
  const council=await load('council-position-baseline').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  const xhtml=await load('public-legal-xhtml').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  return {...amendments,...text,...baseline,...cellar,...official,...structure,...placement,...model,...order,...amendmentModel,...identity,...council,...xhtml,
    documentContextVersion:context.DOCUMENT_CONTEXT_VERSION,documentExtractionVersion:docx.DOCX_EXTRACTION_VERSION};
}
export const publicDocumentUrl=id=>'https://data.europarl.europa.eu/api/v2/plenary-documents/'+id+'?format=application%2Fld%2Bjson';

// Read only the publication's explicit template references, without using the
// amendment parser or its baseline classification to choose acquisition inputs.
export function rawProposalReferences(buffer,runtime) {
  let xml;try{xml=runtime.docxParts(buffer).get('word/document.xml');}catch{return [];}
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(xml);
  const text=nodes=>nodes.flatMap(node=>Object.entries(node).flatMap(([key,value])=>key==='w:t'?value.filter(v=>'#text' in v).map(v=>String(v['#text'])):Array.isArray(value)?text(value):[])).join('');
  return [...text(tree).matchAll(/<(DocRef|DocAmend\d?)>([\s\S]*?)<\/\1>/g)].map(([,field,raw])=>({field,raw}));
}

export function sourceReplay(cache,runtime) {
  const observedFiles=new Map();
  const textWork=(work,language)=>{
    const files=runtime.documentFiles(work).filter(f=>f.format==='DOCX'&&runtime.allowedDownload(f.url));
    if(files.some(f=>f.language===language))return {work};
    const declaration=observedFiles.get(language);
    if(!declaration)return {work};
    // The frozen public catalogue is also an exact-ID file declaration. Keep
    // the current EP metadata unchanged and record the supplementary evidence.
    return {work:{...work,is_realized_by:[...runtime.array(work.is_realized_by),{language,is_embodied_by:[{format:'DOCX',is_exemplified_by:declaration.url}]}]},declaration};
  };
  const request=async endpoint=>{
    const input=await cache.get(publicDocumentUrl(endpoint.split('/').at(-1)),{accept:'application/ld+json'});
    if(!input.ok)return {payload:{data:[]},url:input.url,fetchedAt:Date.parse(input.fetchedAt),status:input.status};
    let payload;try{payload=JSON.parse(input.body.toString('utf8'));}catch{throw new Error('Invalid public document JSON: '+input.url);}
    const id=endpoint.split('/').at(-1),nodes=payload?.data;
    if(!Array.isArray(nodes)||nodes.length!==1||!['eli/dl/doc/'+id,'https://data.europarl.europa.eu/eli/dl/doc/'+id].includes(nodes[0].id))throw new Error('Public document identity mismatch: '+id);
    const type=String(nodes[0].work_type?.id||nodes[0].work_type||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
    const expected='def/ep-document-types/'+(id.startsWith('A-')?'REPORT_PLENARY':id.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION');
    if(type!==expected)throw new Error('Public document type mismatch: '+id);
    return {payload,url:input.url,fetchedAt:Date.parse(input.fetchedAt)};
  };
  // Keep the production metadata validation, negotiation and redirect rules.
  // InputCache owns the single writer, request spacing/cap and immutable bytes.
  let sourceTime=Date.now();
  const clock=()=>sourceTime;
  const sources=new runtime.OfficialContextSources({directory:null,clock,fetchSource:async(url,options)=>{
    const input=await cache.get(url,{accept:options.headers.Accept,language:options.headers['Accept-Language'],raw:true,signal:options.signal});
    sourceTime=Date.parse(input.fetchedAt);
    return new Response([204,304].includes(input.status)?null:input.body,{status:input.status,headers:input.headers});
  },run:operation=>operation()});
  const documents=new runtime.CellarDocuments({sources,directory:null,clock});
  const readProposal=runtime.createProposalBaseline({documents,request});
  const readCouncil=runtime.createCouncilPositionBaseline?.({documents,request});
  return {
    request,
    observeFiles(id,contexts) {
      for(const [language,{plain}] of contexts) {
        const document=plain.value?.document;
        if(plain.value?.documentId!==id||document?.selectedDocumentId&&document.selectedDocumentId!==id)continue;
        const files=(document?.files||[]).filter(file=>file.language===language&&file.format==='DOCX'&&runtime.allowedDownload(file.url));
        const urls=[...new Set(files.map(file=>file.url))];
        if(urls.length===1)observedFiles.set(language,{url:urls[0],language,catalogue:{url:plain.input.url,sha256:plain.input.sha256,fetchedAt:plain.input.fetchedAt},upstreamSources:plain.value.sources||[]});
      }
    },
    references:buffer=>rawProposalReferences(buffer,runtime),
    async acquire(id,languages,references=new Map()) {
      const record=await request('/plenary-documents/'+id),work=record.payload.data[0];
      if(!work)return null;
      // Mirror documentText's selection with its checkout helpers. Acquisition
      // never needs a parsed amendment, document body or proposal projection.
      for(const language of languages) {
        const selected=textWork(work,language);
        const files=runtime.documentFiles(selected.work).filter(f=>f.format==='DOCX'&&runtime.allowedDownload(f.url));
        const preferred=runtime.languagePreference(files.map(f=>f.language).filter(Boolean),language);
        const chosen=files.find(f=>f.language===preferred[0])||files[0];
        if(chosen)await cache.get(chosen.url);
        if(id.startsWith('A-')){await readProposal({reportId:id,language});cache.assertHealthy();}
        if(id.startsWith('A-')&&readCouncil){await readCouncil({reportId:id,language,documentReferences:references.get(language)||[]});cache.assertHealthy();}
        const hints=[...new Map((references.get(language)||[]).map(ref=>[JSON.stringify(ref),ref])).values()];
        for(const ref of hints) {
          const celexes=[...new Set(runtime.commissionReferences(ref.raw).map(r=>r.celex))];
          if(!celexes.length)continue;
          if(id.startsWith('A-'))await readProposal({reportId:id,language,documentReferences:[ref]});
          else for(const celex of celexes)await readProposal({celex,language,documentReferences:[ref]});
          cache.assertHealthy();
        }
      }
      cache.assertHealthy();return work;
    },
    async text(work,language) {
      if(!work)return {status:'unavailable',paragraphs:[],textLanguage:language,reason:'public-document-unavailable',sourceInput:null};
      const selected=textWork(work,language);work=selected.work;
      const files=runtime.documentFiles(work).filter(f=>f.format==='DOCX'&&runtime.allowedDownload(f.url));
      const preferred=runtime.languagePreference(files.map(f=>f.language).filter(Boolean),language);
      const chosen=files.find(f=>f.language===preferred[0])||files[0];
      const source=chosen?await cache.get(chosen.url):null;
      const text=await runtime.documentText(work,language,{directory:null,clock:()=>source?Date.parse(source.fetchedAt):0,download:async url=>{
        const input=await cache.get(url);
        if(!input.ok)throw new Error('document-source-http-'+input.status);
        return {...runtime.docxContent(input.body),resolvedSourceUrl:input.resolvedSourceUrl||url};
      }});
      cache.assertHealthy();return {...text,sourceMetadataGaps:selected.declaration?['requested-language-omitted-by-current-EP-metadata']:[],fileDeclarationSource:selected.declaration??null,sourceInput:source?{url:source.url,fetchedAt:source.fetchedAt,sha256:source.sha256,status:source.status,ok:source.ok}:null};
    },
    async proposal(options) {
      if(typeof options.language!=='string'||!options.reportId&&!options.celex)return {baseline:{status:'unresolved',language:options.language,gaps:['proposal-identity-unavailable']},items:[]};
      const source=await readProposal(options);cache.assertHealthy();
      const items=[];
      try {
        for(const item of source.items)items.push({kind:item.kind,index:item.index,proposal:runtime.parseProposal(item.buffer,{language:options.language,item:item.kind,sourceUrl:item.source.url,identity:{work:source.workId,expression:item.expressionId,item:item.itemId}})});
        if(Buffer.byteLength(JSON.stringify(items))>3*1024*1024)throw new Error('proposal-response-budget');
      }catch {return {baseline:{...source,items:[],status:'unavailable',gaps:[...source.gaps,'proposal-projection-unavailable']},items:[]};}
      return {baseline:{...source,items:source.items.map(({buffer,...item})=>item)},items};
    },
    async council(options) {
      if(!readCouncil)return {baseline:{status:'unresolved',language:options.language,gaps:['council-position-unavailable']},items:[]};
      const source=await readCouncil(options);cache.assertHealthy();
      const items=[];
      try {
        for(const item of source.items)items.push({kind:item.kind,index:item.index,proposal:runtime.parsePublicLegalXhtml(item.buffer,{language:options.language,sourceUrl:item.source.url,identity:{work:source.workId,expression:item.expressionId,item:item.itemId,celex:source.celex}})});
        if(Buffer.byteLength(JSON.stringify(items))>3*1024*1024)throw new Error('proposal-response-budget');
      }catch {return {baseline:{...source,items:[],status:'unavailable',gaps:[...source.gaps,'proposal-projection-unavailable']},items:[]};}
      return {baseline:{...source,items:source.items.map(({buffer,...item})=>item)},items};
    },
  };
}
