#!/usr/bin/env node
// Replays real document-context reads from a frozen benchmark snapshot and checks
// that the off-thread parser and the disk cache return byte-identical replies to
// the inline parser. It reads the snapshot's cached sources only: every request
// outside them fails the same way on both paths, and nothing is fetched.
//
//   node scripts/document-context-equivalence.mjs --snapshot DIR --documents A-10-2026-0039,A-10-2026-0105 \
//     [--queries-per-document 3] [--work-dir NEW_DIR]
//
// Per query it compares the JSON of: the inline reply; a cold off-thread read
// (empty parse cache); a second read with a new DocumentContext over the same
// parser; and a read with a new parser instance over the same cache directory.
// Warm reads must not reach the parse thread.
import {readFile,mkdtemp,mkdir,rm,symlink,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {InputCache} from './amendment-benchmark-cache.mjs';
import {replayRuntime,replaySourceClients,sourceReplay} from './amendment-benchmark-replay.mjs';
import {OffThreadDocumentParser} from '../server/document-parse.mjs';
import {createParseThread} from '../server/amendment-extraction-thread.mjs';
import {documentContextQuery} from '../server/document-context.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
function options(args) {
  const result={queries:3};
  for(let i=0;i<args.length;i++) {
    const flag=args[i],value=args[++i];
    if(flag==='--snapshot')result.snapshot=value;
    else if(flag==='--documents')result.documents=value.split(',').filter(Boolean);
    else if(flag==='--queries-per-document')result.queries=Number(value);
    else if(flag==='--work-dir')result.workDir=value;
    else throw new Error('Unknown option: '+flag);
  }
  if(!result.snapshot||!result.documents?.length||!Number.isSafeInteger(result.queries)||result.queries<1)throw new Error('Require --snapshot, --documents and a positive --queries-per-document.');
  return result;
}

// The context queries a snapshot captured for a document, in capture order.
export function capturedQueries(snapshot,documentId,limit) {
  const found=[];
  for(const entry of snapshot.manifest) {
    const url=new URL(entry.url);
    if(!url.pathname.startsWith('/api/document-context/')||url.pathname.split('/').at(-1)!==documentId)continue;
    const key=url.searchParams.toString();
    if(!found.some(item=>item.key===key))found.push({key,params:url.searchParams});
    if(found.length>=limit)break;
  }
  return found;
}

async function main() {
  const opts=options(process.argv.slice(2));
  const snapshot=JSON.parse(await readFile(path.join(opts.snapshot,'snapshot.json'),'utf8'));
  const runtime=await replayRuntime(root);
  const workDir=opts.workDir??await mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'context-equivalence-'));
  await mkdir(workDir,{recursive:true});
  // The cache is read through a private directory that links the snapshot inputs.
  const inputs=path.join(workDir,'inputs');
  await symlink(path.join(opts.snapshot,'inputs'),inputs,'dir').catch(error=>{if(error.code!=='EEXIST')throw error;});
  const cache=new InputCache(inputs,{apiBase:snapshot.apiBase,cap:0,fetchMissing:false});
  // Each read gets its own source clients: their caches and clocks carry state
  // from one read to the next, which would otherwise show up as a difference.
  const context=parser=>{
    const {request}=sourceReplay(cache,runtime),{documents}=replaySourceClients(cache,runtime);
    let sourceTime=0;
    const download=async url=>{
      const input=await cache.get(url);
      if(!input.ok)throw new Error('acquisition-unavailable');
      sourceTime=Date.parse(input.fetchedAt);
      return {buffer:input.body,resolvedSourceUrl:input.resolvedSourceUrl||url,fetchedAt:input.fetchedAt,freshnessAssessed:false};
    };
    const readText=(work,language)=>runtime.documentText(work,language,{directory:null,enqueue:false,clock:()=>sourceTime,download:async url=>({...runtime.docxContent((await download(url)).buffer),resolvedSourceUrl:url})});
    return new runtime.DocumentContext({request,download,readText,readProposal:runtime.createProposalBaseline({documents,request}),
      readCouncil:runtime.createCouncilPositionBaseline?.({documents,request}),readExistingLaw:runtime.createExistingLawBaseline?.({documents}),
      findAmendment:()=>null,clock:()=>Date.parse(snapshot.sample.asOf+'T12:00:00Z'),...(parser?{parser}:{})});
  };

  const thread=createParseThread({idleMs:1000,timeoutMs:300_000,maxHeapMiB:384});
  const counted=thread=>{const spy={jobs:0,tasks:{},run:(task,...args)=>{spy.jobs++;spy.tasks[task]=(spy.tasks[task]??0)+1;return thread.run(task,...args);}};return spy;};
  const results=[];
  let failures=0;
  for(const documentId of opts.documents) {
    const queries=capturedQueries(snapshot,documentId,opts.queries);
    if(!queries.length){results.push({documentId,status:'no captured context query in the snapshot'});failures++;continue;}
    for(const {key,params} of queries) {
      const query=documentContextQuery(documentId,params);
      const read=async parser=>{
        const started=process.hrtime.bigint();
        let reply;
        try {reply=JSON.stringify(await context(parser).query(query,{store:null}));}
        catch(error) {reply='error:'+(error.code||error.name)+':'+error.message;}
        return {reply,ms:Number(process.hrtime.bigint()-started)/1e6};
      };
      const cacheDir=path.join(workDir,'parse-'+createHash('sha256').update(documentId+key).digest('hex').slice(0,12));
      await rm(cacheDir,{recursive:true,force:true});
      const spy=counted(thread),parser=()=>new OffThreadDocumentParser({thread:spy,directory:()=>cacheDir});
      const inline=await read(undefined);
      const first=parser(),cold=await read(first);
      const coldJobs=spy.jobs;
      const warmSame=await read(first);
      await settle(first);
      const warmFresh=await read(parser());
      const parsed=inline.reply.startsWith('error:')?null:JSON.parse(inline.reply);
      const row={documentId,query:key,replyBytes:Buffer.byteLength(inline.reply),baseline:parsed?.baseline?{kind:parsed.baseline.kind,status:parsed.baseline.status,gaps:parsed.baseline.gaps,items:parsed.baseline.items?.length}:null,
        proposalItems:parsed?.proposal?.items?.length??0,placement:parsed?.placement?.status??null,amendmentVariants:parsed?.amendment?.variants?.length??0,parseTasksCold:{...spy.tasks},parseJobsCold:coldJobs,parseJobsAfterWarm:spy.jobs-coldJobs,
        cold:cold.reply===inline.reply,warmSameParser:warmSame.reply===inline.reply,warmNewParserSameDirectory:warmFresh.reply===inline.reply,
        inlineMs:Math.round(inline.ms),coldMs:Math.round(cold.ms),warmMs:Math.round(warmFresh.ms),sha256:createHash('sha256').update(inline.reply).digest('hex').slice(0,16)};
      // Two inline reads must agree before a difference is blamed on the parse thread.
      if(!row.cold)row.inlineRepeatable=(await read(undefined)).reply===inline.reply;
      if(!row.cold)row.firstDifference=firstDifference(JSON.parse(inline.reply),JSON.parse(cold.reply));
      row.ok=row.cold&&row.warmSameParser&&row.warmNewParserSameDirectory&&row.parseJobsAfterWarm===0;
      if(!row.ok)failures++;
      results.push(row);
      process.stderr.write(`${row.ok?'ok  ':'FAIL'} ${documentId} ${key} jobs ${coldJobs}/${row.parseJobsAfterWarm}\n`);
    }
  }
  thread.close();
  if(!opts.workDir)await rm(workDir,{recursive:true,force:true});
  process.stdout.write(JSON.stringify({snapshot:opts.snapshot,failures,results},null,1)+'\n');
  process.exitCode=failures?1:0;
}
// The first JSON path at which two replies differ, for a failure report.
export function firstDifference(a,b,at='$') {
  if(JSON.stringify(a)===JSON.stringify(b))return null;
  if(a&&b&&typeof a==='object'&&typeof b==='object') {
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {
      const found=firstDifference(a[key],b[key],at+'.'+key);
      if(found)return found;
    }
  }
  return {path:at,inline:JSON.stringify(a)?.slice(0,160),offThread:JSON.stringify(b)?.slice(0,160)};
}
// A stored parse is published after its reader has the result.
async function settle(parser) {while(parser.inflight.size)await new Promise(resolve=>setTimeout(resolve,5));}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
