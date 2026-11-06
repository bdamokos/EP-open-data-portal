export const MEMBER_VOTE_RECORD_LIMIT=5;
const languages=new Set('bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' '));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const sitting=value=>date(value?.slice(7))&&/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(value);
const position=value=>value===null||['for','against','abstaining'].includes(value);
const share=value=>object(value)&&typeof value.median==='number'&&Number.isFinite(value.median)&&value.median>=0&&value.median<=1&&integer(value.members)&&value.members>0;
const medians=value=>value===null||object(value)&&share(value.group)&&share(value.parliament);
const pair=(a,b)=>a===null&&b===null||integer(a)&&integer(b)&&a<=b;
const alignment=value=>object(value)&&['with','against','abstained','notComparable'].every(key=>integer(value[key]));

export function memberVoteRecordRoute(memberId,{language='en',scope='all',limit=MEMBER_VOTE_RECORD_LIMIT,offset=0}={}) {
  if(!/^[1-9]\d*$/.test(String(memberId))||!Number.isSafeInteger(Number(memberId)))throw new RangeError('Invalid member identifier.');
  if(!languages.has(language)||!['all','final'].includes(scope)||!integer(limit)||limit>50||!integer(offset)||offset>10000)throw new RangeError('Invalid voting-record request.');
  const query=new URLSearchParams({lang:language,scope,limit:String(limit),offset:String(offset)});
  return 'member-vote-record/'+memberId+'?'+query;
}

export function validateMemberVoteRecordResponse(data,{memberId}={}) {
  if(!object(data)||data.version!==1||data.member?.id!==String(memberId)||typeof data.member?.uri!=='string')return false;
  if(!object(data.period)||!date(data.period.from)||data.period.to!==null&&!date(data.period.to))return false;
  const coverage=data.coverage;
  if(!object(coverage)||!integer(coverage.sittings)||!integer(coverage.included)||!integer(coverage.missing)||
    coverage.included>coverage.sittings||coverage.missing!==coverage.sittings-coverage.included||
    !['complete','partial','pending','unavailable'].includes(coverage.status))return false;
  if(!object(data.group)||!['attached','non-attached','unavailable'].includes(data.group.status)||
    data.group.code!==null&&typeof data.group.code!=='string')return false;
  if(data.alignment!==null&&(!object(data.alignment)||!alignment(data.alignment.all)||!alignment(data.alignment.wholeText)))return false;
  if(!object(data.ballots)||!['recorded','chaired'].every(key=>integer(data.ballots[key]))||data.ballots.named!==null&&!integer(data.ballots.named))return false;
  if(!Array.isArray(data.bySitting)||data.bySitting.length>coverage.sittings)return false;
  if(!data.bySitting.every(day=>object(day)&&sitting(day.sittingId)&&day.date===day.sittingId.slice(7)&&
    pair(day.withGroup,day.comparable)&&pair(day.finalWithGroup,day.finalComparable)))return false;
  const departures=data.departures;
  if(!object(departures)||!['all','final'].includes(departures.scope)||!integer(departures.offset)||
    !integer(departures.limit)||departures.limit>50||!integer(departures.total)||!Array.isArray(departures.items)||
    departures.items.length>departures.limit||departures.items.length>0&&departures.offset+departures.items.length>departures.total)return false;
  if(departures.nextOffset!==null&&(!integer(departures.nextOffset)||departures.nextOffset!==departures.offset+departures.items.length))return false;
  if(!departures.items.every(item=>object(item)&&/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(item.decisionId||'')&&
    sitting(item.sittingId)&&date(item.date)&&['all','final'].includes(item.scope)&&typeof item.wholeText==='boolean'&&
    position(item.position)&&position(item.line)&&
    (item.text===null&&item.language===null||typeof item.text==='string'&&(languages.has(item.language)||item.language==='mul'))&&
    (item.subject==null||object(item.subject)&&typeof item.subject.text==='string'&&(languages.has(item.subject.language)||item.subject.language==='mul'))))return false;
  if(data.comparison!==null&&!(object(data.comparison)&&medians(data.comparison.all)&&medians(data.comparison.final)))return false;
  return typeof data.attribution==='string';
}

export function recordAlignment(data,scope='all') {
  const counts=data.alignment?.[scope==='final'?'wholeText':'all'];
  if(!counts)return null;
  const total=counts.with+counts.against+counts.abstained+counts.notComparable;
  const comparable=counts.with+counts.against;
  return {...counts,total,comparable,withShare:comparable?counts.with/comparable:null,againstShare:comparable?counts.against/comparable:null};
}

export function recordTrend(data,scope='all') {
  const [withKey,comparableKey]=scope==='final'?['finalWithGroup','finalComparable']:['withGroup','comparable'];
  return [...data.bySitting].sort((a,b)=>a.date.localeCompare(b.date)||a.sittingId.localeCompare(b.sittingId))
    .map(day=>({sittingId:day.sittingId,date:day.date,withGroup:day[withKey],comparable:day[comparableKey],share:day[comparableKey]?day[withKey]/day[comparableKey]:null}));
}

export function recordComparison(data,scope='all') {
  return data.comparison?.[scope==='final'?'final':'all']??null;
}

export function recordSummary(data) {
  const totals=recordAlignment(data,'all');
  return {
    attached:data.group.status==='attached',
    share:totals?.withShare??null,
    comparable:totals?.comparable??0,
    recorded:data.ballots.recorded,
    named:data.ballots.named,
    chaired:data.ballots.chaired,
  };
}

export function recordShare(value) {
  return typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000)/10:null;
}
