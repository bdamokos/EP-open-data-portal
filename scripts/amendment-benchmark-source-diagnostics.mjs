// Source diagnostics do not change replay inputs or placement outcomes. A 406
// can advertise a different public representation; preserve that observation
// without replacing a frozen source observation or its MIME validation.
import {allowedDownload} from '../server/document-text.mjs';
import {CELLAR_DOCX_MIME} from '../server/cellar-documents.mjs';

const xmlParts=new Set(['word/document.xml','word/styles.xml','word/numbering.xml','word/settings.xml','word/_rels/document.xml.rels','word/footnotes.xml','word/_rels/footnotes.xml.rels','word/endnotes.xml','word/_rels/endnotes.xml.rels']);
export function docxXmlSizes(buffer) {
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)return null;
  const count=buffer.readUInt16LE(end+10);let cursor=buffer.readUInt32LE(end+16);
  if(count>2000)return null;
  const parts=[];
  for(let i=0;i<count;i++) {
    if(cursor+46>buffer.length||buffer.readUInt32LE(cursor)!==0x02014b50)return null;
    const length=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32);
    const name=buffer.subarray(cursor+46,cursor+46+length).toString('utf8');
    if(xmlParts.has(name))parts.push({name,bytes:buffer.readUInt32LE(cursor+24)});
    cursor+=46+length+extra+comment;
    if(cursor>buffer.length)return null;
  }
  return {parts,totalXmlBytes:parts.reduce((sum,part)=>sum+part.bytes,0)};
}

export function advertisedRepresentation(input) {
  if(input.status!==406||input.body.length>16*1024)return null;
  // Only the concrete public representation observed in the corpus is
  // supported. No wildcard Accept, alternate endpoint or identity substitution.
  return /resource mimetype \[application\/zip;type=akn4eu\]/u.test(input.body.toString('utf8'))?'application/zip;type=akn4eu':null;
}

export async function sourceDiagnostics(cache,manifest,{negotiationCache}={}) {
  const results=[];
  for(const meta of manifest) {
    if(meta.status!==406&&!meta.ok)continue;
    const isDocx=meta.request?.accept===CELLAR_DOCX_MIME||new URL(meta.url).pathname.endsWith('.docx');
    if(!isDocx)continue;
    // Read one document at a time. No decompression or DOM allocation is needed
    // to explain the extractor's existing cumulative XML-size bound.
    const input=await cache.get(meta.url,{...meta.request,raw:true,officialRedirect:allowedDownload(meta.url)});
    if(input.ok) {
      const sizes=docxXmlSizes(input.body);
      if(sizes&&sizes.totalXmlBytes>4*1024*1024)results.push({url:meta.url,sha256:meta.sha256,fetchedAt:meta.fetchedAt,kind:'docx-xml-size-limit',limitBytes:4*1024*1024,...sizes});
    } else if(input.status===406) {
      const accept=advertisedRepresentation(input);
      const result={url:meta.url,sha256:meta.sha256,fetchedAt:meta.fetchedAt,kind:'source-representation-mismatch',requestedAccept:meta.request?.accept,advertisedAccept:accept};
      if(accept&&negotiationCache) {
        const observed=await negotiationCache.get(meta.url,{accept,language:meta.request?.language,raw:true});
        result.observation={status:observed.status,contentType:observed.headers?.['content-type']??null,bytes:observed.bytes,sha256:observed.sha256,fetchedAt:observed.fetchedAt,request:observed.request};
      }
      results.push(result);
    }
  }
  return results;
}
