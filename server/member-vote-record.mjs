import {HttpError} from './http-utils.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {pickTitle} from './member-vote-record-model.mjs';

export const MEMBER_VOTE_RECORD_VERSION=2;
export const MEMBER_VOTE_RECORD_LIMITS=Object.freeze({departures:50,maxOffset:10000});
const emptyAlignment=()=>({with:0,against:0,abstained:0,notComparable:0});
// A group-history answer that places the person in office on that day.

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
  return Math.round((sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2)*10000)/10000;
};
const readGroupOn=(db,generation)=>{
  if(generation==null)return null;
  try {
    const row=db.prepare('SELECT body FROM group_history_snapshots WHERE generation=?').get(generation);
    return row?createGroupOn(JSON.parse(row.body)):null;
  }catch{return null;}
};

function pendingRecord(id,query) {
  return {version:MEMBER_VOTE_RECORD_VERSION,member:{id,uri:'https://data.europarl.europa.eu/person/'+id},period:{from:CURRENT_TERM_START,to:null},
    coverage:{sittings:0,included:0,missing:0,status:'pending'},group:{code:null,status:'unavailable'},alignment:null,ballots:{chaired:0},
    departures:{scope:query.scope,offset:query.offset,limit:query.limit,total:0,items:[],nextOffset:null},comparison:null,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
}

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
      // Before the projection exists the answer is a pending record, not an error to retry.
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='member_vote_record_sittings'").get())return pendingRecord(id,query);
      const today=brusselsDay(this.clock());
      let generation=null;
      try{generation=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='active'").get()?.value??'null');}catch{}
      const groupOn=readGroupOn(db,generation);
      const current=groupOn?groupOn(id,today):'unavailable';
      const group=typeof current==='object'
        ?current.code==='NI'?{code:'NI',status:'non-attached'}:{code:current.code,status:'attached'}
        :{code:null,status:'unavailable'};
      const rows=db.prepare(`SELECT m.body AS body,s.sitting_id AS sittingId,s.date AS date
        FROM member_vote_record_members m JOIN member_vote_record_sittings s ON s.sitting_id=m.sitting_id
        WHERE m.member_id=? AND s.snapshot_version=? ORDER BY s.date DESC,s.sitting_id DESC`).all(id,MEMBER_VOTE_SNAPSHOT_VERSION);
      const alignment={all:emptyAlignment(),wholeText:emptyAlignment()};
      const ballots={chaired:0};
      const departures=[];
      for(const row of rows) {
        const body=JSON.parse(row.body);
        for(const key of ['with','against','abstained','notComparable']) {
          alignment.all[key]+=body.alignment?.[key]||0;
          alignment.wholeText[key]+=body.wholeText?.[key]||0;
        }
        ballots.chaired+=body.ballots?.chaired||0;
        for(const departure of body.departures||[]) {
          departures.push({decisionId:departure.decisionId,sittingId:row.sittingId,date:departure.date,scope:departure.wholeText?'final':'all',wholeText:Boolean(departure.wholeText),
            position:departure.position??null,line:departure.line??null});
        }
      }
      const termFirst='MTG-PL-'+CURRENT_TERM_START;
      const sittings=db.prepare('SELECT date FROM member_vote_record_sittings WHERE snapshot_version=? AND sitting_id>=? AND status=\'projected\'').all(MEMBER_VOTE_SNAPSHOT_VERSION,termFirst);
      // Every stored votes sitting counts except those that held no decisions. One that is not
      // examined yet, or whose voting records are incomplete or conflicting, is missing.
      const stored=db.prepare("SELECT COUNT(*) AS n FROM sitting_snapshots WHERE kind='votes' AND version=? AND id>=?").get(MEMBER_VOTE_SNAPSHOT_VERSION,termFirst).n;
      const examined=db.prepare("SELECT status,COUNT(*) AS n FROM member_vote_record_sittings WHERE snapshot_version=? AND sitting_id>=? GROUP BY status").all(MEMBER_VOTE_SNAPSHOT_VERSION,termFirst);
      const count=status=>examined.find(row=>row.status===status)?.n||0;
      const included=sittings.length;
      const missing=Math.max(0,stored-count('empty')-included);
      const total=included+missing;
      const coverage={sittings:total,included,missing,status:!total?'unavailable':!included?'pending':missing?'partial':'complete'};
      // The period is the stored sittings' range, the same for every member.
      const period={from:CURRENT_TERM_START,to:sittings.reduce((latest,sitting)=>sitting.date>latest?sitting.date:latest,'')||null};
      // Every member's totals cover the same projected sittings, so medians stay
      // comparable with a member's own figures while some sittings are missing.
      let comparison=null;
      if(group.status==='attached'&&groupOn&&included>0) {
        // The group median is taken over the other current members of the same group.
        const shares={all:[],final:[]};
        for(const row of db.prepare('SELECT member_id,body FROM member_vote_record_totals').all()) {
          const answer=groupOn(row.member_id,today);
          if(typeof answer!=='object'||answer.code!==group.code)continue;
          const totals=JSON.parse(row.body);
          for(const [key,withKey,comparableKey] of [['all','withGroup','comparable'],['final','finalWithGroup','finalComparable']])
            if(totals[comparableKey]>0)shares[key].push(totals[withKey]/totals[comparableKey]);
        }
        const pair=key=>{
          const groupMedian=median(shares[key]);
          return groupMedian===null?null:{group:{median:groupMedian,members:shares[key].length}};
        };
        comparison={all:pair('all'),final:pair('final')};
      }
      const sorted=departures.sort((a,b)=>(b.wholeText?1:0)-(a.wholeText?1:0)||b.date.localeCompare(a.date)||b.decisionId.localeCompare(a.decisionId))
        .filter(item=>query.scope==='all'||item.wholeText);
      // Wording is large, so only the sittings on the requested page are read.
      const wording=new Map();
      const items=sorted.slice(query.offset,query.offset+query.limit).map(item=>{
        if(!wording.has(item.sittingId)) {
          const row=db.prepare('SELECT decisions,subjects FROM member_vote_record_sittings WHERE sitting_id=?').get(item.sittingId);
          wording.set(item.sittingId,{decisions:JSON.parse(row?.decisions||'{}'),subjects:JSON.parse(row?.subjects||'{}')});
        }
        const sitting=wording.get(item.sittingId),decision=sitting.decisions[item.decisionId]||{};
        const label=pickTitle(decision.titles,decision.referenceTexts,query.language);
        // The result's own title, only through the exact decision-to-result link.
        const subject=decision.subjectId&&sitting.subjects[decision.subjectId]?pickTitle(sitting.subjects[decision.subjectId],null,query.language):{text:null,language:null};
        return {...item,...label,subject:subject.text?subject:null};
      }),nextOffset=query.offset+items.length<sorted.length?query.offset+items.length:null;
      return {version:MEMBER_VOTE_RECORD_VERSION,member:{id,uri:'https://data.europarl.europa.eu/person/'+id},period,coverage,group,
        alignment:group.status==='attached'?alignment:null,ballots,departures:{scope:query.scope,offset:query.offset,limit:query.limit,total:sorted.length,items,nextOffset},
        comparison,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'member_vote_record_unavailable','Voting records are temporarily unavailable.');}
  }
}
export const memberVoteRecord=new MemberVoteRecordReader();
