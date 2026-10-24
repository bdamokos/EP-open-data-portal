import {sourceAvailability,validDay} from './source-availability.mjs';
import {brusselsDay} from './analysis-period.mjs';

export function availabilityGap(body,sourceId) {
  const idDate=String(body.recoveryId||body.id||'').match(/MTG-PL-(\d{4}-\d{2}-\d{2})/)?.[1];
  const start=body.date||body.start||body.params?.['sitting-date']||idDate;
  const end=body.end||body.params?.['sitting-date-end']||start;
  return {start:validDay(start)?start:null,end:validDay(end)?end:null,sourceId,reason:'source-gap'};
}

// Only small indexed gap metadata is read. No source bodies or corpus text
// scans are needed to classify a date range.
export function savedGaps(store,generation,family) {
  const question=family==='questions'||family==='answers';
  const where=question?"((kind='document' AND key LIKE '/parliamentary-questions/%') OR (kind IN ('feed','catalog','coverage') AND json_extract(body,'$.endpoint')='/parliamentary-questions'))":family==='speeches'?"kind='speeches'":family==='procedures'?"(kind='procedure' OR (kind IN ('feed','catalog','coverage') AND json_extract(body,'$.endpoint')='/procedures'))":family==='documents'?"(kind='document' AND key NOT LIKE '/parliamentary-questions/%')":"kind='motion-outcomes'";
  const rows=store.db.prepare(`SELECT key,COALESCE(json_extract(body,'$.start'),json_extract(body,'$.params.sitting-date'),substr(sitting_id,8,10)) start,COALESCE(json_extract(body,'$.end'),json_extract(body,'$.params.sitting-date-end'),substr(sitting_id,8,10)) end FROM refresh_gaps WHERE generation=? AND ${where} LIMIT 501`).all(generation);
  return rows.length>500?[{reason:'source-gap'}]:rows.map(row=>({start:row.start,end:row.end,sourceId:row.key,reason:'source-gap'}));
}
export function indexAvailability(store,{sourceKey,family=sourceKey,subtype=null,stage='metadata',language=null,start='2024-07-16',end=brusselsDay(store.clock()),records=[],latestObservedDate=null,limited=false,generation=store.status().servingGeneration,gaps=null,checkedAt=store.get('lastSuccess'),revision=store.get('availabilityRevision')||0}={}) {
  return sourceAvailability({sourceKey,family,subtype,stage,language,start,end,records,latestObservedDate,limited,
    gaps:gaps??savedGaps(store,generation,family),checkedAt,today:brusselsDay(store.clock()),
    snapshot:{generation,revision}});
}
export function oralAvailability(store,{generation,start='2024-07-16',end=brusselsDay(store.clock()),limited=false}={}) {
  const date=store.db.prepare('SELECT MAX(date) date FROM group_voice_observations WHERE generation=? AND date<=?').get(generation,end)?.date||null;
  return indexAvailability(store,{sourceKey:'oral-speeches',family:'speeches',subtype:'PLENARY_DEBATE_SPEECH',generation,start,end,latestObservedDate:date,limited});
}

export function activityAvailability(store,generation,{category=null,limited=false}={}) {
  // Role projections are enumerated across all people, before the member filter.
  const rows=store.db.prepare("SELECT category,MAX(date) date FROM items WHERE generation=? AND COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer' GROUP BY category").all(generation);
  const selected=category?[rows.find(row=>row.category===category)||{category,date:null}]:rows;
  return selected.map(row=>indexAvailability(store,{sourceKey:row.category,family:row.category.includes('questions')?'questions':row.category==='plenary-contributions'?'speeches':'documents',stage:'activity-role',generation,latestObservedDate:row.date,limited}));
}
