import { createHash } from 'node:crypto';
import { AMENDMENT_LIMITS, PROPOSER_DATE_BASES, AMENDMENT_OUTCOME_PROOF_VERSION, AMENDMENT_DISTRIBUTION_PROOF_VERSION, AMENDMENT_EMPTY_OBSERVATION_VERSION, SPLIT_BINDING_GAP, amendmentRowOutcome, checkedAmendmentBindings, resolvedAmendmentAuthorId, amendmentTextLosses, amendmentProposerDate, checkedAggregateAttribution, amendmentReference, amendmentTarget, canonicalEPReference } from './amendments.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
const parse=value=>JSON.parse(value);
const wordingUpgradeGap='Amendment wording is unverified until the current document parser refreshes its source.';
const proposerDateGap='The amendment proposer date is unavailable; author identities cannot be checked against a mandate.';
const sourceFreshnessGap='Some amendment wording source distributions are pending, unverified or failed; retained wording is labelled.';
const checkedLabel=record=>({targetLabelLanguage:record.targetLabel?record.targetLabelLanguage ?? null:null,targetLabelSource:record.targetLabel?record.targetLabelSource ?? null:null});
const checkedTargetTopics=record=>[...(record.topics || []).filter(topic=>topic.basis!=='target'),...(record.targetLabel?[{id:'target:'+record.targetLabel,label:record.targetLabel,basis:'target',language:record.targetLabelLanguage ?? null,source:record.targetLabelSource ?? null}]:[])];
function checkedProposer(record) {
  const date=amendmentProposerDate(record);
  return {...record,proposerDate:date?.date || null,proposerDateBasis:date?.basis || null,
    authors:(record.authors || []).map(author=>date?resolvedAmendmentAuthorId(author)?author:{...author,personId:null,method:null,status:author.status || 'unverified'}:{...author,personId:null,method:null,status:'missing_proposer_date',evidence:[]}),
    gaps:[...new Set([...(record.gaps || []),...(!date&&record.authors?.length?[proposerDateGap]:[])])]};
}
function checkedAmendmentRead(record) {
  record=checkedAggregateAttribution(record);
  const row=checkedAmendmentBindings({...checkedProposer(record),...checkedLabel(record)});
  if((record.listId || record.textParserVersion!=null || typeof record.originalText==='string' || typeof record.proposedText==='string')&&record.textParserVersion!==AMENDMENT_EXTRACTION_VERSION) {
    row.originalText=null;row.proposedText=null;row.textIntegrity='incomplete';row.wordingRetained=false;
    row.gaps=[...new Set([...row.gaps,wordingUpgradeGap])];
  }
  if(record.listId || typeof record.originalText==='string' || typeof record.proposedText==='string') {
    row.sourceFreshness=record.sourceFreshness?.version===AMENDMENT_DISTRIBUTION_PROOF_VERSION?record.sourceFreshness:{...(record.sourceFreshness || {descriptor:null,sourceDescriptor:null}),version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'unverified',distributionState:'unknown'};
    if(row.sourceFreshness.status!=='fresh') {
      row.wordingRetained=row.textParserVersion===AMENDMENT_EXTRACTION_VERSION&&row.textIntegrity!=='incomplete'&&typeof row.originalText==='string'&&typeof row.proposedText==='string';
      row.gaps=[...new Set([...row.gaps,sourceFreshnessGap])];
    }
  }
  if(record.variants)row.variants=record.variants.map(checkedAmendmentRead);
  if(record.targetDocumentId || record.topics)row.topics=checkedTargetTopics(row);
  row.outcome=amendmentRowOutcome(row);
  return row;
}
// Apply only to checked read records: proposer dates and variant attribution have
// already passed the same guards used by the member-filtered catalogue query.
export function amendmentAuthorMatch(record,member) {
  const memberId=String(member);
  const matches=value=>!value.conflicted&&Boolean(amendmentProposerDate(value))&&(value.authors || []).some(author=>resolvedAmendmentAuthorId(author)===memberId);
  const aggregateMatched=matches(record),variants=(record.variants || []).filter(matches);
  const matched=aggregateMatched||variants.length>0;
  return {memberId,matched,aggregateMatched,basis:matched?aggregateMatched?variants.length?'aggregate-and-variant':'aggregate':'variant':null,
    variantListIds:[...new Set(variants.map(variant=>variant.listId).filter(Boolean))]};
}
function supportedProposerDateSql(body) {
  const value=field=>`json_extract(${body},'$.${field}')`,date=value('proposerDate'),document=value('documentDate'),list=value('listDocumentDate');
  const valid=expression=>`(typeof(${expression})='text' AND ${expression} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${expression},'+0 days')=${expression})`;
  const bases=PROPOSER_DATE_BASES.map(basis=>"'"+basis+"'").join(',');
  return `COALESCE((${valid(date)} AND (${value('proposerDateBasis')} IN (${bases}) OR (${valid(document)} AND ${date}=${document}) OR (${valid(list)} AND ${date}=${list}))) OR (${date} IS NULL AND COALESCE(${value('proposerRetained')},0)=0 AND (${valid(document)} OR ${valid(list)})),0)`;
}
const incompatibleWordingSql=body=>`((json_extract(${body},'$.listId') IS NOT NULL OR json_extract(${body},'$.textParserVersion') IS NOT NULL OR json_type(${body},'$.originalText')='text' OR json_type(${body},'$.proposedText')='text') AND COALESCE(json_extract(${body},'$.textParserVersion'),'')<>?)`;
const unverifiedSourceSql=body=>`((json_extract(${body},'$.listId') IS NOT NULL OR json_type(${body},'$.originalText')='text' OR json_type(${body},'$.proposedText')='text') AND (COALESCE(json_extract(${body},'$.sourceFreshness.version'),0)<>${AMENDMENT_DISTRIBUTION_PROOF_VERSION} OR COALESCE(json_extract(${body},'$.sourceFreshness.status'),'unverified')<>'fresh'))`;
const splitUnverifiedSql=body=>`(EXISTS(SELECT 1 FROM json_each(${body},'$.decisions') AS vote WHERE json_extract(vote.value,'$.partId') IS NOT NULL OR json_extract(vote.value,'$.partNumber') IS NOT NULL OR json_extract(vote.value,'$.componentBinding') IS NOT NULL OR json_array_length(json_extract(vote.value,'$.componentReferences'))>0) AND (COALESCE(json_extract(${body},'$.outcomeProofVersion'),0)<>${AMENDMENT_OUTCOME_PROOF_VERSION} OR COALESCE(json_extract(${body},'$.splitCoverageComplete'),0)<>1 OR COALESCE(json_array_length(json_extract(${body},'$.splitCoverage')),0)=0 OR EXISTS(SELECT 1 FROM json_each(${body},'$.splitCoverage') AS proof WHERE COALESCE(json_extract(proof.value,'$.complete'),0)<>1) OR EXISTS(SELECT 1 FROM json_each(${body},'$.decisions') AS vote WHERE json_extract(vote.value,'$.componentBinding') IN ('unresolved-collective','unverified'))))`;
const memberMatchesSql=body=>`(COALESCE(json_extract(${body},'$.conflicted'),0)=0 AND ${supportedProposerDateSql(body)} AND EXISTS(SELECT 1 FROM json_each(${body},'$.authors') AS author WHERE json_extract(author.value,'$.status')='resolved' AND CAST(json_extract(author.value,'$.personId') AS TEXT) IN (?,?)))`;
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
        if(incoming[field]==null&&old[field]!=null){incoming[field]=old[field];if(field==='targetLabel')Object.assign(incoming,checkedLabel(old));incoming.fieldSources={...(incoming.fieldSources || {}),[field]:field==='targetLabel'?old.targetLabelSource || null:old.fieldSources?.[field] || (['originalText','proposedText','language'].includes(field)?old.wordingSource:old.metadataSource) || null};stale.push(field);}
      }
      const acceptedProposer=checkedProposer(old);
      const retainProposer=()=>Object.assign(incoming,{proposerSource:old.proposerSource || old.metadataSource || null,proposerRetained:true,proposerDate:acceptedProposer.proposerDate,proposerDateBasis:acceptedProposer.proposerDateBasis});
      if(!incoming.conflicted && !incoming.committeeProposer && !incoming.authors?.length && old.authors?.length){incoming.authors=acceptedProposer.authors;retainProposer();stale.push('authors');}
      else if(!incoming.conflicted&&!old.conflicted&&!incoming.committeeProposer&&!incoming.authors?.length&&old.committeeProposer){incoming.committeeProposer=old.committeeProposer;retainProposer();stale.push('committee proposer');}
      else incoming.authors=(incoming.authors || []).map(author=>{
        const accepted=(old.authors || []).find(item=>item.name===author.name&&item.personId!=null);
        // Missing inputs can retain an accepted link, but an explicit fresh
        // ambiguity or inactive mandate invalidates that link immediately.
        if(author.personId==null&&accepted&&acceptedProposer.proposerDate&&acceptedProposer.proposerDate===amendmentProposerDate(incoming)?.date&&['missing','missing_mandate'].includes(author.status)){stale.push('author identity');return {...accepted,latestResolution:author};}return author;
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
      Object.assign(row,checkedAggregateAttribution(row));
      Object.assign(row,checkedProposer(row),checkedLabel(row));
      if(row.variants)row.variants=row.variants.map(variant=>({...checkedProposer(variant),...checkedLabel(variant)}));
      if([row,...(row.variants || [])].some(record=>record.authors?.length&&!record.proposerDate))extraGaps.add(proposerDateGap);
      row.gaps=(row.gaps || []).filter(gap=>gap!=='An amendment decision has no exact recorded source page; candidate page provenance is retained.');
      if((row.decisions || []).some(decision=>!decision.source?.url)){row.gaps.push('An amendment decision has no exact recorded source page; candidate page provenance is retained.');extraGaps.add('Some amendment decisions have no exact recorded source page.');}
      Object.assign(row,checkedAmendmentBindings(row));
      const partIds=new Set((row.decisions || []).map(decision=>decision.partId).filter(Boolean));
      const parts=new Map((row.splitParts || []).filter(part=>partIds.has(part.id)).map(part=>[part.id,part]));
      for(const id of partIds)if(freshParts.has(id))parts.set(id,freshParts.get(id));
      row.splitParts=[...parts.values()];
      Object.assign(row,checkedAmendmentBindings(row));
      if(!row.splitCoverageComplete)extraGaps.add(SPLIT_BINDING_GAP);
      row.gaps=(row.gaps || []).filter(gap=>!splitGaps.has(gap)&&!((row.decisions || []).length&&gap==='No explicit amendment outcome is indexed.'));
      for(const id of partIds) {
        const part=parts.get(id);
        if(!part)row.gaps.push('A split component has no indexed description.');
        else if(part.status==='unresolved')row.gaps.push('A split description could not be parsed; the failure is retained for a future parser update.');
        else row.gaps.push('Split descriptions are parsed as selection plans; exact wording spans have not been validated.');
        if(part&&!part.source?.url){row.gaps.push('The split description has no exact recorded source page; candidate page provenance is retained.');extraGaps.add('Some split descriptions have no exact recorded source page.');}
        if(!part||part.status==='unresolved')extraGaps.add('Some split components have incomplete description or parsing evidence.');
      }
      row.sources=[...new Map([...(row.sources || []),...row.splitParts.map(part=>part.source),...(row.decisions || []).map(decision=>decision.source)].filter(source=>source?.url).map(source=>[source.url+':'+(source.language || '')+':'+source.fetchedAt,source])).values()];
      const textLosses=amendmentTextLosses(null,row);
      const oldParser=(row.listId || row.textParserVersion!=null || typeof row.originalText==='string' || typeof row.proposedText==='string')&&row.textParserVersion!==AMENDMENT_EXTRACTION_VERSION;
      if(invalidBaseline(row)||oldParser||textLosses.length) {
        row.originalText=null;row.proposedText=null;row.textIntegrity='incomplete';row.wordingRetained=false;
        row.gaps.push(...textLosses.map(gap=>gap.message || gap.code));
        if(invalidBaseline(row))row.gaps.push('Earlier wording has no verified baseline compatible with the current document parser and is withheld.');
        if(oldParser)row.gaps.push(wordingUpgradeGap);
        extraGaps.add('Some amendment wording is withheld because its complete extraction could not be verified.');
      }
      if(row.variants?.length)row.variants=row.variants.map(variant=>{
        const losses=amendmentTextLosses(null,{...variant,number:row.number}),incompatible=invalidBaseline(variant)||variant.textParserVersion!==AMENDMENT_EXTRACTION_VERSION;
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
      row.topics=checkedTargetTopics(row);
    }
    const put=store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)');
    for(const row of merged.values())put.run(generation,row.id,target.id,row.date || target.date || '',amendmentRowOutcome(row),JSON.stringify({...row,outcome:amendmentRowOutcome(row)}));
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
/** One exact indexed selection, with the same wording/binding guards as a page. */
export function amendmentById(store,{document,id,language='en'}={}) {
  if(!amendmentTarget(document)||typeof id!=='string')return null;
  const reference=canonicalEPReference(id)||canonicalEPReference('eli/dl/doc/'+id);
  const identity=amendmentReference(reference);
  if(!identity||identity.targetDocumentId!==document)return null;
  const generation=amendmentGeneration(store);
  const rows=store.db.prepare(`SELECT id,body FROM amendments WHERE generation=? AND target=? AND
    (id=? OR (json_type(amendments.body,'$.officialIds')='array' AND EXISTS(SELECT 1 FROM json_each(amendments.body,'$.officialIds') AS official
      WHERE (CASE WHEN official.type='object' THEN json_extract(official.value,'$.id') ELSE official.value END) IN (?,?,?)))) LIMIT 2`)
    .all(generation,document,identity.id,reference,'https://data.europarl.europa.eu/'+reference,'http://data.europarl.europa.eu/'+reference);
  // An alias shared by two records is not a reliable individual selection.
  if(rows.length!==1)return null;
  const record=parse(rows[0].body);
  if(record.id!==rows[0].id||record.targetDocumentId!==document||amendmentReference('eli/dl/doc/'+record.id)?.targetDocumentId!==document)return null;
  const row=checkedAmendmentRead(record);
  return {...row,title:row.titles?.[language] || row.titles?.en || Object.values(row.titles || {})[0] || document,requestedLanguage:language};
}
function checkedEmptyObservation(record,document,rowCount) {
  const proof=record?.emptyObservation,source=proof?.source;
  // This proves only the published list relationship was observed empty. It
  // cannot erase retained records or establish a census of oral/other changes.
  return rowCount===0&&record?.id===document&&record.listProjectionVersion===AMENDMENT_LINKS_VERSION&&
    record.linkedListObservationCount===0&&record.unresolvedListObservationCount===0&&
    proof?.version===AMENDMENT_EMPTY_OBSERVATION_VERSION&&proof.documentId===document&&proof.listCount===0&&
    proof.relationship==='inverse_foresees_change_of'&&proof.scope==='published-amendment-list-relationships'&&
    source?.url==='https://data.europarl.europa.eu/api/v2/plenary-documents/'+document+'?format=application%2Fld%2Bjson'&&
    typeof source.fetchedAt==='string'&&Number.isFinite(Date.parse(source.fetchedAt))?proof:null;
}
export function amendmentsPage(store,{document=null,procedure=null,member=null,outcome=null,language='en',limit=20,offset=0}={}) {
  const generation=amendmentGeneration(store),clauses=['generation=?'],args=[generation];
  if(document){clauses.push('target=?');args.push(document);}
  if(outcome){clauses.push(`(CASE WHEN ${splitUnverifiedSql('amendments.body')} THEN 'unavailable' ELSE outcome END)=?`);args.push(outcome);}
  if(procedure){clauses.push("EXISTS(SELECT 1 FROM json_each(amendments.body,'$.procedureIds') AS p WHERE p.value=?)");args.push(procedure);}
  if(member){clauses.push(`(${memberMatchesSql('amendments.body')} OR EXISTS(SELECT 1 FROM json_each(amendments.body,'$.variants') AS variant WHERE ${memberMatchesSql('variant.value')}))`);args.push(String(member),'person/'+member,String(member),'person/'+member);}
  const where=clauses.join(' AND '),total=store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE '+where).get(...args).n;
  const items=store.db.prepare('SELECT body FROM amendments WHERE '+where+" ORDER BY date DESC,target,CAST(json_extract(body,'$.number') AS INTEGER),id LIMIT ? OFFSET ?").all(...args,limit,offset).map(record=>{
    const row=checkedAmendmentRead(parse(record.body));
    if(member) {
      const {memberId,basis,variantListIds}=amendmentAuthorMatch(row,member);
      row.authorMatch={memberId,basis,variantListIds};
    }
    return {...row,title:row.titles?.[language] || row.titles?.en || Object.values(row.titles || {})[0] || row.targetDocumentId,requestedLanguage:language};
  });
  const records=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=?'+(document?' AND id=?':'')+' LIMIT 10001').all(generation,...(document?[document]:[])).map(record=>parse(record.body));
  const gaps=[...new Set(records.flatMap(record=>record.gaps || []))];
  const listProjectionUnverified=records.some(record=>record.listProjectionVersion!==AMENDMENT_LINKS_VERSION);
  if(listProjectionUnverified)gaps.push('Amendment-list observation coverage is unverified until the current document projection refreshes its source.');
  // Verify the cached scope before pagination, so a stale later page cannot
  // produce complete coverage on an otherwise current first page. Reads never
  // rewrite the retained source or indexed JSON used by older workers.
  const readCoverage=store.db.prepare(`SELECT COUNT(*) AS rows,
    COALESCE(MAX(CASE WHEN ${incompatibleWordingSql('amendments.body')} OR EXISTS(SELECT 1 FROM json_each(amendments.body,'$.variants') AS variant WHERE ${incompatibleWordingSql('variant.value')}) THEN 1 ELSE 0 END),0) AS wording,
    COALESCE(MAX(CASE WHEN (json_array_length(json_extract(amendments.body,'$.authors'))>0 AND NOT ${supportedProposerDateSql('amendments.body')}) OR EXISTS(SELECT 1 FROM json_each(amendments.body,'$.variants') AS variant WHERE json_array_length(json_extract(variant.value,'$.authors'))>0 AND NOT ${supportedProposerDateSql('variant.value')}) THEN 1 ELSE 0 END),0) AS proposer,
    COALESCE(MAX(CASE WHEN ${splitUnverifiedSql('amendments.body')} THEN 1 ELSE 0 END),0) AS splits,
    COALESCE(MAX(CASE WHEN ${unverifiedSourceSql('amendments.body')} OR EXISTS(SELECT 1 FROM json_each(amendments.body,'$.variants') AS variant WHERE ${unverifiedSourceSql('variant.value')}) THEN 1 ELSE 0 END),0) AS freshness
    FROM amendments WHERE generation=?${document?' AND target=?':''}`).get(AMENDMENT_EXTRACTION_VERSION,AMENDMENT_EXTRACTION_VERSION,generation,...(document?[document]:[]));
  if(readCoverage.wording)gaps.push(wordingUpgradeGap);
  if(readCoverage.proposer)gaps.push(proposerDateGap);
  if(readCoverage.splits)gaps.push(SPLIT_BINDING_GAP);
  if(readCoverage.freshness)gaps.push(sourceFreshnessGap);
  const working=store.get('working'),active=store.get('active');
  const generations=[...new Set([generation,working?.generation,active].filter(Boolean))];
  const pending=Boolean(generations.some(id=>store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND done<>1 LIMIT 1').get(id)||store.db.prepare("SELECT 1 FROM sources WHERE generation=? AND key='amendment:continuations' AND (json_array_length(json_extract(body,'$.tasks'))>0 OR json_array_length(json_extract(body,'$.discovery'))>0) LIMIT 1").get(id))||[...new Set([working?.generation,active].filter(Boolean))].some(id=>store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind IN ('document','motion-outcomes') AND (done IS NULL OR done<>1) LIMIT 1").get(id)));
  const capacityGaps=generations.flatMap(id=>{
    const row=store.db.prepare("SELECT json_extract(body,'$.capacityGap') AS gap FROM sources WHERE generation=? AND key='amendment:continuations'").get(id);
    if(!row?.gap)return [];
    let detail;try {detail=JSON.parse(row.gap);}catch {detail=null;}
    return [typeof detail?.message==='string'?detail.message:'Some amendment discovery was deferred after the checkpoint capacity was reached.'];
  });
  gaps.push(...new Set(capacityGaps));
  if(!records.length)gaps.push(document?'This document has no indexed amendment records.':'Amendment discovery is incomplete.');
  if(!document)gaps.push('Coverage includes indexed plenary amendment lists; older targets are enriched in bounded batches.');
  const lastUpdated=records.map(record=>record.lastUpdated).filter(Boolean).sort().at(-1) || null;
  const indexedObservationComplete=Boolean(document&&readCoverage.rows>0&&records.length&&records.every(record=>record.complete)&&!listProjectionUnverified&&!readCoverage.wording&&!readCoverage.proposer&&!readCoverage.splits&&!readCoverage.freshness);
  const emptyObservation=document&&records.length===1?checkedEmptyObservation(records[0],document,readCoverage.rows):null;
  const observationComplete=indexedObservationComplete||Boolean(emptyObservation);
  return {items,total,offset,limit,coverage:{complete:Boolean(indexedObservationComplete&&!pending&&!capacityGaps.length),observationComplete,emptyObservation,
    observationScope:emptyObservation?'published-amendment-list-relationships':'indexed-plenary-amendment-sources',indexed:Boolean(records.length),pending,gaps,lastUpdated,parserVersion:SPLIT_PARSER_VERSION,scope:'plenary',servingGeneration:generation,workingGeneration:Boolean(working?.generation===generation)},failures:amendmentFailureSummary(store)};
}

export function amendmentCompletionMarker(task,today) {
  return task.done===1&&task.kind==='motion-outcomes'&&task.key.includes(':'+today)?{key:task.key,kind:task.kind,sittingId:parse(task.body).sittingId}:null;
}
export function enqueueAmendment(store,generation,key,kind,body,priority=105,refreshCompleted=false) {
  store.assertWriter();
  const enqueue=()=>{
    const existing=store.db.prepare('SELECT 1 FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
    if(!existing) {
      const checkpointKey='amendment:continuations',saved=store.source(generation,checkpointKey)?.work || {};
      const saveCheckpoint=work=>store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,checkpointKey,'amendment-continuations',JSON.stringify(work),new Date(store.clock()).toISOString());
      if([...(saved.tasks || []),...(saved.discovery || [])].some(task=>task.key===key))return true;
      if(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n>=200) {
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(store.clock()));
        const completed=new Map((saved.completed || []).filter(task=>task.key.includes(':'+today)).map(task=>[task.key,task]));
        const reclaim=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND done=1 ORDER BY (kind='motion-outcomes'),key").all(generation).find(task=>{
          const marker=amendmentCompletionMarker(task,today);return !marker||completed.has(marker.key)||completed.size<200;
        });
        if(reclaim) {
          const marker=amendmentCompletionMarker(reclaim,today);
          if(marker){completed.set(marker.key,marker);saveCheckpoint({...saved,completed:[...completed.values()]});}
          store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,reclaim.key);
        } else {
          const tasks=[...(saved.tasks || [])];
          if(tasks.length<200) {
            tasks.push({generation,key,kind,body:JSON.stringify(body),priority,done:0,attempts:0,retry_at:0,error:null});
            saveCheckpoint({...saved,tasks});return true;
          }
          // Only untouched discovery reaches this limit; admitted cursors stay
          // in the direct queue or its reserved full snapshots.
          const capacityGap={count:(saved.capacityGap?.count || 0)+1,message:'Additional untouched amendment discovery exceeded the bounded checkpoint and is deferred to normal catalogue refresh.'};
          saveCheckpoint({...saved,capacityGap});
          store.db.prepare("UPDATE sources SET body=json_remove(body,'$.amendmentLinksVersion') WHERE generation=? AND kind='document' AND (json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT')").run(generation);
          return false;
        }
      }
    }
    store.db.prepare('INSERT OR IGNORE INTO amendment_jobs(generation,key,kind,body,priority) VALUES (?,?,?,?,?)').run(generation,key,kind,JSON.stringify(body),priority);
    if(refreshCompleted)store.db.prepare('UPDATE amendment_jobs SET done=0,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE generation=? AND key=? AND done=1').run(JSON.stringify(body),priority,generation,key);
    return true;
  };
  return store.db.isTransaction?enqueue():store.transaction(enqueue);
}
export function nextAmendmentTask(store,generation) {
  const row=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND done=0 AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(generation,store.clock());
  return row?{...row,body:parse(row.body),amendmentJob:true}:null;
}
