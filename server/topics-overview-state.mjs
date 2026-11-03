import {readableRecordTopicState} from './topic-projection-state.mjs';
export const overviewMetaKeys=['recordTopicProjection','active','previous','recordTopicCoverage','recordTopicCalendar','recordTopicAskerCoverage'];
export function overviewState(store){
 const values=new Map(overviewMetaKeys.map(key=>[key,store.get(key)]));
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(Date.now());
 return {token:JSON.stringify([...values.values(),day]),ready:Boolean(readableRecordTopicState({get:key=>values.get(key)}))};
}
