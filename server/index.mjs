import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {apiPrefixes,config} from './config.mjs';
import {assertSameOrigin,HttpError,sendError,sendJson,setCommonSecurityHeaders} from './http-utils.mjs';
import {serveStatic} from './static-files.mjs';
import {odpDirectory,odpProfile,odpSpeeches,odpSpeech,odpLanguage,odpPortrait} from './odp.mjs';
import {questionStatuses} from './question-status.mjs';
import {recentActivities,activityDocument} from './activities.mjs';
import {motionComparison} from './motion-comparison.mjs';
import {activityIndex,activityIndexStatus,latestActivities,startActivityIndex} from './activity-index-worker.mjs';
import {createInsights} from './insights.mjs';
import {CATEGORIES} from './activity-index-model.mjs';
import {speechMedia} from './mmc.mjs';
import {outsideDirectory,outsideSpeaker,outsideQuery} from './outside-store.mjs';
import {corpusSearch,corpusStatus,corpusText,corpusSearchOptions,startCorpus} from './corpus-worker.mjs';
import {CORPUS_LIMITS,corpusQuery} from './corpus-store.mjs';

import {SpeechInterventions,INTERVENTION_LIMITS} from './speech-intervention-service.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext,procedureContextQuery,REFERENCE_SUMMARY_ORDER} from './procedure-context.mjs';
import {LegalReferences,referencesQuery} from './legal-references.mjs';
const interventions=new SpeechInterventions();
let stopIndex=()=>{};let stopCorpus=()=>{};let insightService;
// One owner per official-source cache directory, shared by insights and reading-time references.
let officialContext;
function official() {
  if(!officialContext){const sources=new OfficialContextSources(),catalog=new EurovocCatalog(sources);officialContext={sources,catalog,procedures:new ProcedureContext(sources,catalog),references:new LegalReferences(sources)};}
  return officialContext;
}
function positiveId(value) {
  const raw = String(value || "");
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new HttpError(400, "invalid_id", "id must be a positive integer");
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    throw new HttpError(400, "invalid_id", "id must be a positive integer");
  }
  return id;
}

function routeSegments(pathname, apiPrefix) {
  const relative = pathname.slice(apiPrefix.length);
  try {
    return relative
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "invalid_path", "The request path is invalid");
  }
}

function requireMethod(request, allowed) {
  if (!allowed.includes(request.method)) {
    throw new HttpError(405, "method_not_allowed", `Use ${allowed.join(" or ")} for this endpoint`);
  }
}

function requireQuery(searchParams,allowed) {
  if([...searchParams.keys()].some(key=>!allowed.includes(key)||searchParams.getAll(key).length!==1))
    throw new HttpError(400,'invalid_query','Unsupported or repeated query parameter.');
}

async function corpusSearchBody(request) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers['content-type']||'')))throw new HttpError(415,'invalid_content_type','Use application/json for corpus search.');
  const length=request.headers['content-length'];
  if(length!==undefined && (!/^\d+$/.test(length)||Number(length)>CORPUS_LIMITS.requestBytes))throw new HttpError(413,'request_too_large','The search request exceeds 128 KiB.');
  return await new Promise((resolve,reject)=>{
    const chunks=[];let bytes=0,failed=false;
    request.on('data',chunk=>{
      if(failed)return;
      bytes+=chunk.length;
      if(bytes>CORPUS_LIMITS.requestBytes){failed=true;reject(new HttpError(413,'request_too_large','The search request exceeds 128 KiB.'));return;}
      chunks.push(chunk);
    });
    request.once('error',reject);
    request.once('end',()=>{
      if(failed)return;
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{reject(new HttpError(400,'invalid_json','The search body must be valid JSON.'));}
    });
  });
}

async function handleApi(request,response,url,apiPrefix){
 assertSameOrigin(request);
 const segments=routeSegments(url.pathname,apiPrefix),endpoint=segments[0]||'';
 const isCorpusSearch=segments.length===3&&segments[0]==='poc'&&segments[1]==='corpus'&&segments[2]==='search';
 if(request.method==='OPTIONS'){setCommonSecurityHeaders(response);response.statusCode=204;response.setHeader('Allow',isCorpusSearch?'GET, HEAD, POST, OPTIONS':'GET, HEAD, OPTIONS');response.setHeader('Cache-Control','no-store');response.setHeader('Vary','Origin');response.end();return;}
 requireMethod(request,isCorpusSearch?['GET','HEAD','POST']:['GET','HEAD']);
 if(!endpoint||endpoint==='healthz'&&segments.length===1){requireQuery(url.searchParams,[]);sendJson(request,response,200,{ok:true,service:'parliament-explorer',apiVersion:1,...(!endpoint?{endpoints:['healthz','poc']}:{}),time:new Date().toISOString()});return;}
  if (endpoint === "poc") {
    requireMethod(request,isCorpusSearch?['GET','HEAD','POST']:["GET", "HEAD"]);
    const queryKeys={directory:['lang'],profile:['lang'],portrait:['lang'],speeches:['lang','offset'],activities:['lang'],document:['lang','member'],speech:['lang'],'motion-comparison':['lang','joint','stage']};
    if(Object.hasOwn(queryKeys,segments[1]))requireQuery(url.searchParams,queryKeys[segments[1]]);
    const language = odpLanguage(url.searchParams.get("lang") || "en");
    if (segments.length === 3 && segments[1] === "portrait") {
      const image = await odpPortrait(positiveId(segments[2]));
      setCommonSecurityHeaders(response);
      response.setHeader("Content-Type", image.contentType);
      response.setHeader("Cache-Control", "private, max-age=21600");
      response.setHeader("Content-Length", image.body.length);
      response.statusCode = 200;
      response.end(request.method === "HEAD" ? undefined : image.body);
      return;
    }
    let result;
    if(segments[1]==='motion-comparison' && segments.length===3) {
      result=await motionComparison(segments[2],url.searchParams.get('joint'),{stage:url.searchParams.get('stage') || 'original-joint',language});
    }
    else if (segments[1] === 'outside' && segments.length === 3) {
      const query=outsideQuery(url.searchParams), store=activityIndex().store;
      result=segments[2]==='directory'?outsideDirectory(store,query):outsideSpeaker(store,segments[2],query);
    }
    else if (segments.length === 3 && segments[1] === 'insights') {
      insightService ??= createInsights(activityIndex().store,{officialSources:official().sources,eurovocCatalog:official().catalog});
      result = await insightService.query(segments[2], url.searchParams);
    }
    else if (segments.length === 2 && segments[1] === 'references') result = await official().references.query(referencesQuery(url.searchParams));
    // Dossier summaries for reading references do not depend on the activity index.
    else if (segments.length === 2 && segments[1] === 'reference-summary') result = await official().procedures.query({...procedureContextQuery(url.searchParams),order:REFERENCE_SUMMARY_ORDER});
    else if (segments.length === 3 && segments[1] === 'activity-index' && segments[2] === 'status') {
      if ([...url.searchParams.keys()].some(key => key!=='lang' || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated status query parameter.');
      result = activityIndexStatus();
    }
    else if (segments.length === 3 && segments[1] === 'corpus' && segments[2] === 'status') {
      if ([...url.searchParams.keys()].some(key => key!=='lang' || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated status query parameter.');
      result = await corpusStatus();
    }
    else if (segments.length === 3 && segments[1] === 'corpus' && segments[2] === 'search') {
      const allowed = new Set(['lang','q','kind','kinds','text-lang','member','country','from','to','limit','offset','group','date-basis','sort','source-ids']);
      if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400,'invalid_query','Unsupported or repeated search query parameter.');
      if(request.method==='POST') {
        requireQuery(url.searchParams,['lang']);
        result=await corpusSearch(corpusSearchOptions({uiLanguage:language,...await corpusSearchBody(request)}));
      } else {
      const value = name => url.searchParams.get(name);
      const integer = (name,fallback,max,min=0) => {
        const text=value(name) ?? String(fallback), number=Number(text);
        if (!/^(0|[1-9]\d*)$/.test(text) || number>max || number<min) throw new HttpError(400,'invalid_query',`Invalid ${name}.`);
        return number;
      };
      result = await corpusSearch(corpusSearchOptions({query:value('q'),kind:value('kind'),kinds:value('kinds')===null?null:value('kinds').split(','),language:value('text-lang'),uiLanguage:language,
        member:value('member')===null?null:positiveId(value('member')),country:value('country'),from:value('from'),to:value('to'),group:value('group'),dateBasis:value('date-basis'),sort:value('sort'),
        sourceIds:value('source-ids')===null?null:value('source-ids')===''?[]:value('source-ids').split(','),limit:integer('limit',20,CORPUS_LIMITS.searchLimit,1),offset:integer('offset',0,CORPUS_LIMITS.searchOffset)}));
      }
    }
    else if (segments.length === 3 && segments[1] === 'corpus' && segments[2] === 'text') {
      requireQuery(url.searchParams,['lang','source-id','source-key','q']);
      const sourceId=url.searchParams.get('source-id'),sourceKey=url.searchParams.get('source-key');
      if(!/^[A-Z0-9-]{1,100}$/.test(sourceId||''))throw new HttpError(400,'invalid_source_id','Use an exact source identifier.');
      if(typeof sourceKey!=='string'||!sourceKey||sourceKey.length>200||/[\u0000-\u001f\u007f]/.test(sourceKey))throw new HttpError(400,'invalid_source_key','Use the exact source key from a corpus search result.');
      const query=url.searchParams.get('q');
      if(query!==null&&!corpusQuery(query))throw new HttpError(400,'invalid_query','Use bounded words or quoted phrases for text highlighting.');
      result=await corpusText({sourceId,sourceKey,query});
    }
    else if (segments.length === 3 && segments[1] === 'latest-activities') {
      const allowed = new Set(['lang','category','limit','offset','source-id']);
      if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400,'invalid_query','Unsupported or repeated activity query parameter.');
      const integer = (name,fallback,max) => {
        const text=url.searchParams.get(name) ?? String(fallback);
        const value=Number(text);
        if (!/^(0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(value) || value>max || name==='limit' && value<1) throw new HttpError(400,'invalid_query',`Invalid ${name}.`);
        return value;
      };
      const category=url.searchParams.get('category');
      if(category!==null && !Object.hasOwn(CATEGORIES,category))throw new HttpError(400,'invalid_category','Unknown activity category.');
      const sourceId=url.searchParams.get('source-id');
      if(sourceId!==null && !/^[A-Z0-9-]{1,100}$/.test(sourceId))throw new HttpError(400,'invalid_source_id','Invalid source identifier.');
      result=questionStatuses(activityIndex().store,latestActivities(positiveId(segments[2]),{language,category,sourceId,limit:integer('limit',10,50),offset:integer('offset',0,1000000)}));
    }
    else if (segments.length === 3 && segments[1] === 'speech-context') {
      requireQuery(url.searchParams,['lang']);
      if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/.test(segments[2]))throw new HttpError(400,'invalid_speech','Invalid speech identifier.');
      result=await interventions.context(segments[2]);
    }
    else if (segments.length === 3 && segments[1] === 'speech-statistics') {
      requireQuery(url.searchParams,['lang','page']);
      const page=url.searchParams.get('page')||'0';
      if(!/^(0|[1-9]\d?)$/.test(page)||Number(page)>=INTERVENTION_LIMITS.memberPages)throw new HttpError(400,'invalid_page','Invalid statistics page.');
      result=await interventions.member(positiveId(segments[2]),Number(page));
    }
    else if (segments.length === 3 && segments[1] === 'speech-media') {
      if (!/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/.test(segments[2])) throw new HttpError(400,'invalid_speech','Invalid speech identifier.');
      if ([...url.searchParams.keys()].some(key => !['lang','audio'].includes(key) || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated media query parameter.');
      const audio=url.searchParams.get('audio');
      if (audio!==null && audio!=='or') throw new HttpError(400,'invalid_audio','Use audio=or for explicitly selected original audio; otherwise the interface language is requested.');
      result=await speechMedia(segments[2],language,audio || language);
    }
    else if (segments.length === 2 && segments[1] === "directory") result = await odpDirectory();
    else if (segments.length === 3 && segments[1] === "profile") result = await odpProfile(positiveId(segments[2]));
    else if (segments.length === 3 && segments[1] === "activities") result = await recentActivities(positiveId(segments[2]), language);
    else if (segments.length === 3 && segments[1] === "document" && /^[A-Z0-9-]{1,100}$/.test(segments[2])) result = await activityDocument(segments[2], url.searchParams.has("member")?positiveId(url.searchParams.get("member")):null, language);
    else if (segments.length === 3 && segments[1] === "speeches") {
      const rawOffset=url.searchParams.get('offset') ?? '0';
      const offset = Number(rawOffset);
      if (!/^(0|[1-9][0-9]*)$/.test(rawOffset) || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new HttpError(400, "invalid_offset", "Invalid speech page.");
      result = await odpSpeeches(positiveId(segments[2]), language, offset);
    } else if (segments.length === 3 && segments[1] === "speech" && /^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(segments[2])) result = await odpSpeech(segments[2], language);
    else throw new HttpError(404, "not_found", "Unknown explorer endpoint.");
    sendJson(request, response, 200, result);
    return;
  }

 throw new HttpError(404,'not_found','The requested API endpoint does not exist.');
}
export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const apiPrefix = apiPrefixes.find(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    if (apiPrefix) {
      await handleApi(request, response, url, apiPrefix);
      return;
    }

    if (url.pathname === "/healthz") {
      url.pathname = `${apiPrefixes.at(-1)}/healthz`;
      await handleApi(request, response, url, apiPrefixes.at(-1));
      return;
    }

    if (await serveStatic(request, response, url)) {
      return;
    }
    throw new HttpError(404, "not_found", "The requested resource does not exist");
  } catch (error) {
    if (!response.headersSent) {
      sendError(request, response, error);
    } else if (!response.writableEnded) {
      response.destroy();
    }
  }
}

export const server = http.createServer(handleRequest);

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;

export function startServer() {
  server.listen(config.port, config.host, () => {
    console.log(`[parliament-explorer] listening on http://${config.host}:${config.port}`);
  });
}

function shutDown(signal) {
  stopIndex();
  stopCorpus();
  console.log(`[parliament-explorer] received ${signal}; shutting down`);
  const forceTimer = setTimeout(() => {
    process.exitCode = 1;
    server.closeAllConnections();
  }, 5000);
  forceTimer.unref();
  server.close((error) => {
    clearTimeout(forceTimer);
    process.exitCode = error ? 1 : 0;
  });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  server.on("error", (error) => {
    console.error(`[parliament-explorer] server error: ${error.message}`);
    process.exitCode = 1;
  });
  process.on("SIGINT", () => shutDown("SIGINT"));
  process.on("SIGTERM", () => shutDown("SIGTERM"));
  startServer();
  stopIndex = startActivityIndex();
  stopCorpus = startCorpus();
}
