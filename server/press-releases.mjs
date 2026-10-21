import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {observeSqlite} from './sqlite-observability.mjs';
import {boundedUpstream,odpLanguage,upstreamResponseError} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {browserCompatibleUserAgent} from './user-agent.mjs';
import {parseProcedurePage,procedureReference} from './official-context.mjs';
import {requestSignal} from './request-budget.mjs';
import {PRESS_FEEDS,parsePressFeed,parsePressRelease} from './press-releases-model.mjs';

const HOUR=60*60_000,DAY=24*HOUR;
export const PRESS_LIMITS=Object.freeze({pollInterval:2*HOUR,pagesPerRun:6,maxAttempts:6,listed:5});
const parse=value=>value==null?null:JSON.parse(value);
const message=error=>String(error?.message||error).slice(0,300);
const SCHEMA=`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, url TEXT NOT NULL, body TEXT NOT NULL, discovered_at INTEGER NOT NULL, checked_at INTEGER, next_check INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT);
  CREATE INDEX IF NOT EXISTS release_due ON releases(next_check) WHERE next_check IS NOT NULL;
  CREATE TABLE IF NOT EXISTS links (kind TEXT NOT NULL, value TEXT NOT NULL, release TEXT NOT NULL, label TEXT, PRIMARY KEY(kind,value,release));
  CREATE INDEX IF NOT EXISTS link_release ON links(release);`;
const MATCH=`(l.kind='procedure' AND l.value=?) OR (l.kind='summary' AND l.value IN (SELECT value FROM json_each(?))) OR (l.kind='document' AND l.value IN (SELECT value FROM json_each(?)))`;

// Brussels wall-clock time on a page → UTC instant.
export function brusselsInstant(local) {
  const guess=Date.parse(local+'Z');if(!Number.isFinite(guess))return null;
  const offset=at=>{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(at).map(part=>[part.type,part.value]));
    return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-at;
  };
  return new Date(guess-offset(guess-offset(guess))).toISOString();
}

// Following data accumulates from the first feed read; it is not rebuilt with
// activity-index generations. Readers never create the file or its schema: only
// the activity-index lease holder initializes and writes it (leaseFencedWrite).
export class PressStore {
  constructor(directory){Object.assign(this,{directory,filename:path.join(directory,'press-v1.sqlite'),db:null,ready:false});}
  // Connection settings apply on every open; the journal mode is stored in the file.
  open(){this.db=observeSqlite(new DatabaseSync(this.filename),'press');this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');return this.db;}
  tables() {
    if(this.ready)return true;
    if(!this.db&&!existsSync(this.filename))return false;
    this.ready=Boolean((this.db||this.open()).prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='links'").get());
    return this.ready;
  }
  // Outside a press transaction: journal mode cannot change inside one.
  initialize() {
    if(this.ready)return;
    mkdirSync(this.directory,{recursive:true});
    (this.db||this.open()).exec('PRAGMA journal_mode=WAL;'+SCHEMA);
    this.ready=true;
  }
  get(key){return this.tables()?parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value):null;}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,JSON.stringify(value));}
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try{const out=fn();this.db.exec('COMMIT');return out;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  release(id){const row=this.tables()&&this.db.prepare('SELECT * FROM releases WHERE id=?').get(id);return row?{...row,body:parse(row.body)}:null;}
  // A newly announced release is read once; a repeated announcement only adds its feed.
  discover(item,{feed,now}) {
    const old=this.release(item.id);
    if(!old) {
      const body={id:item.id,url:item.url,title:item.title??null,feedPublishedAt:item.publishedAt??null,committees:item.committees||[],feeds:[feed]};
      this.db.prepare('INSERT INTO releases(id,url,body,discovered_at,next_check) VALUES (?,?,?,?,?)').run(item.id,item.url,JSON.stringify(body),now,now);
      return true;
    }
    if(!old.body.feeds.includes(feed))this.db.prepare('UPDATE releases SET body=? WHERE id=?').run(JSON.stringify({...old.body,feeds:[...old.body.feeds,feed]}),item.id);
    return false;
  }
  hasDue(now){return this.tables()&&Boolean(this.db.prepare('SELECT 1 FROM releases INDEXED BY release_due WHERE next_check IS NOT NULL AND next_check<=? LIMIT 1').get(now));}
  due(now,limit){return this.tables()?this.db.prepare('SELECT id FROM releases INDEXED BY release_due WHERE next_check IS NOT NULL AND next_check<=? ORDER BY next_check,id LIMIT ?').all(now,limit).map(row=>row.id):[];}
  record(id,body,{now,links}) {
    this.db.prepare('UPDATE releases SET body=?,checked_at=?,next_check=NULL,attempts=0,error=NULL WHERE id=?').run(JSON.stringify(body),now,id);
    this.db.prepare('DELETE FROM links WHERE release=?').run(id);
    const insert=this.db.prepare('INSERT OR IGNORE INTO links VALUES (?,?,?,?)');
    for(const link of links)insert.run(link.kind,link.value,id,link.label);
  }
  fail(id,error,{now,retryAt}) {
    const attempts=(this.release(id)?.attempts||0)+1,next=attempts>=PRESS_LIMITS.maxAttempts?null:Math.max(retryAt||0,now+Math.min(DAY,15*60_000*2**(attempts-1)));
    this.db.prepare('UPDATE releases SET attempts=?,next_check=?,error=? WHERE id=?').run(attempts,next,message(error),id);
  }
  // Releases whose own Further information list links this exact procedure, or
  // one of the OEIL summaries or documents its procedure file links.
  mentions(reference,{summaries=[],documents=[]}={},limit=PRESS_LIMITS.listed) {
    if(!this.tables())return {items:[],total:0};
    const args=[reference,JSON.stringify(summaries),JSON.stringify(documents)];
    const total=this.db.prepare(`SELECT COUNT(DISTINCT l.release) AS n FROM links l WHERE ${MATCH}`).get(...args).n;
    const items=this.db.prepare(`SELECT r.id,r.body,json_group_array(json_object('kind',l.kind,'value',l.value,'label',l.label)) AS basis
      FROM links l JOIN releases r ON r.id=l.release WHERE ${MATCH}
      GROUP BY r.id ORDER BY COALESCE(json_extract(r.body,'$.publishedAt'),'') DESC,r.id DESC LIMIT ?`).all(...args,limit).map(row=>({id:row.id,body:parse(row.body),basis:parse(row.basis)}));
    return {items,total};
  }
  counts() {
    if(!this.tables())return {releases:0,pending:0,unreadable:0,unlisted:0};
    return this.db.prepare(`SELECT COUNT(*) AS releases,COALESCE(SUM(checked_at IS NULL AND next_check IS NOT NULL),0) AS pending,COALESCE(SUM(checked_at IS NULL AND next_check IS NULL),0) AS unreadable,COALESCE(SUM(json_extract(body,'$.listed')=0),0) AS unlisted FROM releases`).get();
  }
  close(){this.db?.close();this.db=null;this.ready=false;}
}
// The activity-index transaction keeps its lease row locked until the press
// commit, so no takeover can fall between the lease check and the write.
export const leaseFencedWrite=(activity,press)=>fn=>activity.transaction(()=>{activity.assertWriter();press.initialize();return press.transaction(fn);});

async function limitedText(response,maximum) {
  const reader=response.body?.getReader();if(!reader)return '';
  const parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw new Error('The Parliament page exceeded the supported size.');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).toString('utf8');
}
// Feeds and pages on www.europarl.europa.eu share the website admission pool.
export function fetchWebsite(url,{signal}={}) {
  const xml=url.endsWith('.xml');
  return boundedUpstream(async admitted=>{
    const response=await fetch(url,{headers:{Accept:xml?'application/rss+xml, application/xml':'text/html','User-Agent':browserCompatibleUserAgent('press releases')},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(25_000),...(admitted?[admitted]:[]),...(signal?[signal]:[])])});
    const limited=upstreamResponseError(response,{source:'website'});
    if(limited){await response.body?.cancel();throw limited;}
    const type=response.headers.get('content-type')||'';
    if(response.status!==200||!(xml?/xml/.test(type):/html/.test(type))){await response.body?.cancel();throw Object.assign(new Error(`Parliament returned ${response.status} ${type||'without a content type'}.`),{status:response.status});}
    return {text:await limitedText(response,2*1024*1024),robotsHeader:response.headers.get('x-robots-tag')};
  },{source:'website',priority:'background',signal});
}
const fetched=value=>typeof value==='string'?{text:value,robotsHeader:null}:value;

export class PressFollower {
  constructor(store,{clock=Date.now,fetchText=fetchWebsite,write=fn=>{store.initialize();return store.transaction(fn);}}={}) {Object.assign(this,{store,clock,fetchText,write});}
  due(){const now=this.clock();return now>=(this.store.get('follow')?.nextPollAt||0)||this.store.hasDue(now);}
  // admit() is asked before every request; it carries the worker's request budget and deadline.
  async run({signal,admit=()=>true}={}) {
    if(this.clock()>=(this.store.get('follow')?.nextPollAt||0)&&!await this.poll(signal,admit))return;
    for(const id of this.store.due(this.clock(),PRESS_LIMITS.pagesPerRun)) {
      signal?.throwIfAborted();
      if(!admit())return;
      await this.read(id,signal);
    }
  }
  // Each feed's releases, status and the following start commit together, so an
  // interrupted poll resumes with the remaining feeds. nextPollAt advances only
  // once every feed of the poll has been read.
  async poll(signal,admit) {
    for(const feed of PRESS_FEEDS) {
      const started=this.store.get('follow')?.poll;
      if(started&&this.clock()-started.startedAt<PRESS_LIMITS.pollInterval&&started.done.includes(feed.id))continue;
      if(!admit())return false;
      const attemptedAt=new Date(this.clock()).toISOString();
      let items=null,failure=null;
      try{items=parsePressFeed(fetched(await this.fetchText(feed.url,{signal})).text);}
      catch(error){signal?.throwIfAborted();failure=error;}
      const now=this.clock();
      this.write(()=>{
        const follow=this.store.get('follow')||{since:null,feeds:{}},current=follow.poll&&now-follow.poll.startedAt<PRESS_LIMITS.pollInterval?follow.poll:{startedAt:now,done:[]};
        const added=items?items.filter(item=>this.store.discover(item,{feed:feed.id,now})).length:0;
        follow.feeds={...follow.feeds,[feed.id]:items?{url:feed.url,lastSuccessAt:attemptedAt,items:items.length,added,error:null}:{...follow.feeds?.[feed.id],url:feed.url,lastAttemptAt:attemptedAt,error:message(failure)}};
        if(items)follow.since??=attemptedAt;
        const done=[...new Set([...current.done,feed.id])];
        if(PRESS_FEEDS.every(entry=>done.includes(entry.id))){delete follow.poll;follow.nextPollAt=now+PRESS_LIMITS.pollInterval;}
        else follow.poll={startedAt:current.startedAt,done};
        this.store.set('follow',follow);
      });
    }
    return true;
  }
  async read(id,signal) {
    const release=this.store.release(id);if(!release)return;
    let response;
    try{response=fetched(await this.fetchText(release.url,{signal}));}
    catch(error){signal?.throwIfAborted();this.write(()=>this.store.fail(id,error,{now:this.clock(),retryAt:error.retryAt}));return;}
    const now=this.clock();
    let page;
    try{page=parsePressRelease(response.text,id,{robotsHeader:response.robotsHeader});}
    catch(error){this.write(()=>this.store.fail(id,error,{now}));return;}
    const listed=page.robots.listed;
    this.write(()=>this.store.record(id,{...release.body,title:page.title??release.body.title,publishedAt:(page.publishedLocal&&brusselsInstant(page.publishedLocal))||release.body.feedPublishedAt,publishedLocal:page.publishedLocal,robots:page.robots,listed,furtherInformation:page.furtherInformation,fetchedAt:new Date(now).toISOString()},{now,links:listed?page.links:[]}));
  }
}

export function pressMentionsQuery(search) {
  for(const key of search.keys())if(!['lang','reference'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated press query.');
  return {reference:procedureReference(search.get('reference')),language:odpLanguage(search.get('lang')||'en')};
}
const publicItem=row=>({
  id:row.id,url:row.body.url,title:row.body.title,titleLanguage:'en',publishedAt:row.body.publishedAt||null,committees:row.body.committees,
  links:row.basis.map(link=>({kind:link.kind,value:link.value,label:link.label})),fetchedAt:row.body.fetchedAt,
});
export class PressMentions {
  constructor(store,officialSources){Object.assign(this,{store,officialSources});}
  async query({reference,language}) {
    // The procedure file lists its OEIL summaries and documents; a release
    // linking one of them refers to this procedure through that exact ID.
    const sourceLanguage=language==='fr'?'fr':'en',procedureUrl=`https://oeil.europarl.europa.eu/oeil/${sourceLanguage}/procedure-file?`+new URLSearchParams({reference});
    let procedure={status:'unavailable',summaries:[],documents:[],source:null};
    try {
      const page=await this.officialSources.get(procedureUrl),parsed=parseProcedurePage(page.html,reference,sourceLanguage);
      // A saved page whose refresh is due or failing stays visible as such.
      procedure={status:'available',summaries:parsed.summaries.map(summary=>summary.id),documents:parsed.documents,source:{url:page.url,fetchedAt:page.fetchedAt,stale:Boolean(page.viewCache?.stale),refreshInProgress:Boolean(page.viewCache?.refreshInProgress),refreshError:page.viewCache?.refreshError||null}};
    } catch {requestSignal()?.throwIfAborted();}
    const {items,total}=this.store.mentions(reference,procedure),follow=this.store.get('follow'),counts=this.store.counts();
    return {
      view:'press-releases',reference,items:items.map(publicItem),total,
      coverage:{
        // Following starts at the first feed read; the feeds hold only recent releases.
        complete:false,followingSince:follow?.since||null,
        feeds:PRESS_FEEDS.map(feed=>({id:feed.id,url:feed.url,lastSuccessAt:follow?.feeds?.[feed.id]?.lastSuccessAt||null,lastError:follow?.feeds?.[feed.id]?.error||null})),
        procedureLinks:{status:procedure.status,source:procedure.source},
        pendingReleases:counts.pending,unreadableReleases:counts.unreadable,unlistedReleases:counts.unlisted,
      },
    };
  }
}
