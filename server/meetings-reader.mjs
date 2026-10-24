import {odp} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {calendarYears,currentTermSittings,isPlenarySitting,identifiedPlenarySitting} from './plenary-calendar.mjs';
import {VoteSourceReader} from './vote-source-reader.mjs';
import {requestSignal,sharedRequest,waitForRequest} from './request-budget.mjs';

const LIMITS=Object.freeze({pageSize:50,cataloguePages:10,maxRows:4000,sourceBytes:8*1024*1024,periodBytes:24*1024*1024,sourceMs:15*60_000,cacheMs:60_000,cacheEntries:8,cacheBytes:32*1024*1024,timeoutMs:50_000});
export const calendarNeedsRefresh=coverage=>coverage?.status!=='complete'||coverage.years.some(year=>year.sources.some(source=>source.stale||source.refreshInProgress||source.refreshError));
export const catalogueCoverage=years=>({status:years.every(y=>y.state==='complete')?'complete':years.some(y=>y.pages>0)?'partial':'unavailable',years});
export const missingSitting=catalogue=>{if(catalogue.complete===false)throw new HttpError(503,'sitting_calendar_unavailable','Sitting dates unavailable. Try again.');throw new HttpError(404,'sitting_not_found','Choose a listed plenary week or sitting.');};

// One metadata observation per year. Exact meeting details and their participants
// remain separate ODP records; this reader never replaces those payloads.
export class MeetingsReader extends VoteSourceReader {
  constructor({request=odp,clock=Date.now,limits={}}={}){super();this.request=request;this.clock=clock;this.limits={...LIMITS,...limits};this.saved=new Map();this.pending=new Map();this.cacheBytes=0;}
  year(year) {
    requestSignal()?.throwIfAborted();
    if(!Number.isInteger(year)||year<Number(CURRENT_TERM_START.slice(0,4))||year>Number(brusselsDay(this.clock()).slice(0,4)))throw new HttpError(400,'invalid_year','Choose a current-term year.');
    const old=this.saved.get(year);
    if(old&&this.clock()-old.at<this.limits.cacheMs)return waitForRequest(Promise.resolve(old.value));
    if(old){this.saved.delete(year);this.cacheBytes-=old.size;}
    if(this.pending.has(year))return waitForRequest(this.pending.get(year));
    const job=sharedRequest(async()=>{
      const budget={bytes:0},result=await this.pages('/meetings',{year},'catalogue',budget);
      requestSignal()?.throwIfAborted();
      const coverage={year,...result.coverage};
      if(result.nodes.some(n=>isPlenarySitting(n)&&(!identifiedPlenarySitting(n)||Number(n.activity_date.slice(0,4))!==year))){coverage.state='partial';coverage.stopReason='identity';coverage.error={code:'vote_sitting_identity',message:'Some sitting identifiers or dates are inconsistent.'};}
      const disputed=new Set(result.conflicts.map(n=>n.id?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')));
      const nodes=currentTermSittings(result.nodes.filter(n=>!disputed.has(n.id?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''))),brusselsDay(this.clock()),{heldOnly:false}).filter(n=>Number(n.activity_date.slice(0,4))===year);
      const value={nodes,coverage,bytes:budget.bytes},size=Buffer.byteLength(JSON.stringify(value));
      if(coverage.state==='complete'&&coverage.sources.every(s=>!s.stale&&!s.refreshInProgress&&!s.refreshError)&&size<=this.limits.cacheBytes){this.saved.set(year,{at:this.clock(),value,size});this.cacheBytes+=size;while(this.saved.size>this.limits.cacheEntries||this.cacheBytes>this.limits.cacheBytes){const key=this.saved.keys().next().value;this.cacheBytes-=this.saved.get(key).size;this.saved.delete(key);}}
      return value;
    },this.limits.timeoutMs).finally(()=>{if(this.pending.get(year)===job)this.pending.delete(year);});
    this.pending.set(year,job);return waitForRequest(job);
  }
  async catalogue() {
    const today=brusselsDay(this.clock()),years=[],nodes=[];
    for(const year of calendarYears(today)){const result=await this.year(year);nodes.push(...result.nodes);years.push(result.coverage);}
    const coverage=catalogueCoverage(years);
    return {nodes,coverage};
  }
}
export const meetingsReader=new MeetingsReader();

// Only years that could contain a newer held sitting affect the default choice.
// null means latest is unknown; undefined means a complete empty catalogue.
export function latestCatalogueSitting(catalogue,today) {
  const held=catalogue.sittings.filter(sitting=>sitting.activity_date<=today).sort((a,b)=>b.activity_date.localeCompare(a.activity_date));
  const relevant=catalogue.coverage?.years?.filter(year=>!held[0]||year.year>=Number(held[0].activity_date.slice(0,4)));
  if(relevant?.some(year=>year.state!=='complete')||catalogue.complete===false&&!relevant)return null;
  return held[0]||[...catalogue.sittings].sort((a,b)=>a.activity_date.localeCompare(b.activity_date))[0];
}
export function requireLatestSitting(catalogue,today) {
  const latest=latestCatalogueSitting(catalogue,today);
  if(latest===null)throw new HttpError(503,'sitting_calendar_unavailable','Latest sitting dates unavailable. Choose a period.');
  return latest;
}
