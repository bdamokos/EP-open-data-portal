#!/usr/bin/env node
import {mkdir,readFile,writeFile,readdir,rm,appendFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {extractAmendments,AMENDMENT_EXTRACTION_VERSION} from '../server/amendment-documents.mjs';
import {amendmentTextLosses} from '../server/amendments.mjs';
import {commissionReferences} from '../server/commission-proposal-identity.mjs';
import {documentContextPlacement} from '../server/document-context-placement.mjs';
import {DOCUMENT_CONTEXT_VERSION} from '../server/document-context.mjs';
import {PROPOSAL_PARSER_VERSION} from '../server/proposal-structure.mjs';
import {DOCX_EXTRACTION_VERSION} from '../server/docx-source-structure.mjs';
import {InputCache,apiOrigin,digest,outsideRepository,allowedInput} from './amendment-benchmark-cache.mjs';
import {classify,parseBenchmarkTarget,verifyPlacement,targetPatterns,metrics,compareBaseline,SOURCE_REASONS} from './amendment-benchmark-model.mjs';

export function options(args) {
  const result={apiBase:process.env.AMENDMENT_BENCHMARK_API_BASE,weeks:8,documents:[],fetchMissing:false,cap:1500,delay:750,cache:process.env.AMENDMENT_BENCHMARK_CACHE_DIR||path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'ep-explorer/amendment-benchmark')};
  const values={'--api-base':'apiBase','--retry-after-cap-ms':'maxRetryAfter','--weeks':'weeks','--from':'from','--to':'to','--as-of':'asOf','--document':'documents','--report':'documents','--cache-dir':'cache','--output-dir':'output','--request-cap':'cap','--delay-ms':'delay','--baseline':'baseline'};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--fetch'){result.fetchMissing=true;continue;}
    if(arg==='--help'){result.help=true;continue;}
    const key=values[arg];if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown or missing option: '+arg);
    const value=args[++i];if(key==='documents')result.documents.push(value);else result[key]=value;
  }
  result.maxRetryAfter=Number(result.maxRetryAfter??60000);
  if(!Number.isSafeInteger(result.maxRetryAfter)||result.maxRetryAfter<0||result.maxRetryAfter>60000)throw new Error('Retry-After cap must be between 0 and 60000 ms.');
  if(result.apiBase)result.apiBase=apiOrigin(result.apiBase);
  for(const key of ['weeks','cap','delay']) {result[key]=Number(result[key]);if(!Number.isSafeInteger(result[key])||result[key]<(key==='weeks'?1:0))throw new Error('Invalid '+key);}
  if(result.fetchMissing&&result.delay<750)throw new Error('Public acquisition requires --delay-ms of at least 750.');
  for(const key of ['from','to','asOf'])if(result[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(result[key])||new Date(result[key]).toISOString().slice(0,10)!==result[key]))throw new Error('Invalid date: '+key);
  if(Boolean(result.from)!==Boolean(result.to)||result.from>result.to)throw new Error('--from and --to require an ordered inclusive date window.');
  result.documents=[...new Set(result.documents)].sort();
  if(result.documents.some(id=>!/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id)))throw new Error('Expected exact term-10 report/document IDs.');
  if(result.documents.length&&result.from)throw new Error('Choose document IDs or a date window.');
  return result;
}
export function monday(date) {
  const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()-(value.getUTCDay()+6)%7);return value.toISOString().slice(0,10);
}
export const placeableDecision=decision=>!/^Provisional agreement$/i.test((decision.reference||'').trim());
const validDecision = decision => /^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(decision.sittingId||'') && /^\d{4}-\d{2}-\d{2}$/.test(decision.date||'') && decision.sittingId==='MTG-PL-'+decision.date;
const allDecisions = row => (row.decisions||[]).filter(validDecision);
const variants = row => (row.variants?.length?row.variants:[row]).slice().sort((a,b)=>(a.language==='en'?0:1)-(b.language==='en'?0:1)||String(a.language).localeCompare(String(b.language),'en')||String(a.listId).localeCompare(String(b.listId),'en'));
const passed = fields => ({status:'passed',...fields});
const blocked = reason => ({status:'blocked',reason});
const percent = value => value===null?'unavailable':(value*100).toFixed(2)+'%';

// Catalogue pages stay immutable in the URL cache. Build a small disk spool so
// source text, DOCX buffers and extraction results live for only one report.
async function catalogue(cache,opts,spool) {
  const seen=new Set(),weeks=new Set(),documents=new Set();let total=null,generation=null;
  const scopes=opts.documents.length?opts.documents:[null];
  for(const document of scopes)for(let offset=0;;offset+=50) {
    const query=new URLSearchParams({limit:'50',offset:String(offset),lang:'en'});if(document)query.set('document',document);
    const {input,value}=await cache.json(cache.apiBase+'/api/amendments?'+query);
    if(!value)throw new Error('Cannot establish the sample catalogue: '+input.error+' '+input.url);
    if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.offset!==offset||value.limit!==50)throw new Error('Invalid index pagination');
    if(offset===0)total=value.total;
    if(total!==value.total)throw new Error('Index total changed during paging; use a new cache snapshot.');
    const current=value.coverage?.servingGeneration;
    if(generation!==null&&generation!==current)throw new Error('Index generation changed during paging; use a new cache snapshot.');generation=current;
    for(const row of value.items) {
      if(seen.has(row.id)||!/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(row.targetDocumentId)||document&&row.targetDocumentId!==document)throw new Error('Duplicate or inconsistent index identity');
      seen.add(row.id);documents.add(row.targetDocumentId);
      for(const decision of allDecisions(row))if(decision.date<=opts.asOf)weeks.add(monday(decision.date));
      await appendFile(path.join(spool,row.targetDocumentId+'.jsonl'),JSON.stringify(row)+'\n');
    }
    if(offset+value.items.length>=total)break;
    if(value.items.length!==50)throw new Error('Incomplete index page');
    if(offset%500===0)process.stderr.write(`Catalogue ${offset+value.items.length}/${total}; ${cache.requests} requests\n`);
  }
  return {generation,indexed:seen.size,documents:[...documents].sort(),weeks:[...weeks].sort().reverse().slice(0,opts.weeks).sort()};
}
async function readRows(filename) {
  const result=[];for await(const line of createInterface({input:createReadStream(filename),crlfDelay:Infinity}))if(line)result.push(JSON.parse(line));return result;
}
function decisionsInSample(row,sample) {
  return allDecisions(row).filter(d=>d.date<=sample.asOf&&(sample.mode==='documents'||sample.mode==='date-window'&&d.date>=sample.from&&d.date<=sample.to||sample.mode==='plenary-weeks'&&sample.weeks.includes(monday(d.date))));
}
export const contextUrl=(apiBase,document,language,variant,row)=>{
  const query=new URLSearchParams({lang:language});
  if(variant&&row&&variant.listId) {query.set('amendment',row.id);query.set('list',variant.listId);query.set('wording-lang',variant.language||'unknown');}
  return apiBase+'/api/document-context/'+document+'?'+query;
};

// Acquisition is a function of the frozen catalogue only. Never consult an
// extraction, parser result or checkout baseline classification to choose URLs.
export async function acquireReport(rows,sample,cache) {
  if(!rows.some(row=>decisionsInSample(row,sample).length))return new Map();
  const contexts=new Map(),all=rows.flatMap(row=>variants(row).map(variant=>({row,variant})));
  for(const url of [...new Set(all.map(({variant})=>variant.wordingSource?.url).filter(Boolean))].sort()) {
    if(!allowedInput(url,cache.apiBase))throw new Error('Unsupported indexed DOCX URL: '+url);
    await cache.get(url);
  }
  for(const language of [...new Set(all.map(({variant})=>variant.language||'en'))].sort()) {
    const alternatives=all.filter(({variant})=>(variant.language||'en')===language&&variant.listId);
    const candidates=alternatives.filter(({variant})=>variant.baseline==='commission-proposal');
    const representative=candidates.find(({variant})=>typeof variant.originalText==='string'&&typeof variant.proposedText==='string')||candidates[0]||alternatives[0];
    const plain=await cache.json(contextUrl(cache.apiBase,rows[0].targetDocumentId,language));
    const proposal=representative?await cache.json(contextUrl(cache.apiBase,rows[0].targetDocumentId,language,representative.variant,representative.row)):plain;
    for(const saved of [plain,proposal])if(saved.value?.documentId!==rows[0].targetDocumentId)throw new Error('Context identity unavailable or inconsistent: '+saved.input.url);
    contexts.set(language,{plain,proposal});
  }
  return contexts;
}

export async function evaluateReport(rows,sample,cache) {
  const selected=rows.filter(row=>decisionsInSample(row,sample).length),extractions=new Map(),results=[];
  const contexts=await acquireReport(rows,sample,cache);
  for(const row of selected) {
    const variant=variants(row)[0],language=variant?.language||null,decisions=decisionsInSample(row,sample);
    const stages={S1:passed({decisionIds:decisions.map(d=>d.id)}),S2:blocked('wording-not-evaluated'),S3:blocked('target-not-evaluated'),S4:blocked('baseline-not-evaluated'),S5:{status:'unresolved',reason:'placement-not-evaluated'},S6:{status:'not-applicable',reason:'not-placed'}};
    if(!decisions.length||decisions.some(d=>!d.id||!d.source?.url||!d.source?.fetchedAt||!(d.amendmentIds||[]).some(id=>id===row.id||(row.officialIds||[]).includes('eli/dl/doc/'+id))))stages.S1=blocked('decision-linkage-unverified');
    const url=variant?.wordingSource?.url;let wording=null,gaps=[],fetched=null;
    if(!url||!variant.listId)stages.S2=blocked('wording-source-not-indexed');
    else if(!allowedInput(url,cache.apiBase))stages.S2=blocked('input-unsupported-public-url');
    else {
      const key=JSON.stringify([url,variant.listId,language]);
      if(!extractions.has(key)) {
        const input=await cache.get(url);let extraction=null,error=null;
        if(input.ok)try {extraction=extractAmendments(input.body,{listId:variant.listId,targetDocumentId:row.targetDocumentId,language,sourceUrl:url,fetchedAt:input.fetchedAt});}catch(cause){error=cause.message;}
        extractions.set(key,{input,extraction,error});
      }
      const {input,extraction,error}=extractions.get(key);fetched=input;
      if(!input.ok)stages.S2=blocked([404,410].includes(input.status)?'source-document-unavailable':'input-'+(input.error||'unavailable'));
      else if(error)stages.S2=blocked('docx-parser-error');
      else {
        wording=extraction.amendments.find(a=>a.number===row.number);
        gaps=wording?amendmentTextLosses(extraction,wording):extraction.gaps;
        if(!wording)stages.S2=blocked('docx-amendment-not-extracted');
        else if(gaps.length||typeof wording.originalText!=='string'||typeof wording.proposedText!=='string')stages.S2=blocked('wording-'+(gaps[0]?.code||'unavailable'));
        else if(!wording.originalText.trim()&&!wording.proposedText.trim())stages.S2=blocked('source-wording-empty');
        else stages.S2=passed({parserVersion:AMENDMENT_EXTRACTION_VERSION,originalSha256:digest(wording.originalText),proposedSha256:digest(wording.proposedText)});
      }
    }
    let target=null;
    if(wording) {
      target=parseBenchmarkTarget(wording);
      stages.S3=target.complete&&target.segments.length?passed({target}):{...blocked('target-label-unparsed'),target};
      // Select only from the fixed, pre-acquired pair; never request new inputs
      // because this checkout changed an extraction or baseline classification.
      const commission=wording.baseline==='commission-proposal';
      const {input,value}=contexts.get(language||'en')[commission?'proposal':'plain'];
      const items=value?.proposal?.items,text=value?.document?.selectedText;
      const hints=(wording.documentReferences||[]).filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)).flatMap(r=>commissionReferences(r.raw));
      const referenceConflict=commission&&value?.baseline?.celex&&hints.some(h=>h.celex!==value.baseline.celex||h.qualifier&&h.qualifier!=='final');
      const matching=!referenceConflict&&language&&(commission?value?.baseline?.language===language&&items?.length:text?.textLanguage===language&&text?.paragraphs?.length);
      stages.S4={...(matching?passed({kind:commission?'commission-proposal':'resolution',language,baselineStatus:value?.baseline?.status||text?.status}):blocked(referenceConflict?'proposal-reference-conflict':!input.ok?'input-'+(input.error||'unavailable'):!language||text?.textLanguage&&text.textLanguage!==language&&!commission?'acquisition-matching-language-unavailable':commission?'acquisition-proposal-projection-unavailable':'acquisition-document-projection-unavailable')),gaps:value?.baseline?.gaps||[],sourceUrl:input.url};
      if(stages.S2.status==='passed'&&matching) {
        const references=[...new Set((row.decisions||[]).filter(d=>(d.amendmentIds||[]).includes(row.id)&&d.source?.url&&d.source?.fetchedAt).map(d=>d.reference).filter(value=>typeof value==='string'))];
        const opts={...wording,targetLabelLanguage:language,resolutionDocument:true,referenceText:references[0]};
        stages.S5=documentContextPlacement({chosen:opts,text,items:commission?items:null,referenceTexts:references,resolutionDocument:true});
        stages.S6=verifyPlacement({placement:stages.S5,wording,items:commission?items:null,text,target});
        // Keep coordinates and assertions, not a growing corpus of source text.
        // The exact text is recoverable from the hashed input for this report.
        delete stages.S5.originalText;
      }
    }
    stages.S2.gaps=gaps;
    const provisional=decisions.length>0&&decisions.every(d=>!placeableDecision(d));
    const classified=provisional?{outcome:'not-placeable',reason:'provisional-agreement'}:classify(stages);
    const baseline=wording?.baseline||variant?.baseline;
    results.push({key:row.id,id:row.id,documentId:row.targetDocumentId,documentType:row.targetDocumentId.startsWith('A-')?(baseline==='commission-proposal'?'legislative-report':baseline==='motion-resolution'?'A-resolution':'A-unresolved'):'B/RC-resolution',number:row.number,listId:variant?.listId||null,language,targetLabel:wording?.targetLabel||variant?.targetLabel||null,acquisition:{contextVersions:[...new Set([...contexts.values()].flatMap(pair=>[pair.plain.value?.version,pair.proposal.value?.version]))],projectionVersions:[...contexts].map(([language,pair])=>({language,documentExtraction:pair.plain.value?.document?.selectedText?.extractionVersion??null,proposalParsers:[...new Set((pair.proposal.value?.proposal?.items||[]).map(item=>item.proposal.parserVersion))]})),status:stages.S4.reason?.startsWith('acquisition-')?'unavailable':'available'},wordingSource:fetched?{url:fetched.url,resolvedSourceUrl:fetched.resolvedSourceUrl||fetched.url,fetchedAt:fetched.fetchedAt,sha256:fetched.sha256,status:fetched.status}:null,variantAlternatives:variants(row).map(v=>({listId:v.listId,language:v.language,url:v.wordingSource?.url||null})),notPlaceableVoteIds:[...new Set(decisions.filter(d=>!placeableDecision(d)).map(d=>d.id))].sort(),voteIds:[...new Set(decisions.filter(placeableDecision).map(d=>d.id))].sort(),patterns:targetPatterns(wording||variant,gaps),stages,...classified});
  }
  return results;
}

export function markdown(result) {
  const {metrics:m,sample}=result;
  const comparison=result.comparison?{...result.comparison,taxonomyDeltas:result.comparison.taxonomyDeltas.filter(row=>row.count!==0||row.share!==0)}:null;
  return `# Amendment benchmark\n\nSample: ${JSON.stringify(sample)}\n\nCheckout: ${result.code.head}; extraction ${result.code.extractionVersion}.\n\nHeadline: **${percent(m.headline)}** (${m.counts.correct}/${m.eligible}); raw: ${percent(m.raw)} (${m.counts.correct}/${m.total}). False placements: **${m.falsePlacements}**.\n\nAmendment votes: ${percent(m.votes.share)} (${m.votes.correct}/${m.votes.total}); collective/split decisions count once and require every sampled linked amendment to be correct.\n\nUnfetched/failed URL inputs: ${result.acquisition.failures.length}; amendments without an indexed wording source: ${result.acquisition.amendmentsWithoutWordingSource}; requests this run: ${result.acquisition.requests}. Coverage is limited to the frozen public index, not a census of all EP amendments.\n\nLive context versions: ${result.compatibility.liveContextVersions.join(', ')}; checkout: ${result.compatibility.checkoutDocumentContextVersion}. Baseline gate compatible: ${result.compatibility.compatible}. Live proposal and document projections are acquisition inputs, not checkout extraction.\n\nNot-placeable provisional agreements: ${m.counts['not-placeable']} (excluded from the headline and vote denominator, retained in raw). Acquisition-unavailable: ${m.counts['acquisition-unavailable']} (retained in the headline denominator).\n\nUnique amendments by reason (one row each):\n\n| Reason | Count | Share | Examples |\n| --- | ---: | ---: | --- |\n${m.uniqueReasons.slice(0,20).map(r=>`| ${r.reason} | ${r.count} | ${percent(r.share)} | ${r.examples.join(', ')} |`).join('\n')}\n\nPatterns overlap; shares use all sampled amendments.\n\n| Document type | Language | Reason | Pattern | Count | Share | Examples |\n| --- | --- | --- | --- | ---: | ---: | --- |\n${m.taxonomy.slice(0,20).map(r=>`| ${r.documentType} | ${r.language||'unknown'} | ${r.reason} | ${r.pattern} | ${r.count} | ${percent(r.share)} | ${r.examples.join(', ')} |`).join('\n')}\n${result.comparison?'\nBaseline comparison:\n```json\n'+JSON.stringify(comparison,null,2)+'\n```\n':''}`;
}

async function checkoutIdentity(root) {
  return {head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0,workingDiffHash:digest(execFileSync('git',['diff','HEAD'],{cwd:root})),extractionVersion:AMENDMENT_EXTRACTION_VERSION,documentContextVersion:DOCUMENT_CONTEXT_VERSION,proposalParserVersion:PROPOSAL_PARSER_VERSION,documentExtractionVersion:DOCX_EXTRACTION_VERSION,files:Object.fromEntries(await Promise.all(['server/amendment-documents.mjs','server/proposal-placement.mjs','server/proposal-structure.mjs','server/document-context-model.mjs','server/document-context.mjs','server/document-context-placement.mjs','server/document-text.mjs','scripts/amendment-benchmark.mjs','scripts/amendment-benchmark-model.mjs','scripts/amendment-benchmark-cache.mjs'].map(async file=>[file,digest(await readFile(path.join(root,file)))])))};
}

export async function main(args=process.argv.slice(2)) {
  const opts=options(args);
  if(opts.help) {process.stdout.write('Usage: npm run bench:amendments -- --api-base HTTPS_ORIGIN [--fetch] [--weeks 8 | --from YYYY-MM-DD --to YYYY-MM-DD | --document A-10-YYYY-NNNN (repeatable)] [--as-of YYYY-MM-DD] [--cache-dir PATH] [--output-dir PATH] [--request-cap 1500] [--delay-ms 750] [--baseline PATH.json]\nOffline by default. --fetch fills missing URLs only; use a new cache directory for a new snapshot.\n');return;}
  if(!opts.apiBase)throw new Error('Provide --api-base or AMENDMENT_BENCHMARK_API_BASE; no deployment host is built in.');
  const root=fileURLToPath(new URL('../',import.meta.url)),code=await checkoutIdentity(root);
  const directory=await outsideRepository(path.resolve(opts.cache)),output=await outsideRepository(path.resolve(opts.output||path.join(directory,'output')));
  const lock=path.join(directory,'.benchmark-lock');
  try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('Another benchmark owns this cache. If interrupted, verify it has stopped before removing '+lock);throw error;}
  let spool;
  try {
  const inputs=path.join(directory,'inputs');await mkdir(inputs,{recursive:true});
  const cache=new InputCache(inputs,opts);
  const snapshotPath=path.join(directory,'snapshot.json');let snapshot;
  try{snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!snapshot){snapshot={schemaVersion:2,apiBase:opts.apiBase,asOf:opts.asOf||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels'}).format(new Date())};await writeFile(snapshotPath,JSON.stringify(snapshot)+'\n');}
  if(snapshot.schemaVersion!==2||snapshot.apiBase!==opts.apiBase)throw new Error('Snapshot API origin/schema mismatch; use a new cache directory.');
  opts.asOf=opts.asOf||snapshot.asOf;
  spool=await mkdtemp(path.join(output,'spool-'));
  const index=await catalogue(cache,opts,spool);
  const sample={term:10,asOf:opts.asOf,mode:opts.documents.length?'documents':opts.from?'date-window':'plenary-weeks',...(opts.documents.length?{documents:opts.documents}:opts.from?{from:opts.from,to:opts.to}:{requestedWeeks:opts.weeks,weeks:index.weeks}),decisionBasis:'indexed-plenary-decision-date',variantPolicy:'one exact variant per amendment: English, then language code, then list ID',indexGeneration:index.generation,indexedAmendments:index.indexed};
  const filenames=(await readdir(spool)).sort();
  // Complete and seal acquisition before invoking any checkout extraction or
  // placement. The evaluation phase cannot fill even a previously unseen URL.
  for(const filename of filenames) {
    const rows=await readRows(path.join(spool,filename));
    await acquireReport(rows,sample,cache);
    process.stderr.write(`Acquired ${filename.replace('.jsonl','')}; ${cache.requests} requests\n`);
  }
  const manifest=cache.manifest(),snapshotId=digest(JSON.stringify({apiBase:opts.apiBase,sample,manifest}));
  if(snapshot.snapshotId&&snapshot.snapshotId!==snapshotId)throw new Error('Frozen snapshot manifest changed; acquisition must be independent of checkout output.');
  if(!snapshot.snapshotId){snapshot={...snapshot,sample,manifest,snapshotId};await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n');}
  cache.fetchMissing=false;
  const resultRows=[];
  for(const filename of filenames) {
    const rows=await readRows(path.join(spool,filename));
    resultRows.push(...await evaluateReport(rows,sample,cache));
    process.stderr.write(`Evaluated ${filename.replace('.jsonl','')}: ${resultRows.length} sample rows\n`);
  }
  resultRows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  if(!resultRows.length)throw new Error('No indexed amendment decisions in the requested sample.');
  if(JSON.stringify(manifest)!==JSON.stringify(cache.manifest()))throw new Error('Evaluation read outside the fixed snapshot manifest.');
  if(JSON.stringify(code)!==JSON.stringify(await checkoutIdentity(root)))throw new Error('Checkout changed during the run; replay the cached inputs offline before reporting a score.');
  const liveContextVersions=[...new Set(resultRows.flatMap(row=>row.acquisition.contextVersions))].sort();
  const compatibility={liveContextVersions,checkoutDocumentContextVersion:DOCUMENT_CONTEXT_VERSION,compatible:liveContextVersions.every(version=>version===DOCUMENT_CONTEXT_VERSION)};
  const result={schemaVersion:2,snapshotId,sample,code,compatibility,inputs:manifest,sourceReasonPolicy:SOURCE_REASONS,acquisition:{amendmentsWithoutWordingSource:resultRows.filter(row=>row.stages.S2.reason==='wording-source-not-indexed').length,requests:cache.requests,requestCap:opts.cap,delayMs:opts.delay,failures:[...cache.missing].sort(([a],[b])=>a.localeCompare(b,'en')).map(([url,reason])=>({url,reason}))},metrics:metrics(resultRows),rows:resultRows};
  if(opts.baseline){result.comparison=compareBaseline(result,JSON.parse(await readFile(opts.baseline,'utf8')));for(const warning of result.comparison.warnings||[])process.stderr.write('WARNING: '+warning+'\n');if(result.comparison.refused)process.stderr.write('BASELINE REFUSED: '+result.comparison.reason+'\n');}
  const stamp=digest(JSON.stringify({sample,inputs:result.inputs,code:result.code})).slice(0,16),jsonPath=path.join(output,'benchmark-'+stamp+'.json'),mdPath=path.join(output,'benchmark-'+stamp+'.md');
  await writeFile(jsonPath,JSON.stringify(result,null,2)+'\n');await writeFile(mdPath,markdown(result));
  process.stdout.write(JSON.stringify({jsonPath,mdPath,snapshotId,compatibility,sample,metrics:result.metrics,acquisition:result.acquisition,...(result.comparison?{comparison:result.comparison}:{})},null,2)+'\n');
  if(result.metrics.falsePlacements||result.comparison?.failed)process.exitCode=1;
  } finally {if(spool)await rm(spool,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
