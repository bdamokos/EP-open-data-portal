import {meetingsReader,MeetingsReader} from './meetings-reader.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {currentTermSittings,calendarWeeks} from './plenary-calendar.mjs';
import {HttpError} from './http-utils.mjs';
export const VOTE_PERIODS_VERSION=1;
export class VotePeriods {
  constructor(options={}){this.reader=options.meetings||(!options.request&&!options.clock&&!options.limits?meetingsReader:new MeetingsReader(options));this.clock=options.clock||Date.now;}
  async collect(){
    const {nodes,coverage}=await this.reader.catalogue();
    return {version:VOTE_PERIODS_VERSION,weeks:calendarWeeks(currentTermSittings(nodes,brusselsDay(this.clock()))),coverage,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
  }
  query(search=new URLSearchParams()){
    if([...search.keys()].length)throw new HttpError(400,'invalid_query','The vote-period calendar accepts no parameters.');
    return this.collect();
  }
}
export const votePeriods=new VotePeriods();
