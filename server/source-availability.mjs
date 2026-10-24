import {brusselsDay} from './analysis-period.mjs';

export const SOURCE_AVAILABILITY_VERSION=1;
export const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
export function sourceTime(value) {
  const time=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):Date.parse(value);
  return Number.isFinite(time)?new Date(time).toISOString():null;
}
const overlaps=(a,b)=>!a.start||!a.end||a.start<=b.end&&a.end>=b.start;
const covers=(intervals,start,end)=>{
  let next=start;
  for(const range of [...intervals].filter(r=>validDay(r.start)&&validDay(r.end)).sort((a,b)=>a.start.localeCompare(b.start))) {
    if(range.start>next)return false;
    if(range.end>=end)return true;
    if(range.end>=next)next=new Date(Date.parse(range.end+'T12:00Z')+86400_000).toISOString().slice(0,10);
  }
  return false;
};

// A checked local snapshot enumerates saved records, never all parliamentary
// activity on an event date. Publication maturity remains unknown.
export function sourceAvailability({sourceKey,family=sourceKey,subtype=null,stage='metadata',language=null,start,end,records=[],latestObservedDate=null,checkedAt=null,gaps=[],limited=false,retention=null,snapshot=null,checkedIntervals=null,observedRecords=null,route='saved',today=brusselsDay()}={}) {
  const observed=[];
  if(validDay(latestObservedDate)&&latestObservedDate<=today)observed.push(latestObservedDate);
  for(const record of records) {
    const date=typeof record==='string'?record:record?.date;
    const at=typeof record==='object'?sourceTime(record.fetchedAt):null;
    if(validDay(date)&&date<=today&&(!at||date<=brusselsDay(Date.parse(at))))observed.push(date);
  }
  const latest=observed.sort().at(-1)||null;
  return {version:SOURCE_AVAILABILITY_VERSION,sourceKey,family,subtype,stage,language,
    latestObservedDate:latest,checkedAt:sourceTime(checkedAt),publicationMaturity:'unknown',authoritativeComplete:false,
    checkedIntervals:checkedIntervals??(validDay(start)&&validDay(end)?[{start,end,basis:'saved-records'}]:[]),
    gaps:gaps.map(gap=>({start:validDay(gap.start)?gap.start:null,end:validDay(gap.end)?gap.end:null,reason:gap.reason||'source-gap',...(gap.sourceId?{sourceId:gap.sourceId}:{})})),limited:Boolean(limited),retention,snapshot,observedRecords,route};
}

export function periodAvailability(period,evidence,observedCount,{today=brusselsDay()}={}) {
  const sources=(Array.isArray(evidence)?evidence:[evidence]).filter(Boolean);
  const count=Number.isFinite(observedCount)&&observedCount>=0?observedCount:null;
  const reasons=new Set(),dependencies=[];
  if(!validDay(period?.start)||!validDay(period?.end)||period.start>period.end||period.start>today)return {state:'unavailable',observedCount:null,reasons:['no-date-evidence'],dependencies};
  const end=period.end>today?today:period.end;
  let usable=0,failed=false,partial=period.end>today;
  for(const source of sources) {
    const frontier=source.latestObservedDate;
    const gaps=source.gaps.filter(gap=>overlaps(gap,{start:period.start,end}));
    const through=validDay(frontier)&&frontier<=today?frontier:null;
    const checked=through&&period.start<=through&&covers(source.checkedIntervals,period.start,end<through?end:through);
    if(checked)usable++;
    let state='observed';
    if(!checked){state='unavailable';reasons.add(through&&period.start>through?'later-dates':'no-date-evidence');}
    if(gaps.length){failed=true;state='partial';for(const gap of gaps)reasons.add(gap.reason);}
    if(checked&&end>=through){state='partial';reasons.add('frontier-period');}
    if(source.limited){if(state!=='unavailable')state='partial';reasons.add('limited');}
    if(state!=='observed')partial=true;
    dependencies.push({sourceKey:source.sourceKey,stage:source.stage,language:source.language,state,latestObservedDate:through});
  }
  if(count===null||!sources.length||count===0&&(!usable||failed))return {state:'unavailable',observedCount:null,reasons:[...(reasons.size?reasons:['no-date-evidence'])],dependencies};
  // Positive evidence survives a missing dependency or an older failed range.
  return {state:partial?'partial':'observed',observedCount:count,reasons:[...reasons],dependencies};
}

export function availabilitySummary(evidence) {
  const sources=(Array.isArray(evidence)?evidence:[evidence]).filter(Boolean);
  const latest=sources.map(source=>source.latestObservedDate).filter(validDay).sort().at(-1)||null;
  return {latestObservedDate:latest,partial:sources.some(source=>source.limited||source.gaps.length>0||!source.latestObservedDate),sources};
}

export const availabilityValue=(value,state)=>state==='unavailable'?'Unavailable':value===0&&state==='partial'?'0 so far':`${value??'—'}${state==='partial'?' · Partial':''}`;
