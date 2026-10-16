import { createHash } from 'node:crypto';
import { AMENDMENT_LIMITS, amendmentOutcome } from './amendments.mjs';
import { SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
const parse=value=>JSON.parse(value);
export function amendmentsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS amendments (generation INTEGER, id TEXT, target TEXT, date TEXT, outcome TEXT, body TEXT, PRIMARY KEY(generation,id));
    CREATE INDEX IF NOT EXISTS amendment_target ON amendments(generation,target,date DESC,id);
    CREATE INDEX IF NOT EXISTS amendment_outcome ON amendments(generation,outcome,date DESC,id);
    CREATE TABLE IF NOT EXISTS amendment_jobs (generation INTEGER,key TEXT,kind TEXT,body TEXT,priority INTEGER,done INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,retry_at INTEGER DEFAULT 0,error TEXT,PRIMARY KEY(generation,key));
    CREATE TABLE IF NOT EXISTS amendment_targets (generation INTEGER,id TEXT,body TEXT,PRIMARY KEY(generation,id));
    CREATE TABLE IF NOT EXISTS amendment_split_failures (request_id TEXT,part_id TEXT,language TEXT,body TEXT,PRIMARY KEY(request_id,part_id,language));
    CREATE INDEX IF NOT EXISTS amendment_list_target ON sources(generation,kind,json_extract(body,'$.targetDocumentId'));`);
}
function extensionGeneration(db) {
  return db.prepare('SELECT MAX(generation) AS generation FROM (SELECT generation FROM amendments UNION SELECT generation FROM amendment_targets UNION SELECT generation FROM amendment_jobs)').get()?.generation || 0;
}
export function amendmentsCopy(db,generation,active) {
  // Legacy workers advance core generations without knowing these additive
  // tables. Adopt their last retained extension snapshot before deleting any
  // rows, including pending page cursors, rather than copying an empty core ID.
  const source=extensionGeneration(db) || active;
  if(source && source!==generation) {
    db.prepare('INSERT OR IGNORE INTO amendments SELECT ?,id,target,date,outcome,body FROM amendments WHERE generation=?').run(generation,source);
    db.prepare('INSERT OR IGNORE INTO amendment_targets SELECT ?,id,body FROM amendment_targets WHERE generation=?').run(generation,source);
    db.prepare('INSERT OR IGNORE INTO amendment_jobs SELECT ?,key,kind,body,priority,done,attempts,retry_at,error FROM amendment_jobs WHERE generation=? AND done=0').run(generation,source);
  }
  db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('amendmentSnapshotGeneration',JSON.stringify(generation));
  if(source!==generation)for(const table of ['amendments','amendment_targets','amendment_jobs'])db.prepare(`DELETE FROM ${table} WHERE generation NOT IN (?,?)`).run(generation,source || generation);
}

export function amendmentsPrune(db,generation,old) {
  for(const table of ['amendments','amendment_targets','amendment_jobs'])db.prepare(`DELETE FROM ${table} WHERE generation NOT IN (?,?)`).run(generation,old || generation);
}
export function recordSplitResults(store,result) {
  store.assertWriter();
  const failures=new Map((result.failures || []).map(failure=>[String(failure.partId),failure]));
  const parts=[...(result.parts || [])];
  if(parts.length && !(result.failures || []).some(failure=>failure.partId==null) && store.db.prepare('SELECT 1 FROM amendment_split_failures WHERE request_id=? AND part_id=?').get(result.requestId,'__request__'))parts.push({id:'__request__',language:parts[0].language,requestFailure:true});
  for(const failure of result.failures || [])if(!parts.some(part=>String(part.id)===String(failure.partId)))parts.push({id:failure.partId ?? '__request__',description:failure.description,language:failure.language,requestFailure:true});
  for(const part of parts) {
    const requestId=result.requestId,partId=part.id ?? '__request__',language=part.language || 'en';
    const prior=store.db.prepare('SELECT body FROM amendment_split_failures WHERE request_id=? AND part_id=? AND language=?').get(requestId,partId,language);
    const old=prior?parse(prior.body):null, failure=failures.get(String(partId)) || (part.requestFailure?failures.get('null'):null);
    if(!failure&&!old)continue;
    if(!old && store.db.prepare('SELECT COUNT(*) AS n FROM amendment_split_failures').get().n>=AMENDMENT_LIMITS.failures) {
      store.set('amendmentFailureCapacityReached',true);continue;
    }
    const at=failure?.fetchedAt || result.fetchedAt || new Date(store.clock()).toISOString();
    const description=String(failure?.description || part.description || '').slice(0,65537);
    const rawDescription=typeof (failure?.rawDescription ?? part.rawDescription)==='string'?(failure?.rawDescription ?? part.rawDescription).slice(0,65537):null;
    const signature=createHash('sha256').update(JSON.stringify({description,rawDescription,sourceDescriptions:failure?.sourceDescriptions || part.sourceDescriptions || null})).digest('hex');
    const body={...old,...failure,...(rawDescription!=null?{rawDescription}:{}),requestId,partId,description,language,parserVersion:SPLIT_PARSER_VERSION,
      sourceUrl:failure?.sourceUrl || result.sourceUrl || old?.sourceUrl || null,fetchedAt:at,
      firstOccurrence:old?.firstOccurrence || at,lastOccurrence:at,originalPartId:part.requestFailure?null:partId,count:(old?.count || 0)+(failure?1:0),
      status:failure?'unresolved':'resolved',code:failure?.code || old?.code || null,reason:failure?.message || old?.reason || null,
      sourceDescriptionHash:signature,...(!failure?{resolvedAt:at}:{resolvedAt:null}),
    };
    store.db.prepare('INSERT OR REPLACE INTO amendment_split_failures VALUES (?,?,?,?)').run(requestId,partId,language,JSON.stringify(body));
  }
}
export function saveAmendmentRows(store,generation,target,rows,coverage,{observedDecisionIds=[]}={}) {
  store.transaction(()=>{
    store.assertWriter();
    const prior=store.db.prepare('SELECT id,body FROM amendments WHERE generation=? AND target=?').all(generation,target.id);
    const merged=new Map(rows.map(row=>[row.id,row]));
    const observed=new Set(observedDecisionIds);
    let retained=false;
    // Copying a generation preserves accepted components. A missing list,
    // author mapping or decision is a gap, never evidence that it disappeared.
    for(const previous of prior) {
      const old=parse(previous.body),incoming=merged.get(previous.id);
      if(!incoming){
        retained=true;
        const decisions=(old.decisions || []).filter(decision=>!observed.has(decision.id));
        const partIds=new Set(decisions.map(decision=>decision.partId).filter(Boolean));
        const splitParts=(old.splitParts || []).filter(part=>partIds.has(part.id));
        const changed=decisions.length!==(old.decisions || []).length;
        merged.set(previous.id,{...old,decisions,splitParts,gaps:[...new Set([...(old.gaps || []),'Source was absent from the latest partial refresh.',...(changed?['A refreshed decision no longer references this amendment.']:[])])]});
        continue;
      }
      const stale=[];
      for(const field of incoming.conflicted?[]:['originalText','proposedText','targetLabel','language','listId','justification','onBehalfOf'])if(incoming[field]==null&&old[field]!=null){incoming[field]=old[field];stale.push(field);}
      if(!incoming.conflicted && !incoming.authors?.length && old.authors?.length){incoming.authors=old.authors;stale.push('authors');}
      else incoming.authors=(incoming.authors || []).map(author=>{
        const accepted=(old.authors || []).find(item=>item.name===author.name&&item.personId!=null);
        // Missing inputs can retain an accepted link, but an explicit fresh
        // ambiguity or inactive mandate invalidates that link immediately.
        if(author.personId==null&&accepted&&['missing','missing_date','missing_mandate'].includes(author.status)){stale.push('author identity');return {...accepted,latestResolution:author};}return author;
      });
      const decisionKey=decision=>decision.id+':'+(decision.partId || '');
      const decisions=new Map((incoming.decisions || []).map(decision=>[decisionKey(decision),decision]));
      const currentDecisionIds=new Set((incoming.decisions || []).map(decision=>decision.id));
      // A published decision node's reference set is atomic. Its current parts
      // replace prior bindings; only entirely absent decisions are retained.
      for(const decision of old.decisions || [])if(!currentDecisionIds.has(decision.id)&&!observed.has(decision.id)){decisions.set(decisionKey(decision),decision);stale.push('decisions');}
      incoming.decisions=[...decisions.values()];
      const retainedPartIds=new Set(incoming.decisions.filter(decision=>!currentDecisionIds.has(decision.id)).map(decision=>decision.partId).filter(Boolean));
      incoming.splitParts=[...new Map([...(old.splitParts || []).filter(part=>retainedPartIds.has(part.id)),...(incoming.splitParts || [])].map(part=>[part.id,part])).values()];
      if(stale.length){retained=true;incoming.retainedComponents=[...new Set(stale)];incoming.gaps=[...new Set([...(incoming.gaps || []),'Some previously accepted components are retained because the latest refresh is incomplete.'])];incoming.sources=[...new Map([...(incoming.sources || []),...(old.sources || [])].map(source=>[source.url+':'+source.fetchedAt,source])).values()];}
    }
    const put=store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)');
    for(const row of merged.values())put.run(generation,row.id,target.id,row.date || target.date || '',amendmentOutcome(row.decisions),JSON.stringify({...row,outcome:amendmentOutcome(row.decisions)}));
    const sittingIds=[...new Set([...(target.sittingIds || []),...[...merged.values()].flatMap(row=>(row.decisions || []).map(decision=>decision.sittingId).filter(Boolean))])];
    store.db.prepare('INSERT OR REPLACE INTO amendment_targets VALUES (?,?,?)').run(generation,target.id,JSON.stringify({...target,...coverage,sittingIds,...(retained?{complete:false,gaps:[...(coverage.gaps || []),'Previously accepted amendment components are retained after an incomplete refresh.']}: {})}));
  });
}
export function amendmentFailureSummary(store) {
  const row=store.db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN json_extract(body,'$.status')='unresolved' THEN 1 ELSE 0 END),0) AS unresolved FROM amendment_split_failures").get();
  return {...row,capacityReached:Boolean(store.get('amendmentFailureCapacityReached'))};
}
export function amendmentFailures(store,{limit=20,offset=0,status='all'}={}) {
  const where=status==='all'?'':" WHERE json_extract(body,'$.status')=?",args=status==='all'?[]:[status];
  const total=store.db.prepare('SELECT COUNT(*) AS n FROM amendment_split_failures'+where).get(...args).n;
  const items=store.db.prepare('SELECT body FROM amendment_split_failures'+where+" ORDER BY json_extract(body,'$.lastOccurrence') DESC,request_id,part_id LIMIT ? OFFSET ?").all(...args,limit,offset).map(row=>{const item=parse(row.body);return {...item,message:item.reason,firstSeen:item.firstOccurrence,lastSeen:item.lastOccurrence,occurrences:item.count};});
  const summary=amendmentFailureSummary(store);
  return {items,total,limit,offset,parserVersion:SPLIT_PARSER_VERSION,unresolved:summary.unresolved,capacityReached:summary.capacityReached,summary};
}
export function amendmentGeneration(store) {
  const core=store.get('working')?.generation || store.get('active') || 0;
  return store.db.prepare('SELECT 1 FROM amendment_targets WHERE generation=? LIMIT 1').get(core)?core:extensionGeneration(store.db) || core;
}
export function amendmentsPage(store,{document=null,procedure=null,member=null,outcome=null,language='en',limit=20,offset=0}={}) {
  const generation=amendmentGeneration(store),clauses=['generation=?'],args=[generation];
  if(document){clauses.push('target=?');args.push(document);}
  if(outcome){clauses.push('outcome=?');args.push(outcome);}
  if(procedure){clauses.push("EXISTS(SELECT 1 FROM json_each(amendments.body,'$.procedureIds') AS p WHERE p.value=?)");args.push(procedure);}
  if(member){clauses.push("EXISTS(SELECT 1 FROM json_each(amendments.body,'$.authors') AS a WHERE CAST(json_extract(a.value,'$.personId') AS TEXT) IN (?,?))");args.push(String(member),'person/'+member);}
  const where=clauses.join(' AND '),total=store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE '+where).get(...args).n;
  const items=store.db.prepare('SELECT body FROM amendments WHERE '+where+" ORDER BY date DESC,target,CAST(json_extract(body,'$.number') AS INTEGER),id LIMIT ? OFFSET ?").all(...args,limit,offset).map(record=>{
    const row=parse(record.body);return {...row,title:row.titles?.[language] || row.titles?.en || Object.values(row.titles || {})[0] || row.targetDocumentId,requestedLanguage:language};
  });
  const records=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=?'+(document?' AND id=?':'')+' LIMIT 10001').all(generation,...(document?[document]:[])).map(record=>parse(record.body));
  const gaps=[...new Set(records.flatMap(record=>record.gaps || []))];
  const working=store.get('working'),pending=Boolean(working&&store.db.prepare("SELECT 1 FROM amendment_jobs WHERE generation=? AND done<>1 LIMIT 1").get(working.generation));
  if(!records.length)gaps.push(document?'This document has no indexed amendment records.':'Amendment discovery is incomplete.');
  if(!document)gaps.push('Coverage includes indexed plenary amendment lists; older targets are enriched in bounded batches.');
  const lastUpdated=records.map(record=>record.lastUpdated).filter(Boolean).sort().at(-1) || null;
  return {items,total,offset,limit,coverage:{complete:Boolean(document&&records.length&&records.every(record=>record.complete)&&!pending),pending,gaps,lastUpdated,parserVersion:SPLIT_PARSER_VERSION,scope:'plenary',servingGeneration:generation,workingGeneration:Boolean(working?.generation===generation)},failures:amendmentFailureSummary(store)};
}

export function enqueueAmendment(store,generation,key,kind,body,priority=105,refreshCompleted=false) {
  store.assertWriter();
  if(!store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key) && store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n>=200)return false;
  store.db.prepare('INSERT OR IGNORE INTO amendment_jobs(generation,key,kind,body,priority) VALUES (?,?,?,?,?)').run(generation,key,kind,JSON.stringify(body),priority);
  if(refreshCompleted)store.db.prepare('UPDATE amendment_jobs SET done=0,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE generation=? AND key=? AND done=1').run(JSON.stringify(body),priority,generation,key);
  return true;
}
export function nextAmendmentTask(store,generation) {
  const row=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND done=0 AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(generation,store.clock());
  return row?{...row,body:parse(row.body),amendmentJob:true}:null;
}
