import {sourceAvailability,validDay} from './source-availability.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {activityOnly} from './activity-read-projections.mjs';

export const activityAvailabilityIndexVersion=2;
export function prepareActivityAvailability(db) {
  db.exec(`CREATE INDEX IF NOT EXISTS activity_role_frontier ON items(generation,category,date DESC) WHERE ${activityOnly}`);
  db.exec(`CREATE INDEX IF NOT EXISTS activity_member_roles ON items(generation,mep,category,date DESC,source_id DESC) WHERE ${activityOnly}`);
}

export function availabilityGap(body,sourceId) {
  const idDate=String(body.recoveryId||body.id||'').match(/MTG-PL-(\d{4}-\d{2}-\d{2})/)?.[1];
  const start=body.date||body.start||body.params?.['sitting-date']||idDate;
  const end=body.end||body.params?.['sitting-date-end']||start;
  return {start:validDay(start)?start:null,end:validDay(end)?end:null,sourceId,reason:'source-gap'};
}

// Only small indexed gap metadata is read. No source bodies or corpus text
// scans are needed to classify a date range.
export function savedGaps(store,generation,family,{start='2024-07-16',end=brusselsDay(store.clock?.()??Date.now()),recordIds=null,restrictRecords=false}={}) {
  const question=family==='questions'||family==='answers',rootPresence=question||family==='procedures';
  const where=question?"((kind='document' AND key LIKE '/parliamentary-questions/%') OR (kind IN ('feed','catalog','coverage') AND json_extract(body,'$.endpoint')='/parliamentary-questions'))":family==='speeches'?"kind='speeches'":family==='procedures'?"(kind='procedure' OR (kind IN ('feed','catalog','coverage') AND json_extract(body,'$.endpoint')='/procedures'))":family==='documents'?"(kind='document' AND key NOT LIKE '/parliamentary-questions/%')":"kind='motion-outcomes'";
  const retainedDate=question?"(SELECT date FROM items INDEXED BY item_source WHERE items.generation=refresh_gaps.generation AND items.source_key=refresh_gaps.key AND date IS NOT NULL LIMIT 1)":'NULL';
  const selection=`SELECT key,COALESCE(json_extract(body,'$.start'),json_extract(body,'$.params.sitting-date'),substr(sitting_id,8,10),${retainedDate}) start,COALESCE(json_extract(body,'$.end'),json_extract(body,'$.params.sitting-date-end'),substr(sitting_id,8,10),${retainedDate}) end${rootPresence?",EXISTS(SELECT 1 FROM sources WHERE sources.generation=refresh_gaps.generation AND sources.key=refresh_gaps.key) retained":""} FROM refresh_gaps WHERE generation=? AND ${where}`;
  const wanted=new Set(recordIds||[]),details=[],preferred=[],intervals=new Map();let total=0,unknown=false,unknownRecord=false;
  const stamp=(value,open)=>value?Date.parse(value+'T12:00Z'):open;
  const merge=(key,gap)=>{
    const ranges=intervals.get(key)||[];let value={...(key.startsWith('record:')?{}:{sourceId:gap.sourceId}),start:gap.start,end:gap.end,reason:key.startsWith('record:')?'record-gap-summary':'source-gap',minimumCount:1,...(typeof gap.retained==='boolean'?{retained:gap.retained}:{})},index=0;
    while(index<ranges.length&&stamp(ranges[index].end,Infinity)+86400_000<stamp(value.start,-Infinity))index++;
    while(index<ranges.length&&stamp(value.end,Infinity)+86400_000>=stamp(ranges[index].start,-Infinity)){
      const other=ranges.splice(index,1)[0];value={...value,start:!value.start||!other.start?null:value.start<other.start?value.start:other.start,end:!value.end||!other.end?null:value.end>other.end?value.end:other.end,minimumCount:value.minimumCount+other.minimumCount};if(value.sourceId!==other.sourceId)delete value.sourceId;
    }
    ranges.splice(index,0,value);intervals.set(key,ranges);
  };
  // Stream small metadata only. Bound identity details independently of exact
  // dated intervals, which coalesce without filling the days between failures.
  const statement=store.db.prepare(selection);
  for(const row of statement.iterate?statement.iterate(generation):statement.all(generation)) {
    total++;
    if(typeof row.key!=='string'){unknown=true;if(details.length<500)details.push({reason:'source-gap'});continue;}
    const record=/^\/(?:parliamentary-questions|procedures|documents|plenary-documents|adopted-texts)\//.test(row.key)||/MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(row.key),exact=wanted.has(row.key)||wanted.has(row.key.split('/').at(-1));
    if(record&&restrictRecords&&!exact)continue;
    const gap={start:validDay(row.start)?row.start:null,end:validDay(row.end)?row.end:null,sourceId:row.key,reason:'source-gap',...(rootPresence&&/^\/(parliamentary-questions|procedures)\//.test(row.key)?{retained:Boolean(row.retained)}:{})};
    if(start&&gap.end&&gap.end<start||end&&gap.start&&gap.start>end)continue;
    if(details.length<500)details.push(gap);
    if(exact&&preferred.length<1000)preferred.push(gap);
    if(gap.start||gap.end){if(!exact)merge((record?'record:':'collection:')+String(gap.retained),gap);}
    else if(gap.retained!==true){if(record)unknownRecord=true;else unknown=true;}
  }
  if(total<=500)return details;
  return [{reason:'gap-list-limit',minimumCount:501,archiveOnly:true},...preferred,...[...intervals.values()].flat(),...(unknownRecord?[{reason:'record-gap-summary'}]:[]),...(unknown?[{reason:'source-gap'}]:[])];
}
export function indexAvailability(store,{sourceKey,family=sourceKey,subtype=null,stage='metadata',language=null,start='2024-07-16',end=brusselsDay(store.clock()),records=[],latestObservedDate=null,limited=false,generation=store.status().servingGeneration,gaps=null,checkedAt=store.get('lastSuccess'),revision=store.get('availabilityRevision')||0}={}) {
  return sourceAvailability({sourceKey,family,subtype,stage,language,start,end,records,latestObservedDate,limited,
    gaps:gaps??savedGaps(store,generation,family,{start,end}),checkedAt,today:brusselsDay(store.clock()),
    snapshot:{generation,revision}});
}
export function oralAvailability(store,{generation,start='2024-07-16',end=brusselsDay(store.clock()),limited=false,gaps=null}={}) {
  const date=store.db.prepare('SELECT MAX(date) date FROM group_voice_observations WHERE generation=? AND date<=?').get(generation,brusselsDay(store.clock()))?.date||null;
  return indexAvailability(store,{sourceKey:'oral-speeches',family:'speeches',subtype:'PLENARY_DEBATE_SPEECH',generation,start,end,latestObservedDate:date,limited,gaps});
}

export function activityAvailability(store,generation,{category=null,limited=false}={}) {
  // Role projections are enumerated across all people, before the member filter.
  // Seek one frontier per role in the covering partial index. Skipping to the
  // next role also retains stored categories absent from the current UI list.
  const from=`FROM items INDEXED BY activity_role_frontier WHERE generation=? AND ${activityOnly}`;
  let rows;
  if(category)rows=[{category,date:store.db.prepare(`SELECT date ${from} AND category=? ORDER BY date DESC LIMIT 1`).get(generation,category)?.date??null}];
  else {
    rows=[];
    const next=store.db.prepare(`SELECT category,date ${from} AND category>? ORDER BY category,date DESC LIMIT 1`);
    for(let row=store.db.prepare(`SELECT category,date ${from} ORDER BY category,date DESC LIMIT 1`).get(generation);row;row=next.get(generation,row.category))rows.push(row);
  }
  return rows.map(row=>indexAvailability(store,{sourceKey:row.category,family:row.category.includes('questions')?'questions':row.category==='plenary-contributions'?'speeches':'documents',stage:'activity-role',generation,latestObservedDate:row.date,limited}));
}
