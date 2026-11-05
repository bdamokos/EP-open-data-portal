import {HttpError} from './http-utils.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {pickTitle} from './member-vote-record-model.mjs';

export const MEMBER_VOTE_RECORD_VERSION=1;
export const MEMBER_VOTE_RECORD_LIMITS=Object.freeze({departures:50,maxOffset:10000});
const emptyAlignment=()=>({with:0,against:0,abstained:0,notComparable:0});
// A group-history answer that places the person in office on that day.
const serving=answer=>typeof answer==='object'||answer==='ambiguous';

export function memberVoteRecordQuery(search) {
  const allowed=['lang','scope','limit','offset'];
  for(const key of search.keys())if(!allowed.includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated voting-record parameter.');
  const scope=search.get('scope')??'all';
  if(!['all','final'].includes(scope))throw new HttpError(400,'invalid_scope','Choose all or final votes.');
  function integer(key,fallback,min,max) {
    const raw=search.get(key)??String(fallback),value=Number(raw);
    if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new HttpError(400,'invalid_query',`Invalid ${key}.`);
    return value;
  }
  return {scope,limit:integer('limit',5,0,MEMBER_VOTE_RECORD_LIMITS.departures),offset:integer('offset',0,0,MEMBER_VOTE_RECORD_LIMITS.maxOffset)};
}
export function memberVoteRecordLanguage(search) {
  const value=search.get('lang')??'en';
  if(!/^[a-z]{2}$/.test(value))throw new HttpError(400,'invalid_language','Use a two-letter interface language.');
  return value;
}

const median=values=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:Math.round((sorted[middle-1]+sorted[middle])/2*10000)/10000;
};
const readGroupOn=(db,generation)=>{
  if(generation==null)return null;
  try {
    const row=db.prepare('SELECT body FROM group_history_snapshots WHERE generation=?').get(generation);
    return row?createGroupOn(JSON.parse(row.body)):null;
  }catch{return null;}
};

// Reads only the compact projection. No sitting snapshot is parsed and no
// upstream request is made; missing projection rows stay explicit.
export class MemberVoteRecordReader {
  constructor({snapshots=sittingSnapshots,clock=Date.now}={}){this.snapshots=snapshots;this.clock=clock;}
  query(memberId,query) {
    const id=String(memberId);
    if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))throw new HttpError(400,'invalid_id','Use a positive person identifier.');
    const db=this.snapshots.connection();
    if(!db)throw new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.');
    try {
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='member_vote_record_sittings'").get())throw new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.');
      const today=brusselsDay(this.clock());
      let generation=null;
      try{generation=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='active'").get()?.value??'null');}catch{}
      const groupOn=readGroupOn(db,generation);
      const current=groupOn?groupOn(id,today):'unavailable';
      const group=typeof current==='object'
        ?current.code==='NI'?{code:'NI',status:'non-attached'}:{code:current.code,status:'attached'}
        :{code:null,status:'unavailable'};
      const rows=db.prepare(`SELECT m.body AS body,s.sitting_id AS sittingId,s.date AS date,s.decisions AS decisions
        FROM member_vote_record_members m JOIN member_vote_record_sittings s ON s.sitting_id=m.sitting_id
        WHERE m.member_id=? AND s.snapshot_version=? ORDER BY s.date DESC,s.sitting_id DESC`).all(id,MEMBER_VOTE_SNAPSHOT_VERSION);
      const alignment={all:emptyAlignment(),wholeText:emptyAlignment()};
      const ballots={recorded:0,named:0,chaired:0};
      const bySitting=[],departures=[],withRow=new Set();
      for(const row of rows) {
        const body=JSON.parse(row.body),decisions=JSON.parse(row.decisions);
        withRow.add(row.sittingId);
        for(const key of ['with','against','abstained','notComparable']) {
          alignment.all[key]+=body.alignment?.[key]||0;
          alignment.wholeText[key]+=body.wholeText?.[key]||0;
        }
        ballots.recorded+=body.ballots?.recorded||0;ballots.chaired+=body.ballots?.chaired||0;
        bySitting.push({sittingId:row.sittingId,date:row.date,...Object.fromEntries(['withGroup','comparable','finalWithGroup','finalComparable'].map(key=>[key,body.bySitting?.[key]??null]))});
        for(const departure of body.departures||[]) {
          const decision=decisions[departure.decisionId]||{};
          const title=pickTitle(decision.titles,decision.referenceTexts,query.language);
          departures.push({decisionId:departure.decisionId,sittingId:row.sittingId,date:departure.date,scope:departure.wholeText?'final':'all',wholeText:Boolean(departure.wholeText),
            position:departure.position??null,line:departure.line??null,...title});
        }
      }
      // Named votes only count while the person held a mandate; a sitting whose
      // membership is unknown leaves the total unknown rather than zero.
      const termFirst='MTG-PL-'+CURRENT_TERM_START;
      const sittings=db.prepare('SELECT sitting_id AS sittingId,date,named FROM member_vote_record_sittings WHERE snapshot_version=? AND sitting_id>=?').all(MEMBER_VOTE_SNAPSHOT_VERSION,termFirst);
      let unknown=0;
      for(const sitting of sittings) {
        if(!sitting.named)continue;
        const answer=groupOn?groupOn(id,sitting.date):'unavailable';
        if(withRow.has(sitting.sittingId)||serving(answer))ballots.named+=sitting.named;
        else if(answer!=='not-serving')unknown++;
      }
      if(unknown)ballots.named=null;
      const expected=db.prepare("SELECT COUNT(*) AS n FROM sitting_snapshots WHERE kind='votes' AND version=? AND id>=?").get(MEMBER_VOTE_SNAPSHOT_VERSION,termFirst).n;
      const included=sittings.length;
      const missing=Math.max(0,expected-included);
      const coverage={sittings:expected,included,missing,status:!expected&&!included?'unavailable':missing?'partial':'complete'};
      const period={from:CURRENT_TERM_START,to:rows[0]?.date??null};
      // Medians are published only from a complete projection, so a gap in the
      // stored sittings never shifts them.
      let comparison=null;
      if(group.status==='attached'&&groupOn&&ballots.recorded>0&&coverage.status==='complete') {
        const shares={all:{all:[],same:[]},final:{all:[],same:[]}};
        for(const row of db.prepare('SELECT member_id,body FROM member_vote_record_totals').all()) {
          const totals=JSON.parse(row.body),answer=groupOn(row.member_id,today);
          if(!serving(answer))continue;
          const same=typeof answer==='object'&&answer.code===group.code;
          for(const [key,withKey,comparableKey] of [['all','withGroup','comparable'],['final','finalWithGroup','finalComparable']]) {
            if(!(totals[comparableKey]>0))continue;
            const share=totals[withKey]/totals[comparableKey];
            shares[key].all.push(share);
            if(same)shares[key].same.push(share);
          }
        }
        const pair=key=>{
          const groupMedian=median(shares[key].same),parliamentMedian=median(shares[key].all);
          return groupMedian===null||parliamentMedian===null?null:{group:{median:groupMedian,members:shares[key].same.length},parliament:{median:parliamentMedian,members:shares[key].all.length}};
        };
        comparison={all:pair('all'),final:pair('final')};
      }
      const sorted=departures.sort((a,b)=>(b.wholeText?1:0)-(a.wholeText?1:0)||b.date.localeCompare(a.date)||b.decisionId.localeCompare(a.decisionId))
        .filter(item=>query.scope==='all'||item.wholeText);
      const items=sorted.slice(query.offset,query.offset+query.limit),nextOffset=query.offset+items.length<sorted.length?query.offset+items.length:null;
      return {version:MEMBER_VOTE_RECORD_VERSION,member:{id,uri:'https://data.europarl.europa.eu/person/'+id},period,coverage,group,
        alignment:group.status==='attached'?alignment:null,ballots,bySitting,departures:{scope:query.scope,offset:query.offset,limit:query.limit,total:sorted.length,items,nextOffset},
        comparison,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.');}
  }
}
export const memberVoteRecord=new MemberVoteRecordReader();
