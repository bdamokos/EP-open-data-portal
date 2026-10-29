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
import {odp,agendaCacheRevision} from './odp.mjs';
import {MeetingsReader} from './meetings-reader.mjs';
import {recentPlenaryWeeks} from './plenary-warmup.mjs';
import {requestSignal,waitForRequest} from './request-budget.mjs';
import {agendaViewFreshMs,nextPlenaryWarmup} from './plenary-cache-policy.mjs';

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
  const search=new ParliamentSearch(store,{clock});
  const isLatest=query=>query.week==='latest'||!query.week&&!query.sitting;
  const viewKey=async(view,query,catalogue)=>{
    const version=view==='legislation'?INSIGHTS_VERSION+':'+LEGISLATION_VIEW_VERSION:INSIGHTS_VERSION;
    const generation=store.status().servingGeneration;
    // Calendar content selects "latest". Retrieval times alone do not change it.
    const selection=view==='legislation'&&isLatest(query)?catalogue.coverage.years.map(year=>[year.year,year.state,year.stopReason,year.error,year.sources.map(source=>[source.url,source.contentHash,source.stale,source.refreshInProgress,source.refreshError])]):null;
    return [version,view,generation,historyCacheKey(store,generation),store.get('availabilityRevision')||0,store.get('demographicRevision')||0,view==='legislation'?brusselsDay(clock()):null,query,...(view==='legislation'&&query.topic?[amendmentGeneration(store)]:[]),...(selection?[selection]:[]),...(view==='legislation'?[await agendaCacheRevision()]:[])];
  };
  let warmReader;
  return {async warmPlenary() {
    const status=store.status();
    if(!status.currentMeps||!status.servingGeneration)return 60_000;
    if(!warmReader){
      const request=(endpoint,params,settings)=> (options.request||odp)(endpoint,params,{...settings,priority:'background',signal:requestSignal()});
      warmReader=new LegislationInsights(store,{...shared,request,meetings:new MeetingsReader({request,clock})});
    }
    const catalogue=await warmReader.catalogue(),weeks=recentPlenaryWeeks(catalogue,clock()),values=[];
    // The UI defaults to English/latest. Raw source records contain all languages.
    for(const week of weeks.length?['latest',...weeks]:[]) {
      const query=insightQuery(new URLSearchParams({week,lang:'en'}),{kind:'legislation',now:clock()}),key=await viewKey('legislation',query,catalogue);
      const value=await views.get(key,()=>warmReader.query(query,catalogue),{freshMs:value=>agendaViewFreshMs(value,clock())});
      // Stale views return immediately to readers; warming waits for their refresh.
      const pending=views.pending.get(views.key(key)),refreshed=pending?await waitForRequest(pending):null;
      values.push(refreshed?.value||value);
    }
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
    if(view==='participation'){const query=participationQuery(searchParams),generation=store.status().servingGeneration;return views.get([INSIGHTS_VERSION,LEGISLATION_VIEW_VERSION,view,generation,historyCacheKey(store,generation),store.get('availabilityRevision')||0,store.get('demographicRevision')||0,brusselsDay(clock()),query,await agendaCacheRevision()],()=>participation(legislation,store,query,{clock,readEvent:options.readEvent}));}
    if(!['questions','legislation'].includes(view))throw new HttpError(404,'insight_not_found','Unknown insight view.');
    const query=insightQuery(searchParams,{kind:view,now:options.clock?.()??Date.now()});
    const catalogue=view==='legislation'&&isLatest(query)?await legislation.catalogue():null;
    return views.get(await viewKey(view,query,catalogue),()=>view==='questions'?questions.query(query):legislation.query(query,catalogue),view==='legislation'&&!query.topic&&!query.vote?{freshMs:value=>agendaViewFreshMs(value,clock())}:{});
  }};
}
