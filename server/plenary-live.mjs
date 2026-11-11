import {XMLParser} from 'fast-xml-parser';
import {boundedUpstream,odp,upstreamResponseError} from './odp.mjs';
import {sharedRequest,waitForRequest} from './request-budget.mjs';
import {browserCompatibleUserAgent,userAgent} from './user-agent.mjs';
import {sittingSnapshots,SITTING_CALENDAR_VERSION} from './sitting-snapshot-store.mjs';
import {identifiedPlenarySitting} from './plenary-calendar.mjs';
import {brusselsMidnight} from './plenary-cache-policy.mjs';

export const EBS_PLUS_URL='https://8hwk2cyeyb.execute-api.eu-west-1.amazonaws.com/parrotfish-prod/ebs/live/EBSPLUS';
export const PLENARY_LIVE_VERSION='plenary-live-v2';
export const EBS_PLUS_CHANNEL='6082c9bb97ad8b2acf7fcc98';
export const EBS_PLUS_EMBED='https://audiovisual.ec.europa.eu/embed/ebsplus?language=EN';
export const liveDebateUrl=day=>'https://www.europarl.europa.eu/plenary/en/getSpeakerListAndPlenaryMessages.html?dateSys='+day.replaceAll('-','');
export const brusselsDay=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const stamp=time=>new Date(time).toISOString();
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const tail=value=>String(value||'').split('/').at(-1);
const CHECK_MS=30_000;

// Sitting dates from a complete retained calendar, or null without one.
// Every day counts as a sitting day until the calendar says otherwise.
export function retainedSittingDates(year,reader=sittingSnapshots) {
  const value=reader.read('calendar',SITTING_CALENDAR_VERSION,String(year),{retained:true});
  if(value?.coverage?.state!=='complete'||!Array.isArray(value.nodes))return null;
  return new Set(value.nodes.filter(identifiedPlenarySitting).map(node=>node.activity_date));
}
const nextBrusselsMidnight=day=>brusselsMidnight(new Date(Date.parse(day+'T12:00:00Z')+86400_000).toISOString().slice(0,10));

// A quiet answer stays true until the next Brussels day: the CDN may keep it
// that long, and clients wait for nextCheckAt. Sitting days are never cached.
export function plenaryLiveCachePolicy(value,now=Date.now()) {
  const seconds=Math.floor((Date.parse(value?.nextCheckAt)-now)/1000);
  if(value?.status!=='off-air'||value.current||!(seconds>=120))return {cacheControl:'no-store',cdnCacheControl:'no-store'};
  return {cacheControl:'public, max-age=0',cdnCacheControl:`public, max-age=${seconds}, stale-if-error=0`};
}

// The feed supplies Brussels wall-clock times, including its last update.
export function brusselsTime(day,time) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))return NaN;
  const parts=(day+'T'+time).match(/\d+/g).map(Number);
  const utc=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]||0);
  const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const local=formatter.format(utc).replace(' ','T');
  const result=utc-(Date.parse(local+'Z')-utc);
  return formatter.format(result).replace(' ','T')===day+'T'+time+(time.length===5?':00':'')?result:NaN;
}

export function currentDebate(feed,day,now) {
  const date=day.split('-').reverse().join('-');
  const update=typeof feed?.lastUpdate==='string'&&feed.lastUpdate.match(/^(\d{2})-(\d{2})-(\d{4}) - (\d{2}:\d{2})$/);
  const updated=update?brusselsTime(`${update[3]}-${update[2]}-${update[1]}`,update[4]):NaN;
  // The feed updates when the speaker changes, so a long speech or a vote keeps
  // an old update time. The item's and speaker's scheduled ends extend it, up
  // to two hours after the last update; a frozen feed still expires.
  const ends=[feed?.currentEndTime,feed?.currentMepSpeaker?.end,feed?.currentNoMepSpeaker?.end].filter(time=>typeof time==='string'&&/^\d{2}:\d{2}:\d{2}$/.test(time)).map(time=>brusselsTime(day,time)).filter(end=>end>updated&&end-updated<=7200_000);
  const holds=Math.max(updated,...ends)+180_000;
  if(feed?.currentDate!==date||!Number.isFinite(updated)||now>holds||updated-now>60_000||feed.plenaryMessages||!['DEB','VOT','EXP'].includes(feed.type)||!/^D\d{1,10}$/.test(feed.debateId||'')||typeof feed.currentTitle!=='string'||!feed.currentTitle.trim()||feed.currentTitle.length>3000)return null;
  // This is the source's current debate, not an inferred ODP agenda identity.
  return {id:feed.debateId,title:feed.currentTitle,language:'en',updatedAt:stamp(updated),sourceUrl:liveDebateUrl(day)};
}

const parser=new XMLParser({ignoreAttributes:true,parseTagValue:false,processEntities:true});
export function liveBroadcast(programme,day,now) {
  if(programme?.channelId!==EBS_PLUS_CHANNEL||programme.status!=='PUBLISHED'||programme.broadcastStatus!=='LIVE'||!/^[a-f0-9]{24}$/.test(programme.id||''))return null;
  const start=Date.parse(programme.startDatetime);
  if(!Number.isFinite(start)||start>now+60_000||now-start>14*3600_000||brusselsDay(start)!==day)return null;
  const title=list(programme.titles).find(t=>t?.language==='EN')?.content;
  if(typeof title!=='string'||title.length>6000||/<!DOCTYPE|<!ENTITY/i.test(title))return null;
  let paragraphs;try{paragraphs=list(parser.parse('<title>'+title+'</title>').title?.p);}catch{return null;}
  // An explicit broadcaster programme classification, never a title join to ODP.
  if(typeof paragraphs[0]!=='string'||paragraphs[0].trim()!=='EP Plenary Session')return null;
  const transmissions=list(programme.transmissions);
  // Brussels sittings are published without transmissions; any that are listed must be the EP's own.
  if(transmissions.some(t=>t?.status!=='PUBLISHED'||t.media?.status!=='PUBLISHED'||t.media?.locked!==false||!list(t.media?.institutions).some(i=>i?.id==='2618')))return null;
  const languages=list(programme.languages).filter(l=>typeof l==='string'&&/^[A-Z]{2,3}$/.test(l)).slice(0,30);
  if(!languages.includes('EN'))return null;
  return {id:programme.id,channel:'EbS+',title:paragraphs.filter(p=>typeof p==='string').map(p=>p.trim()).join(' — '),language:'en',languages,start:stamp(start),embedUrl:EBS_PLUS_EMBED,websiteUrl:'https://audiovisual.ec.europa.eu/en/ebs/grid?ebs=no&ebsplus=yes',sourceUrl:EBS_PLUS_URL};
}

export function scheduledAgenda(rows,day,now) {
  if(!Array.isArray(rows)||rows.length>100||rows.some(row=>!row||typeof row!=='object'))return {state:'unavailable',items:[]};
  const sitting='MTG-PL-'+day,prefix=sitting+'-OJ-ITM-',byId=new Map(rows.map(row=>[tail(row.id),row]));
  const blocks=rows.filter(row=>tail(row.had_activity_type)==='MEETING_PART'&&row.activity_id?.startsWith(sitting+'-TF-')).flatMap(row=>{
    const starts=[...new Set(list(row.activity_start_date))],ends=[...new Set(list(row.activity_end_date))];
    const parsedStarts=starts.map(Date.parse),parsedEnds=ends.map(Date.parse);
    // Only discard a block when every published possibility rules out now.
    // Missing or conflicting timing must not make a competing block disappear.
    if(parsedStarts.length&&parsedStarts.every(start=>Number.isFinite(start)&&start>now)||parsedEnds.length&&parsedEnds.every(end=>Number.isFinite(end)&&end<=now))return [];
    const children=[...new Set(list(row.consists_of).map(tail))];
    const items=children.map(id=>byId.get(id)).filter(item=>item?.activity_id?.startsWith(prefix)&&item.activity_date===day&&['PLENARY_DEBATE','PLENARY_VOTE'].includes(tail(item.had_activity_type))).map(item=>({id:item.activity_id,titles:item.activity_label||{},kind:tail(item.had_activity_type)}));
    const timingCertain=starts.length===1&&ends.length===1&&Number.isFinite(parsedStarts[0])&&Number.isFinite(parsedEnds[0])&&parsedEnds[0]>parsedStarts[0];
    const childrenCertain=children.length===1&&items.length===1&&rows.filter(candidate=>tail(candidate.id)===children[0]).length===1;
    return [{id:row.activity_id,starts,ends,items,conflict:!timingCertain||!childrenCertain}];
  });
  const items=[...new Map(blocks.flatMap(block=>block.items).map(item=>[item.id,item])).values()];
  const unique=blocks.length===1&&!blocks[0].conflict&&items.length===1;
  return {state:unique?'presumed':blocks.length?'ambiguous':'none',sittingId:sitting,items,blocks:blocks.map(({items,...block})=>block)};
}

// www.europarl.europa.eu answers 403 to other agent forms (see user-agent.mjs).
export const liveSourceAgent=url=>new URL(url).hostname==='www.europarl.europa.eu'?browserCompatibleUserAgent('live plenary metadata'):userAgent('live plenary metadata');
async function readJson(url,signal) {
  return boundedUpstream(async()=>{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':liveSourceAgent(url)},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    const limited=upstreamResponseError(response,{source:'website'});
    if(limited){await response.body?.cancel();throw limited;}
    if(!response.ok||!/^application\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('Live source unavailable.');}
    const reader=response.body.getReader();let bytes=0;const chunks=[];
    try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>512*1024)throw new Error('Live source exceeds its size limit.');chunks.push(value);}}
    finally {await reader.cancel().catch(()=>{});}
    // EbS+ answers an empty body when it lists no current programme.
    if(!bytes)return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  },{source:'website',signal});
}

export class PlenaryLive {
  constructor({clock=Date.now,read=readJson,readAgenda=odp,sittingDates=retainedSittingDates}={}){this.clock=clock;this.read=read;this.readAgenda=readAgenda;this.sittingDates=sittingDates;this.saved=null;this.pending=null;this.lastLive=null;}
  async snapshot() {
    const now=this.clock(),day=brusselsDay(now);
    if(!this.saved||this.saved.day!==day||now-this.saved.at>=CHECK_MS){
      if(!this.pending)this.pending=sharedRequest(async signal=>{
        const sources=[];
        const collect=async(url,operation)=>{try{const value=await operation();sources.push({url,fetchedAt:stamp(this.clock()),available:true});return value;}catch{sources.push({url,fetchedAt:stamp(this.clock()),available:false});return null;}};
        const agendaUrl=`https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-${day}/foreseen-activities`;
        const agenda=async()=>{
          try {
            const rows=[],deadline=AbortSignal.any([signal,AbortSignal.timeout(8000)]);
            for(let offset=0;offset<100;offset+=50){
              const record=await this.readAgenda(`/meetings/MTG-PL-${day}/foreseen-activities`,{limit:50,offset},{ttl:60_000,signal:deadline});
              if(!Array.isArray(record.payload?.data)||record.stale)throw new Error('Agenda unavailable.');
              sources.push({url:record.url||agendaUrl+'?limit=50&offset='+offset,fetchedAt:stamp(record.fetchedAt??this.clock()),available:true});
              rows.push(...record.payload.data);
              if(record.payload.data.length<50)return rows;
            }
            throw new Error('Agenda exceeds live-view bound.');
          }catch{sources.push({url:agendaUrl,fetchedAt:stamp(this.clock()),available:false});return null;}
        };
        const [feed,programme,rows]=await Promise.all([
          collect(liveDebateUrl(day),()=>this.read(liveDebateUrl(day),signal)),
          collect(EBS_PLUS_URL,()=>this.read(EBS_PLUS_URL,signal)),
          agenda()
        ]);
        signal.throwIfAborted();
        this.saved={day,at:this.clock(),feed,programme,rows,sources};
      },12_000).finally(()=>{this.pending=null;});
      try{await waitForRequest(this.pending);}catch{return {status:'unavailable',checkedAt:stamp(now),validUntil:stamp(now),nextCheckAt:stamp(now+CHECK_MS),current:null,broadcast:null,agenda:{state:'unavailable',items:[]},sources:[]};}
    }
    const saved=this.saved;
    // Never carry a previous day's response across midnight or a slow refresh.
    if(saved.day!==brusselsDay(this.clock()))return {status:'unavailable',checkedAt:stamp(now),validUntil:stamp(now),nextCheckAt:stamp(now+CHECK_MS),current:null,broadcast:null,agenda:{state:'unavailable',items:[]},sources:[]};
    // EbS+ sometimes lists no programme for a minute or two mid-broadcast. Bridge
    // such a gap from a plenary seen live in the last two minutes; a failed read
    // or a different programme is never bridged.
    const bridged=saved.programme&&!saved.programme.id&&this.lastLive?.day===day&&saved.at-this.lastLive.at<=120_000;
    const current=currentDebate(saved.feed,day,this.clock()),broadcast=liveBroadcast(bridged?this.lastLive.programme:saved.programme,day,this.clock());
    if(broadcast&&!bridged)this.lastLive={day,at:saved.at,programme:saved.programme};
    else if(saved.programme?.id&&!broadcast)this.lastLive=null; // EbS+ named another programme: coverage ended.
    let sittings=null;try{sittings=this.sittingDates(Number(day.slice(0,4)));}catch{/* No calendar: check as on a sitting day. */}
    // Only an observed off-air programme is quiet: a live broadcast or debate
    // outweighs the calendar, and a failed programme read is never kept. The
    // debate feed has no answer on days without a sitting, so its gap does not
    // count; a sitting in progress still shows as an EbS+ plenary broadcast.
    const quiet=Boolean(saved.programme)&&!broadcast&&!current&&sittings?.has(day)===false;
    const nextCheck=quiet?nextBrusselsMidnight(day)+60_000:saved.at+CHECK_MS;
    return {status:broadcast?'live':saved.programme?'off-air':'unavailable',checkedAt:stamp(saved.at),validUntil:stamp(quiet?nextCheck:saved.at+75_000),nextCheckAt:stamp(nextCheck),current,broadcast,agenda:scheduledAgenda(saved.rows,day,this.clock()),sources:saved.sources};
  }
}

export const plenaryLive=new PlenaryLive();
