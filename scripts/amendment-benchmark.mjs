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
import {replayRuntime,sourceReplay,publicDocumentUrl} from './amendment-benchmark-replay.mjs';
import {monday,allDecisions,decisionsInSample,sampleExclusions} from './amendment-benchmark-sample.mjs';
export {monday} from './amendment-benchmark-sample.mjs';
import {sourceDiagnostics} from './amendment-benchmark-source-diagnostics.mjs';
import {checkoutProducers} from './amendment-benchmark-producers.mjs';
import {acquireLanguageVariants,languageVariantContext} from './amendment-benchmark-languages.mjs';
import {classify,parseBenchmarkTarget,verifyPlacement,targetPatterns,metrics,compareBaseline,projectionCompatibility,SOURCE_REASONS} from './amendment-benchmark-model.mjs';

export function options(args) {
  const result={apiBase:process.env.AMENDMENT_BENCHMARK_API_BASE,weeks:8,decisionWeeks:[],excludeSnapshots:[],documents:[],fetchMissing:false,cap:1500,delay:750,cache:process.env.AMENDMENT_BENCHMARK_CACHE_DIR||path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'ep-explorer/amendment-benchmark')};
  const values={'--source-negotiation-cache':'negotiationCache','--decision-week':'decisionWeeks','--exclude-snapshot':'excludeSnapshots','--runtime-root':'runtimeRoot','--api-base':'apiBase','--retry-after-cap-ms':'maxRetryAfter','--weeks':'weeks','--from':'from','--to':'to','--as-of':'asOf','--document':'documents','--report':'documents','--cache-dir':'cache','--output-dir':'output','--request-cap':'cap','--delay-ms':'delay','--baseline':'baseline'};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--diagnose-sources'){result.diagnoseSources=true;continue;}
    if(arg==='--placement-only'){result.placementOnly=true;continue;}
    if(arg==='--language-variants'){result.languageVariants=true;continue;}
    if(arg==='--acquire-only'){result.acquireOnly=true;continue;}
    if(arg==='--fetch'){result.fetchMissing=true;continue;}
    if(arg==='--help'){result.help=true;continue;}
    const key=values[arg];if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown or missing option: '+arg);
    const value=args[++i];if(Array.isArray(result[key]))result[key].push(value);else result[key]=value;
  }
  result.maxRetryAfter=Number(result.maxRetryAfter??60000);
  if(!Number.isSafeInteger(result.maxRetryAfter)||result.maxRetryAfter<0||result.maxRetryAfter>60000)throw new Error('Retry-After cap must be between 0 and 60000 ms.');
  if(result.negotiationCache&&!result.diagnoseSources)throw new Error('--source-negotiation-cache requires --diagnose-sources');
  if(result.apiBase)result.apiBase=apiOrigin(result.apiBase);
  for(const key of ['weeks','cap','delay']) {result[key]=Number(result[key]);if(!Number.isSafeInteger(result[key])||result[key]<(key==='weeks'?1:0))throw new Error('Invalid '+key);}
  if((result.fetchMissing||result.negotiationCache)&&result.delay<750)throw new Error('Public acquisition requires --delay-ms of at least 750.');
  for(const key of ['from','to','asOf'])if(result[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(result[key])||new Date(result[key]).toISOString().slice(0,10)!==result[key]))throw new Error('Invalid date: '+key);
  if(Boolean(result.from)!==Boolean(result.to)||result.from>result.to)throw new Error('--from and --to require an ordered inclusive date window.');
  result.documents=[...new Set(result.documents)].sort();
  if(result.documents.some(id=>!/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id)))throw new Error('Expected exact term-10 report/document IDs.');
  if(result.documents.length&&result.from)throw new Error('Choose document IDs or a date window.');
  result.decisionWeeks=[...new Set(result.decisionWeeks)].sort();
  for(const week of result.decisionWeeks)if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week))||new Date(week).toISOString().slice(0,10)!==week||monday(week)!==week)throw new Error('--decision-week requires a Monday YYYY-MM-DD.');
  if(result.decisionWeeks.length&&(result.from||result.documents.length||args.includes('--weeks')))throw new Error('Choose explicit decision weeks, latest weeks, document IDs or a date window.');
  return result;
}
export const placeableDecision=decision=>!/^Provisional agreement$/i.test((decision.reference||'').trim());
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
export const contextUrl=(apiBase,document,language,variant,row)=>{
  const query=new URLSearchParams({lang:language});
  if(variant&&row&&variant.listId) {query.set('amendment',row.id);query.set('list',variant.listId);query.set('wording-lang',variant.language||'unknown');}
  return apiBase+'/api/document-context/'+document+'?'+query;
};

// Acquisition is a function of the frozen catalogue only. Never consult an
// extraction, parser result or checkout baseline classification to choose URLs.
export async function acquireReport(rows,sample,cache,replay) {
  if(!rows.some(row=>decisionsInSample(row,sample).length))return new Map();
  const contexts=new Map(),references=new Map(),all=rows.flatMap(row=>variants(row).map(variant=>({row,variant})));
  for(const url of [...new Set(all.map(({variant})=>variant.wordingSource?.url).filter(Boolean))].sort()) {
    if(!allowedInput(url,cache.apiBase))throw new Error('Unsupported indexed DOCX URL: '+url);
    const input=await cache.get(url);
    if(replay&&input.ok)for(const language of [...new Set(all.filter(({variant})=>variant.wordingSource?.url===url).map(({variant})=>variant.language||'en'))])references.set(language,[...(references.get(language)||[]),...replay.references(input.body)]);
  }
  for(const language of [...new Set(all.map(({variant})=>variant.language||'en'))].sort()) {
    const alternatives=all.filter(({variant})=>(variant.language||'en')===language&&variant.listId);
    const candidates=alternatives.filter(({variant})=>variant.baseline==='commission-proposal');
    const representative=candidates.find(({variant})=>typeof variant.originalText==='string'&&typeof variant.proposedText==='string')||candidates[0]||alternatives[0];
    const plain=await cache.json(contextUrl(cache.apiBase,rows[0].targetDocumentId,language));
    const proposal=representative?await cache.json(contextUrl(cache.apiBase,rows[0].targetDocumentId,language,representative.variant,representative.row)):plain;
    for(const saved of [plain,proposal])if(saved.value&&saved.value.documentId!==rows[0].targetDocumentId)throw new Error('Context identity unavailable or inconsistent: '+saved.input.url);
    contexts.set(language,{plain,proposal});
  }
  if(cache.languageVariants)contexts.languageVariants=await acquireLanguageVariants(rows.filter(row=>decisionsInSample(row,sample).length),contexts,cache);
  if(replay){replay.observeFiles(rows[0].targetDocumentId,contexts);await replay.acquire(rows[0].targetDocumentId,[...new Set([...contexts.keys(),...[...(contexts.languageVariants?.values()||[])].map(saved=>saved.language)])],references);}
  return contexts;
}

export async function evaluateReport(rows,sample,cache,{runtime,replay}={}) {
  const selected=rows.filter(row=>decisionsInSample(row,sample).length),extractions=new Map(),results=[];
  const contexts=await acquireReport(rows,sample,cache);
  const extractionFor=async variant=>{
    const url=variant.wordingSource?.url,language=variant.language||null,key=JSON.stringify([url,variant.listId,language]);
    if(!extractions.has(key)) {
      const input=await cache.get(url);let extraction=null,error=null;
      if(input.ok)try{extraction=(runtime?.extractAmendments||extractAmendments)(input.body,{listId:variant.listId,targetDocumentId:rows[0].targetDocumentId,language,sourceUrl:url,fetchedAt:input.fetchedAt,...(variant.wordingSource?.reportId?{reportId:variant.wordingSource.reportId}:{})});}catch(cause){error=cause.message;}
      extractions.set(key,{input,extraction,error});
    }
    return extractions.get(key);
  };
  if(replay)replay.observeFiles(rows[0].targetDocumentId,contexts);
  const projected=new Map();
  const work=replay&&selected.length?(await replay.request('/plenary-documents/'+rows[0].targetDocumentId)).payload.data[0]:null;
  for(const row of selected) {
    const originalVariant=variants(row)[0];
    const available=contexts.get(originalVariant?.language||'en')?.plain.value?.document?.selectedText?.availableTextLanguages||[];
    let translated=available.includes(originalVariant?.language)?null:contexts.languageVariants?.get(originalVariant?.listId);
    // A legislative amendment uses its baseline language, independently of the
    // report body's publication languages. Acquisition remains extraction-free.
    if(translated&&originalVariant.wordingSource?.url&&allowedInput(originalVariant.wordingSource.url,cache.apiBase)) {
      const original=await extractionFor(originalVariant);
      const comparison=original.extraction?.amendments.find(amendment=>amendment.number===row.number)?.baseline;
      if(['commission-proposal','council-position'].includes(comparison))translated=null;
    }
    const variant=translated?{...originalVariant,language:translated.language,wordingSource:{...originalVariant.wordingSource,url:translated.wording.url}}:originalVariant;
    const language=variant?.language||null,decisions=decisionsInSample(row,sample);
    const stages={S1:passed({decisionIds:decisions.map(d=>d.id)}),S2:blocked('wording-not-evaluated'),S3:blocked('target-not-evaluated'),S4:blocked('baseline-not-evaluated'),S5:{status:'unresolved',reason:'placement-not-evaluated'},S6:{status:'not-applicable',reason:'not-placed'}};
    if(!decisions.length||decisions.some(d=>!d.id||!d.source?.url||!d.source?.fetchedAt||!(d.amendmentIds||[]).some(id=>id===row.id||(row.officialIds||[]).includes('eli/dl/doc/'+id))))stages.S1=blocked('decision-linkage-unverified');
    const url=variant?.wordingSource?.url;let wording=null,gaps=[],fetched=null;
    if(!url||!variant.listId)stages.S2=blocked('wording-source-not-indexed');
    else if(!allowedInput(url,cache.apiBase))stages.S2=blocked('input-unsupported-public-url');
    else {
      const {input,extraction,error}=await extractionFor(variant);fetched=input;
      if(!input.ok)stages.S2=blocked([404,410].includes(input.status)?'source-document-unavailable':'input-'+(input.error||'unavailable'));
      else if(error)stages.S2=blocked('docx-parser-error');
      else {
        wording=extraction.amendments.find(a=>a.number===row.number);
        gaps=wording?(runtime?.amendmentTextLosses||amendmentTextLosses)(extraction,wording):extraction.gaps;
        if(!wording)stages.S2=blocked('docx-amendment-not-extracted');
        else if(gaps.length||typeof wording.originalText!=='string'||typeof wording.proposedText!=='string')stages.S2=blocked('wording-'+(gaps[0]?.code||'unavailable'));
        else if(!wording.originalText.trim()&&!wording.proposedText.trim())stages.S2=blocked('source-wording-empty');
        else stages.S2=passed({parserVersion:runtime?.AMENDMENT_EXTRACTION_VERSION||AMENDMENT_EXTRACTION_VERSION,originalSha256:digest(wording.originalText),proposedSha256:digest(wording.proposedText)});
      }
    }
    let target=null;
    if(wording) {
      target=parseBenchmarkTarget(wording);
      stages.S3=target.complete&&target.segments.length?passed({target}):{...blocked('target-label-unparsed'),target};
      // Live projections are a recorded comparison. Evaluated inputs come only
      // from the sealed upstream bytes through the measured checkout.
      const commission=wording.baseline==='commission-proposal';
      const council=wording.baseline==='council-position',existing=wording.baseline==='present-text',structured=commission||council||existing;
      const pair=contexts.get(originalVariant?.language||'en');
      const {input,value}=translated&&!structured?languageVariantContext(translated,pair.plain,runtime):pair[commission?'proposal':'plain'];
      let items=value?.proposal?.items,text=value?.document?.selectedText,baseline=value?.baseline;
      if(replay) {
        const key=JSON.stringify([language,wording.baseline,structured?[wording.documentReferences,existing?wording.targetPath:null,existing?wording.documentDate:null]:[]]);
        if(!projected.has(key)) {
          if(commission) {
            const explicit=[...new Set((wording.documentReferences||[]).filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)).flatMap(r=>(runtime?.commissionReferences||commissionReferences)(r.raw).map(r=>r.celex)))];
            projected.set(key,await replay.proposal({...(row.targetDocumentId.startsWith('A-')?{reportId:row.targetDocumentId}:{celex:explicit.length===1?explicit[0]:undefined}),language,documentReferences:wording.documentReferences||[]}));
          } else if(council)projected.set(key,await replay.council({reportId:row.targetDocumentId,language,documentReferences:wording.documentReferences||[]}));
          else if(existing)projected.set(key,await replay.existingLaw({...wording,language}));
          else projected.set(key,{text:await replay.text(work,language)});
        }
        ({items,text,baseline}=projected.get(key));
      }
      const hints=(wording.documentReferences||[]).filter(r=>r.field==='DocRef'||/^DocAmend\d?$/.test(r.field)).flatMap(r=>(runtime?.commissionReferences||commissionReferences)(r.raw));
      const referenceConflict=commission&&baseline?.celex&&hints.some(h=>h.celex!==baseline.celex||h.qualifier&&h.qualifier!=='final');
      const matching=!referenceConflict&&language&&(structured?baseline?.language===language&&items?.length:text?.textLanguage===language&&text?.paragraphs?.length);
      let unavailableReason;
      if(referenceConflict)unavailableReason='proposal-reference-conflict';
      else if(!replay&&!input.ok)unavailableReason='input-'+(input.error||'unavailable');
      else if(!language||!structured&&text?.textLanguage&&text.textLanguage!==language)unavailableReason='acquisition-matching-language-unavailable';
      else if(!replay)unavailableReason=commission?'acquisition-proposal-projection-unavailable':'acquisition-document-projection-unavailable';
      else if(structured)unavailableReason=baseline?.gaps?.includes('proposal-projection-unavailable')?'proposal-projection-unavailable':existing?baseline?.gaps?.[0]||'existing-law-baseline-unavailable':council?'council_position_unavailable':'acquisition-proposal-source-unavailable';
      else unavailableReason=text?.sourceInput?.ok?'document-projection-unavailable':'acquisition-document-source-unavailable';
      stages.S4={
        ...(matching?passed({kind:existing?'existing-act':council?'council-position':commission?'commission-proposal':'resolution',language,baselineStatus:baseline?.status||text?.status}):blocked(unavailableReason)),
        gaps:baseline?.gaps||text?.sourceMetadataGaps||[],
        liveProjectionObservation:{documentContextVersion:value?.version,documentStatus:value?.document?.selectedText?.status??null,documentReason:value?.document?.selectedText?.reason??null,proposalStatus:value?.baseline?.status??null},
        sourceUrl:replay?(structured?baseline?.items?.[0]?.source?.url||publicDocumentUrl(row.targetDocumentId):text?.sourceUrl||publicDocumentUrl(row.targetDocumentId)):input.url,
        ...(replay?{projection:{mode:'cached-source-replay',celex:baseline?.celex??null,status:baseline?.status??text?.status,reason:text?.reason??null,fileDeclarationSource:text?.fileDeclarationSource??null,workId:baseline?.workId??null,itemSources:baseline?.items?.map(({itemId,source})=>({itemId,url:source.url,sha256:source.sha256,fetchedAt:source.fetchedAt}))||[]}}:{}),
      };
      if(stages.S2.status==='passed'&&matching) {
        const references=[...new Set((row.decisions||[]).filter(d=>(d.amendmentIds||[]).includes(row.id)&&d.source?.url&&d.source?.fetchedAt).map(d=>d.reference).filter(value=>typeof value==='string'))];
        const opts={...wording,targetLabelLanguage:language,resolutionDocument:true,referenceText:references[0]};
        stages.S5=(runtime?.documentContextPlacement||documentContextPlacement)({chosen:opts,text,baseline,items:structured?items:null,referenceTexts:references,resolutionDocument:true});
        stages.S6=verifyPlacement({placement:stages.S5,wording,items:structured?items:null,text,target});
        // Keep coordinates and assertions, not a growing corpus of source text.
        // The exact text is recoverable from the hashed input for this report.
        delete stages.S5.originalText;
      }
    }
    stages.S2.gaps=gaps;
    const provisional=decisions.length>0&&decisions.every(d=>!placeableDecision(d));
    const classified=provisional?{outcome:'not-placeable',reason:'provisional-agreement'}:classify(stages);
    const baseline=wording?.baseline||variant?.baseline;
    results.push({key:row.id,id:row.id,documentId:row.targetDocumentId,documentType:row.targetDocumentId.startsWith('A-')?(['commission-proposal','council-position','present-text'].includes(baseline)?'legislative-report':baseline==='motion-resolution'?'A-resolution':'A-unresolved'):'B/RC-resolution',number:row.number,listId:variant?.listId||null,language,targetLabel:wording?.targetLabel||variant?.targetLabel||null,acquisition:{contextVersions:[...new Set([...contexts.values()].flatMap(pair=>[pair.plain.value?.version,pair.proposal.value?.version]))],projectionVersions:[...contexts].map(([language,pair])=>({language,documentExtraction:pair.plain.value?.document?.selectedText?.extractionVersion??null,proposalParsers:[...new Set((pair.proposal.value?.proposal?.items||[]).map(item=>item.proposal.parserVersion))]})),status:stages.S4.reason?.startsWith('acquisition-')?'unavailable':'available'},wordingSource:fetched?{url:fetched.url,resolvedSourceUrl:fetched.resolvedSourceUrl||fetched.url,fetchedAt:fetched.fetchedAt,sha256:fetched.sha256,status:fetched.status}:null,variantAlternatives:[...variants(row).map(v=>({listId:v.listId,language:v.language,url:v.wordingSource?.url||null})),...(translated?[{listId:variant.listId,language,url:variant.wordingSource.url}]:[])],notPlaceableVoteIds:[...new Set(decisions.filter(d=>!placeableDecision(d)).map(d=>d.id))].sort(),voteIds:[...new Set(decisions.filter(placeableDecision).map(d=>d.id))].sort(),patterns:targetPatterns(wording||variant,gaps),stages,...classified});
  }
  return results;
}

export function markdown(result) {
  const {metrics:m,sample}=result;
  const comparison=result.comparison?{...result.comparison,taxonomyDeltas:result.comparison.taxonomyDeltas.filter(row=>row.count!==0||row.share!==0)}:null;
  return `# Amendment benchmark\n\nSample: ${JSON.stringify(sample)}\n\nScope: **${result.scope||'full-pipeline'}**.${result.scope==='placement-only-frozen-projections'?' Frozen API text/proposals; checkout placement outcomes only. Source extraction/projection changes are excluded.':''}\n\nCheckout: ${result.code.head}; extraction ${result.code.extractionVersion}.\n\nHeadline: **${percent(m.headline)}** (${m.counts.correct}/${m.eligible}); raw: ${percent(m.raw)} (${m.counts.correct}/${m.total}). False placements: **${m.falsePlacements}**.\n\nAmendment votes: ${percent(m.votes.share)} (${m.votes.correct}/${m.votes.total}); collective/split decisions count once and require every sampled linked amendment to be correct.\n\nUnfetched/failed URL inputs: ${result.acquisition.failures.length}; amendments without an indexed wording source: ${result.acquisition.amendmentsWithoutWordingSource}; requests this run: ${result.acquisition.requests}. Coverage is limited to the frozen public index, not a census of all EP amendments.\n\nLive context versions: ${result.compatibility.liveContextVersions.join(', ')}; checkout: ${result.compatibility.checkoutDocumentContextVersion}. Live/checkout version agreement: ${result.compatibility.compatible} (comparison only). Proposals and document text are rebuilt from cached upstream bytes with checkout code. Live-projection comparison: ${result.liveComparison?.metrics.counts.correct} correct; ${percent(result.liveComparison?.metrics.headline)}.\n\nNot-placeable provisional agreements: ${m.counts['not-placeable']} (excluded from the headline and vote denominator, retained in raw). Acquisition-unavailable: ${m.counts['acquisition-unavailable']} (retained in the headline denominator).\n\nUnique amendments by reason (one row each):\n\n| Reason | Count | Share | Examples |\n| --- | ---: | ---: | --- |\n${m.uniqueReasons.slice(0,20).map(r=>`| ${r.reason} | ${r.count} | ${percent(r.share)} | ${r.examples.join(', ')} |`).join('\n')}\n\nPatterns overlap; shares use all sampled amendments.\n\n| Document type | Language | Reason | Pattern | Count | Share | Examples |\n| --- | --- | --- | --- | ---: | ---: | --- |\n${m.taxonomy.slice(0,20).map(r=>`| ${r.documentType} | ${r.language||'unknown'} | ${r.reason} | ${r.pattern} | ${r.count} | ${percent(r.share)} | ${r.examples.join(', ')} |`).join('\n')}\n${result.comparison?'\nBaseline comparison:\n```json\n'+JSON.stringify(comparison,null,2)+'\n```\n':''}`;
}

async function checkoutIdentity(root,runtime) {
  return {producerFingerprint:await checkoutProducers(root),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0,workingDiffHash:digest(execFileSync('git',['diff','HEAD'],{cwd:root})),extractionVersion:runtime?.AMENDMENT_EXTRACTION_VERSION||AMENDMENT_EXTRACTION_VERSION,documentContextVersion:runtime?.documentContextVersion||DOCUMENT_CONTEXT_VERSION,proposalParserVersion:runtime?.PROPOSAL_PARSER_VERSION||PROPOSAL_PARSER_VERSION,documentExtractionVersion:runtime?.documentExtractionVersion||DOCX_EXTRACTION_VERSION,files:Object.fromEntries(await Promise.all(['server/amendment-documents.mjs','server/proposal-placement.mjs','server/proposal-structure.mjs','server/document-context-model.mjs','server/document-context.mjs','server/document-context-placement.mjs','server/document-text.mjs','scripts/amendment-benchmark.mjs','scripts/amendment-benchmark-model.mjs','scripts/amendment-benchmark-cache.mjs','scripts/amendment-benchmark-producers.mjs','scripts/amendment-benchmark-resolution-oracle.mjs'].map(async file=>[file,digest(await readFile(path.join(root,file)))])))};
}

async function harnessIdentity(root) {
  const files=['scripts/amendment-benchmark.mjs','scripts/amendment-benchmark-sample.mjs','scripts/amendment-benchmark-model.mjs','scripts/amendment-benchmark-cache.mjs','scripts/amendment-benchmark-producers.mjs','scripts/amendment-benchmark-replay.mjs','scripts/amendment-benchmark-resolution-oracle.mjs','scripts/amendment-benchmark-languages.mjs','package-lock.json','scripts/amendment-benchmark-operation-oracle.mjs','scripts/amendment-benchmark-proposal-oracle.mjs','scripts/amendment-benchmark-source-diagnostics.mjs'];
  return {files:Object.fromEntries(await Promise.all(files.map(async file=>[file,digest(await readFile(path.join(root,file)))])))};
}

export async function main(args=process.argv.slice(2)) {
  const opts=options(args);
  if(opts.help) {process.stdout.write('Usage: npm run bench:amendments -- --api-base HTTPS_ORIGIN [--fetch] [--decision-week YYYY-MM-DD (repeatable) | --weeks 8 | --from YYYY-MM-DD --to YYYY-MM-DD | --document A-10-YYYY-NNNN (repeatable)] [--exclude-snapshot PATH/snapshot.json (repeatable)] [--as-of YYYY-MM-DD] [--cache-dir PATH] [--output-dir PATH] [--request-cap 1500] [--delay-ms 750] [--baseline PATH.json] [--placement-only] [--language-variants] [--acquire-only] [--runtime-root CLEAN_CHECKOUT] [--diagnose-sources [--source-negotiation-cache NEW_PATH]]\nOffline by default. --fetch fills missing URLs only; use a new cache directory for a new snapshot. --diagnose-sources inspects frozen inputs; --source-negotiation-cache explicitly permits paced public representation checks in a separate cache, without changing scores.\n');return;}
  if(!opts.apiBase)throw new Error('Provide --api-base or AMENDMENT_BENCHMARK_API_BASE; no deployment host is built in.');
  const root=fileURLToPath(new URL('../',import.meta.url)),runtimeRoot=path.resolve(opts.runtimeRoot||root),runtime=await replayRuntime(runtimeRoot),code=await checkoutIdentity(runtimeRoot,runtime),harness=await harnessIdentity(root);
  if(opts.placementOnly)process.stderr.write('NOTE: --placement-only is a compatibility alias for full cached-source replay; producer changes are evaluated.\n');
  const directory=await outsideRepository(path.resolve(opts.cache)),output=await outsideRepository(path.resolve(opts.output||path.join(directory,'output')));
  const lock=path.join(directory,'.benchmark-lock');
  try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('Another benchmark owns this cache. If interrupted, verify it has stopped before removing '+lock);throw error;}
  let spool,negotiationLock;
  try {
  const inputs=path.join(directory,'inputs');await mkdir(inputs,{recursive:true});
  const cache=new InputCache(inputs,opts);
  cache.languageVariants=Boolean(opts.languageVariants);
  const snapshotPath=path.join(directory,'snapshot.json');let snapshot;
  try{snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!snapshot){snapshot={schemaVersion:3,apiBase:opts.apiBase,asOf:opts.asOf||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels'}).format(new Date())};await writeFile(snapshotPath,JSON.stringify(snapshot)+'\n');}
  if(snapshot.schemaVersion!==3||snapshot.apiBase!==opts.apiBase)throw new Error('Snapshot origin/schema mismatch; legacy live-projection snapshots need upstream acquisition in a new cache directory.');
  if(snapshot.snapshotId)await cache.seal(snapshot.manifest);
  opts.asOf=opts.asOf||snapshot.asOf;
  spool=await mkdtemp(path.join(output,'spool-'));
  const index=await catalogue(cache,opts,spool);
  const exclusions=await sampleExclusions(opts.excludeSnapshots);
  const sample={term:10,asOf:opts.asOf,mode:opts.documents.length?'documents':opts.from?'date-window':'plenary-weeks',...(opts.documents.length?{documents:opts.documents}:opts.from?{from:opts.from,to:opts.to}:opts.decisionWeeks.length?{weeks:opts.decisionWeeks}:{requestedWeeks:opts.weeks,weeks:index.weeks}),...(exclusions?{exclusions}:{}),decisionBasis:'indexed-plenary-decision-date',variantPolicy:'one exact variant per amendment: English, then language code, then list ID',...(opts.languageVariants?{languageVariantInputs:'exact declared list translations and matching document DOCX'}:{}),indexGeneration:index.generation,indexedAmendments:index.indexed};
  const filenames=(await readdir(spool)).sort();
  // Complete and seal acquisition before invoking any checkout extraction or
  // placement. The evaluation phase cannot fill even a previously unseen URL.
  for(const filename of snapshot.snapshotId?[]:filenames) {
    const rows=await readRows(path.join(spool,filename));
    await acquireReport(rows,sample,cache,sourceReplay(cache,runtime));
    process.stderr.write(`Acquired ${filename.replace('.jsonl','')}; ${cache.requests} requests\n`);
  }
  const manifest=cache.manifest(),snapshotId=digest(JSON.stringify({apiBase:opts.apiBase,sample,manifest}));
  if(snapshot.snapshotId&&snapshot.snapshotId!==snapshotId)throw new Error('Frozen snapshot manifest changed; acquisition must be independent of checkout output.');
  if(!snapshot.snapshotId){snapshot={...snapshot,sample,manifest,snapshotId};await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n');}
  if(opts.acquireOnly){process.stdout.write(JSON.stringify({snapshotId,sample,inputs:manifest.length,requests:cache.requests},null,2)+'\n');return;}
  if(!cache.sealed)await cache.seal(manifest);
  let diagnostics;
  if(opts.diagnoseSources) {
    const negotiationDirectory=opts.negotiationCache?await outsideRepository(path.resolve(opts.negotiationCache)):null;
    if(negotiationDirectory&&(negotiationDirectory===directory||negotiationDirectory.startsWith(directory+path.sep)))throw new Error('Source negotiation cache must be separate from the sealed snapshot.');
    if(negotiationDirectory) {
      const candidate=path.join(negotiationDirectory,'.benchmark-lock');
      try{await mkdir(candidate);}catch(error){if(error.code==='EEXIST')throw new Error('Another source diagnostic owns this negotiation cache.');throw error;}
      negotiationLock=candidate;
    }
    const negotiationCache=negotiationDirectory?new InputCache(negotiationDirectory,{...opts,fetchMissing:true}):null;
    diagnostics={observations:await sourceDiagnostics(cache,manifest,{negotiationCache}),acquisition:{requests:negotiationCache?.requests??0,requestCap:opts.cap,delayMs:opts.delay,inputs:negotiationCache?.manifest()??[]}};
  }
  const resultRows=[],liveRows=[];
  for(const filename of filenames) {
    const rows=await readRows(path.join(spool,filename));
    resultRows.push(...await evaluateReport(rows,sample,cache,{runtime,replay:sourceReplay(cache,runtime)}));
    liveRows.push(...await evaluateReport(rows,sample,cache,{runtime}));
    process.stderr.write(`Evaluated ${filename.replace('.jsonl','')}: ${resultRows.length} sample rows\n`);
  }
  resultRows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  liveRows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
  if(!resultRows.length)throw new Error('No indexed amendment decisions in the requested sample.');
  if(JSON.stringify(manifest)!==JSON.stringify(cache.manifest()))throw new Error('Evaluation read outside the fixed snapshot manifest.');
  if(JSON.stringify(code)!==JSON.stringify(await checkoutIdentity(runtimeRoot,runtime))||JSON.stringify(harness)!==JSON.stringify(await harnessIdentity(root)))throw new Error('Checkout changed during the run; replay the cached inputs offline before reporting a score.');
  const compatibility={...projectionCompatibility(resultRows,code),projectionMode:'cached-source-replay'};
  const scope='full-pipeline-cached-sources';
  const result={schemaVersion:3,scope,projectionMode:'cached-source-replay',liveComparison:{metrics:metrics(liveRows),rows:liveRows},snapshotId,sample,code,harness,compatibility,inputs:manifest,sourceReasonPolicy:SOURCE_REASONS,...(diagnostics?{sourceDiagnostics:diagnostics}:{}),acquisition:{amendmentsWithoutWordingSource:resultRows.filter(row=>row.stages.S2.reason==='wording-source-not-indexed').length,requests:cache.requests,requestCap:opts.cap,delayMs:opts.delay,failures:[...cache.missing].sort(([a],[b])=>a.localeCompare(b,'en')).map(([url,reason])=>({url,reason}))},metrics:metrics(resultRows),rows:resultRows};
  if(opts.baseline){const baseline=JSON.parse(await readFile(opts.baseline,'utf8'));result.comparison=compareBaseline(result,baseline,{placementOnly:opts.placementOnly});for(const warning of result.comparison.warnings||[])process.stderr.write('WARNING: '+warning+'\n');if(result.comparison.refused)process.stderr.write('BASELINE REFUSED: '+result.comparison.reason+'\n');}

  const stamp=digest(JSON.stringify({sample,inputs:result.inputs,code:result.code,harness,scope,diagnostics})).slice(0,16),jsonPath=path.join(output,'benchmark-'+stamp+'.json'),mdPath=path.join(output,'benchmark-'+stamp+'.md');
  await writeFile(jsonPath,JSON.stringify(result,null,2)+'\n');await writeFile(mdPath,markdown(result));
  process.stdout.write(JSON.stringify({jsonPath,mdPath,scope,snapshotId,compatibility,sample,metrics:result.metrics,acquisition:result.acquisition,...(diagnostics?{sourceDiagnostics:diagnostics}:{}),...(result.comparison?{comparison:result.comparison}:{})},null,2)+'\n');
  if(result.metrics.falsePlacements||result.comparison?.failed)process.exitCode=1;
  } finally {if(negotiationLock)await rm(negotiationLock,{recursive:true,force:true});if(spool)await rm(spool,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
