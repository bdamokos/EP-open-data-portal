import {generationGroupOn} from './group-attribution.mjs';
import {groupContributions} from './group-aggregation.mjs';
import {sourceAvailability,periodAvailability} from './source-availability.mjs';
import {oralAvailability} from './availability-evidence.mjs';
import {missingSitting,requireLatestSitting} from './meetings-reader.mjs';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {EU_COUNTRIES,countryCode,memberCountry} from './insights-countries.mjs';
import {HttpError} from './http-utils.mjs';
import {array,tail} from './activity-index-model.mjs';
import {canonical,personId} from './insights-model.mjs';
import {refs,voteScope} from './insights-legislation-model.mjs';
import {odpLanguage} from './odp.mjs';
import {brusselsDay} from './insights-store.mjs';
import {LEGISLATION_LIMITS,sourceCacheState,sourceIsTransient} from './insights-legislation.mjs';
import {declaredSpeechEvidence} from './declared-speech-evidence.mjs';
export function participationQuery(search) {
  for(const key of search.keys())if(!['lang','sitting','week','country'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated participation query.');
  const sitting=search.get('sitting'),week=search.get('week'),country=search.get('country');if(country&&!countryCode(country))throw new HttpError(400,'invalid_country','Choose a country of representation.');
  if(sitting&&!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting)||sitting&&week)throw new HttpError(400,'invalid_selection','Choose a sitting or a week.');
  if(week&&(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week))||new Date(week).toISOString().slice(0,10)!==week||new Date(week).getUTCDay()!==1))throw new HttpError(400,'invalid_week','Choose a Monday from the listed plenary weeks.');
  return {language:odpLanguage(search.get('lang')||'en'),sitting,week,country:country?countryCode(country):null};
}
// Exact existing raw-cache keys only. No directory scan or upstream parent fan-out.
export async function cachedEvent(id,directory=process.env.ODP_CACHE_DIR) {
  if(!directory)return null;
  const url='https://data.europarl.europa.eu/api/v2/events/'+id+'?format=application%2Fld%2Bjson';
  const names=[createHash('sha256').update(url).digest('hex')+'.json'],legacy=Buffer.from(url).toString('base64url')+'.json';if(legacy.length<=255)names.push(legacy);
  for(const name of names)try{const file=path.join(directory,name);if((await stat(file)).size>2*1024*1024)continue;const raw=await readFile(file,'utf8'),record=JSON.parse(raw);if(record.url===url&&Array.isArray(record.payload?.data))return record;}catch{}
  return null;
}
async function participationEvent(legislation,id,readEvent,now) {
  const entry=legislation.cache.get(JSON.stringify(['/events/'+id,{}])),memory=entry?.value;
  if(memory&&!sourceIsTransient(memory)&&Number.isFinite(entry.at)&&now-entry.at<LEGISLATION_LIMITS.cacheMs)return memory;
  const disk=await readEvent(id);
  // Old disk events are saved observations. Only a provably newer publication replaces transient evidence.
  return disk&&(!memory||Number.isFinite(disk.fetchedAt)&&Number.isFinite(memory.fetchedAt)&&disk.fetchedAt>memory.fetchedAt)?disk:memory||disk;
}
export function participationRows(topics,results,decisions,speechRows,members,groupOn=()=>'unavailable',includePerson=()=>true) {
  const rows=topics.map(topic=>({...topic,speakerIds:speechRows.has(topic.id)?new Set(speechRows.get(topic.id).filter(row=>row.speechKind==='PLENARY_DEBATE_SPEECH'&&members.has(String(row.mepId))).map(row=>String(row.mepId))):null,voterIds:null,amendmentVotes:null,amendmentIds:new Set(),rollCalls:0,speakerContributions:[...new Map((speechRows.get(topic.id)||[]).filter(r=>r.speechKind==='PLENARY_DEBATE_SPEECH').map(r=>[[r.sourceId,r.mepId,r.date].join('|'),r])).values()].map(r=>({id:String(r.mepId),date:r.date})),voterContributions:[]}));
  const byId=new Map(rows.map(row=>[row.uri,row])),parents=new Map();
  for(const result of results?.payload.data||[])if(tail(result.had_activity_type)==='PLENARY_VOTE_RESULTS')for(const executed of refs(result.executed)){const row=byId.get(executed);if(row)parents.set(canonical(result.id),row);}
  const seen=new Set();
  for(const vote of decisions?.payload.data||[]) {
    const id=canonical(vote.id);if(seen.has(id))continue;seen.add(id);
    for(const row of new Set(refs(vote.inverse_consists_of).map(parent=>parents.get(parent)).filter(Boolean))) {
      row.rollCalls++;row.amendmentVotes??=0;if(voteScope(vote)==='amendment'){row.amendmentIds.add(id);row.amendmentVotes=row.amendmentIds.size;}
      if(!['had_voter_favor','had_voter_against','had_voter_abstention'].some(field=>Object.hasOwn(vote,field)))continue;
      row.voterIds??=new Set();
      const named=new Set(['had_voter_favor','had_voter_against','had_voter_abstention'].flatMap(field=>array(vote[field]).map(personId).filter(Boolean)));
      row.voterContributions.push(...[...named].map(id=>({id,date:vote.activity_date})));
      for(const field of ['had_voter_favor','had_voter_against','had_voter_abstention'])for(const ref of array(vote[field])){const person=personId(ref);if(person&&members.has(person))row.voterIds.add(person);}
    }
  }
  return rows.map(({speakerContributions,voterContributions,...row})=>({...row,groupContributions:{speakers:row.speakerIds===null?null:groupContributions(speakerContributions.filter(p=>includePerson(p.id)),groupOn),voters:row.voterIds===null?null:groupContributions(voterContributions.filter(p=>includePerson(p.id)),groupOn)}}));
}
export async function participation(legislation,store,query,{clock=Date.now,readEvent=cachedEvent}={}) {
  const status=store.status(),groupOn=generationGroupOn(store,status.servingGeneration),catalogue=await legislation.catalogue(),today=brusselsDay(clock());
  const end=query.week?new Date(Date.parse(query.week+'T12:00:00Z')+6*86400_000).toISOString().slice(0,10):null;
  const selected=query.sitting||(!query.week?requireLatestSitting(catalogue,today)?.activity_id:null);
  const sittings=query.week?catalogue.sittings.filter(s=>s.activity_date>=query.week&&s.activity_date<=end):catalogue.sittings.filter(s=>s.activity_id===selected);
  if(!sittings.length)missingSitting(catalogue);
  if(sittings.length>5)throw new HttpError(502,'sitting_calendar_invalid','Too many sitting days in this week.');
  const memberRecords=new Map(store.db.prepare('SELECT id,body FROM members').all().map(row=>[row.id,JSON.parse(row.body)])),members=new Set(memberRecords.keys()),metadata=await legislation.loadMetadata({members:memberRecords,store}),countryOf=id=>memberCountry(id,memberRecords,metadata),all=[],gaps=[],speechProjectionGaps=new Map(),speechProjectionLimits=new Set(),sources=[...(catalogue.sources||[])];
  const countryMetadata=Object.fromEntries([...members].map(id=>[id,metadata.get(id)?.demographicProvenance?.['api:country-of-representation']||{status:countryOf(id)?'available':'missing_acquisition',value:countryOf(id),sources:[],lastAttempt:null}]));
  const recordSource=async(...args)=>{const record=await legislation.record(...args);sources.push({url:record.url,fetchedAt:record.fetchedAt,...sourceCacheState(record)});return record;};
  for(const sitting of sittings) {
    let base;try{base=await legislation.query({language:query.language,sitting:sitting.activity_id,topic:null,vote:null},catalogue,{status,groupOn});}catch{gaps.push({sitting:sitting.activity_id,kind:'agenda-unavailable'});continue;}sources.push(...(base.coverage?.sources||[]));const speechRows=new Map();let results=null,decisions=null;
    if(base.coverage?.agendaError){gaps.push({sitting:sitting.activity_id,kind:'agenda-unavailable'});if(!base.topics.length)continue;}
    if(sitting.activity_date<=today) {
      try{results=await recordSource('/meetings/'+sitting.activity_id+'/vote-results',{limit:50,offset:0});decisions=await recordSource('/meetings/'+sitting.activity_id+'/decisions',{'vote-method':'ROLL_CALL_EV',limit:1,offset:0});if(decisions.payload.data.length>250){decisions={...decisions,payload:{...decisions.payload,data:decisions.payload.data.slice(0,250)}};gaps.push({sitting:sitting.activity_id,kind:'roll-call-limit'});}if(results.payload.data.length>=50)gaps.push({sitting:sitting.activity_id,kind:'vote-result-page-limit'});}catch{gaps.push({sitting:sitting.activity_id,kind:'votes-unavailable'});}
      const parents=refs(sitting.consists_of).filter(uri=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(uri)).slice(0,50);
      for(const uri of parents) {
        const id=tail(uri),record=await participationEvent(legislation,id,readEvent,clock());
        // Missing children or an unresolved node still depend on this record's freshness.
        if(record)sources.push({url:record.url,fetchedAt:record.fetchedAt,...sourceCacheState(record)});
        const event=record?.payload.data.find(node=>canonical(node.id)===uri);
        if(!event||tail(event.had_activity_type)!=='PLENARY_DEBATE'||event.activity_date!==sitting.activity_date)continue;
        if(!array(event.consists_of).length)continue;
        const declared=[...new Set(refs(event.consists_of).filter(uri=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(uri)).map(tail))],children=declared.slice(0,200);
        if(!children.length)continue;
        const projected=children.length?store.db.prepare(`SELECT body FROM items WHERE generation=? AND category='plenary-contributions' AND source_id IN (${children.map(()=>'?').join(',')}) LIMIT 1001`).all(status.servingGeneration,...children).map(row=>JSON.parse(row.body)):[],rows=projected.slice(0,1000);
        const proof=declaredSpeechEvidence({children,parentId:id,parentDate:event.activity_date,nodes:[...array(event.consists_of),...record.payload.data]});
        const missing=new Set();
        for(const [child,observation] of proof.speeches)if(observation.kind==='PLENARY_DEBATE_SPEECH')for(const person of observation.people)if(members.has(person)&&!rows.some(row=>row.sourceId===child&&row.speechKind===observation.kind&&String(row.mepId)===person))missing.add(person);
        for(const target of refs(event.executed)){const topic=base.topics.find(t=>t.uri===target);if(topic){speechRows.set(topic.id,[...(speechRows.get(topic.id)||[]),...rows]);speechProjectionGaps.set(topic.id,new Set([...(speechProjectionGaps.get(topic.id)||[]),...missing]));if(declared.length>children.length||projected.length>rows.length)speechProjectionLimits.add(topic.id);}}
      }
    }
    all.push(...participationRows(base.topics,results,decisions,speechRows,members,groupOn,id=>!query.country||countryOf(id)===query.country).map(row=>({...row,sittingId:sitting.activity_id,upcoming:sitting.activity_date>today})));
  }
  const countryIds=ids=>ids===null?null:new Set([...ids].filter(id=>!query.country||countryOf(id)===query.country));
  const union=(rows,field)=>new Set(rows.flatMap(row=>[...(countryIds(row[field])||[])])).size;
  const window={start:query.week||sittings[0].activity_date,end:end||sittings[0].activity_date};
  const oral=oralAvailability(store,{generation:status.servingGeneration,start:window.start,end:window.end});
  const availability={speakers:oral,voters:sourceAvailability({sourceKey:'named-votes',family:'votes',start:window.start,end:window.end,records:all.filter(row=>row.voterIds!==null).map(row=>row.date),limited:gaps.some(gap=>gap.kind.includes('vote')||gap.kind.includes('roll-call')),today}),amendmentVotes:sourceAvailability({sourceKey:'amendment-roll-calls',family:'votes',start:window.start,end:window.end,records:all.filter(row=>row.amendmentVotes!==null).map(row=>row.date),limited:gaps.some(gap=>gap.kind.includes('vote')||gap.kind.includes('roll-call')),today})};
  const fields={speakers:'speakerIds',voters:'voterIds',amendmentVotes:'amendmentVotes'};
  const classify=(metric,rows,count,date,selectIds=countryIds)=>{
    const source=availability[metric];
    const relevant=rows.filter(row=>metric==='speakers'?row.kind!=='PLENARY_VOTE':row.kind!=='PLENARY_DEBATE');
    const incomplete=relevant.some(row=>row[fields[metric]]===null)||gaps.some(gap=>gap.sitting===rows[0]?.sittingId&&(gap.kind==='agenda-unavailable'||metric!=='speakers'&&/vote|roll-call/.test(gap.kind)));
    // Archive failures stay in the archive notice. An exactly checked debate
    // is limited only by its own missing parent/child links, not another speech.
    return periodAvailability({start:date,end:date},{...source,limited:(metric==='speakers'?rows.some(row=>speechProjectionLimits.has(row.id)):source.limited)||incomplete,gaps:[...(metric==='speakers'?[]:source.gaps),...(metric==='speakers'&&rows.some(row=>selectIds(speechProjectionGaps.get(row.id)||new Set()).size>0)?[{start:date,end:date,reason:'speech-projection-gap'}]:[])]},count,{today});
  };
  const series=sittings.map(s=>{
    const rows=all.filter(row=>row.sittingId===s.activity_id),values={speakers:rows.some(r=>r.speakerIds!==null)?union(rows,'speakerIds'):null,voters:rows.some(r=>r.voterIds!==null)?union(rows,'voterIds'):null,amendmentVotes:rows.some(r=>r.amendmentVotes!==null)?new Set(rows.flatMap(r=>[...r.amendmentIds])).size:null},states={};
    for(const metric of Object.keys(fields)){const result=classify(metric,rows,values[metric],s.activity_date);values[metric]=result.observedCount;states[metric]=result.state;}
    return {date:s.activity_date,...values,availability:states};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const countsFor=(row,idsFor)=>{
    const speakerCount=row.speakerIds===null?null:idsFor(row.speakerIds).size,voterCount=row.voterIds===null?null:idsFor(row.voterIds).size;
    return {speakers:classify('speakers',[row],speakerCount,row.date,idsFor),voters:classify('voters',[row],voterCount,row.date),amendmentVotes:classify('amendmentVotes',[row],row.amendmentVotes,row.date)};
  };
  const countries=EU_COUNTRIES.map(code=>{
    const ids=new Set([...members].filter(id=>countryOf(id)===code));
    return {code,delegationSize:ids.size,topics:all.map(row=>{
      const values=countsFor(row,set=>new Set([...set].filter(id=>ids.has(id)))),speakers=values.speakers.observedCount,voters=values.voters.observedCount;
      return {id:row.id,sittingId:row.sittingId,title:row.title,speakers,voters,availability:{speakers:values.speakers.state,voters:values.voters.state},speakingShare:speakers===null||!ids.size?null:speakers/ids.size*100,votingShare:voters===null||!ids.size?null:voters/ids.size*100};
    })};
  });
  const topics=all.map(row=>{
    const values=countsFor(row,countryIds),whole=countsFor(row,set=>set),{speakerIds,voterIds,amendmentIds,...publicRow}=row;
    // Empty dated buckets need the same source evidence as the topic counts.
    // Positive contributions remain observations, including former members.
    const groups=Object.fromEntries(Object.entries(row.groupContributions).map(([metric,buckets])=>[metric,buckets?.total>0||values[metric].observedCount!==null?buckets&&{...buckets,availability:values[metric].state}:null]));
    return {...publicRow,groupContributions:groups,...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.observedCount])),allSpeakers:whole.speakers.observedCount,allVoters:whole.voters.observedCount,availability:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.state]))};
  });
  return {view:'participation',countryMetadata,availability,country:query.country,countries,topics,series,window,coverage:{catalogueComplete:catalogue.complete,catalogue:catalogue.coverage,indexComplete:status.complete,servingGeneration:status.servingGeneration,topicsWithSpeechLinks:all.filter(r=>r.speakerIds!==null).length,topics:all.length,gaps,sources},basis:'Distinct people on the current roster, using current country of representation. Actual named roll-calls only; intended corrections excluded. Speakers require existing exact cached debate-event links to saved oral contributions. Amendment roll-calls are not a count of amendments tabled and are not assigned to national delegations.'};
}
