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
import {INSIGHTS_VERSION} from './insights-model.mjs';
import {savedQuery,savedStates} from './insights-saved.mjs';
import {participationQuery,participation} from './insights-participation.mjs';

// Root integration supplies its already-owned store; this module never starts a worker.
export function createInsights(store,options={}) {
  const clock=options.clock||Date.now,readMetadata=options.loadMetadata||savedMetadata;
  let metadata=null,pendingMetadata=null;
  const loadMetadata=async args=>{
    const key=[...args.members.keys()].join(',');
    if(metadata?.key===key&&clock()-metadata.at<5*60_000)return metadata.value;
    if(pendingMetadata?.key===key)return pendingMetadata.promise;
    const promise=readMetadata(args).then(value=>{metadata={key,at:clock(),value};return value;});
    pendingMetadata={key,promise};try{return await promise;}finally{if(pendingMetadata?.promise===promise)pendingMetadata=null;}
  };
  const shared={...options,loadMetadata};
  const speechWords=new SpeechWordInsights(store,shared);
  const questions=new QuestionInsights(store,shared),legislation=new LegislationInsights(store,shared);
  const speechCloud=new SpeechCloudInsights(store,{...shared,legislation});
  const officialSources=options.officialSources||(options.officialContext||options.clock?new OfficialContextSources({clock,...options.officialContext}):getSharedOfficialContextSources());
  const catalog=options.eurovocCatalog||new EurovocCatalog(officialSources,{clock,...options.eurovoc});
  const procedureContext=new ProcedureContext(officialSources,catalog),topicTrends=new TopicTrends(store,catalog,{clock});
  const procedureProgress=new ProcedureProgress(officialSources);
  const views=new InsightViewCache({clock,...options.viewCache});
  return {async query(view,searchParams) {
    if(view==='speech-words')return speechWords.query(speechWordsQuery(searchParams,{now:clock()}));
    if(view==='speech-cloud')return speechCloud.query(speechCloudQuery(searchParams,{now:clock()}));
    if(view==='procedure-context')return procedureContext.query(procedureContextQuery(searchParams));
    if(view==='procedure-progress')return procedureProgress.query(procedureProgressQuery(searchParams));
    if(view==='topic-trends')return topicTrends.query(topicTrendsQuery(searchParams,{now:clock()}));
    if(view==='saved')return savedStates(store,savedQuery(searchParams));
    if(view==='participation'){const query=participationQuery(searchParams);return views.get([INSIGHTS_VERSION,LEGISLATION_VIEW_VERSION,view,store.status().servingGeneration,brusselsDay(clock()),query],()=>participation(legislation,store,query,{clock,readEvent:options.readEvent}));}
    if(!['questions','legislation'].includes(view))throw new HttpError(404,'insight_not_found','Unknown insight view.');
    const query=insightQuery(searchParams,{kind:view,now:options.clock?.()??Date.now()});
    const version=view==='legislation'?INSIGHTS_VERSION+':'+LEGISLATION_VIEW_VERSION:INSIGHTS_VERSION;
    return views.get([version,view,store.status().servingGeneration,view==='legislation'?brusselsDay(clock()):null,query],()=>view==='questions'?questions.query(query):legislation.query(query));
  }};
}
