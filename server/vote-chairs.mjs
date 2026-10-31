import https from 'node:https';
import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {boundedUpstream,upstreamResponseError} from './odp.mjs';
import {interventionMetadata} from './speech-interventions.mjs';
import {requestSignal,runWithRequestSignal} from './request-budget.mjs';
import {sourceEvidence} from './vote-source-reader.mjs';
import {userAgent} from './user-agent.mjs';

const MAX_BYTES=2*1024*1024;
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const normalized=value=>value.normalize('NFC').replace(/\s+/gu,' ').trim().toLocaleUpperCase('und');
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const text=nodes=>(nodes||[]).map(node=>Object.entries(node).filter(([key])=>key!==':@').map(([key,value])=>key==='#text'?String(value):Array.isArray(value)?text(value):'').join('')).join('');
const walk=function*(nodes){for(const node of nodes||[])for(const [key,value] of Object.entries(node))if(key!==':@'&&key!=='#text'){yield {tag:key,children:value,attributes:node[':@']||{}};if(Array.isArray(value))yield* walk(value);}};

function distribution(payload,date){
  const id='PV-10-'+date,rows=payload?.data;
  if(!Array.isArray(rows)||rows.length!==1||relative(rows[0].id)!=='eli/dl/doc/'+id||rows[0].document_date!==date)return null;
  const files=(rows[0].is_realized_by||[]).filter(e=>relative(e.id)==='eli/dl/doc/'+id+'/en').flatMap(e=>e.is_embodied_by||[]).filter(m=>relative(m.id)==='eli/dl/doc/'+id+'/en/xml').map(m=>m.is_exemplified_by);
  if(files.length!==1||typeof files[0]!=='string')return null;
  try{
    const url=new URL(files[0],'https://data.europarl.europa.eu/');
    if(url.protocol!=='https:'||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.search||url.hash||!/^\/distribution\/.+\.xml$/.test(url.pathname))return null;
    return url.href;
  }catch{return null;}
}

export async function downloadMinutesXml(url){
  const signal=requestSignal();
  return boundedUpstream(async admitted=>{
    const response=await new Promise((resolve,reject)=>https.get(url,{headers:{Accept:'application/xml','User-Agent':userAgent('voting chairs')},signal:AbortSignal.any([AbortSignal.timeout(15_000),...(admitted?[admitted]:[])])},resolve).on('error',reject));
    const failure=upstreamResponseError(response,{source:'documents'});
    if(failure){response.resume();throw failure;}
    if(response.statusCode!==200||!/(?:xml|octet-stream)/i.test(response.headers['content-type']||'')){response.resume();throw new Error('Minutes XML unavailable.');}
    const chunks=[];let bytes=0;
    for await(const chunk of response){bytes+=chunk.length;if(bytes>MAX_BYTES){response.destroy();throw new Error('Minutes XML exceeds the supported size.');}chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  },{source:'documents',priority:'interactive',signal});
}

// Minutes' explicit AnnexVote numbers bind to the result's exact PV VOT-ITM
// document reference. Neither clock offsets nor matching subject titles join them.
export function extractVoteChairs(xml,chairPayload,date){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES)return null;
  // The official export declares this external DTD. Strip that one declaration;
  // never retrieve it or accept an internal subset or other entity declarations.
  xml=xml.replace('<!DOCTYPE PV SYSTEM "http://www.pv.ep.parl.union.eu/pv1/dtd/PV.dtd">','');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return null;
  const rows=chairPayload?.data,total=chairPayload?.meta?.total,hits=chairPayload?.searchResults?.hits;
  if(!Array.isArray(rows)||!Number.isSafeInteger(total)||total!==rows.length||total>100||!Array.isArray(hits)||hits.length!==total||new Set(rows.map(r=>r.activity_id)).size!==total)return null;
  const identities=new Map();
  for(const row of rows){
    if(row.activity_date!==date||!new RegExp('^MTG-PL-'+date+'-PVCRE-CHA-\\d+$').test(row.activity_id)||relative(row.id)!=='eli/dl/event/'+row.activity_id||!hits.some(hit=>relative(hit.id)===relative(row.id))||relative(row.had_activity_type)!=='def/ep-activities/MEETING_NAME_CHAIR')return null;
    const chair=interventionMetadata(row).chair;
    if(!chair)return null;
    const key=normalized(chair.name),old=identities.get(key);
    if(old&&old!==chair.id)return null;
    identities.set(key,chair.id);
  }
  const document=parser.parse(xml),roots=document.filter(n=>Object.hasOwn(n,'PV'));
  if(roots.length!==1||roots[0][':@']?.['@_Sitting.Date']!==date||roots[0][':@']?.['@_Document.Language']!=='EN')return null;
  const result=new Map();let current=null;
  function change(node){
    const name=normalized(text(node.children).replace(/^\s*IN THE CHAIR:\s*/,'').replace(/\s*(?:Vice-President|President)\s*$/,''));
    current=identities.get(name)||null;
  }
  for(const node of walk(roots[0].PV)){
    if(node.tag==='Orator.ChangeOfPresident.Text')change(node);
    if(node.tag!=='PV.Vote.Text')continue;
    const descendants=[...walk(node.children)];
    // A handover within a voting block cannot establish who chaired each
    // ballot. Preserve every decision there until finer evidence is available.
    if(!current||descendants.some(n=>n.tag==='Orator.ChangeOfPresident.Text'))continue;
    for(const ref of descendants.filter(n=>n.tag==='Pv.Reference.Text')){
      const number=ref.attributes['@_Pv.AnnexVote'];
      if(!/^[1-9]\d{0,3}$/.test(String(number||'')))continue;
      const id='PV-10-'+date+'-VOT-ITM-'+String(number).padStart(3,'0');
      result.set(id,result.has(id)&&result.get(id)!==current?null:current);
    }
  }
  return Object.fromEntries([...result].filter(([,id])=>id));
}

export async function collectVoteChairs(request,sittingId,{download=downloadMinutesXml,clock=Date.now,maxBytes=6*MAX_BYTES}={}){
  const date=sittingId.slice(7);let bytes=0;
  const unavailable=()=>({status:'unavailable',byResultDocument:{},sources:[],bytes});
  const parent=requestSignal(),signal=AbortSignal.any([AbortSignal.timeout(10_000),...(parent?[parent]:[])]);
  try{return await runWithRequestSignal(signal,async()=>{
    if(maxBytes<=0)return unavailable();
    const options={priority:'interactive',staleWhileRevalidate:true,ttl:15*60_000};
    const metadata=await request('/plenary-session-documents/PV-10-'+date,{},options);
    bytes+=Buffer.byteLength(JSON.stringify(metadata.payload));
    if(metadata.refreshError||bytes>Math.min(MAX_BYTES,maxBytes))return unavailable();
    const url=distribution(metadata.payload,date);if(!url)return unavailable();
    const chairs=await request('/speeches',{'sitting-date':date,'activity-type':'MEETING_NAME_CHAIR','include-output':'xml_fragment',language:'en','sort-by':'numbering:asc',limit:100,offset:0},options);
    const chairBytes=Buffer.byteLength(JSON.stringify(chairs.payload));bytes+=chairBytes;
    if(chairs.refreshError||chairBytes>MAX_BYTES||bytes>=maxBytes)return unavailable();
    const xml=await download(url);bytes+=Buffer.byteLength(xml);
    if(bytes>maxBytes)return unavailable();
    const byResultDocument=extractVoteChairs(xml,chairs.payload,date);
    if(!byResultDocument)return unavailable();
    const source={url,fetchedAt:new Date(clock()).toISOString(),contentHash:createHash('sha256').update(xml).digest('hex'),stale:false,refreshInProgress:false,refreshError:null};
    return {status:'observed',byResultDocument,sources:[sourceEvidence(metadata,metadata.payload),sourceEvidence(chairs,chairs.payload),source],bytes};
  });}catch(error){if(parent?.aborted)throw error;return unavailable();}
}
