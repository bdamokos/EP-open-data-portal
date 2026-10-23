import {followingDossiers} from './follow-dossiers.mjs';
import {followingResponse} from './insights-following.mjs';
import {savedPostQuery,savedStates} from './insights-saved.mjs';
import {groupVoicesQuery} from './group-voices-model.mjs';
import {groupVoicesPage} from './group-voices-store.mjs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {measureEventLoopDelay} from './event-loop-delay.mjs';
let eventLoopDelay;
import {pathToFileURL} from 'node:url';
import {apiPrefixes,config} from './config.mjs';
import {assertSameOrigin,HttpError,sendError,sendJson,setCommonSecurityHeaders} from './http-utils.mjs';
import {serveStatic} from './static-files.mjs';
import {apiCachePolicy,portraitCachePolicy} from './response-cache.mjs';
import {API_VERSION} from './api-version.mjs';
import {plenaryLive} from './plenary-live.mjs';
import {odpDirectory,odpProfileWithMemberships,odpSpeeches,odpSpeech,odpLanguage,odpPortrait,upstreamStatus} from './odp.mjs';
import {questionStatuses} from './question-status.mjs';
import {recentActivities,activityDocument} from './activities.mjs';
import {motionComparison} from './motion-comparison.mjs';
import {motionAmendmentsQuery,motionAmendmentsPage} from './motion-amendments.mjs';
import {votePeriods} from './vote-periods.mjs';
import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {documentContext,documentContextQuery} from './document-context.mjs';
import {sourceRecord} from './source-record.mjs';
import {activityIndex,activityIndexStatus,latestActivities,startActivityIndex} from './activity-index-worker.mjs';
import {createInsights} from './insights.mjs';
import { amendmentQuery } from './amendments.mjs';
import { amendmentsPage, amendmentFailures } from './amendments-store.mjs';
import {CATEGORIES} from './activity-index-model.mjs';
import {speechMedia} from './mmc.mjs';
import {outsideDirectory,outsideSpeaker,outsideQuery} from './outside-store.mjs';
import {corpusSearch,corpusStatus,corpusText,corpusSearchOptions,startCorpus} from './corpus-worker.mjs';
import {speechTranscript} from './speech-transcript.mjs';
import {CORPUS_LIMITS,corpusQuery} from './corpus-store.mjs';
import {createRequestBudget,runWithRequestSignal,waitForRequest,cancelledRequest,requestSignal} from './request-budget.mjs';

import {SpeechInterventions,INTERVENTION_LIMITS} from './speech-intervention-service.mjs';
import {OfficialContextSources} from './official-context.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext,procedureContextQuery,REFERENCE_SUMMARY_ORDER} from './procedure-context.mjs';
import {LegalReferences,referencesQuery} from './legal-references.mjs';
import {ProcedureProgress,procedureProgressQuery} from './procedure-progress.mjs';
import {PressMentions,pressMentionsQuery} from './press-releases.mjs';
const interventions=new SpeechInterventions();
let stopIndex=()=>{};let stopCorpus=()=>{};let insightService,pressMentions;
// One owner per official-source cache directory, shared by insights and reading-time references.
let officialContext;
function official() {
  if(!officialContext){const sources=new OfficialContextSources(),catalog=new EurovocCatalog(sources);officialContext={sources,catalog,procedures:new ProcedureContext(sources,catalog),progress:new ProcedureProgress(sources),references:new LegalReferences(sources)};}
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

async function jsonRequestBody(request,{limit=CORPUS_LIMITS.requestBytes,subject='search',size='128 KiB'}={}) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers['content-type']||'')))throw new HttpError(415,'invalid_content_type','Use application/json for this request.');
  const length=request.headers['content-length'];
  if(length!==undefined && (!/^\d+$/.test(length)||Number(length)>limit))throw new HttpError(413,'request_too_large',`The ${subject} request exceeds ${size}.`);
  const signal=requestSignal();signal?.throwIfAborted();
  let cleanup;
  const body=new Promise((resolve,reject)=>{
    const chunks=[];let bytes=0;
    const onData=chunk=>{
      bytes+=chunk.length;
      if(bytes>limit){reject(new HttpError(413,'request_too_large',`The ${subject} request exceeds ${size}.`));return;}
      chunks.push(chunk);
    };
    const onEnd=()=>{
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{reject(new HttpError(400,'invalid_json',`The ${subject} body must be valid JSON.`));}
    };
    cleanup=()=>{request.removeListener('data',onData);request.removeListener('error',reject);request.removeListener('end',onEnd);};
    request.on('data',onData);request.once('error',reject);request.once('end',onEnd);
  });
  try{return await waitForRequest(body,signal);}
  finally{cleanup();}
}

// Browser transport for this app. The gateway admits the same finite route set.
const apiEndpoints=new Set(['healthz','directory','profile','portrait','speeches','activities','document','document-context','speech','speech-transcript','activity-index','latest-activities','insights','outside','references','reference-summary','amendments','motion-comparison','motion-amendments','member-votes','vote-periods','source-record','corpus','speech-statistics','speech-media','speech-context','plenary-live']);

async function handleApi(request,response,url,apiPrefix){
 assertSameOrigin(request);
 const versions=url.searchParams.getAll('v');
 if(versions.length>1 || versions.length===1 && (!/^[1-9][0-9]*$/.test(versions[0]) || !Number.isSafeInteger(Number(versions[0]))))
   throw new HttpError(400,'invalid_api_version','v must be a single positive integer.');
 const currentVersion=versions[0]===String(API_VERSION);
 url.searchParams.delete('v');
 if(versions.length && !currentVersion){
   sendJson(request,response,409,{error:{code:'api_version_mismatch',message:'A new version of the explorer is available.',apiVersion:API_VERSION}});
   return;
 }
 const segments=routeSegments(url.pathname,apiPrefix);
 const endpoint=segments[0]||'';
 if(endpoint&&!apiEndpoints.has(endpoint))throw new HttpError(404,'not_found','The requested API endpoint does not exist.');
 const isSavedPost=segments.length===2&&endpoint==='insights'&&segments[1]==='saved';
 const allowsPost=isSavedPost||segments.length===2&&endpoint==='corpus'&&segments[1]==='search';
 if(request.method==='OPTIONS'){setCommonSecurityHeaders(response);response.statusCode=204;response.setHeader('Allow',allowsPost?'GET, HEAD, POST, OPTIONS':'GET, HEAD, OPTIONS');response.setHeader('Cache-Control','no-store');response.setHeader('CDN-Cache-Control','no-store');response.setHeader('Vary','Origin');response.end();return;}
 requireMethod(request,allowsPost?['GET','HEAD','POST']:['GET','HEAD']);
 if(!endpoint||endpoint==='healthz'&&segments.length===1){requireQuery(url.searchParams,[]);sendJson(request,response,200,{ok:true,service:'parliament-explorer',apiVersion:API_VERSION,...(!endpoint?{endpoints:[...apiEndpoints]}:{}),time:new Date().toISOString()});return;}
 if(endpoint==='plenary-live'&&segments.length===1){requireQuery(url.searchParams,[]);sendJson(request,response,200,await plenaryLive.snapshot());return;}
    const queryKeys={directory:['lang','retry'],profile:['lang'],portrait:['lang'],speeches:['lang','offset'],activities:['lang'],document:['lang','member'],speech:['lang'],'speech-transcript':['lang'],'source-record':['lang','url'],'motion-comparison':['lang','joint','stage']};
    if(Object.hasOwn(queryKeys,segments[0]))requireQuery(url.searchParams,queryKeys[segments[0]]);
    const language = odpLanguage(url.searchParams.get("lang") || "en");
    if (segments.length === 2 && segments[0] === "portrait") {
      const image = await odpPortrait(positiveId(segments[1]));
      setCommonSecurityHeaders(response);
      const policy = request.headers.authorization ? {cacheControl: 'no-store', cdnCacheControl: 'no-store'} : portraitCachePolicy(image);
      const etag = `"${createHash('sha256').update(image.body).digest('base64url')}"`;
      response.setHeader("Content-Type", image.contentType);
      response.setHeader("Cache-Control", policy.cacheControl);
      response.setHeader("CDN-Cache-Control", currentVersion ? policy.cdnCacheControl : 'no-store');
      response.setHeader("Vary", "Origin");
      response.setHeader("ETag", etag);
      if (request.headers['if-none-match'] === etag) {
        response.statusCode = 304;
        response.removeHeader('Content-Type');
        response.end();
        return;
      }
      response.setHeader("Content-Length", image.body.length);
      response.statusCode = 200;
      response.end(request.method === "HEAD" ? undefined : image.body);
      return;
    }
    let result;
    if(segments[0]==='source-record' && segments.length===1)result=await sourceRecord(url.searchParams.get('url'),language);
    else if(segments[0]==='motion-comparison' && segments.length===2) {
      result=await motionComparison(segments[1],url.searchParams.get('joint'),{stage:url.searchParams.get('stage') || 'original-joint',language});
    }
    else if(segments[0]==='motion-amendments' && segments.length===2) {
      const query=motionAmendmentsQuery(segments[1],url.searchParams);
      result=motionAmendmentsPage(activityIndex().store,query);
    }
    else if (segments[0] === 'vote-periods' && segments.length===1) {
      result=await votePeriods.query(url.searchParams);
    }
    else if (segments[0] === 'member-votes' && segments.length===2) {
      result=await memberVotes.query(positiveId(segments[1]),memberVotesQuery(url.searchParams));
    }
    else if(segments[0]==='document-context'&&segments.length===2) {
      result=await documentContext.query(documentContextQuery(segments[1],url.searchParams),{store:process.env.ACTIVITY_INDEX_ENABLED==='true'?activityIndex().store:null});
    }
    else if (segments[0] === 'amendments' && (segments.length===1 || segments.length===2&&segments[1]==='failures')) {
      const failures=segments.length===2,query=amendmentQuery(url.searchParams,{failures});
      result=failures?amendmentFailures(activityIndex().store,query):amendmentsPage(activityIndex().store,query);
    }
    else if (segments[0] === 'outside' && segments.length === 2) {
      const query=outsideQuery(url.searchParams), store=activityIndex().store;
      result=segments[1]==='directory'?outsideDirectory(store,query):outsideSpeaker(store,segments[1],query);
    }
    else if (segments.length === 2 && segments[0] === 'insights' && segments[1] === 'procedure-progress') {
      result=await official().progress.query(procedureProgressQuery(url.searchParams));
    }
    else if (segments.length === 2 && segments[0] === 'insights' && segments[1] === 'press-releases') {
      const query=pressMentionsQuery(url.searchParams);
      pressMentions??=new PressMentions(activityIndex().press,official().sources);
      result=await pressMentions.query(query);
    }
    else if (segments.length === 2 && segments[0] === 'insights' && segments[1] === 'group-voices') {
      result=groupVoicesPage(activityIndex().store,groupVoicesQuery(url.searchParams));
    }
    else if (segments.length===2 && segments[0]==='insights' && segments[1]==='following-dossiers') {
      result=followingDossiers(activityIndex().store,url.searchParams);
      const cacheControl=request.headers.authorization?'no-store':'public, max-age=3600';
      sendJson(request,response,200,result,{cacheControl,cdnCacheControl:currentVersion?cacheControl:'no-store'});
      return;
    }
    else if (segments.length === 2 && segments[0] === 'insights' && ['following-status','following-manifest','following-member','following-membership','following-groups','group-history'].includes(segments[1])) {
      const reply=followingResponse(activityIndex().store,segments[1],url.searchParams);
      const cacheControl=request.headers.authorization?'no-store':reply.cacheControl||'no-store';
      sendJson(request,response,reply.status,reply.body,{cacheControl,cdnCacheControl:currentVersion?cacheControl:'no-store'});
      return;
    }
    else if (isSavedPost && request.method==='POST') {
      requireQuery(url.searchParams,['lang']);
      const body=await jsonRequestBody(request,{limit:8192,subject:'saved questions',size:'8 KiB'});
      requestSignal()?.throwIfAborted();
      result=savedStates(activityIndex().store,savedPostQuery(url.searchParams,body));
    }
    else if (segments.length === 2 && segments[0] === 'insights') {
      insightService ??= createInsights(activityIndex().store,{officialSources:official().sources,eurovocCatalog:official().catalog});
      result = await insightService.query(segments[1], url.searchParams);
    }
    else if (segments.length === 1 && segments[0] === 'references') result = await official().references.query(referencesQuery(url.searchParams));
    // Dossier summaries for reading references do not depend on the activity index.
    else if (segments.length === 1 && segments[0] === 'reference-summary') result = await official().procedures.query({...procedureContextQuery(url.searchParams),order:REFERENCE_SUMMARY_ORDER});
    else if (segments.length === 2 && segments[0] === 'activity-index' && segments[1] === 'status') {
      if ([...url.searchParams.keys()].some(key => key!=='lang' || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated status query parameter.');
      result = activityIndexStatus();
    }
    else if (segments.length === 2 && segments[0] === 'corpus' && segments[1] === 'status') {
      if ([...url.searchParams.keys()].some(key => key!=='lang' || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated status query parameter.');
      result = await corpusStatus();
    }
    else if (segments.length === 2 && segments[0] === 'corpus' && segments[1] === 'search') {
      const allowed = new Set(['lang','q','kind','kinds','text-lang','member','country','addressee','from','to','limit','offset','group','date-basis','sort','source-ids']);
      if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400,'invalid_query','Unsupported or repeated search query parameter.');
      if(request.method==='POST') {
        requireQuery(url.searchParams,['lang']);
        const body=await jsonRequestBody(request);
        requestSignal()?.throwIfAborted();
        result=await corpusSearch(corpusSearchOptions({uiLanguage:language,...body}));
      } else {
      const value = name => url.searchParams.get(name);
      const integer = (name,fallback,max,min=0) => {
        const text=value(name) ?? String(fallback), number=Number(text);
        if (!/^(0|[1-9]\d*)$/.test(text) || number>max || number<min) throw new HttpError(400,'invalid_query',`Invalid ${name}.`);
        return number;
      };
      result = await corpusSearch(corpusSearchOptions({query:value('q'),kind:value('kind'),kinds:value('kinds')===null?null:value('kinds').split(','),language:value('text-lang'),uiLanguage:language,
        member:value('member')===null?null:positiveId(value('member')),country:value('country'),addressee:value('addressee'),from:value('from'),to:value('to'),group:value('group'),dateBasis:value('date-basis'),sort:value('sort'),
        sourceIds:value('source-ids')===null?null:value('source-ids')===''?[]:value('source-ids').split(','),limit:integer('limit',20,CORPUS_LIMITS.searchLimit,1),offset:integer('offset',0,CORPUS_LIMITS.searchOffset)}));
      }
    }
    else if (segments.length === 2 && segments[0] === 'corpus' && segments[1] === 'text') {
      requireQuery(url.searchParams,['lang','source-id','source-key','q']);
      const sourceId=url.searchParams.get('source-id'),sourceKey=url.searchParams.get('source-key');
      if(!/^[A-Z0-9-]{1,100}$/.test(sourceId||''))throw new HttpError(400,'invalid_source_id','Use an exact source identifier.');
      if(typeof sourceKey!=='string'||!sourceKey||sourceKey.length>200||/[\u0000-\u001f\u007f]/.test(sourceKey))throw new HttpError(400,'invalid_source_key','Use the exact source key from a corpus search result.');
      const query=url.searchParams.get('q');
      if(query!==null&&!corpusQuery(query))throw new HttpError(400,'invalid_query','Use bounded words or quoted phrases for text highlighting.');
      result=await corpusText({sourceId,sourceKey,query});
    }
    else if (segments.length === 2 && segments[0] === 'latest-activities') {
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
      result=questionStatuses(activityIndex().store,latestActivities(positiveId(segments[1]),{language,category,sourceId,limit:integer('limit',10,50),offset:integer('offset',0,1000000)}));
    }
    else if (segments.length === 2 && segments[0] === 'speech-context') {
      requireQuery(url.searchParams,['lang']);
      if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/.test(segments[1]))throw new HttpError(400,'invalid_speech','Invalid speech identifier.');
      result=await interventions.context(segments[1]);
    }
    else if (segments.length === 2 && segments[0] === 'speech-statistics') {
      requireQuery(url.searchParams,['lang','page']);
      const page=url.searchParams.get('page')||'0';
      if(!/^(0|[1-9]\d?)$/.test(page)||Number(page)>=INTERVENTION_LIMITS.memberPages)throw new HttpError(400,'invalid_page','Invalid statistics page.');
      result=await interventions.member(positiveId(segments[1]),Number(page));
    }
    else if (segments.length === 2 && segments[0] === 'speech-media') {
      if (!/^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}$/.test(segments[1])) throw new HttpError(400,'invalid_speech','Invalid speech identifier.');
      if ([...url.searchParams.keys()].some(key => !['lang','audio'].includes(key) || url.searchParams.getAll(key).length!==1)) throw new HttpError(400,'invalid_query','Unsupported or repeated media query parameter.');
      const audio=url.searchParams.get('audio');
      if (audio!==null && audio!=='or') throw new HttpError(400,'invalid_audio','Use audio=or for explicitly selected original audio; otherwise the interface language is requested.');
      result=await speechMedia(segments[1],language,audio || language);
    }
    else if (segments.length === 1 && segments[0] === "directory") {
      const retry=url.searchParams.get('retry');
      if (retry!==null && retry!=='committee-details') throw new HttpError(400,'invalid_retry','Unsupported directory retry.');
      result = await odpDirectory({retryCommitteeDetails:retry==='committee-details'});
    }
    else if (segments.length === 2 && segments[0] === "profile") result = await odpProfileWithMemberships(positiveId(segments[1]));
    else if (segments.length === 2 && segments[0] === "activities") result = await recentActivities(positiveId(segments[1]), language);
    else if (segments.length === 2 && segments[0] === "document" && /^[A-Z0-9-]{1,100}$/.test(segments[1])) result = await activityDocument(segments[1], url.searchParams.has("member")?positiveId(url.searchParams.get("member")):null, language);
    else if (segments.length === 2 && segments[0] === "speeches") {
      const rawOffset=url.searchParams.get('offset') ?? '0';
      const offset = Number(rawOffset);
      if (!/^(0|[1-9][0-9]*)$/.test(rawOffset) || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new HttpError(400, "invalid_offset", "Invalid speech page.");
      result = await odpSpeeches(positiveId(segments[1]), language, offset);
    } else if (segments.length === 2 && segments[0] === "speech-transcript" && /^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(segments[1])) result = await speechTranscript(segments[1], language);
    else if (segments.length === 2 && segments[0] === "speech" && /^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(segments[1])) result = await odpSpeech(segments[1], language);
    else throw new HttpError(404, "not_found", "Unknown explorer endpoint.");
    const policy=apiCachePolicy(request, url, result);
    sendJson(request, response, 200, result, {...policy,...(!currentVersion?{cdnCacheControl:'no-store'}:{})});
    return;
}
export async function handleRequest(request, response) {
  const started=performance.now(),eventLoop=performance.eventLoopUtilization();let route='/';
  response.explorerStartedAt=started;
  try {
    const url = new URL(request.url || "/", "http://localhost");
    route=url.pathname;
    const apiPrefix = apiPrefixes.find(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    if (apiPrefix) {
      const extended=/^\/(?:speech-context|motion-comparison)\//.test(url.pathname.slice(apiPrefix.length));
      const budget=createRequestBudget(extended?50_000:30_000);
      const closed=()=>{if(!response.writableEnded)budget.abort(cancelledRequest());};
      response.once('close',closed);
      try {await runWithRequestSignal(budget.signal,()=>waitForRequest(handleApi(request,response,url,apiPrefix)));}
      finally {budget.dispose();response.removeListener('close',closed);}
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
    if(error.code==='request_timeout')console.warn('[request-budget]',JSON.stringify({code:error.code,route,elapsedMs:Math.round(performance.now()-started),upstream:upstreamStatus(),eventLoopDelay:eventLoopDelay?.snapshot(),eventLoopUtilization:performance.eventLoopUtilization(eventLoop).utilization}));
    if(response.destroyed||response.writableEnded)return;
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
  eventLoopDelay ??= measureEventLoopDelay();
  server.once('close',()=>{eventLoopDelay?.stop();eventLoopDelay=undefined;});
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
