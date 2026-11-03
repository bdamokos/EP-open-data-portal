import {retainSittingBallotBindings} from './your-vote-ballot.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {createHash} from 'node:crypto';
import {docxContent} from './document-text.mjs';
import {parseVotingList,VOTING_LIST_PAGE,VOTING_LISTS_VERSION} from './voting-lists.mjs';
import {SittingSnapshotReader} from './sitting-snapshot-store.mjs';
import {calendarDate,currentTermSittings} from './plenary-calendar.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {brusselsInstant} from './press-releases.mjs';
import {boundedUpstream,upstreamResponseError} from './odp.mjs';
import {browserCompatibleUserAgent} from './user-agent.mjs';
import {HttpError} from './http-utils.mjs';
const HOUR=3600000,DAY=24*HOUR;
const addDays=(date,n)=>new Date(Date.parse(date+'T12:00Z')+n*DAY).toISOString().slice(0,10);
const hour=now=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'}).format(now));
export function votingListSessions(nodes){
  const dates=[...new Set(currentTermSittings(nodes,'9999-12-31',{heldOnly:false}).map(n=>n.activity_date))].sort(),sessions=[];
  for(const date of dates){let session=sessions.at(-1);if(!session||addDays(session.last,1)!==date){session={first:date,last:date,sittings:[]};sessions.push(session);}session.last=date;session.sittings.push('MTG-PL-'+date);}
  return sessions.map(s=>({...s,start:Date.parse(brusselsInstant(addDays(s.first,-4)+'T07:00:00')),end:Date.parse(brusselsInstant(s.last+'T23:00:00')),purgeAt:Date.parse(brusselsInstant(addDays(s.last,30)+'T00:00:00'))}));
}
export function allowedVotingListUrl(value){try{const u=new URL(value,VOTING_LIST_PAGE),decoded=decodeURIComponent(u.pathname);if(decoded.includes('\\'))return null;if(u.origin!=='https://www.europarl.europa.eu'||u.username||u.password||!/^\/sedcms\/(?:votingList\/|pubfile\/VOTING_SCHEDULE\/)[^/]+\.docx$/i.test(decoded))return null;u.search='';u.hash='';return u.href;}catch{return null;}}
const activeSessionKey=sessions=>JSON.stringify(sessions.map(s=>s.first).sort());
const localTime=(day,time)=>Date.parse(brusselsInstant(day+'T'+time));
const pageCheckAt=(page,now)=>Math.max(page.nextCheck||now,localTime(brusselsDay(now),'07:00:00'));
// Until an agenda is needed, 23:00 bounds the possible sitting-day hourly window.
function fileCheckAt(source,now,ends=new Map()) {
  const {body}=source,checked=body.checkedAt||0,retry=body.retryAt||0;
  const ordinary=Math.max(source.next_check,checked?checked+6*HOUR:0,retry);
  if(body.schedule||!source.sitting)return ordinary;
  const day=source.sitting.slice(7),start=localTime(day,'06:00:00'),end=ends.has(source.sitting)?ends.get(source.sitting):localTime(day,'23:00:00');
  const frequent=Math.max(start,checked?checked+HOUR:now,retry);
  return Math.min(ordinary,now<=end&&frequent<=end?frequent:Infinity);
}
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function discoverVotingLists(html,sessions){
  const links=[],gaps=[];let sittingId=null,session=null,sectionSitting=null,sectionSession=null;
  const scope=()=>({sittingId:sectionSitting,sessionFirst:sectionSession?.first||session?.first||null,sessionLast:sectionSession?.last||session?.last||null});
  for(const m of html.matchAll(/<h[34]\b[^>]*>[\s\S]*?<\/h[34]>|<a\b[^>]*href="([^"]+)"[^>]*>/gi)){
    if(/^<h/i.test(m[0])){
      const text=plain(m[0]),dates=[...text.matchAll(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{1,2}) ([A-Za-z]+) (\d{4})/g)].map(d=>{const at=Date.parse(`${d[2]} ${d[1]}, ${d[3]} 12:00:00 GMT`);return Number.isFinite(at)?new Date(at).toISOString().slice(0,10):null;});
      if(dates.length>1){sectionSession={first:dates[0],last:dates.at(-1)};sectionSitting=null;session=sessions.find(s=>s.first===dates[0]&&s.last===dates.at(-1))||null;sittingId=null;}
      else if(dates.length===1){sectionSitting='MTG-PL-'+dates[0];if(!sectionSession||dates[0]<sectionSession.first||dates[0]>sectionSession.last)sectionSession={first:dates[0],last:dates[0]};sittingId=sectionSitting;session=sessions.find(s=>s.sittings.includes(sittingId))||null;if(!session)sittingId=null;}continue;
    }
    const raw=m[1].replace(/&amp;/g,'&'),url=allowedVotingListUrl(raw);if(!url)continue;
    const schedule=url.includes('/VOTING_SCHEDULE/');
    if(!session||!schedule&&!sittingId){gaps.push({code:'unmapped-section',message:'A voting list has no known sitting section.',sourceUrl:url,...scope()});continue;}
    if(links.length>=120){gaps.push({code:'discovery-cap',message:'Voting list discovery limit reached.',...scope()});break;}
    if(!links.some(l=>l.url===url&&l.sittingId===sittingId))links.push({url,sittingId:schedule?null:sittingId,sessionFirst:session.first,purgeAt:session.purgeAt,linkVersion:new URL(raw,VOTING_LIST_PAGE).searchParams.get('version'),schedule});
  }return {links,gaps};
}
export async function fetchVotingList(url,{signal,etag,lastModified}={}){
  if(url!==VOTING_LIST_PAGE&&!allowedVotingListUrl(url))throw new Error('Unsupported voting-list source.');
  return boundedUpstream(async admitted=>{
    const response=await fetch(url,{redirect:'error',headers:{Accept:url===VOTING_LIST_PAGE?'text/html':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','User-Agent':browserCompatibleUserAgent('voting lists'),...(etag?{'If-None-Match':etag}:{}),...(lastModified?{'If-Modified-Since':lastModified}:{})},signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[]),...(admitted?[admitted]:[])])});
    const error=upstreamResponseError(response,{source:'website'});if(error){await response.body?.cancel();throw error;}
    const meta={status:response.status,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
    if(response.status===304){await response.body?.cancel();return meta;}
    if(response.status!==200){await response.body?.cancel();throw new Error('Voting-list source returned '+response.status);}
    const reader=response.body.getReader(),parts=[];let bytes=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw new Error('Voting-list source exceeds size limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
    return {...meta,buffer:Buffer.concat(parts)};
  },{source:'website',priority:'background',signal});
}
export function prepareVotingLists(store){store.assertWriter();store.db.exec(`CREATE TABLE IF NOT EXISTS voting_list_sources (url TEXT,sitting TEXT NOT NULL,body TEXT NOT NULL,next_check INTEGER NOT NULL,purge_at INTEGER NOT NULL,PRIMARY KEY(url,sitting)); CREATE TABLE IF NOT EXISTS voting_list_revisions (url TEXT,sitting TEXT NOT NULL,hash TEXT NOT NULL,observed_at TEXT NOT NULL,body TEXT NOT NULL,purge_at INTEGER NOT NULL,PRIMARY KEY(url,sitting,hash)); CREATE INDEX IF NOT EXISTS voting_list_expiry ON voting_list_revisions(purge_at);`);store.set('votingListSchema',1);}
export class VotingListStore {
  constructor(store,{clock=Date.now}={}){this.store=store;this.clock=clock;}
  votingListsForSitting(sittingId){
    const db=this.store.db;if(!db?.prepare("SELECT 1 FROM sqlite_master WHERE name='voting_list_revisions'").get())return [];
    const rows=db.prepare('SELECT url,body FROM voting_list_revisions WHERE sitting=? AND purge_at>? ORDER BY observed_at DESC,hash').all(sittingId,this.clock()),seen=new Set(),result=[];
    const latest=new Map(db.prepare('SELECT url,body FROM voting_list_sources WHERE sitting=? AND purge_at>?').all(sittingId,this.clock()).map(row=>[row.url,JSON.parse(row.body)]));
    const documents=rows.map(row=>({...row,body:JSON.parse(row.body)})).sort((a,b)=>{
      const aLatest=latest.get(a.url)?.latestHash===a.body.revision.sha256,bLatest=latest.get(b.url)?.latestHash===b.body.revision.sha256;
      return Number(bLatest)-Number(aLatest)||(latest.get(b.url)?.checkedAt||0)-(latest.get(a.url)?.checkedAt||0);
    });
    for(const row of documents){const key=row.body.documentId||row.url;if(seen.has(key))continue;seen.add(key);const body=row.body;body.revisions=documents.filter(r=>(r.body.documentId||r.url)===key).map(({body:b})=>({sha256:b.revision.sha256,observedAt:b.revision.observedAt,versionLabel:b.versionLabel}));result.push(body);}return result;
  }
}
export class VotingListCollector {
  constructor(store,{clock=Date.now,fetchSource=fetchVotingList,snapshots=new SittingSnapshotReader({db:store.db,clock}),sessions=null}={}){Object.assign(this,{store,clock,fetchSource,snapshots,sessionOverride:sessions});}
  sessions(){return this.sessionOverride||votingListSessions([0,1].flatMap(offset=>this.snapshots.read('calendar',1,String(Number(brusselsDay(this.clock()).slice(0,4))+offset),{retained:true})?.nodes||[]));}
  window(now){
    // Calendar snapshots are inflated at most hourly, and exactly at a known
    // window boundary. Checking the window never takes the writer lease.
    if(!this.windowCache||now<this.windowCache.checkedAt||now>=this.windowCache.until){
      const sessions=this.sessions(),boundaries=sessions.flatMap(s=>[s.start,s.end]).filter(at=>at>now);
      this.windowCache={checkedAt:now,until:Math.min(now+HOUR,...boundaries),active:sessions.filter(s=>s.start<=now&&now<s.end)};
    }
    return this.windowCache.active;
  }
  due(){
    const now=this.clock();this.nextPurgeCheck??=this.store.get('votingListPurgeCheck')||0;
    const active=this.window(now),page=this.store.get('votingListPage')||{};
    return now>=this.nextPurgeCheck||active.length>0&&hour(now)>=6&&hour(now)<23&&((this.store.get('votingListSweep')||0)<=now||page.activeSessionKey!==activeSessionKey(active)&&now>=pageCheckAt(page,now));
  }
  write(fn){const run=()=>{this.store.assertWriter();return fn();};return this.store.db.isTransaction?run():this.store.transaction(run);}
  async step(worker){
    if(!this.due())return false;
    if(this.runSignal!==worker.controller.signal){this.runSignal=worker.controller.signal;this.runDocxGets=0;}
    const now=this.clock(),active=this.window(now),db=this.store.db;
    if(now>=this.nextPurgeCheck)this.write(()=>{
      // Keep stable ballot identities before the source retention purge.
      for(const {sitting} of db.prepare('SELECT DISTINCT sitting FROM voting_list_revisions').all()){
        const snapshot=this.snapshots.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,sitting,{retained:true});
        if(snapshot?.day)retainSittingBallotBindings(this.store,snapshot.day,new VotingListStore(this.store,{clock:()=>0}).votingListsForSitting(sitting));
      }
      if((this.store.get('votingListDiscoveryPurgeAt')||Infinity)<=now){this.store.set('votingListDiscoveryGaps',[]);this.store.set('votingListLastError',null);}
      db.prepare('DELETE FROM voting_list_revisions WHERE purge_at<=?').run(now);db.prepare('DELETE FROM voting_list_sources WHERE purge_at<=?').run(now);
      this.store.set('votingListPurgeCheck',now+DAY);this.nextPurgeCheck=now+DAY;});
    if(!active.length||hour(now)<6||hour(now)>=23)return false;
    const page=this.store.get('votingListPage')||{},sessionKey=activeSessionKey(active),pageAt=pageCheckAt(page,now),pageDue=now>=pageAt;
    const sources=db.prepare('SELECT * FROM voting_list_sources ORDER BY next_check,url LIMIT 240').all()
      .map(row=>({...row,body:JSON.parse(row.body)})).filter(row=>active.some(s=>s.first===row.body.sessionFirst));
    const sweep=ends=>{
      const next=Math.min(now+HOUR,pageAt,...active.map(s=>s.end),...sources.map(row=>fileCheckAt(row,now,ends)));
      this.write(()=>this.store.set('votingListSweep',next));
    };
    // Plan from retained request metadata before inflating any agenda snapshot.
    if(!pageDue&&!sources.some(row=>fileCheckAt(row,now)<=now)){sweep();return false;}
    if(!pageDue&&this.runDocxGets>=120)return false;
    const agendas=new Map(),ends=new Map();
    const agendaFor=sitting=>{
      if(!agendas.has(sitting)){
        const retained=sitting?this.snapshots.read('agenda',1,sitting,{retained:true}):null;
        const agenda=retained?.pages?.flatMap(p=>p.payload.data)||[];agendas.set(sitting,agenda);
        if(sitting&&!retained)this.snapshots.enqueue?.('agenda',1,sitting);
        const votes=new Set(agenda.filter(n=>String(n.had_activity_type).endsWith('/PLENARY_VOTE')).map(n=>String(n.id||'eli/dl/event/'+n.activity_id).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')));
        const slotEnds=agenda.filter(n=>String(n.had_activity_type).endsWith('/MEETING_PART')&&(n.consists_of||[]).some(ref=>votes.has(String(ref?.id||ref).replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')))).map(n=>Date.parse(n.activity_end_date)).filter(Number.isFinite);
        ends.set(sitting,slotEnds.length?Math.max(...slotEnds):-Infinity);
      }
      return agendas.get(sitting);
    };
    // Preserve agenda warming through the existing hint queue on page checks.
    if(pageDue)for(const session of active)for(const sitting of session.sittings)this.snapshots.enqueue?.('agenda',1,sitting);
    const source=pageDue?null:sources.find(row=>{
      if(fileCheckAt(row,now)>now)return false;
      agendaFor(row.sitting);return fileCheckAt(row,now,ends)<=now;
    });
    if(!pageDue&&!source){sweep(ends);return false;}
    const prior=pageDue?page:source.body,url=pageDue?VOTING_LIST_PAGE:source.url;
    const next=now+HOUR;
    // Reserve before awaiting: crashes and skipped generations cannot create a retry storm.
    this.write(()=>{if(pageDue)this.store.set('votingListPage',{...page,nextCheck:next});else db.prepare('UPDATE voting_list_sources SET next_check=?,body=? WHERE url=? AND sitting=?').run(next,JSON.stringify({...prior,checkedAt:now}),url,source.sitting);});
    try{
      if(!pageDue)this.runDocxGets++;
      const response=await this.fetchSource(url,{signal:worker.controller.signal,etag:!pageDue||page.activeSessionKey===sessionKey?prior.etag:null,lastModified:!pageDue||page.activeSessionKey===sessionKey?prior.lastModified:null});
      const validators={etag:response.etag||prior.etag||null,lastModified:response.lastModified||prior.lastModified||null};
      if(pageDue){this.write(()=>{
        this.store.set('votingListPage',{...validators,nextCheck:next,activeSessionKey:response.status===304?page.activeSessionKey:sessionKey});
        if(response.status===304)return;
        const discovery=discoverVotingLists(response.buffer.toString('utf8'),active);this.store.set('votingListDiscoveryGaps',discovery.gaps);this.store.set('votingListDiscoveryPurgeAt',Math.max(...active.map(s=>s.purgeAt)));
        for(const link of discovery.links)db.prepare('INSERT INTO voting_list_sources VALUES (?,?,?,?,?) ON CONFLICT(url,sitting) DO UPDATE SET body=json_set(body,\'$.linkVersion\',json_extract(excluded.body,\'$.linkVersion\'))').run(link.url,link.sittingId||'',JSON.stringify(link),now,link.purgeAt);
      });}else{
        const agenda=agendaFor(source.sitting);
        const frequent=source.sitting.slice(7)===brusselsDay(now)&&hour(now)>=6&&now<=ends.get(source.sitting);
        const nextCheck=now+(frequent?HOUR:6*HOUR);
        let parsed=null;
        const heldHash=response.buffer?createHash('sha256').update(response.buffer).digest('hex'):null;
        const unchanged=heldHash&&db.prepare('SELECT 1 FROM voting_list_revisions WHERE url=? AND sitting=? AND hash=?').get(url,source.sitting,heldHash);
        if(response.status!==304&&!unchanged){
          if(prior.schedule)parsed={paragraphs:docxContent(response.buffer).paragraphs};
          else {parsed=parseVotingList(response.buffer,{sourceUrl:url,observedAt:new Date(now).toISOString()});parsed.sittingId=source.sitting;
            const matches=agenda.filter(n=>String(n.had_activity_type).endsWith('/PLENARY_VOTE')&&(n.based_on_a_realization_of||[]).some(ref=>String(ref?.id||ref).split('/').at(-1)===parsed.documentId));
            parsed.agendaItemId=matches.length===1?(matches[0].activity_id||matches[0].id.split('/').at(-1)):null;
            if(!parsed.agendaItemId)parsed.gaps.push({code:'agenda-unbound',message:'No exact agenda vote item.'});
            Object.assign(parsed.revision,validators,{linkVersion:prior.linkVersion});
          }
        }
        this.write(()=>{
          db.prepare('UPDATE voting_list_sources SET body=?,next_check=? WHERE url=? AND sitting=?').run(JSON.stringify({...prior,...validators,checkedAt:now,retryAt:null,error:null,latestHash:heldHash||prior.latestHash||null,...(prior.schedule&&parsed?{scheduleData:parsed}:{} )}),nextCheck,url,source.sitting);
          if(!prior.schedule)for(const row of db.prepare('SELECT hash,body FROM voting_list_revisions WHERE url=? AND sitting=?').all(url,source.sitting)){
            const held=JSON.parse(row.body);if(held.agendaItemId)continue;
            const matches=agenda.filter(n=>String(n.had_activity_type).endsWith('/PLENARY_VOTE')&&(n.based_on_a_realization_of||[]).some(ref=>String(ref?.id||ref).split('/').at(-1)===held.documentId));
            if(matches.length===1){held.agendaItemId=matches[0].activity_id||matches[0].id.split('/').at(-1);held.gaps=held.gaps.filter(g=>g.code!=='agenda-unbound');db.prepare('UPDATE voting_list_revisions SET body=? WHERE url=? AND sitting=? AND hash=?').run(JSON.stringify(held),url,source.sitting,row.hash);}
          }
          if(parsed&&!prior.schedule)db.prepare('INSERT INTO voting_list_revisions VALUES (?,?,?,?,?,?) ON CONFLICT(url,sitting,hash) DO NOTHING').run(url,source.sitting,parsed.revision.sha256,parsed.revision.observedAt,JSON.stringify(parsed),source.purge_at);
        });
      }
    }catch(error){if(worker.controller.signal.aborted)throw error;this.write(()=>{this.store.set('votingListLastError',{at:new Date(now).toISOString(),message:String(error.message).slice(0,200)});const retry=now+Math.max(HOUR,Number(error.retryAfter||0)*1000);if(pageDue)this.store.set('votingListPage',{...prior,nextCheck:retry,error:String(error.message).slice(0,200),errorSittings:active.flatMap(s=>s.sittings)});else db.prepare('UPDATE voting_list_sources SET next_check=?,body=? WHERE url=? AND sitting=?').run(retry,JSON.stringify({...prior,checkedAt:now,retryAt:retry,error:String(error.message).slice(0,200)}),url,source.sitting);});}
    return true;
  }
}
export const collectVotingList=worker=>worker.votingLists?.step(worker)||false;
export function votingListsResponse(store,params){const sitting=params.get('sitting');if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting||'')||!calendarDate(sitting.slice(7)))throw new HttpError(400,'invalid_sitting','Choose a plenary sitting.');const clock=store.clock||Date.now,now=clock(),gaps=(store.get('votingListDiscoveryGaps')||[]).filter(g=>g.sittingId===sitting||!g.sittingId&&g.sessionFirst&&g.sessionLast&&sitting.slice(7)>=g.sessionFirst&&sitting.slice(7)<=g.sessionLast);
  if(store.get('votingListPage')?.error&&store.get('votingListPage').errorSittings?.includes(sitting))gaps.push({code:'page-unavailable',message:'Voting list page unavailable.'});
  if(store.db?.prepare("SELECT 1 FROM sqlite_master WHERE name='voting_list_sources'").get())for(const row of store.db.prepare('SELECT body FROM voting_list_sources WHERE sitting=? AND purge_at>?').all(sitting,now))if(JSON.parse(row.body).error)gaps.push({code:'file-unavailable',message:'Voting list file unavailable.',sourceUrl:JSON.parse(row.body).url});
  return {version:VOTING_LISTS_VERSION,sittingId:sitting,documents:new VotingListStore(store,{clock}).votingListsForSitting(sitting),gaps,sourcePageUrl:VOTING_LIST_PAGE};}
