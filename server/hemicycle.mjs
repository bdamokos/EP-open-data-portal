import {createHash} from 'node:crypto';
import {boundedUpstream,upstreamResponseError} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {sharedRequest} from './request-budget.mjs';
import {browserCompatibleUserAgent} from './user-agent.mjs';

export const HEMICYCLE_VERSION='hemicycle-v1';
export const HEMICYCLE_PAGE='https://www.europarl.europa.eu/plenary/en/hemicycle.html';
export const HEMICYCLE_CHAMBERS=['str','bru'];
const HOUR=3600000,CHECK_EVERY=6*HOUR,RETRY_AFTER=HOUR,LIVE_TTL=HOUR,LIVE_RETRY=5*60000,SOURCE_TIMEOUT=30000,MAX_BYTES=1024*1024,MAX_ELEMENT=512,MAX_CHANGES=20;
// Below these a file is damaged or a placeholder, not a seating plan: 720 Members sit in 850+ seats.
const MIN_MEMBERS=300,MIN_SEATS=600,MAX_SEATS=1500;
// The numeric identifiers Parliament's plan uses for the seats that are not Members'.
const INSTITUTIONS=new Map([[999995,'council'],[999998,'commission']]);
// The API and the app use these identifiers where the plan uses display abbreviations.
const GROUP_CODES={EPP:'PPE','Greens/EFA':'Verts/ALE'};
const sourceUrls=chamber=>({
  plan:`https://www.europarl.europa.eu/erpl-public/hemicycle/${chamber}/en.json`,
  // The widget's shared assets are versioned; a retired path surfaces as a recorded check error.
  geometry:`https://www.europarl.europa.eu/commonFrontResources/evostrap/4.0.1/lib/widgets/hemicycle/svg/${chamber}.svg`,
});
const validChamber=chamber=>HEMICYCLE_CHAMBERS.includes(chamber);
const text=(value,limit=200)=>typeof value==='string'&&value.trim()&&value.length<=limit?value.trim():null;

// Both files are parsed as data only, in one pass over bounded tags: this runs in the
// source writer, so hostile or damaged input must not cost more than linear time.
const openingTag=(svg,from)=>{
  const end=svg.indexOf('>',from);
  if(end<0||end-from>MAX_ELEMENT)throw new Error('Hemicycle geometry has a malformed tag.');
  return [svg.slice(from,end),end+1];
};
const isElement=(svg,at,name)=>svg.startsWith(name,at+1)&&/[\s/>]/.test(svg[at+1+name.length]||'');
const skipped=[['<!--','-->'],['<![CDATA[',']]>']];
export function parseGeometry(svg) {
  let viewBox=null;
  const seats=new Map();
  for(let at=svg.indexOf('<');at>=0;at=svg.indexOf('<',at)){
    const section=skipped.find(([open])=>svg.startsWith(open,at));
    if(section){
      const end=svg.indexOf(section[1],at+section[0].length);
      if(end<0)throw new Error('Hemicycle geometry has a malformed tag.');
      at=end+section[1].length;
    }else if(!viewBox&&isElement(svg,at,'svg')){
      const [tag,next]=openingTag(svg,at);
      viewBox=/\sviewBox="0 0 (\d{1,6}(?:\.\d{1,6})?) (\d{1,6}(?:\.\d{1,6})?)"/.exec(tag);
      if(!viewBox)throw new Error('Hemicycle geometry has no viewBox.');
      at=next;
    }else if(viewBox&&isElement(svg,at,'circle')){
      const [element,next]=openingTag(svg,at);
      const attrs=new Map([...element.matchAll(/\s(id|cx|cy|r)="([^"]*)"/g)].map(match=>[match[1],match[2]]));
      const id=attrs.get('id'),[x,y,r]=['cx','cy','r'].map(name=>/^\d{1,6}(?:\.\d{1,6})?$/.test(attrs.get(name)||'')?Number(attrs.get(name)):NaN);
      if(!/^[1-9]\d{0,3}$/.test(id||'')||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(r)||r<=0)throw new Error('Hemicycle geometry has an invalid seat.');
      if(seats.has(Number(id)))throw new Error('Hemicycle geometry repeats a seat.');
      seats.set(Number(id),{x,y,r});
      if(seats.size>MAX_SEATS)throw new Error('Hemicycle geometry has an unexpected seat count.');
      at=next;
    }else at+=1;
  }
  if(!viewBox)throw new Error('Hemicycle geometry has no viewBox.');
  if(seats.size<MIN_SEATS)throw new Error('Hemicycle geometry has an unexpected seat count.');
  return {width:Number(viewBox[1]),height:Number(viewBox[2]),seats};
}

export function normalizePlan(chamber,source,svg) {
  const geometry=parseGeometry(svg);
  if(!Array.isArray(source?.seats)||!Array.isArray(source.groups))throw new Error('Hemicycle plan has an unexpected shape.');
  const sourceDate=Number.isFinite(Date.parse(source.startDate))?new Date(source.startDate).toISOString():null;
  const groups=new Map(source.groups.map(group=>[group?.groupId,text(group?.name?.short)]));
  const assigned=new Map();
  for(const row of source.seats){
    if(!Number.isSafeInteger(row?.seatId)||assigned.has(row.seatId))throw new Error('Hemicycle plan has an invalid seat.');
    // A seat missing from the geometry cannot be drawn, so it is a damaged pair of files.
    if(!geometry.seats.has(row.seatId))throw new Error('Hemicycle plan and geometry disagree.');
    const institution=INSTITUTIONS.get(row.groupId);
    if(row.persId===undefined){if(institution)assigned.set(row.seatId,{institution});continue;}
    const name=text(row.name),short=groups.get(row.groupId);
    if(!Number.isSafeInteger(row.persId)||row.persId<=0||!name||!short)throw new Error('Hemicycle plan has an invalid Member.');
    assigned.set(row.seatId,{
      member:row.persId,name,firstName:text(row.firstName)||'',
      group:GROUP_CODES[short]||short,
      country:/^[a-z]{2}$/.test(row.countryCode||'')?row.countryCode.toUpperCase():null,
    });
  }
  const seats=[...geometry.seats].sort(([a],[b])=>a-b).map(([seat,position])=>({seat,...position,...assigned.get(seat)}));
  const members=seats.filter(seat=>seat.member);
  if(members.length<MIN_MEMBERS||new Set(members.map(seat=>seat.member)).size!==members.length)throw new Error('Hemicycle plan has an unexpected Member list.');
  const plan={chamber,width:geometry.width,height:geometry.height,seats};
  return {...plan,sourceDate,hash:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}

// Who joined, left, moved or changed group between two plans, by exact Member identifier.
export function diffPlans(previous,next) {
  const index=plan=>new Map(plan.seats.filter(seat=>seat.member).map(seat=>[seat.member,seat]));
  const before=index(previous),after=index(next);
  const person=seat=>({member:seat.member,name:seat.name,firstName:seat.firstName,group:seat.group});
  return {
    joined:[...after.values()].filter(seat=>!before.has(seat.member)).map(seat=>({...person(seat),seat:seat.seat})),
    left:[...before.values()].filter(seat=>!after.has(seat.member)).map(seat=>({...person(seat),seat:seat.seat})),
    moved:[...after.values()].filter(seat=>before.has(seat.member)&&before.get(seat.member).seat!==seat.seat).map(seat=>({...person(seat),from:before.get(seat.member).seat,seat:seat.seat})),
    regrouped:[...after.values()].filter(seat=>before.has(seat.member)&&before.get(seat.member).group!==seat.group).map(seat=>({...person(seat),from:before.get(seat.member).group})),
  };
}

// The size limit counts decoded bytes as they arrive; a declared length can be absent or wrong.
async function boundedText(response) {
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let body='',bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)return body+decoder.decode();
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw new Error('Hemicycle source exceeds size limit.');
      body+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
}
// The deadline starts before the shared queue: a paused queue, a slow response and an
// unfinished body must all release the source writer, which renews its lease while it waits.
async function readSource(url,validator,accept,signal,timeoutMs) {
  const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]);
  return boundedUpstream(async admitted=>{
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.any([admitted||deadline,deadline]),headers:{Accept:accept,'User-Agent':browserCompatibleUserAgent('hemicycle'),...(validator?{'If-None-Match':validator}:{})}});
    const busy=upstreamResponseError(response,{source:'website'});if(busy){await response.body?.cancel();throw busy;}
    if(response.status===304){await response.body?.cancel();return {notModified:true,etag:validator};}
    if(response.status!==200){await response.body?.cancel();throw new Error('Hemicycle source returned '+response.status);}
    return {body:await boundedText(response),etag:response.headers.get('etag')};
  },{source:'website',priority:'background',signal:deadline});
}

// The two files change independently. A plan always comes from one complete pair.
export async function fetchHemicyclePlan(chamber,{signal,validators={},timeoutMs=SOURCE_TIMEOUT,onExtraRead}={}) {
  const urls=sourceUrls(chamber);
  let [plan,geometry]=await Promise.all([
    readSource(urls.plan,validators.plan,'application/json',signal,timeoutMs),
    readSource(urls.geometry,validators.geometry,'image/svg+xml',signal,timeoutMs),
  ]);
  if(plan.notModified&&geometry.notModified)return {notModified:true,validators};
  if(plan.notModified||geometry.notModified)onExtraRead?.();
  if(plan.notModified)plan=await readSource(urls.plan,null,'application/json',signal,timeoutMs);
  if(geometry.notModified)geometry=await readSource(urls.geometry,null,'image/svg+xml',signal,timeoutMs);
  return {plan:normalizePlan(chamber,JSON.parse(plan.body),geometry.body),validators:{plan:plan.etag,geometry:geometry.etag}};
}

export function prepareHemicycle(store) {
  store.assertWriter();
  store.db.exec('CREATE TABLE IF NOT EXISTS hemicycle_revisions (chamber TEXT NOT NULL,observed_at INTEGER NOT NULL,hash TEXT NOT NULL,source_date TEXT,body TEXT NOT NULL,diff TEXT,PRIMARY KEY(chamber,observed_at))');
  store.set('hemicycleSchema',1);
}
const hasRevisions=store=>Boolean(store?.db?.prepare("SELECT 1 FROM sqlite_master WHERE name='hemicycle_revisions'").get());
function latestRevision(store,chamber) {
  if(!hasRevisions(store))return null;
  const row=store.db.prepare('SELECT observed_at,hash,source_date,body FROM hemicycle_revisions WHERE chamber=? ORDER BY observed_at DESC LIMIT 1').get(chamber);
  return row?{...JSON.parse(row.body),sourceDate:row.source_date,hash:row.hash,observedAt:row.observed_at}:null;
}

// Runs in the single source writer, like the voting-list collector. Unchanged files
// cost two conditional requests; a changed plan adds one revision and its diff.
export class HemicycleCollector {
  constructor(store,{clock=Date.now,fetchPlan=fetchHemicyclePlan}={}){Object.assign(this,{store,clock,fetchPlan});}
  state(){return this.store.get('hemicycleSources')||{};}
  due(){const now=this.clock(),state=this.state();return HEMICYCLE_CHAMBERS.some(chamber=>(state[chamber]?.nextCheck||0)<=now);}
  write(fn){const run=()=>{this.store.assertWriter();return fn();};return this.store.db.isTransaction?run():this.store.transaction(run);}
  record(chamber,update){this.store.set('hemicycleSources',{...this.state(),[chamber]:{...this.state()[chamber],...update}});}
  async step(worker) {
    const now=this.clock(),chamber=HEMICYCLE_CHAMBERS.find(item=>(this.state()[item]?.nextCheck||0)<=now);
    if(!chamber)return false;
    // A check takes two requests, and a third when only one file changed.
    if(worker.budget-worker.requests<3)return false;
    const held=this.state()[chamber]||{};
    if(worker.requests!==undefined)worker.requests+=2;
    try{
      const result=await this.fetchPlan(chamber,{signal:worker.controller.signal,validators:latestRevision(this.store,chamber)?held.validators:undefined,onExtraRead:()=>{if(worker.requests!==undefined)worker.requests++;}});
      this.write(()=>{
        const checked={checkedAt:now,nextCheck:now+CHECK_EVERY,error:null,validators:result.validators};
        if(result.plan){
          const latest=latestRevision(this.store,chamber);
          if(latest?.hash!==result.plan.hash){
            const {hash,sourceDate,...body}=result.plan;
            // A corrected name or position updates the plan but is not a change to list.
            const diff=latest?diffPlans(latest,result.plan):null;
            this.store.db.prepare('INSERT INTO hemicycle_revisions VALUES (?,?,?,?,?,?)').run(chamber,now,hash,sourceDate,JSON.stringify(body),diff&&Object.values(diff).some(list=>list.length)?JSON.stringify(diff):null);
          }else this.store.db.prepare('UPDATE hemicycle_revisions SET source_date=? WHERE chamber=? AND observed_at=?').run(result.plan.sourceDate,chamber,latest.observedAt);
        }
        this.record(chamber,checked);
      });
    }catch(error){
      if(worker.controller.signal.aborted)throw error;
      // Keep the last good plan and its validators; a bad response never replaces either.
      this.write(()=>this.record(chamber,{checkedAt:now,nextCheck:now+RETRY_AFTER,error:String(error.message).slice(0,200)}));
    }
    return true;
  }
}
export const collectHemicycle=worker=>worker.hemicycle?.step(worker)||false;

function recentChanges(store,chamber) {
  if(!hasRevisions(store))return null;
  return store.db.prepare('SELECT observed_at,source_date,diff FROM hemicycle_revisions WHERE chamber=? AND diff IS NOT NULL ORDER BY observed_at DESC LIMIT ?').all(chamber,MAX_CHANGES)
    .map(row=>({observedAt:new Date(row.observed_at).toISOString(),sourceDate:row.source_date,...JSON.parse(row.diff)}));
}

const live=new Map();
// A process without the index, or before its first check, reads the source directly.
// A failure is held briefly so that page views cannot turn a broken source into repeated requests.
async function livePlan(chamber,{clock,fetchPlan}) {
  const held=live.get(chamber)||{},now=clock();
  if(held.plan&&now-held.at<LIVE_TTL)return held.plan;
  if(!held.pending&&now<(held.retryAt||0)){
    if(held.plan)return held.plan;
    throw new HttpError(503,'hemicycle_unavailable','Seating plan unavailable.');
  }
  if(!held.pending){
    const pending=sharedRequest(signal=>fetchPlan(chamber,{signal}))
      .then(({plan})=>{live.set(chamber,{plan,at:clock()});return plan;})
      .catch(error=>{
        live.set(chamber,{plan:held.plan,at:held.at,retryAt:clock()+LIVE_RETRY});
        if(held.plan)return held.plan;
        if(error instanceof HttpError)throw error;
        throw new HttpError(503,'hemicycle_unavailable','Seating plan unavailable.');
      });
    live.set(chamber,{...held,pending});
    return pending;
  }
  return held.pending;
}
export const clearHemicycleCache=()=>live.clear();

export async function hemicycleResponse(chamber,{store=null,clock=Date.now,fetchPlan=fetchHemicyclePlan}={}) {
  if(!validChamber(chamber))throw new HttpError(404,'not_found','Choose a chamber.');
  // One snapshot, so a concurrent check cannot pair a plan with a newer plan's changes.
  const read=()=>({stored:latestRevision(store,chamber),changes:recentChanges(store,chamber)});
  const {stored,changes}=store?.readSnapshot?store.readSnapshot(read):read();
  const plan=stored||await livePlan(chamber,{clock,fetchPlan});
  return {version:HEMICYCLE_VERSION,chamber,sourcePageUrl:HEMICYCLE_PAGE,sourceDate:plan.sourceDate,width:plan.width,height:plan.height,seats:plan.seats,changes};
}
