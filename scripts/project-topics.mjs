import {parseArgs} from 'node:util';
import {ActivityStore} from '../server/activity-index-store.mjs';
import {buildTopics,topicCollectorTables} from '../server/topics-project.mjs';
const {values}=parseArgs({options:{index:{type:'string'},cache:{type:'string'}}});
if(!values.index||!values.cache)throw Error('Use --index DIRECTORY --cache DIRECTORY');
const store=new ActivityStore(values.index);if(!store.acquire())throw Error('Index writer busy.');
const start=performance.now();
try{topicCollectorTables(store.db);const result=await buildTopics(store,{cache:values.cache});console.log(JSON.stringify({...result,seconds:(performance.now()-start)/1000,peakRssMiB:process.resourceUsage().maxRSS/1024}));}finally{store.release();store.close();}
