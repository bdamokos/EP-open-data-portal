import {MemberVotes} from './member-votes.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {calendarYears,currentTermSittings,isPlenarySitting,identifiedPlenarySitting,calendarWeeks} from './plenary-calendar.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';
import {HttpError} from './http-utils.mjs';
export const VOTE_PERIODS_VERSION=1;
export class VotePeriods {
  constructor(options={}){this.reader=new MemberVotes(options);this.clock=options.clock||Date.now;this.pending=null;this.saved=null;}
  async collect(){
    const today=brusselsDay(this.clock()),years=[],nodes=[];
    for(const year of calendarYears(today)){
      requestSignal()?.throwIfAborted();
      // Each year has its own byte cap; the fixed current-term year count bounds the total.
      const result=await this.reader.pages('/meetings',{year},'catalogue',{bytes:0});
      const coverage={year,...result.coverage};
      if(result.nodes.some(n=>isPlenarySitting(n)&&(!identifiedPlenarySitting(n)||Number(n.activity_date.slice(0,4))!==year))){coverage.state='partial';coverage.stopReason='identity';coverage.error={code:'vote_sitting_identity',message:'Some listed plenary sittings have inconsistent identifiers or dates.'};}
      // The year query is not an identity join: only observations from that year qualify.
      const held=currentTermSittings(result.nodes,today).filter(n=>Number(n.activity_date.slice(0,4))===year);
      nodes.push(...held);years.push(coverage);
    }
    const status=years.every(y=>y.state==='complete')?'complete':years.some(y=>y.pages>0)?'partial':'unavailable';
    return {version:VOTE_PERIODS_VERSION,weeks:calendarWeeks(nodes),coverage:{status,years},attribution:'European Parliament Open Data API v2, CC BY 4.0'};
  }
  query(search=new URLSearchParams()){
    if([...search.keys()].length)throw new HttpError(400,'invalid_query','The vote-period calendar accepts no parameters.');
    const today=brusselsDay(this.clock());
    if(this.saved?.day===today&&this.clock()-this.saved.at<60_000)return this.saved.value;
    if(this.pending)return waitForRequest(this.pending);
    const job=sharedRequest(async()=>{const value=await this.collect();requestSignal()?.throwIfAborted();if(value.coverage.status==='complete'&&value.coverage.years.every(y=>y.sources.every(s=>!s.stale&&!s.refreshInProgress&&!s.refreshError)))this.saved={day:today,at:this.clock(),value};return value;},this.reader.limits.timeoutMs).finally(()=>{if(this.pending===job)this.pending=null;});
    this.pending=job;return waitForRequest(job);
  }
}
export const votePeriods=new VotePeriods();
