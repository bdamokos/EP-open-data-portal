import {createHash} from 'node:crypto';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCHEMA=1;
export const API='https://data.europarl.europa.eu/api/v2';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const sourceUrl=(endpoint,params={})=>{const url=new URL(API+endpoint);for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));return url.href;};
export const snapshotId=snapshot=>hash(JSON.stringify({...snapshot,snapshotId:undefined}));
export const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export const monday=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);};

export async function outsideRepository(directory) {
  await mkdir(directory,{recursive:true});
  const resolved=await realpath(directory),root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  if(resolved===root||resolved.startsWith(root+path.sep))throw Error('Benchmark inputs and reports must stay outside the repository.');
  return resolved;
}

export function allowedSource(value) {
  const url=new URL(value),keys=[...url.searchParams.keys()];
  return url.origin==='https://data.europarl.europa.eu'&&!url.username&&!url.password&&!url.hash&&
    (/^\/api\/v2\/meetings$/.test(url.pathname)?/^20\d{2}$/.test(url.searchParams.get('year')||'')&&keys.includes('year'):
      /^\/api\/v2\/meetings\/MTG-PL-\d{4}-\d{2}-\d{2}\/foreseen-activities$/.test(url.pathname)&&!keys.includes('year'))&&
    keys.every(key=>['year','limit','offset','format'].includes(key)&&url.searchParams.getAll(key).length===1)&&
    url.searchParams.get('limit')==='50'&&/^\d+$/.test(url.searchParams.get('offset')||'')&&url.searchParams.get('format')==='application/ld+json';
}

export async function loadSnapshot(directory) {
  const snapshot=JSON.parse(await readFile(path.join(directory,'snapshot.json'),'utf8'));
  if(snapshot.schemaVersion!==SCHEMA||snapshot.snapshotId!==snapshotId(snapshot)||!validDate(snapshot.sample?.asOf?.slice(0,10))||!Array.isArray(snapshot.sources)||!snapshot.sources.length)throw Error('Invalid or changed snapshot manifest.');
  const inputs=new Map();
  for(const source of snapshot.sources) {
    if(!allowedSource(source.url)||inputs.has(source.url)||!Number.isFinite(Date.parse(source.retrievedAt))||![200,204,404].includes(source.status)||![source.headersMs,source.bodyMs].every(value=>Number.isFinite(value)&&value>=0))throw Error('Invalid source manifest entry.');
    const body=await readFile(path.join(directory,hash(source.url)+'.body'));
    if(body.length!==source.bytes||hash(body)!==source.sha256)throw Error('Input hash mismatch: '+source.url);
    if(source.status===200&&!Array.isArray(JSON.parse(body).data))throw Error('Invalid JSON-LD input.');
    inputs.set(source.url,{...source,body});
  }
  return {snapshot,inputs};
}

export async function loadIndexStatus(filename) {
  const bytes=await readFile(filename),record=JSON.parse(bytes),url=new URL(record.url);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.pathname!=='/api/activity-index/status'||!Number.isFinite(Date.parse(record.retrievedAt))||typeof record.body!=='string'||hash(record.body)!==record.sha256)throw Error('Invalid or changed public index-status observation.');
  const payload=JSON.parse(record.body);
  if(!Number.isSafeInteger(payload.currentMeps)||payload.currentMeps<=0||!Number.isSafeInteger(payload.servingGeneration)||payload.servingGeneration<=0)throw Error('Observed app index is not ready.');
  return {...record,payload,observationHash:hash(bytes)};
}

// Retrieval timestamps differ when the same bytes pass through ODP again.
// All identities, text, order, language, errors, gaps and freshness flags remain.
export function semanticResponse(value) {
  if(Array.isArray(value))return value.map(semanticResponse);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>!['fetchedAt','computedAt'].includes(key)).map(key=>[key,semanticResponse(value[key])]));
  return value;
}
export const responseHash=value=>hash(JSON.stringify(semanticResponse(value)));
export function distribution(values) {
  const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  return {min:sorted[0],p50:at(.5),p95:at(.95),max:sorted.at(-1)};
}
export function summarize(runs) {
  return Object.fromEntries([...new Set(runs.map(run=>run.scenario))].map(scenario=>{
    const rows=runs.filter(run=>run.scenario===scenario);
    return [scenario,{samples:rows.length,elapsedMs:distribution(rows.map(row=>row.elapsedMs)),cpuMs:distribution(rows.map(row=>row.cpuMs)),transportRequests:distribution(rows.map(row=>row.transportRequests)),responseBytes:distribution(rows.map(row=>row.responseBytes))}];
  }));
}
export function compareBaseline(report,baseline,{regressionPercent=10,regressionMs=20}={}) {
  const refuse=reason=>({failed:true,refused:true,reason});
  if(report.failed||baseline.failed)return refuse('A failed run cannot establish a performance baseline.');
  if(baseline.schemaVersion!==SCHEMA||report.snapshotId!==baseline.snapshotId)return refuse('Snapshot or report schema differs.');
  if(JSON.stringify(report.protocol)!==JSON.stringify(baseline.protocol))return refuse('Benchmark protocol differs.');
  if(JSON.stringify(report.environment)!==JSON.stringify(baseline.environment))return refuse('Runtime or hardware differs.');
  if(report.harnessHash!==baseline.harnessHash)return refuse('Benchmark instrumentation changed; establish a new baseline.');
  if(report.indexObservation?.observationHash!==baseline.indexObservation?.observationHash)return refuse('Observed app readiness differs.');
  const regressions=[],deltas={};
  if(report.semanticHash!==baseline.semanticHash)regressions.push('Agenda response changed: inspect identities, wording and coverage before accepting a new baseline.');
  for(const [scenario,metrics] of Object.entries(baseline.summary)) {
    const current=report.summary[scenario];
    if(!current){regressions.push('Missing scenario: '+scenario);continue;}
    const before=metrics.elapsedMs.p50,after=current.elapsedMs.p50,delta=after-before;
    deltas[scenario]={beforeMs:before,afterMs:after,deltaMs:delta,percent:before?delta/before*100:null};
    if(delta>regressionMs&&delta>before*regressionPercent/100)regressions.push('Slower median: '+scenario);
    if(current.transportRequests.max>metrics.transportRequests.max)regressions.push('More source requests: '+scenario);
  }
  for(const before of baseline.sessionCases||[]) {
    const after=report.sessionCases?.find(row=>row.case===before.case);
    if(!after){regressions.push('Missing session case: '+before.case);continue;}
    if(after.failed||!after.retainedDataSame)regressions.push('Session content lost: '+before.case);
    if(before.returnedWhileHeld&&!after.returnedWhileHeld)regressions.push('Cached response now blocks: '+before.case);
    if(after.recheckRequests>before.recheckRequests)regressions.push('More session recheck requests: '+before.case);
    if(before.topicsHash!==after.topicsHash||before.refreshedTopicsHash!==after.refreshedTopicsHash)regressions.push('Session agenda content differs: '+before.case);
    if(before.initialSemanticHash!==after.initialSemanticHash)regressions.push('Session response metadata differs: '+before.case);
    if(!before.nextResponse||!after.nextResponse||responseHash(before.nextResponse)!==responseHash(after.nextResponse))regressions.push('Refreshed session response differs: '+before.case);
  }
  return {failed:regressions.length>0,refused:false,regressionPercent,regressionMs,regressions,deltas};
}
