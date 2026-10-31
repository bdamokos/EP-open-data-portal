import {meetingsReader,MeetingsReader} from './meetings-reader.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {currentTermSittings,calendarWeeks} from './plenary-calendar.mjs';
import {HttpError} from './http-utils.mjs';
import {requestSignal} from './request-budget.mjs';
export const VOTE_PERIODS_VERSION=3;
const places=new Map([
  ['http://publications.europa.eu/resource/authority/place/FRA_SXB','Strasbourg'],
  ['http://publications.europa.eu/resource/authority/place/BEL_BRU','Brussels'],
]);
export const sittingLocation=node=>places.get(node.hasLocality)||null;
const LAST_GOOD_MS=24*60*60_000;
export class VotePeriods {
  constructor(options={}){this.reader=options.meetings||(!options.request&&!options.clock&&!options.limits?meetingsReader:new MeetingsReader(options));this.clock=options.clock||Date.now;this.lastGood=null;}
  async collect(){
    try {
      const {nodes,coverage}=await this.reader.catalogue();
      requestSignal()?.throwIfAborted();
      const locations=new Map(nodes.map(node=>[node.activity_id,sittingLocation(node)]));
      const value={version:VOTE_PERIODS_VERSION,weeks:calendarWeeks(currentTermSittings(nodes,brusselsDay(this.clock()))).map(week=>({...week,sittings:week.sittings.map(sitting=>({...sitting,location:locations.get(sitting.sittingId)||null}))})),coverage,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
      if(coverage.status==='complete'&&coverage.years.every(year=>year.sources.every(source=>!source.stale&&!source.refreshInProgress&&!source.refreshError)))this.lastGood={at:this.clock(),value:structuredClone(value)};
      return value;
    }catch(error){
      requestSignal()?.throwIfAborted();
      const saved=this.lastGood,age=saved?this.clock()-saved.at:Infinity;
      if(error.code!=='upstream_busy'||age<0||age>=LAST_GOOD_MS)throw error;
      const value=structuredClone(saved.value);
      value.coverage={status:'partial',years:value.coverage.years.map(year=>({...year,state:'partial',stopReason:'error',error:{code:error.code,message:error.message},sources:year.sources.map(source=>({...source,stale:true,refreshInProgress:false,refreshError:error.message}))}))};
      return value;
    }
  }
  query(search=new URLSearchParams()){
    if([...search.keys()].length)throw new HttpError(400,'invalid_query','The vote-period calendar accepts no parameters.');
    return this.collect();
  }
}
export const votePeriods=new VotePeriods();
