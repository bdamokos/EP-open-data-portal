import { createHash } from 'node:crypto';
import { AMENDMENT_LIMITS, amendmentOutcome, amendmentTextLosses } from './amendments.mjs';
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
  const failures=result.failures || [],used=new Set();
  const entries=(result.parts || []).map(part=>{
    const failure=failures.find(item=>!used.has(item)&&(part.id!=null?item.partId===part.id:item.partId==null&&item.scope!=='request'&&(item.componentIndex!=null?item.componentIndex===part.componentIndex:item.rawDescription===part.rawDescription)));
    if(failure)used.add(failure);
    return {part,failure,kind:'component'};
  });
  for(const failure of failures)if(!used.has(failure))entries.push({part:{id:failure.partId,componentIndex:failure.componentIndex,description:failure.description,rawDescription:failure.rawDescription,sourceDescriptions:failure.sourceDescriptions,language:failure.language},failure,kind:failure.partId!=null||failure.scope==='component'?'component':'request'});
  const requestKey=result.requestId || result.observationKey || '__unidentified_request__:'+createHash('sha256').update(JSON.stringify((result.parts || []).map(part=>[part.componentIndex,part.rawDescription,part.sourceDescriptions]))).digest('hex');
  if((result.parts || []).length&&!entries.some(entry=>entry.kind==='request')&&store.db.prepare('SELECT 1 FROM amendment_split_failures WHERE request_id=? AND part_id=?').get(requestKey,'__request__'))entries.push({part:{id:null,language:result.parts[0].language},failure:null,kind:'request'});
  for(const {part,failure,kind} of entries) {
    const requestId=result.requestId ?? null,language=part.language || 'en';
    const partId=kind==='request'?null:part.id ?? null;
    const registryPartKey=kind==='request'?'__request__':partId || '__component__:'+String(part.componentIndex ?? 'unknown')+':'+createHash('sha256').update(JSON.stringify([part.rawDescription ?? part.description ?? null,part.sourceDescriptions || null])).digest('hex');
    const prior=store.db.prepare('SELECT body FROM amendment_split_failures WHERE request_id=? AND part_id=? AND language=?').get(requestKey,registryPartKey,language);
    const old=prior?parse(prior.body):null;
    if(!failure&&!old)continue;
    if(!old && store.db.prepare('SELECT COUNT(*) AS n FROM amendment_split_failures').get().n>=AMENDMENT_LIMITS.failures) {
      store.set('amendmentFailureCapacityReached',true);continue;
    }
    const sourceField=key=>Object.hasOwn(failure || {},key)?failure[key]:Object.hasOwn(result,key)?result[key]:old?.[key] ?? null;
    const sourceUrl=sourceField('sourceUrl'),fetchedAt=sourceField('fetchedAt');
    const at=fetchedAt || new Date(store.clock()).toISOString();
    const description=String(failure?.description ?? part.description ?? '').slice(0,65537);
    const rawDescription=typeof (failure?.rawDescription ?? part.rawDescription)==='string'?(failure?.rawDescription ?? part.rawDescription).slice(0,65537):null;
    const signature=createHash('sha256').update(JSON.stringify({description,rawDescription,sourceDescriptions:failure?.sourceDescriptions || part.sourceDescriptions || null})).digest('hex');
    const body={...old,...failure,...(rawDescription!=null?{rawDescription}:{}),requestId,registryRequestKey:requestKey,partId,registryPartKey,recordKind:kind,componentIndex:part.componentIndex ?? null,description,language,parserVersion:SPLIT_PARSER_VERSION,
      sourceUrl,fetchedAt,source:sourceField('source'),sourceCandidates:sourceField('sourceCandidates') || [],provenance:sourceField('provenance'),
      firstOccurrence:old?.firstOccurrence || at,lastOccurrence:at,originalPartId:partId,count:(old?.count || 0)+(failure?1:0),
      status:failure?'unresolved':'resolved',code:failure?.code || old?.code || null,reason:failure?.message || old?.reason || null,
      sourceDescriptionHash:signature,...(!failure?{resolvedAt:at}:{resolvedAt:null}),
    };
    store.db.prepare('INSERT OR REPLACE INTO amendment_split_failures VALUES (?,?,?,?)').run(requestKey,registryPartKey,language,JSON.stringify(body));
  }
}
export function saveAmendmentRows(store,generation,target,rows,coverage,{observedDecisionIds=[],freshSplitParts=[],invalidatedTextListIds=[],textParserVersion=null,currentListIds=null,listRelationshipsKnown=null}={}) {
  store.transaction(()=>{
    store.assertWriter();
    const prior=store.db.prepare('SELECT id,body FROM amendments WHERE generation=? AND target=?').all(generation,target.id);
    const merged=new Map(rows.map(row=>[row.id,row]));
    const observed=new Set(observedDecisionIds);
    const invalidatedLists=new Set(invalidatedTextListIds),currentLists=currentListIds===null?null:new Set(currentListIds);
    const freshParts=new Map(freshSplitParts.map(part=>[part.id,part]));
    const invalidBaseline=row=>invalidatedLists.has(row.listId)&&row.textParserVersion!==textParserVersion;
    const extraGaps=new Set();
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
      for(const field of incoming.conflicted?[]:['originalText','proposedText','targetLabel','language','listId','justification','onBehalfOf']){
        if(field==='onBehalfOf'&&!incoming.proposerRetained&&(incoming.authors?.length||incoming.committeeProposer))continue;
        if(['originalText','proposedText'].includes(field)&&(incoming.textIntegrity==='incomplete'||old.textIntegrity==='incomplete'||invalidBaseline(old)||amendmentTextLosses(null,old).length))continue;
        if(incoming[field]==null&&old[field]!=null){incoming[field]=old[field];incoming.fieldSources={...(incoming.fieldSources || {}),[field]:old.fieldSources?.[field] || (['originalText','proposedText','language'].includes(field)?old.wordingSource:old.metadataSource) || null};stale.push(field);}
      }
      if(!incoming.conflicted && !incoming.committeeProposer && !incoming.authors?.length && old.authors?.length){incoming.authors=old.authors;incoming.proposerSource=old.proposerSource || old.metadataSource || null;incoming.proposerRetained=true;incoming.proposerDate=old.proposerDate || old.documentDate || old.date || null;stale.push('authors');}
      else if(!incoming.conflicted&&!old.conflicted&&!incoming.committeeProposer&&!incoming.authors?.length&&old.committeeProposer){incoming.committeeProposer=old.committeeProposer;incoming.proposerSource=old.proposerSource || old.metadataSource || null;incoming.proposerRetained=true;incoming.proposerDate=old.proposerDate || old.documentDate || old.date || null;stale.push('committee proposer');}
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
    // A newly parsed exact component can update a retained decision without
    // inventing a binding to any other component, target or namespace.
    const splitGaps=new Set(['A split component has no indexed description.','A split description could not be parsed; the failure is retained for a future parser update.','Split descriptions are parsed as selection plans; exact wording spans have not been validated.','The split description has no exact recorded source page; candidate page provenance is retained.']);
    for(const row of merged.values()) {
      row.gaps=(row.gaps || []).filter(gap=>gap!=='An amendment decision has no exact recorded source page; candidate page provenance is retained.');
      if((row.decisions || []).some(decision=>!decision.source?.url)){row.gaps.push('An amendment decision has no exact recorded source page; candidate page provenance is retained.');extraGaps.add('Some amendment decisions have no exact recorded source page.');}
      const partIds=new Set((row.decisions || []).map(decision=>decision.partId).filter(Boolean));
      const parts=new Map((row.splitParts || []).filter(part=>partIds.has(part.id)).map(part=>[part.id,part]));
      for(const id of partIds)if(freshParts.has(id))parts.set(id,freshParts.get(id));
      row.splitParts=[...parts.values()];
      row.gaps=(row.gaps || []).filter(gap=>!splitGaps.has(gap)&&!((row.decisions || []).length&&gap==='No explicit amendment outcome is indexed.'));
      for(const id of partIds) {
        const part=parts.get(id);
        if(!part)row.gaps.push('A split component has no indexed description.');
        else if(part.status==='unresolved')row.gaps.push('A split description could not be parsed; the failure is retained for a future parser update.');
        else row.gaps.push('Split descriptions are parsed as selection plans; exact wording spans have not been validated.');
        if(part&&!part.source?.url){row.gaps.push('The split description has no exact recorded source page; candidate page provenance is retained.');extraGaps.add('Some split descriptions have no exact recorded source page.');}
        if(!part||part.status==='unresolved')extraGaps.add('Some split components have incomplete description or parsing evidence.');
      }
      row.sources=[...new Map([...(row.sources || []),...row.splitParts.map(part=>part.source).filter(source=>source?.url)].map(source=>[source.url+':'+(source.language || '')+':'+source.fetchedAt,source])).values()];
      const textLosses=amendmentTextLosses(null,row);
      if(invalidBaseline(row)||textLosses.length) {
        row.originalText=null;row.proposedText=null;row.textIntegrity='incomplete';row.wordingRetained=false;
        row.gaps.push(...textLosses.map(gap=>gap.message || gap.code));
        if(invalidBaseline(row))row.gaps.push('Earlier wording has no verified baseline compatible with the current document parser and is withheld.');
        extraGaps.add('Some amendment wording is withheld because its complete extraction could not be verified.');
      }
      if(row.variants?.length)row.variants=row.variants.map(variant=>{
        const losses=amendmentTextLosses(null,{...variant,number:row.number}),incompatible=invalidBaseline(variant);
        if(!incompatible&&!losses.length)return variant;
        row.gaps.push('Some retained amendment variants have unverified wording, which is withheld.');
        extraGaps.add('Some amendment variant wording is withheld because its complete extraction could not be verified.');
        return {...variant,originalText:null,proposedText:null,textIntegrity:'incomplete',wordingRetained:false,gaps:[...new Set([...(variant.gaps || []),...losses.map(gap=>gap.message || gap.code),...(incompatible?['Earlier wording has no verified baseline compatible with the current document parser and is withheld.']:[])])]};
      });
      if(listRelationshipsKnown!==false&&currentLists&&row.listId&&!currentLists.has(row.listId)) {
        row.listRelationship='absent-current-relationship';
        row.gaps.push('This amendment list is absent from the current target relationships; its earlier evidence is retained.');
        extraGaps.add('A previously indexed amendment list is absent from the current target relationships; its evidence is retained.');
      }
      if(listRelationshipsKnown===false) {
        if(row.listId&&!currentLists?.has(row.listId)){row.listRelationship='unverified';row.gaps.push('The current amendment-list relationship is unavailable; this list evidence is unverified and retained.');}
        if(row.variants?.length)row.variants=row.variants.map(variant=>currentLists?.has(variant.listId)?variant:{...variant,listRelationship:'unverified',gaps:[...new Set([...(variant.gaps || []),'The current amendment-list relationship is unavailable; this list evidence is unverified and retained.'])]});
        extraGaps.add('Current amendment-list relationships are unavailable; previously indexed list evidence is unverified and retained.');
      }
      row.gaps=[...new Set(row.gaps)];
    }
    const put=store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)');
    for(const row of merged.values())put.run(generation,row.id,target.id,row.date || target.date || '',amendmentOutcome(row.decisions),JSON.stringify({...row,outcome:amendmentOutcome(row.decisions)}));
    const sittingIds=[...new Set([...(target.sittingIds || []),...[...merged.values()].flatMap(row=>(row.decisions || []).map(decision=>decision.sittingId).filter(Boolean))])];
    store.db.prepare('INSERT OR REPLACE INTO amendment_targets VALUES (?,?,?)').run(generation,target.id,JSON.stringify({...target,...coverage,sittingIds,...(retained||extraGaps.size?{complete:false,gaps:[...new Set([...(coverage.gaps || []),...extraGaps,...(retained?['Previously accepted amendment components are retained after an incomplete refresh.']:[])])]}: {})}));
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
