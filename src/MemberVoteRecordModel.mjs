export const MEMBER_VOTE_RECORD_LIMIT=5;
const languages=new Set('bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' '));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const sitting=value=>date(value?.slice(7))&&/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(value);
const position=value=>value===null||['for','against','abstaining'].includes(value);
const share=value=>object(value)&&typeof value.median==='number'&&Number.isFinite(value.median)&&value.median>=0&&value.median<=1&&integer(value.members)&&value.members>0;
const medians=value=>value===null||object(value)&&share(value.group);
const alignment=value=>object(value)&&['with','against','abstained','notComparable'].every(key=>integer(value[key]));

export const memberVoteRecordTag=value=>typeof value==='string'&&/^(?:topic:\d{1,8}|country:[A-Z0-9_]{2,8})$/.test(value);
export function memberVoteRecordRoute(memberId,{language='en',scope='all',limit=MEMBER_VOTE_RECORD_LIMIT,offset=0,tag=null}={}) {
  if(!/^[1-9]\d*$/.test(String(memberId))||!Number.isSafeInteger(Number(memberId)))throw new RangeError('Invalid member identifier.');
  if(!languages.has(language)||!['all','final'].includes(scope)||!integer(limit)||limit>50||!integer(offset)||offset>10000||tag!==null&&!memberVoteRecordTag(tag))throw new RangeError('Invalid voting-record request.');
  const query=new URLSearchParams({lang:language,scope,limit:String(limit),offset:String(offset)});
  if(tag!==null)query.set('tag',tag);
  return 'member-vote-record/'+memberId+'?'+query;
}

export function validateMemberVoteRecordResponse(data,{memberId}={}) {
  if(!object(data)||data.version!==3||data.member?.id!==String(memberId)||typeof data.member?.uri!=='string')return false;
  if(!object(data.period)||!date(data.period.from)||data.period.to!==null&&!date(data.period.to))return false;
  const coverage=data.coverage;
  if(!object(coverage)||!integer(coverage.sittings)||!integer(coverage.included)||!integer(coverage.missing)||
    coverage.included>coverage.sittings||coverage.missing!==coverage.sittings-coverage.included||
    !['complete','partial','pending','unavailable'].includes(coverage.status))return false;
  if(!object(data.group)||!['attached','non-attached','unavailable'].includes(data.group.status)||
    data.group.code!==null&&typeof data.group.code!=='string')return false;
  if(data.alignment!==null&&(!object(data.alignment)||!alignment(data.alignment.all)||!alignment(data.alignment.wholeText)))return false;
  if(!object(data.ballots)||!integer(data.ballots.chaired))return false;
  const row=value=>object(value)&&memberVoteRecordTag(value.key)&&typeof value.label==='string'&&value.label.length>0&&(languages.has(value.language)||value.language==='mul')&&
    integer(value.comparable)&&integer(value.withGroup)&&value.withGroup<=value.comparable&&typeof value.share==='number'&&value.share>=0&&value.share<=1;
  const list=value=>object(value)&&integer(value.eligible)&&Array.isArray(value.rows)&&value.rows.length<=value.eligible&&value.rows.every(row);
  if(data.breakdown!==null&&!(object(data.breakdown)&&typeof data.breakdown.overall==='number'&&list(data.breakdown.topics)&&list(data.breakdown.countries)))return false;
  const departures=data.departures;
  if(departures?.tag!==null&&!(object(departures?.tag)&&memberVoteRecordTag(departures.tag.key)))return false;
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

export function recordComparison(data,scope='all') {
  return data.comparison?.[scope==='final'?'final':'all']??null;
}

export function recordShare(value) {
  return typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000)/10:null;
}
