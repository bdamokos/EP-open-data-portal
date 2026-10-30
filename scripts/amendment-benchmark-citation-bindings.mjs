import {createHash} from 'node:crypto';
import {rawCitationMarkerAssertion} from './amendment-benchmark-citation-calibration.mjs';

export const CITATION_CALIBRATION_MODE='proposed-native-citation-marker';
const hash=value=>createHash('sha256').update(value).digest('hex');
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const ref=value=>String(value?.id??value??'').replace(/^https:\/\/data\.europarl\.europa\.eu\//u,'');
const identity=(url,request)=>request?JSON.stringify([url,request]):url;
const unknown=reason=>({status:'unavailable',reason});
const publicWord=url=>{
  try{const u=new URL(url);return !u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.protocol==='https:'&&(
    u.hostname==='data.europarl.europa.eu'&&u.pathname.startsWith('/distribution/')||u.hostname==='redmapl3.europarl.europa.eu'&&u.pathname.startsWith('/RedmapFront/media/'))&&u.pathname.endsWith('.docx');}catch{return false;}
};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)&&!Buffer.isBuffer(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en'))):v);

// This reader accepts sealed observations only. The callback receives exact
// retained request tuples, never permission to acquire or replace a source.
export async function bindCitationNativeInputs({manifest,readObservation,offline,documentId,listId,number,language,wording,motionSource,amendmentSource}) {
  if(offline!==true||typeof readObservation!=='function'||!Array.isArray(manifest))return unknown('citation-proof-requires-offline-sealed-inputs');
  if(language!=='en'||wording?.language!==language||wording.baseline!=='motion-resolution'||wording.targetDocumentId!==documentId||wording.listId!==listId||wording.number!==number||!Number.isSafeInteger(number)||number<1||!/^(?:B|RC)-10-\d{4}-\d{4,6}$/u.test(documentId??'')||!new RegExp('^'+documentId+'-AM-\\d+-\\d+$','u').test(listId??''))return unknown('citation-proof-identity-unavailable');
  const records=new Map();
  for(const record of manifest){const key=identity(record.url,record.request);if(records.has(key))return unknown('citation-proof-duplicate-observation');records.set(key,record);}
  const read=async(url,request)=>{
    const expected=records.get(identity(url,request));if(!expected)return null;
    const input=await readObservation(url,request),{body,...meta}=input??{};
    if(!Buffer.isBuffer(body)||body.length!==expected.bytes||hash(body)!==expected.sha256||stable(meta)!==stable(expected))throw new Error('Citation native observation differs from sealed manifest: '+url);
    return input;
  };
  const metadataUrl='https://data.europarl.europa.eu/api/v2/plenary-documents/'+documentId+'?format=application%2Fld%2Bjson';
  const metadata=await read(metadataUrl,{accept:'application/ld+json'});
  if(!metadata?.ok||metadata.status!==200)return unknown('citation-proof-document-metadata-unavailable');
  let payload;try{payload=JSON.parse(metadata.body.toString('utf8'));}catch{return unknown('citation-proof-document-metadata-invalid');}
  const works=array(payload.data).filter(work=>ref(work.id)==='eli/dl/doc/'+documentId&&work.identifier===documentId);
  if(works.length!==1||ref(works[0].work_type)!=='def/ep-document-types/'+(documentId.startsWith('RC-')?'RESOLUTION_MOTION_JOINT':'RESOLUTION_MOTION'))return unknown('citation-proof-document-identity-unavailable');
  const declarations=[];
  for(const expression of array(works[0].is_realized_by)){
    if(ref(expression.id)!=='eli/dl/doc/'+documentId+'/en'||String(expression.language?.id??expression.language)!=='http://publications.europa.eu/resource/authority/language/ENG')continue;
    for(const manifestation of array(expression.is_embodied_by)){
      if(String(manifestation.format?.id??manifestation.format)!=='http://publications.europa.eu/resource/authority/file-type/DOCX')continue;
      for(const file of array(manifestation.is_exemplified_by)){
        const raw=typeof file==='string'?file:file?.id;if(!raw)continue;
        const url=new URL(raw,'https://data.europarl.europa.eu/').href;
        if(publicWord(url))declarations.push({expression:expression.id,language:expression.language,manifestation:manifestation.id,declaredFile:raw,url});
      }
    }
  }
  if(declarations.length!==1||!new URL(declarations[0].url).pathname.endsWith('/'+documentId+'/'+documentId+'_en.docx'))return unknown('citation-proof-document-distribution-ambiguous');
  const amendmentUrl=amendmentSource?.url;
  if(!publicWord(amendmentUrl)||new URL(amendmentUrl).origin!=='https://data.europarl.europa.eu'||!new URL(amendmentUrl).pathname.endsWith('/'+listId+'/'+listId+'_en.docx'))return unknown('citation-proof-amendment-distribution-unavailable');
  const chain=async(url,owner)=>{
    const observations=[],seen=new Set();let current=url;
    for(let hop=0;hop<=3;hop++){
      if(!publicWord(current)||!new URL(current).pathname.endsWith('/'+owner+'/'+owner+'_en.docx')||seen.has(current))return null;seen.add(current);
      const input=await read(current);if(!input)return null;
      const {body,...observation}=input;observations.push(observation);
      if([301,302,303,307,308].includes(input.status)){
        // Earlier retained amendment observations recorded redirectUrl without
        // retaining the Location header. Keep that captured edge and its gap;
        // never invent a header or disregard a contradictory retained header.
        if(!input.ok||!input.redirectUrl||input.headers?.location&&new URL(input.headers.location,current).href!==input.redirectUrl)return null;
        current=input.redirectUrl;continue;
      }
      if(input.status!==200||!input.ok||input.redirectUrl)return null;
      return {body,observations,final:observation};
    }
    return null;
  };
  const motion=await chain(declarations[0].url,documentId),amendment=await chain(amendmentUrl,listId);
  if(!motion||!amendment)return unknown('citation-proof-redirect-chain-unavailable');
  const matches=(selected,expectedUrl,source)=>selected?.url===expectedUrl&&selected.sha256===source.sha256&&selected.status===source.status&&selected.ok===true&&selected.fetchedAt===source.fetchedAt;
  if(!matches(motionSource,declarations[0].url,motion.final)||!matches(amendmentSource,amendmentUrl,amendment.final)||amendmentSource.resolvedSourceUrl!==amendment.final.url||!Buffer.isBuffer(amendmentSource.body)||hash(amendmentSource.body)!==amendment.final.sha256)return unknown('citation-proof-runtime-source-binding-mismatch');
  const {body:metadataBody,...metadataObservation}=metadata;
  const binding={schemaVersion:1,language,documentId,listId,number,manifestSha256:hash(stable(manifest)),metadata:metadataObservation,declaration:declarations[0],motion:motion.observations,amendment:amendment.observations};
  return {status:'bound',binding,nativeCitation:{motionBuffer:motion.body,amendmentBuffer:amendment.body,number}};
}

export async function pairedCitationVerification({canonical,mode,cache,row,variant,fetched,text,wording,placement,target}) {
  if(mode!==CITATION_CALIBRATION_MODE)throw new Error('Explicit citation calibration mode required.');
  const targetMatch=/^Citation ([1-9]\d*)$/u.exec(wording?.targetLabel??'');
  if(wording?.language!=='en'||wording.baseline!=='motion-resolution'||!targetMatch||!wording.originalText?.startsWith(targetMatch[1]+'.\t'))return null;
  const bound=await bindCitationNativeInputs({manifest:cache.manifest(),offline:cache.fetchMissing===false&&cache.cap===0&&Boolean(cache.sealed),readObservation:(url,request)=>cache.get(url,{...request,raw:true,officialRedirect:publicWord(url)}),documentId:row.targetDocumentId,listId:variant.listId,number:row.number,language:variant.language,wording,motionSource:text?.sourceInput,amendmentSource:{...fetched,resolvedSourceUrl:fetched?.resolvedSourceUrl??fetched?.url}});
  const native=bound.status==='bound'?rawCitationMarkerAssertion({wording,placement,text,target,nativeCitation:bound.nativeCitation}):{status:'unverified',reason:bound.reason};
  const proposed=canonical.status==='failed'&&canonical.reason==='oracle-original-span-mismatch'&&native.status==='verified'?native:canonical;
  return {mode,accepted:false,canonical,proposed,native,binding:bound.binding??null,bindingStatus:bound.status,bindingReason:bound.reason??null,rawComparison:{targetLabel:wording.targetLabel,originalText:wording.originalText,proposedText:wording.proposedText},changed:stable(canonical)!==stable(proposed)};
}
