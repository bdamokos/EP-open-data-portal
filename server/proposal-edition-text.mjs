import {createHash} from 'node:crypto';
import {docxContent} from './document-text.mjs';
import {CELLAR_LIMITS} from './cellar-documents.mjs';
import {comparableProposalEditions,resolveProposalTree} from './commission-proposal-identity.mjs';
import {isLocalRequestFailure} from './request-budget.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function identicalProposalEditions(documents,data,{celex,language,procedure}) {
 const editions=comparableProposalEditions(data,{celex});if(!editions)return null;
 const observations=[];let bytes=0,selected,reference;
 try {
  for(const edition of editions){
   const metadata=await documents.metadataByWork(edition.workId,{celex,editionCelex:edition.celex});
   const identity=resolveProposalTree(metadata.xml,{celex,language,procedure,edition});
   if(identity.status!=='resolved'||identity.workId!==edition.workId||metadata.viewCache?.stale)return null;
   const parts=[],items=[],sources=[];
   for(const item of identity.items){
    const content=await documents.docx({celex,language:item.languageUri,...item});
    bytes+=content.buffer.length;if(bytes>CELLAR_LIMITS.bundleBytes||content.source.stale)return null;
    sources.push({itemId:item.itemId,kind:item.kind,index:item.index,source:content.source});
    const parsed=docxContent(content.buffer);
    if(parsed.extractionWarnings.some(warning=>warning!=='A drawing, equation or other document object is shown as a placeholder; the surrounding text is retained.'))return null;
    parts.push({kind:item.kind,index:item.index,paragraphs:parsed.paragraphs,notes:parsed.notes.map(n=>({id:n.id,text:n.text})),anchors:parsed.anchors,warnings:parsed.extractionWarnings});
    if(!selected)items.push({...item,source:content.source,buffer:content.buffer});
   }
   const proof=identity.evidence.find(e=>e.kind==='cellar-identity');
   const signature=JSON.stringify({types:proof.types,dossiers:proof.procedureCodes,parts});
   if(reference!==undefined&&signature!==reference)return null;
   reference=signature;
   observations.push({workId:edition.workId,celex:edition.celex,version:edition.version,metadataSource:{url:metadata.url,fetchedAt:metadata.fetchedAt},items:sources,textSha256:hash(signature)});
   if(!selected)selected={metadata,identity,items};
  }
  return {...selected,evidence:{kind:'identical-extracted-proposal-editions',selectedWorkId:selected.identity.workId,selection:'unqualified-final-edition',language,editions:observations}};
 }catch(error){if(isLocalRequestFailure(error))throw error;return null;}
}
