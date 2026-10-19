import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';

export const MEMBER_VOTE_WEEKS_VERSION=1;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const monday=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);};

// Read only the serving generation. A retained decision is a navigation hint,
// never evidence of complete coverage or of a particular member's position.
export function memberVoteWeeks(store,{now=Date.now()}={}) {
  const generation=store.get('active')||store.get('working')?.generation||0,today=brusselsDay(now);
  const rows=store.db.prepare(`SELECT source.key,source.fetched_at,
    json_extract(source.body,'$.decisionsUrl') AS source_url,
    json_extract(source.body,'$.decisionsFetchedAt') AS retrieved_at FROM sources source
    WHERE source.generation=? AND source.kind='motion-outcomes'
    AND EXISTS (SELECT 1 FROM json_each(source.body,'$.decisions') decision
      WHERE json_extract(decision.value,'$.id') LIKE 'eli/dl/event/' || substr(source.key,17) || '-DEC-%')
    ORDER BY source.key DESC LIMIT 1001`).all(generation);
  const weeks=new Map();
  for(const row of rows.slice(0,1000)) {
    const match=/^motion-outcomes:(MTG-PL-(\d{4}-\d{2}-\d{2}))$/.exec(row.key);
    if(!match||!validDate(match[2])||match[2]<CURRENT_TERM_START||match[2]>today||!Number.isFinite(Date.parse(row.fetched_at)))continue;
    const week=monday(match[2]),sittings=weeks.get(week)||[];
    const sourceUrl=typeof row.source_url==='string'&&row.source_url.split('?')[0]==='https://data.europarl.europa.eu/api/v2/meetings/'+match[1]+'/decisions'?row.source_url:null;
    sittings.push({id:match[1],date:match[2],sourceUrl,retrievedAt:Number.isFinite(Date.parse(row.retrieved_at))?row.retrieved_at:null});weeks.set(week,sittings);
  }
  return {version:MEMBER_VOTE_WEEKS_VERSION,weeks:[...weeks].sort(([a],[b])=>b.localeCompare(a)).map(([week,sittings])=>({week,sittings})),coverage:{status:'partial',termWide:false,truncated:rows.length>1000,basis:'Weeks with retained decision sources in the serving activity index. Missing weeks and member positions are not assessed.'}};
}
