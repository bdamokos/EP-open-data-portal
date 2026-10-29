#!/usr/bin/env node
import {readFile,writeFile,mkdtemp,symlink,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {InputCache,digest,outsideRepository} from './amendment-benchmark-cache.mjs';
import {replayRuntime,sourceReplay} from './amendment-benchmark-replay.mjs';

const DOCUMENT='A-10-2026-0175',LIST=DOCUMENT+'-AM-001-008',LANGUAGES=['en','fr','hu','pl','ga'];
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const key=meta=>meta.request?JSON.stringify([meta.url,meta.request]):meta.url;
const normal=s=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const insist=(condition,reason)=>{if(!condition)throw new Error(reason);};
export function options(args) {
  const opts={};
  const flags={'--snapshot':'snapshot','--runtime-root':'runtimeRoot','--output-dir':'output','--baseline':'baseline','--request-cap':'cap'};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help'){opts.help=true;continue;}
    const field=flags[args[i]];insist(field&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown or missing option: '+args[i]);insist(!Object.hasOwn(opts,field),'Repeated option: '+args[i]);opts[field]=args[++i];
  }
  if(!opts.help)insist(opts.snapshot&&opts.runtimeRoot&&opts.output&&opts.cap==='0','Require --snapshot, --runtime-root, --output-dir and --request-cap 0.');
  return opts;
}
function blockNetwork() {
  const fetch=globalThis.fetch,connect=net.Socket.prototype.connect;
  const denied=()=>{throw new Error('Controlled Council replay cannot access the network.');};
  globalThis.fetch=denied;net.Socket.prototype.connect=denied;
  return ()=>{globalThis.fetch=fetch;net.Socket.prototype.connect=connect;};
}
async function checked(file,sha256) {
  const bytes=await readFile(file);insist(digest(bytes)===sha256,'Sealed input hash mismatch: '+file);return bytes;
}
async function identity(root) {
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=git(['ls-files','server','src','package.json','package-lock.json']).split('\n').filter(Boolean);
  return {head:git(['rev-parse','HEAD']),dirty:Boolean(git(['status','--porcelain'])),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,digest(await readFile(path.join(root,f)))])))};
}
async function harnessIdentity() {
  const files=['amendment-council-language-benchmark.mjs','amendment-council-language-native.py','amendment-benchmark-cache.mjs','amendment-benchmark-replay.mjs','amendment-benchmark-source-diagnostics.mjs'];
  return Object.fromEntries(await Promise.all(files.map(async f=>[f,digest(await readFile(new URL(f,import.meta.url)))])));
}
export function correspondence(expected,proposal,rootPath) {
  const selected=proposal.paragraphs.filter(p=>p.source?.path===rootPath||p.source?.path?.startsWith(rootPath+'/'));
  const paths=new Set(expected.map(p=>p.numericPath));
  if(selected.length!==expected.length||selected.some(p=>!paths.has(p.source.path)))return {supported:false,reason:'native-content-row-set-mismatch'};
  const matched=[];
  for(const row of expected) {
    const found=selected.filter(p=>p.source.path===row.numericPath);
    if(found.length!==1||normal(found[0].text)!==normal(row.text))return {supported:false,reason:'native-complete-text-mismatch',path:row.path};
    if(found[0].complete===false||found[0].source.complete===false||found[0].objects?.some(o=>!o.complete))return {supported:false,reason:'incomplete-native-predecessor',path:row.path};
    matched.push(found[0]);
  }
  if(matched.some((p,i)=>i&&p.index!==matched[i-1].index+1))return {supported:false,reason:'native-row-continuity-mismatch'};
  return {supported:true,rows:matched.map(p=>({index:p.index,text:p.text,path:p.source.path}))};
}
export function assessPlacement(placement,assertion,proposal) {
  const unresolved=placement?.status!=='placed';
  if(placement?.operation!==assertion.operation)return {outcome:unresolved?'withheld':'false-placement',reason:'native-operation-mismatch'};
  if(unresolved)return {outcome:'withheld',reason:placement?.reason||'placement-unavailable'};
  if(placement.itemIndex!==0)return {outcome:'false-placement',reason:'wrong-source-item'};
  if(assertion.state==='typed-note-equivalence-held')return {outcome:'placed-unverified',reason:'typed-note-equivalence-held',gateFailure:true};
  if(assertion.state==='source-orthography-conflict')return {outcome:'false-placement',reason:'source-orthography-conflict'};
  if(assertion.operation==='replace') {
    const mapping=correspondence(assertion.contentRows,proposal,assertion.native.numericPath);
    if(!mapping.supported)return {outcome:'false-placement',reason:mapping.reason,verification:mapping};
    const rows=mapping.rows,start=rows[0],end=rows.at(-1);
    const correct=placement.span?.start===start.index&&placement.span?.end===end.index&&placement.splice?.start?.paragraph===start.index&&placement.splice.start.offset===0&&placement.splice?.end?.paragraph===end.index&&placement.splice.end.offset===end.text.length;
    return {outcome:correct?'legal-correct':'false-placement',reason:correct?'native-complete-replacement':'wrong-native-replacement-span',verification:mapping};
  }
  const before=correspondence(assertion.predecessorRows,proposal,assertion.predecessor.numericPath);
  if(!before.supported)return {outcome:'false-placement',reason:before.reason,verification:before};
  // At a chapter boundary only its complete heading is needed, not the legal
  // contents of that following chapter. Every heading row must stay after
  // the insertion, and the full predecessor must end immediately before it.
  const afterRows=assertion.followingRows,after=[];
  for(const row of afterRows){const found=proposal.paragraphs.filter(p=>p.source?.path===row.numericPath);if(found.length!==1||normal(found[0].text)!==normal(row.text)||found[0].complete===false||found[0].source.complete===false)return {outcome:'false-placement',reason:'native-following-boundary-unavailable'};after.push(found[0]);}
  if(after.some((p,i)=>i&&p.index!==after[i-1].index+1))return {outcome:'false-placement',reason:'native-following-boundary-discontinuous'};
  const last=before.rows.at(-1).index,first=after[0].index;
  const correct=first===last+1&&placement.insertAfter===last&&placement.insertBefore===first;
  return {outcome:correct?'legal-correct':'false-placement',reason:correct?'native-complete-insertion-boundary':'wrong-native-insertion-boundary',verification:{predecessor:before.rows,following:{index:first,path:after[0].source.path,text:after[0].text}}};
}
export function compare(current,baseline) {
  insist(current.snapshotSha256===baseline.snapshotSha256&&current.expectedAssertionsSha256===baseline.expectedAssertionsSha256,'Baseline input/expectation seal differs.');
  insist(current.canonicalOracleFingerprint===baseline.canonicalOracleFingerprint,'Existing canonical oracle fingerprint differs.');
  insist(JSON.stringify(current.harness)===JSON.stringify(baseline.harness),'Baseline measurement harness differs.');
  const unique=rows=>{const m=new Map();for(const r of rows){insist(!m.has(r.key),'Duplicate observation: '+r.key);m.set(r.key,r);}return m;};
  const before=unique(baseline.rows),now=unique(current.rows),regressions=[];
  for(const [k,old] of before) {
    const next=now.get(k);
    if(!next||old.outcome==='legal-correct'&&next.outcome!=='legal-correct')regressions.push({key:k,reason:'lost-observation-or-correct-placement'});
    if(next&&JSON.stringify(old.identity)!==JSON.stringify(next.identity))regressions.push({key:k,reason:'changed-source-or-observation-identity'});
    if(next&&old.placement?.operation!==next.placement?.operation)regressions.push({key:k,reason:'changed-operation'});
    if(next&&old.placement?.status==='placed') {
      const boundary=p=>({operation:p.operation,status:p.status,itemIndex:p.itemIndex,span:p.span,splice:p.splice,insertAfter:p.insertAfter,insertBefore:p.insertBefore});
      if(JSON.stringify(boundary(old.placement))!==JSON.stringify(boundary(next.placement)))regressions.push({key:k,reason:'changed-previous-placement'});
    }
  }
  for(const k of now.keys())if(!before.has(k))regressions.push({key:k,reason:'added-observation'});
  const falsePlacements=current.rows.filter(r=>r.outcome==='false-placement').map(r=>r.key),unsupportedPlacements=current.rows.filter(r=>r.gateFailure).map(r=>r.key);
  return {unsupportedPlacements,baselineHead:baseline.runtime.head,baselineSnapshot:baseline.snapshotSha256,failed:Boolean(regressions.length||falsePlacements.length||unsupportedPlacements.length),regressions,falsePlacements};
}
async function snapshotInputs(snapshot) {
  const research=JSON.parse(await checked(snapshot.research.path,snapshot.research.sha256));
  const retained=JSON.parse(await checked(snapshot.retained.path,research.retainedProvenanceSha256));
  const records=new Map();
  const add=(meta,file)=>{const id=key(meta);insist(!records.has(id),'Duplicate replay observation: '+id);records.set(id,{meta,file});};
  for(const entry of retained){const {snapshot:originalSnapshot,...meta}=entry.observations[0];await checked(entry.path,meta.sha256);add(meta,entry.path);}
  // Every research observation is retained and validated, even when outside
  // this Council cohort. The inherited EN law observation has the same bytes;
  // its new capture remains separate in the immutable research manifest.
  for(const e of research.observations){await checked(e.bodyPath,e.sha256);const meta={url:e.url,request:{accept:e.accept,...(e.language?{language:e.language}:{})},fetchedAt:e.retrievedAt,status:e.status,ok:e.status>=200&&e.status<300,headers:e.headers,bytes:e.bytes,sha256:e.sha256,error:e.error};if(!records.has(key(meta)))add(meta,e.bodyPath);else insist(records.get(key(meta)).meta.sha256===meta.sha256,'Conflicting replay captures need an explicit observation selection.');}
  for(const [name,original] of Object.entries(research.originalSnapshots))await checked(original.path,original.sha256);
  for(const item of snapshot.originalInputs){const original=research.originalSnapshots[item.snapshot];insist(original,'Unknown original snapshot');const manifest=JSON.parse(await checked(original.path,original.sha256)).manifest;insist(manifest.some(meta=>JSON.stringify(meta)===JSON.stringify(item.meta)),'Original observation mismatch');await checked(item.path,item.meta.sha256);add(item.meta,item.path);}
  return {research,records};
}
export async function main(args=process.argv.slice(2)) {
  const opts=options(args);
  if(opts.help){process.stdout.write('Offline controlled Council language gate: --snapshot FILE --runtime-root CHECKOUT --output-dir DIRECTORY --request-cap 0 [--baseline REPORT]\n');return;}
  const snapshotBytes=await readFile(opts.snapshot),snapshot=JSON.parse(snapshotBytes),snapshotSha256=digest(snapshotBytes);
  insist(snapshot.schemaVersion===1&&snapshot.documentId===DOCUMENT&&snapshot.listId===LIST,'Unsupported controlled Council snapshot');
  insist(JSON.stringify(snapshot.editions.map(e=>e.language))===JSON.stringify(LANGUAGES),'Controlled editions must be EN/FR/HU/PL/GA.');
  const root=await realpath(opts.runtimeRoot),output=await outsideRepository(path.resolve(opts.output));
  const runtimeIdentity=await identity(root),harness=await harnessIdentity();
  insist(!runtimeIdentity.dirty,'Measured checkout must be clean.');
  const {records}=await snapshotInputs(snapshot);
  const expectedBytes=await checked(snapshot.expected.path,snapshot.expected.sha256),expected=JSON.parse(expectedBytes);
  const native=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('amendment-council-language-native.py',import.meta.url))],{input:JSON.stringify({editions:snapshot.editions}),encoding:'utf8',maxBuffer:32*1024*1024,timeout:60_000}));
  insist(JSON.stringify(native)===JSON.stringify(expected),'Native assertions differ from the sealed expected assertions.');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'council-language-replay-')),restoreNetwork=blockNetwork();
  try {
    const manifest=[...records.values()].map(r=>r.meta).sort((a,b)=>a.url.localeCompare(b.url,'en')||JSON.stringify(a.request||{}).localeCompare(JSON.stringify(b.request||{}),'en'));
    for(const {meta,file} of records.values()){const name=path.join(temporary,digest(key(meta)));await symlink(file,name+'.body');await writeFile(name+'.json',JSON.stringify(meta));}
    const cache=new InputCache(temporary,{cap:0,fetchMissing:false});await cache.seal(manifest);
    const calls=[],get=cache.get.bind(cache);cache.get=async(url,options={})=>{calls.push({url,request:options.accept?{accept:options.accept,...(options.language?{language:options.language}:{})}:null});return get(url,options);};
    const runtime=await replayRuntime(root),rows=[];
    const replay=sourceReplay(cache,runtime);
    for(const edition of snapshot.editions) {
      const language=edition.language,report=(await replay.request('/plenary-documents/'+DOCUMENT)).payload.data[0];
      let list=runtime.array(report.inverse_foresees_change_of).find(v=>String(v.id||v).replace(/^https?:\/\/data.europarl.europa.eu\//u,'')==='eli/dl/doc/'+LIST);
      insist(list,'Missing exact published amendment-list relationship.');
      if(typeof list!=='object'||!Object.hasOwn(list,'is_realized_by'))list=(await cache.json('https://data.europarl.europa.eu/api/v2/documents/'+LIST+'?format=application%2Fld%2Bjson')).value?.data?.[0];
      const canonical=v=>String(v?.id||v).replace(/^https?:\/\/data.europarl.europa.eu\//u,'');
      insist(canonical(list?.id)==='eli/dl/doc/'+LIST&&canonical(list.work_type)==='def/ep-document-types/AMENDMENT_LIST'&&runtime.array(list.foresees_change_of).some(v=>canonical(v)==='eli/dl/doc/'+DOCUMENT),'Wrong published amendment-list identity/owner.');
      const files=runtime.documentFiles(list).filter(f=>f.language===language&&f.format==='DOCX');
      insist(files.length===1&&runtime.allowedDownload(files[0].url),'Unavailable or competing same-language amendment DOCX.');
      const input=await cache.get(files[0].url);insist(input.ok&&input.sha256===edition.word.sha256,'Selected amendment source differs from native evidence.');
      const extraction=runtime.extractAmendments(input.body,{listId:LIST,targetDocumentId:DOCUMENT,language,sourceUrl:files[0].url,fetchedAt:input.fetchedAt});
      insist(JSON.stringify(extraction.amendments.map(a=>a.number))===JSON.stringify([1,2,3,4,5,6,7,8]),'Missing/changed extracted amendment identities.');
      for(const chosen of extraction.amendments) {
        insist(!runtime.amendmentTextLosses(extraction,chosen).length,'Amendment wording incomplete.');
        insist(chosen.baseline==='council-position'&&chosen.baselineSource?.category==='council-position'&&chosen.baselineSource.conflicted===false,'Extracted comparison does not select the Council runtime provider.');
        const assertion=native.editions.find(e=>e.language===language).rows.find(r=>r.number===chosen.number);
        insist(normal(chosen.originalText)===assertion.word.original&&normal(chosen.proposedText)===assertion.word.proposed&&chosen.targetLabel===assertion.word.Article,'Extracted complete wording/target differs from native Word.');
        const source=await replay.council({reportId:DOCUMENT,language,documentReferences:chosen.documentReferences});cache.assertHealthy();
        const bound=edition.binding,item=source.baseline.items?.[0];
        insist(source.baseline.workId===bound.workId&&source.baseline.celex==='52026AG0006(01)'&&source.baseline.language===language&&source.items.length===1&&item?.itemId===bound.items[0].itemId&&item.expressionId===bound.items[0].expressionId&&item.manifestationId===bound.items[0].manifestationId&&item.source.sha256===edition.xhtml.sha256&&item.source.language===bound.items[0].languageUri&&item.source.url===bound.items[0].itemId.replace(/^http:/u,'https:'),'Runtime selected another Council identity/language/source.');
        const placement=runtime.documentContextPlacement({chosen:{...chosen,targetLabelLanguage:language},items:source.items,baseline:source.baseline,resolutionDocument:true});
        const assessment=assessPlacement(placement,assertion,source.items[0].proposal);
        rows.push({key:assertion.key,number:chosen.number,language,identity:{documentId:DOCUMENT,listId:LIST,number:chosen.number,language,wording:{url:files[0].url,resolvedSourceUrl:input.resolvedSourceUrl||input.url,sha256:input.sha256,fetchedAt:input.fetchedAt},council:{workId:source.baseline.workId,celex:source.baseline.celex,itemId:item.itemId,expressionId:item.expressionId,manifestationId:item.manifestationId,source:item.source}},expectedAssertionSha256:digest(JSON.stringify(assertion)),nativeState:assertion.state,nativeAssertionStatus:assertion.state==='typed-note-equivalence-held'?'unsupported':'verified',wording:{parserVersion:runtime.AMENDMENT_EXTRACTION_VERSION,status:'complete',baseline:chosen.baseline,targetLabel:chosen.targetLabel,originalSha256:digest(chosen.originalText),proposedSha256:digest(chosen.proposedText)},placement,...assessment,baseline:{status:source.baseline.status,gaps:source.baseline.gaps,evidence:source.baseline.evidence,projection:{parserVersion:source.items[0].proposal.parserVersion,sourceHash:source.items[0].proposal.sourceHash,complete:source.items[0].proposal.complete,gaps:source.items[0].proposal.gaps}}});
      }
    }
    cache.assertHealthy();insist(rows.length===40&&new Set(rows.map(r=>r.key)).size===40,'Controlled observation set differs.');
    insist(JSON.stringify(runtimeIdentity)===JSON.stringify(await identity(root))&&JSON.stringify(harness)===JSON.stringify(await harnessIdentity()),'Runtime or harness changed during replay.');
    const canonicalOracleFiles=['amendment-language-oracle.mjs','amendment-language-raw.py','amendment-language-vocabulary.mjs','amendment-benchmark-operation-oracle.mjs','amendment-benchmark-scope-oracle.mjs','fixtures/amendment-language-scope-oracle.json','amendment-oracle-grammar.mjs','amendment-benchmark-proposal-oracle.mjs'];
    const canonicalOracleFingerprint=digest(Buffer.concat(await Promise.all(canonicalOracleFiles.map(f=>readFile(path.join(root,'scripts',f))))));
    const counts=Object.fromEntries(['legal-correct','placed-unverified','withheld','false-placement'].map(status=>[status,rows.filter(r=>r.outcome===status).length]));
    const result={schemaVersion:1,scope:'additive-controlled-council-languages',snapshotSha256,expectedAssertionsSha256:snapshot.expected.sha256,canonicalOracleFingerprint,oracleFingerprint:digest(await readFile(new URL('amendment-council-language-native.py',import.meta.url))),harness,runtime:runtimeIdentity,acquisition:{requests:cache.requests,requestCap:0},observations:40,newLanguageObservations:32,retainedEnglishControls:8,distinctAmendments:8,noChangeOutcomes:0,nativeAssertions:{verified:rows.filter(r=>r.nativeAssertionStatus==='verified').length,unsupported:rows.filter(r=>r.nativeAssertionStatus==='unsupported').length},counts,rows,requests:calls};
    if(opts.baseline)result.comparison=compare(result,await json(opts.baseline));
    const file=path.join(output,'council-languages-'+runtimeIdentity.head+'-'+snapshotSha256.slice(0,12)+'.json');await writeFile(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    process.stdout.write(JSON.stringify({file,head:runtimeIdentity.head,counts,comparison:result.comparison,acquisition:result.acquisition})+'\n');
    if(counts['false-placement']||rows.some(r=>r.gateFailure)||result.comparison?.failed)process.exitCode=1;
    return result;
  } finally {restoreNetwork();await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
