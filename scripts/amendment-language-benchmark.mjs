import {mkdir,readFile,writeFile,rm,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {InputCache,digest,outsideRepository} from './amendment-benchmark-cache.mjs';
import {replayRuntime,sourceReplay,publicDocumentUrl} from './amendment-benchmark-replay.mjs';
import {rawDocument,rawExpected,verifyLanguagePlacement} from './amendment-language-oracle.mjs';

export const LANGUAGES='bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
export const LANGUAGE_SAMPLE=[
  ['A-10-2025-0150','001-129','legislative'],['A-10-2026-0080','001-007','non-legislative'],
  ['A-10-2026-0050','001-002','discharge'],['RC-10-2026-0201','001-004','joint-motion'],
  ['A-10-2026-0051','001-002','discharge'],['B-10-2026-0469','001-002','motion'],
  ['A-10-2026-0175','001-008','second-reading'],['A-10-2026-0258','001-001','non-legislative'],
].map(([documentId,range,type])=>({documentId,listId:documentId+'-AM-'+range,type,numbers:Array.from({length:Number(range.split('-')[1])-Number(range.split('-')[0])+1},(_,i)=>Number(range.split('-')[0])+i)}));
const root=fileURLToPath(new URL('../',import.meta.url));
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const ref=value=>String(value?.id||value).replace(/^https?:\/\/data\.europarl\.europa\.eu\//u,'');
async function runtimeIdentity(directory) {
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8'}).trim();
  const files=git(['ls-files','server','package.json','package-lock.json']).split('\n').filter(Boolean);
  return {head:git(['rev-parse','HEAD']),dirty:Boolean(git(['status','--porcelain'])),treeHash:digest(JSON.stringify(await Promise.all(files.map(async file=>[file,digest(await readFile(path.join(directory,file)))]))))};
}
async function oracleIdentity() {
  return digest(Buffer.concat(await Promise.all(['amendment-language-oracle.mjs','amendment-language-raw.py','amendment-language-vocabulary.mjs','amendment-benchmark-operation-oracle.mjs','amendment-oracle-grammar.mjs','amendment-benchmark-proposal-oracle.mjs'].map(file=>readFile(new URL(file,import.meta.url))))));
}
async function immutableJson(file,value) {
  const bytes=JSON.stringify(value,null,2)+'\n';
  try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await readFile(file,'utf8')!==bytes)throw error;}
}
export async function appendLanguageBaseline(directory,result) {
  const ledger=path.join(directory,'ratchet.jsonl');let records=[];
  try{records=(await readFile(ledger,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code!=='ENOENT')throw error;}
  const existing=records.find(row=>row.head===result.code.head&&row.oracleFingerprint===result.oracleFingerprint);
  if(existing)return {appended:false,record:existing};
  const baselineDirectory=path.join(directory,'output');await mkdir(baselineDirectory,{recursive:true});
  const file=path.join(baselineDirectory,'baseline-'+result.code.head+'-'+result.oracleFingerprint.slice(0,12)+'.json');await immutableJson(file,result);
  const record={head:result.code.head,oracleFingerprint:result.oracleFingerprint,file,snapshotId:result.snapshotId,correct:result.rows.filter(r=>r.outcome==='correct').length,falsePlacements:result.rows.filter(r=>r.outcome==='false-placement').length,tool:'bench:amendments --languages'};
  await appendFile(ledger,JSON.stringify(record)+'\n');return {appended:true,record};
}
const count=values=>{const result={};for(const v of values)result[v]=(result[v]||0)+1;return result;};
// Parity describes the verified source boundary. Published suffix conventions
// (a/b versus bis/ter, Greek letters) remain in expected.targetLabel unchanged.
export function parityLocation(row) {
  if(!row.location)return null;
  const location={...row.location},value=String(location.value);
  const base=row.placement?.operation==='insert'?/^(\d+|\p{Lu}+)/u.exec(value)?.[1]:value;
  if(!base)return null;
  let address=base;
  if(/^\p{Lu}+$/u.test(base)) {
    const alphabet=row.language==='bg'?'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ':row.language==='el'?'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ':'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if([...base].some(c=>!alphabet.includes(c)))return null;
    address=String([...base].reduce((n,c)=>n*alphabet.length+alphabet.indexOf(c)+1,0));
  }
  return {...location,value:address,boundary:row.placement?.operation==='insert'?'after':'within'};
}
export function languageMetrics(rows) {
  const english=new Map(rows.filter(r=>r.language==='en').map(r=>[r.identity,r]));
  return LANGUAGES.map(language=>{
    const selected=rows.filter(r=>r.language===language),paired=selected.filter(r=>r.published!==false&&english.get(r.identity)?.published!==false&&english.has(r.identity));
    const sameOutcome=paired.filter(r=>r.outcome===english.get(r.identity).outcome);
    const located=paired.filter(r=>parityLocation(r)&&parityLocation(english.get(r.identity)));
    return {language,total:selected.length,published:selected.filter(r=>r.published!==false).length,counts:count(selected.map(r=>r.outcome)),unverifiedByReason:count(selected.filter(r=>r.outcome==='placed-unverified').map(r=>r.reason)),withheldByReason:count(selected.filter(r=>r.outcome==='withheld').map(r=>r.reason)),paired:paired.length,sameOutcome:sameOutcome.length,locatedPairs:located.length,sameLocation:located.filter(r=>parityLocation(r)&&parityLocation(english.get(r.identity))&&JSON.stringify(parityLocation(r))===JSON.stringify(parityLocation(english.get(r.identity)))).length,behindEnglishWithheld:paired.filter(r=>english.get(r.identity).outcome==='correct'&&r.outcome==='withheld').length,behindEnglishUnverified:paired.filter(r=>english.get(r.identity).outcome==='correct'&&r.outcome==='placed-unverified').length,behindEnglish:paired.filter(r=>english.get(r.identity).outcome==='correct'&&r.outcome!=='correct').length};
  });
}
export function compareLanguages(current,baseline,calibration) {
  if(current.snapshotId!==baseline.snapshotId||JSON.stringify(current.sample)!==JSON.stringify(baseline.sample)||JSON.stringify(current.inputs)!==JSON.stringify(baseline.inputs)||current.oracleVersion!==baseline.oracleVersion)throw new Error('Language baseline snapshot/sample/inputs/oracle differ.');
  const unique=rows=>{const m=new Map();for(const row of rows){if(m.has(row.key))throw new Error('Duplicate language observation: '+row.key);m.set(row.key,row);}return m;};
  const now=unique(current.rows),before=unique(baseline.rows);
  const regressions=[...before.values()].filter(old=>!now.has(old.key)||old.outcome==='correct'&&now.get(old.key).outcome!=='correct').map(old=>({key:old.key,before:old.outcome,after:now.get(old.key)?.outcome||'missing',reason:now.get(old.key)?.reason}));
  const falsePlacements=current.rows.filter(r=>r.outcome==='false-placement');
  const warnings=[];
  if(current.oracleFingerprint!==baseline.oracleFingerprint) {
    // Implementation maintenance retains a sealed baseline only when every
    // independent source expectation and verification assertion is identical.
    const assertions=row=>JSON.stringify({expected:row.expected,verification:row.verification});
    const changed=[...before.values()].filter(old=>!now.has(old.key)||assertions(old)!==assertions(now.get(old.key)));
    if(now.size!==before.size)throw new Error('Language oracle calibration cannot change the observation set.');
    if(changed.length){
      if(!calibration||calibration.snapshotId!==current.snapshotId||calibration.baselineOracleFingerprint!==baseline.oracleFingerprint||calibration.candidateOracleFingerprint!==current.oracleFingerprint)throw new Error('Language oracle changed its raw expectations or verification assertions; a reviewed calibration is required.');
      const entries=new Map((calibration.rows||[]).map(row=>[row.key,row]));
      if(entries.size!==changed.length||entries.size!==calibration.rows.length)throw new Error('Oracle calibration must account for exactly every changed assertion.');
      for(const old of changed){
        const entry=entries.get(old.key);
        if(!entry||entry.beforeDigest!==digest(assertions(old))||entry.afterDigest!==digest(assertions(now.get(old.key)))||!entry.checkedBy||!entry.note||!entry.sources?.length||entry.sources.some(source=>!/^https:\/\/(?:data\.europarl\.europa\.eu|publications\.europa\.eu)\//u.test(source.url)||! /^[a-f0-9]{64}$/u.test(source.sha256)||!source.paths?.length||!Number.isFinite(Date.parse(source.retrievedAt))))throw new Error('Oracle calibration source evidence incomplete for '+old.key);
      }
      warnings.push('Source-checked oracle calibration applied to '+changed.length+' assertions; independent review of the exact head is still required.');
    }else warnings.push('Oracle implementation changed; all raw expectations and verification assertions match the sealed baseline.');
  }
  warnings.push(...(current.harnessFingerprint===baseline.harnessFingerprint?[]:['Language measurement harness changed or baseline predates its fingerprint; review measurement changes before using deltas.']));
  return {warnings,failed:regressions.length>0||falsePlacements.length>0,regressions,falsePlacements: falsePlacements.map(r=>r.key),deltas:languageMetrics(current.rows).map(m=>({language:m.language,correct:(m.counts.correct||0)-(languageMetrics(baseline.rows).find(b=>b.language===m.language).counts.correct||0)}))};
}
export function languageMarkdown(result) {
  return '# Amendment language parity\n\nCheckout: '+result.code.head+'. Snapshot: '+result.snapshotId+'. Raw source replay; '+result.rows.length+' language observations.\n\n| Language | Planned / published | Correct | Placed unverified | Withheld | False | Same outcome / EN pairs | Same location / verified pairs | Behind EN |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n'+result.metrics.map(m=>`| ${m.language} | ${m.total} / ${m.published} | ${m.counts.correct||0} | ${m.counts['placed-unverified']||0} | ${m.counts.withheld||0} | ${m.counts['false-placement']||0} | ${m.sameOutcome}/${m.paired} | ${m.sameLocation}/${m.locatedPairs} | ${m.behindEnglish} |`).join('\n')+'\n\nOutcome parity includes shared withholding. Location parity compares independent semantic section/scope/address keys, never translated paragraph offsets; unknown locations are excluded and counted separately. Insertion parity compares the existing predecessor boundary; published a/b, bis/ter and alphabet conventions remain in the source label. Lag behind English includes both withholding and weaker oracle coverage; JSON separates them.\n\n'+result.metrics.map(m=>'**'+m.language+' withheld:** '+JSON.stringify(m.withheldByReason)).join('\n\n')+'\n\nFalse placements:\n\n'+(result.rows.filter(r=>r.outcome==='false-placement').map(r=>'- '+r.key+': '+r.reason+'; '+JSON.stringify(r.verification)).join('\n')||'None.')+'\n';
}
async function acquire(cache,runtime) {
  const publications=[],replay=sourceReplay(cache,runtime);
  for(const sample of LANGUAGE_SAMPLE) {
    const {value,input}=await cache.json(publicDocumentUrl(sample.documentId));
    const records=(value?.data||[]).filter(r=>ref(r.id)==='eli/dl/doc/'+sample.documentId&&r.identifier===sample.documentId);
    if(records.length!==1)throw new Error('Language sample document identity unavailable: '+sample.documentId);
    const work=records[0];
    let list=runtime.array(work.inverse_foresees_change_of).find(r=>ref(r)==='eli/dl/doc/'+sample.listId);
    if(!list)throw new Error('Language sample list not declared: '+sample.listId);
    if(typeof list!=='object'||!runtime.documentFiles(list).length) {
      const saved=await cache.json('https://data.europarl.europa.eu/api/v2/documents/'+sample.listId+'?format=application%2Fld%2Bjson');
      list=saved.value?.data?.find(r=>ref(r.id)==='eli/dl/doc/'+sample.listId);
    }
    if(list?.identifier!==sample.listId||!runtime.array(list.foresees_change_of).some(r=>ref(r)==='eli/dl/doc/'+sample.documentId)||ref(list.work_type)!=='def/ep-document-types/AMENDMENT_LIST')throw new Error('Language sample list relationship/type mismatch: '+sample.listId);
    const bodies=runtime.documentFiles(work).filter(f=>f.format==='DOCX'),lists=runtime.documentFiles(list).filter(f=>f.format==='DOCX');
    const editions=[];
    for(const language of LANGUAGES) {
      const body=bodies.filter(f=>f.language===language),wording=lists.filter(f=>f.language===language);
      if(body.length>1||wording.length>1)throw new Error('Ambiguous language distribution: '+sample.listId+' '+language);
      // Absence is recorded for all 24; it does not become a zero denominator.
      if(body[0])await cache.get(body[0].url);
      if(wording[0])await cache.get(wording[0].url);
      editions.push({language,body:body[0]||null,wording:wording[0]||null});
    }
    // Proposal source acquisition is independent of checkout amendment parsing.
    // Only raw template references select extra Commission inputs.
    if(sample.type==='legislative') {
      const references=new Map();
      for(const e of editions)if(e.wording){const input=await cache.get(e.wording.url);if(input.ok)references.set(e.language,replay.references(input.body));}
      await replay.acquire(sample.documentId,editions.filter(e=>e.body&&e.wording).map(e=>e.language),references);
    }
    publications.push({...sample,metadata:{url:input.url,sha256:input.sha256,fetchedAt:input.fetchedAt},editions});
    process.stderr.write('Language inputs: '+sample.documentId+'\n');
  }
  return publications;
}
async function evaluate(publications,cache,runtime) {
  const replay=sourceReplay(cache,runtime),rows=[];
  for(const publication of publications) {
    await cache.json(publicDocumentUrl(publication.documentId));
    for(const e of publication.editions) {
      let extraction,extractionError,rawAmendments,rawText,text,items=[],rawItems=[];
      if(e.body){const input=await cache.get(e.body.url);if(input.ok){rawText={...rawDocument(input.body),motionDocument:['motion','joint-motion'].includes(publication.type)};text={...runtime.docxContent(input.body),textLanguage:e.language,sourceUrl:input.url,status:'available'};}}
      if(e.wording){const input=await cache.get(e.wording.url);if(input.ok){rawAmendments=rawDocument(input.body).amendments;try{extraction=runtime.extractAmendments(input.body,{listId:publication.listId,targetDocumentId:publication.documentId,language:e.language,sourceUrl:input.url,fetchedAt:input.fetchedAt});}catch{extractionError='amendment-parser-error';}}}
      for(const number of publication.numbers) {
        const identity=publication.listId+':'+number,key=identity+':'+e.language,expectedMatches=rawAmendments?.filter(a=>a.number===number)||[],matches=extraction?.amendments.filter(a=>a.number===number)||[];
        const expected=expectedMatches.length===1?rawExpected(expectedMatches[0],e.language):null,wording=matches.length===1?matches[0]:null;
        let placement={status:'unresolved',reason:!e.wording?'language-wording-unpublished':!e.body?'language-body-unpublished':!wording?extractionError||'amendment-not-extracted':'baseline-unavailable'},verification={status:'not-applicable',reason:'not-placed'};
        if(wording&&text&&typeof wording.originalText==='string'&&typeof wording.proposedText==='string'&&!runtime.amendmentTextLosses(extraction,wording).length) {
          if(wording.baseline==='commission-proposal'&&!items.length) {
            const proposal=await replay.proposal({reportId:publication.documentId,language:e.language,documentReferences:wording.documentReferences});items=proposal.items;
            for(const item of proposal.baseline.items||[]) {const input=await cache.get(item.source.url,{accept:runtime.CELLAR_DOCX_MIME,language:item.languageUri.split('/').at(-1).toLowerCase()});rawItems.push(rawDocument(input.body));}
          }
          placement=runtime.documentContextPlacement({chosen:{...wording,targetLabelLanguage:e.language},text,items:wording.baseline==='commission-proposal'?items:null,resolutionDocument:true});
          verification=verifyLanguagePlacement({expected,placement,text,items:wording.baseline==='commission-proposal'?items:null,rawText,rawItems});
        } else if(wording)placement.reason='wording-unavailable';
        const outcome=placement.status==='placed'?(verification.status==='failed'?'false-placement':verification.status==='verified'?'correct':'placed-unverified'):'withheld';
        const savedPlacement={...placement};delete savedPlacement.originalText;
        rows.push({key,identity,documentId:publication.documentId,listId:publication.listId,number,language:e.language,published:Boolean(e.wording),outcome,reason:placement.status==='placed'?verification.reason:placement.reason,location:verification.location||null,expected:expected?{operation:expected.operation,originalSha256:typeof expected.originalText==='string'?digest(expected.originalText):null,proposedSha256:typeof expected.proposedText==='string'?digest(expected.proposedText):null,section:expected.section,sectionKind:expected.sectionKind,targetLabel:expected.targetLabel,...(expected.underlyingTargetLabel?{underlyingSection:expected.underlyingSection,underlyingTargetLabel:expected.underlyingTargetLabel}:{}),sourcePath:expected.path,cellPaths:expected.cellPaths,gap:expected.gap}:null,placement:savedPlacement,verification,sources:{wording:e.wording?.url||null,body:e.body?.url||null}});
      }
      process.stderr.write('Language edition: '+publication.documentId+' '+e.language+'\n');
    }
    process.stderr.write('Language evaluated: '+publication.documentId+'; '+rows.length+' observations\n');
  }
  return rows;
}
export async function languageMain(opts) {
  const directory=await outsideRepository(path.resolve(opts.cache)),output=await outsideRepository(path.resolve(opts.output||path.join(directory,'output')));
  const runtime=await replayRuntime(opts.runtimeRoot||root),cache=new InputCache(path.join(directory,'inputs'),opts);
  await mkdir(cache.directory,{recursive:true});const lock=path.join(directory,'.benchmark-lock');await mkdir(lock);
  try {
    const snapshotFile=path.join(directory,'languages.json');let snapshot;
    try{snapshot=await json(snapshotFile);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!snapshot) {
      const sample=await acquire(cache,runtime),inputs=cache.manifest();snapshot={schemaVersion:1,sample,inputs,snapshotId:digest(JSON.stringify({sample,inputs}))};
      await writeFile(snapshotFile,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
    }
    if(snapshot.schemaVersion!==1||snapshot.snapshotId!==digest(JSON.stringify({sample:snapshot.sample,inputs:snapshot.inputs})))throw new Error('Invalid language snapshot.');
    await cache.seal(snapshot.inputs);
    if(opts.acquireOnly){process.stdout.write(JSON.stringify({snapshotId:snapshot.snapshotId,requests:cache.requests})+'\n');return;}
    const runtimeRoot=path.resolve(opts.runtimeRoot||root),code=await runtimeIdentity(runtimeRoot),oracleFingerprint=await oracleIdentity();
    const rows=await evaluate(snapshot.sample,cache,runtime);
    if(JSON.stringify(code)!==JSON.stringify(await runtimeIdentity(runtimeRoot))||oracleFingerprint!==await oracleIdentity())throw new Error('Measured checkout/oracle changed during replay.');
    const harnessFingerprint=digest(Buffer.concat(await Promise.all(['amendment-language-benchmark.mjs','amendment-benchmark.mjs','amendment-benchmark-cache.mjs','amendment-benchmark-replay.mjs'].map(file=>readFile(new URL(file,import.meta.url))))));
    const result={schemaVersion:1,oracleVersion:1,oracleFingerprint,harnessFingerprint,snapshotId:snapshot.snapshotId,sample:snapshot.sample,inputs:snapshot.inputs,code,rows,metrics:languageMetrics(rows)};
    const ledger=path.join(directory,'ratchet.jsonl');let records=[];
    try{records=(await readFile(ledger,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
    const baselineFile=opts.baseline||records.at(-1)?.file;
    if(baselineFile){try{result.comparison=compareLanguages(result,await json(baselineFile),opts.oracleCalibration?await json(opts.oracleCalibration):undefined);}catch(error){if(!/reviewed calibration/.test(error.message))throw error;result.comparison={failed:true,calibrationRequired:true,error:error.message};}}
    else if(!opts.recordBaseline)throw new Error('Language ratchet has no baseline. Record a clean current-main run with --record-language-baseline first.');
    if(opts.baseline&&records.length&&opts.baseline!==records.at(-1).file){result.ratchetComparison=compareLanguages(result,await json(records.at(-1).file),opts.oracleCalibration?await json(opts.oracleCalibration):undefined);if(result.ratchetComparison.failed)result.comparison.failed=true;}
    const name='languages-'+code.head.slice(0,12)+'-'+digest(JSON.stringify(result)).slice(0,10),filename=path.join(output,name+'.json');
    await immutableJson(filename,result);await writeFile(path.join(output,name+'.md'),languageMarkdown(result));
    if(opts.recordBaseline) {
      if(code.dirty)throw new Error('Language ratchet requires a clean measured checkout.');
      if(!records.length&&code.head!==execFileSync('git',['rev-parse','origin/main'],{cwd:runtimeRoot,encoding:'utf8'}).trim())throw new Error('First language ratchet row must measure current origin/main.');
      if(records.length){const baseline=await json(records.at(-1).file);if(compareLanguages(result,baseline,opts.oracleCalibration?await json(opts.oracleCalibration):undefined).failed)throw new Error('Language ratchet regression; ledger unchanged.');}
      await appendLanguageBaseline(directory,result);
    }
    process.stdout.write(JSON.stringify({file:filename,snapshotId:result.snapshotId,code,metrics:result.metrics,comparison:result.comparison},null,2)+'\n');
    if(rows.some(r=>r.outcome==='false-placement')||result.comparison?.failed)process.exitCode=1;
  } finally {await rm(lock,{recursive:true});}
}
