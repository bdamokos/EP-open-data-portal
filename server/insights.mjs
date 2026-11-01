import path from 'node:path';
import {amendmentGeneration} from './amendments-store.mjs';
import {topicAmendmentsCacheable} from './topic-involvement.mjs';
import {SpeechWordInsights,speechWordsQuery} from './insights-speech-words.mjs';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
import {OfficialContextSources,getSharedOfficialContextSources} from './official-context.mjs';
import {EurovocCatalog} from './eurovoc.mjs';
import {ProcedureContext,procedureContextQuery} from './procedure-context.mjs';
import {ProcedureProgress,procedureProgressQuery} from './procedure-progress.mjs';
import {TopicTrends,topicTrendsQuery} from './topic-trends.mjs';
import { QuestionInsights,insightQuery,savedMetadata,brusselsDay } from './insights-store.mjs';
import { LegislationInsights,LEGISLATION_VIEW_VERSION } from './insights-legislation.mjs';
import { HttpError } from './http-utils.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {DossierActivity,dossierActivityQuery,dossierReferencesQuery} from './dossier-activity.mjs';
import {INSIGHTS_VERSION} from './insights-model.mjs';
import {savedQuery,savedStates} from './insights-saved.mjs';
import {participationQuery,participation} from './insights-participation.mjs';
import {historyCacheKey} from './history-readiness.mjs';
import {ParliamentSearch,parliamentSearchQuery} from './parliament-search.mjs';
import {odp,agendaCacheRevision,agendaCacheRevisionIsDurable} from './odp.mjs';
import {MeetingsReader} from './meetings-reader.mjs';
import {recentPlenaryWeeks} from './plenary-warmup.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';
import {agendaViewFreshMs,nextPlenaryWarmup,PLENARY_REFRESH_MS} from './plenary-cache-policy.mjs';

// Root integration supplies its already-owned store; this module never starts a worker.
export function createInsights(store,options={}) {
  const clock=options.clock||Date.now,readMetadata=options.loadMetadata||savedMetadata;
  let metadata=null,pendingMetadata=null;
  const loadMetadata=async args=>{
    const key=JSON.stringify([store.get('demographicRevision')||0,[...args.members.keys()]]);
    if(metadata?.key===key&&clock()-metadata.at<5*60_000)return metadata.value;
    if(pendingMetadata?.key===key)return pendingMetadata.promise;
    const promise=readMetadata(args).then(value=>{metadata={key,at:clock(),value};return value;});
    pendingMetadata={key,promise};try{return await promise;}finally{if(pendingMetadata?.promise===promise)pendingMetadata=null;}
  };
  const shared={...options,loadMetadata};
  const speechWords=new SpeechWordInsights(store,shared);
  const questions=new QuestionInsights(store,shared),legislation=new LegislationInsights(store,shared);
  const speechCloud=new SpeechCloudInsights(store,{...shared,legislation});
  const dossierActivity=new DossierActivity(store,{...shared,reader:legislation});
  const officialSources=options.officialSources||(options.officialContext||options.clock?new OfficialContextSources({clock,...options.officialContext}):getSharedOfficialContextSources());
  const catalog=options.eurovocCatalog||new EurovocCatalog(officialSources,{clock,...options.eurovoc});
  const procedureContext=new ProcedureContext(officialSources,catalog),topicTrends=new TopicTrends(store,catalog,{clock});
  const procedureProgress=new ProcedureProgress(officialSources);
  const views=new InsightViewCache({clock,...options.viewCache,cacheable:topicAmendmentsCacheable});
  // Keep the latest week's item responses from displacing its navigation lists.
  const details=new InsightViewCache({clock,directory:views.directory&&path.join(views.directory,'plenary-details-v1'),maxEntries:512,...options.detailCache,cacheable:topicAmendmentsCacheable});
  const search=new ParliamentSearch(store,{clock});
  const isLatest=query=>query.week==='latest'||!query.week&&!query.sitting;
  const viewKey=async(view,query,catalogue)=>{
    const version=view==='legislation'?INSIGHTS_VERSION+':'+LEGISLATION_VIEW_VERSION:INSIGHTS_VERSION;
    const generation=store.status().servingGeneration;
    // Calendar content selects "latest". Retrieval times alone do not change it.
    const selection=view==='legislation'&&isLatest(query)?catalogue.coverage.years.map(year=>[year.year,year.state,year.stopReason,year.error,year.sources.map(source=>[source.url,source.contentHash,source.stale,source.refreshInProgress,source.refreshError])]):null;
    return [version,view,generation,historyCacheKey(store,generation),store.get('availabilityRevision')||0,store.get('demographicRevision')||0,view==='legislation'?brusselsDay(clock()):null,query,...(view==='legislation'&&query.topic?[amendmentGeneration(store),store.get('amendmentMutationRevision')||0]:[]),...(selection?[selection]:[]),...(view==='legislation'?[await agendaCacheRevision()]:[])];
  };
  const cached=async(query,catalogue,reader,background=false)=>{
    const cache=query.topic?details:views,key=await viewKey('legislation',query,catalogue);
    const value=await cache.get(key,()=>reader.query(query,catalogue),{background,persist:()=>agendaCacheRevisionIsDurable(key.at(-1)),...(!query.topic&&!query.vote?{freshMs:value=>agendaViewFreshMs(value,clock())}:{})});
    return {cache,key,value};
  };
  const warmView=async(query,catalogue)=>{
    const {cache,key,value}=await cached(query,catalogue,warmReader,true);
    // Stale views return immediately to visitors; warming awaits their refresh.
    const pending=cache.pending.get(cache.key(key));
    return pending?(await waitForRequest(pending)).value:value;
  };
  let warmReader,warmCloud,warmSelection,cursor=0;
  const warmedProcedures=new Set(),warmedSpeechDates=new Set();
  return {async warmPlenary() {
    const status=store.status();
    if(!status.currentMeps||!status.servingGeneration)return 60_000;
    if(!warmReader){
      const request=(endpoint,params,settings)=> (options.request||odp)(endpoint,params,{...settings,priority:'background',cacheGroup:'plenary',signal:requestSignal()});
      warmReader=new LegislationInsights(store,{...shared,request,readSpeechMetadata:legislation.readSpeechMetadata,meetings:new MeetingsReader({request,clock})});
      warmCloud=new SpeechCloudInsights(store,{...shared,request,legislation:warmReader,readCorpusPage:speechCloud.readCorpusPage});
    }
    const catalogue=await warmReader.catalogue(),weeks=recentPlenaryWeeks(catalogue,clock()),values=[];
    // The UI defaults to English/latest. Raw source records contain all languages.
    for(const week of weeks.length?['latest',...weeks]:[]) {
      const query=insightQuery(new URLSearchParams({week,lang:'en'}),{kind:'legislation',now:clock()});
      values.push(await warmView(query,catalogue));
    }
    const latest=values[0];
    if(!latest)return PLENARY_REFRESH_MS;
    // Index refreshes change view keys, but must not keep restarting at item 1.
    const selection=JSON.stringify([latest.week,latest.topics.map(topic=>[topic.sittingId,topic.id])]);
    if(selection!==warmSelection){warmSelection=selection;cursor=0;warmedProcedures.clear();warmedSpeechDates.clear();}
    const warn=error=>(options.log||console.warn)('[plenary-warmup]',error.message);
    // Small serial batches yield to visitors and keep one slow item from
    // preventing later items from being prepared. Existing source bounds apply.
    const end=Math.min(cursor+8,latest.topics.length);
    for(;cursor<end;cursor++) {
      const topic=latest.topics[cursor];
      try {
        const query=insightQuery(new URLSearchParams({sitting:topic.sittingId,topic:topic.id,lang:'en'}),{kind:'legislation',now:clock()});
        const value=await warmView(query,catalogue);
        for(const procedure of value.detail?.procedures||[]) {
          if(!procedure.reference||warmedProcedures.has(procedure.reference))continue;
          const query={reference:procedure.reference,language:'en'};
          // Independent sections can recover independently after a source error.
          const results=await Promise.allSettled([procedureContext.query(query,{priority:'background'}),procedureProgress.query({...query,detail:'events'},{priority:'background'})]);
          for(const result of results)if(result.status==='rejected')warn(result.reason);
          warmedProcedures.add(procedure.reference);
        }
        for(const source of value.detail?.coverage.speechAssociations.sources||[]) {
          if(warmedSpeechDates.has(source.eventDate))continue;
          const params=new URLSearchParams({sitting:'MTG-PL-'+source.eventDate,lang:'en'});
          let page=0;
          do {
            params.set('page',String(page));
            const cloud=await warmCloud.query(speechCloudQuery(params,{now:clock()}));
            page=cloud.nextPage;
          }while(page!==null);
          warmedSpeechDates.add(source.eventDate);
        }
      }catch(error){warn(error);}
    }
    if(cursor<latest.topics.length)return 1000;
    cursor=0;warmedProcedures.clear();warmedSpeechDates.clear();
    // Details and linked publications can arrive after a sitting week ends.
    // Keep checking the latest selection during recesses and across years.
    return nextPlenaryWarmup(catalogue,values,clock());
  },async query(view,searchParams) {
    if(view==='search')return search.query(parliamentSearchQuery(searchParams));
    if(view==='dossier-activity')return dossierActivity.query(dossierActivityQuery(searchParams));
    if(view==='dossier-references')return dossierActivity.references(dossierReferencesQuery(searchParams));
    if(view==='speech-words')return speechWords.query(speechWordsQuery(searchParams,{now:clock()}));
    if(view==='speech-cloud')return speechCloud.query(speechCloudQuery(searchParams,{now:clock()}));
    if(view==='procedure-context')return procedureContext.query(procedureContextQuery(searchParams));
    if(view==='procedure-progress')return procedureProgress.query(procedureProgressQuery(searchParams));
    if(view==='topic-trends')return topicTrends.query(topicTrendsQuery(searchParams,{now:clock()}));
    if(view==='saved')return savedStates(store,savedQuery(searchParams));
    if(view==='participation'){const query=participationQuery(searchParams),generation=store.status().servingGeneration,key=[INSIGHTS_VERSION,LEGISLATION_VIEW_VERSION,view,generation,historyCacheKey(store,generation),store.get('availabilityRevision')||0,store.get('demographicRevision')||0,brusselsDay(clock()),query,await agendaCacheRevision()];return views.get(key,()=>participation(legislation,store,query,{clock,readEvent:options.readEvent}),{persist:()=>agendaCacheRevisionIsDurable(key.at(-1))});}
    if(!['questions','legislation'].includes(view))throw new HttpError(404,'insight_not_found','Unknown insight view.');
    const query=insightQuery(searchParams,{kind:view,now:options.clock?.()??Date.now()});
    const catalogue=view==='legislation'&&isLatest(query)?await legislation.catalogue():null;
    if(view==='legislation')return (await cached(query,catalogue,legislation)).value;
    return views.get(await viewKey(view,query,catalogue),()=>questions.query(query));
  }};
}
