import {committeeCode,committeeListId} from './committee-amendments.mjs';
import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {procedureReference} from './official-context.mjs';
import {canonical,personId} from './insights-model.mjs';
import {array,tail} from './activity-index-model.mjs';
import {classifyProcedure,refs} from './insights-legislation-model.mjs';
import {LegislationInsights,sourceCacheState} from './insights-legislation.mjs';
import {languagePreference} from './language-order.mjs';
import {amendmentsPage,amendmentAuthorMatch,amendmentGeneration,amendmentProcedureTargets,amendmentContributors} from './amendments-store.mjs';
import {resolvedAmendmentAuthorId} from './amendments.mjs';
import {memberVotes} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {requestSignal,isLocalRequestFailure} from './request-budget.mjs';

export const DOSSIER_ACTIVITY_VERSION=8;
export const DOSSIER_ACTIVITY_LIMITS=Object.freeze({roles:500,documents:24,debatesPerPage:2,children:1000,speechRows:2000,votes:4000});
const sectionNames=['roles','speeches','amendments','votes'];
const validId=value=>/^\d{4}-\d{4}[A-Z]?$/.test(value||'');
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const date=value=>validDay(value)?value:null;
const source=(record,language=null)=>({url:record.url,fetchedAt:typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt||null,language,...sourceCacheState(record)});
const apiUrl=endpoint=>'https://data.europarl.europa.eu/api/v2'+endpoint;
const sorted=items=>items.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.start||'').localeCompare(b.start||'')||a.id.localeCompare(b.id));
const pick=(titles,language,fallback)=>{const code=languagePreference(Object.keys(titles||{}).filter(key=>typeof titles[key]==='string'&&titles[key].trim()),language)[0];return {title:code?titles[code]:fallback,titleLanguage:code||null};};
const stage=value=>{const values=[...new Set(refs(value).map(tail))];return values.length===1?values[0]:null;};
const unique=items=>[...new Map(items.map(item=>[item.id,item])).values()];
const eventRef=value=>{const id=tail(value);return /^MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/.test(id)?'eli/dl/event/'+id:canonical(value);};
const errorGap=error=>({code:error?.code||'source_unavailable',message:'Source unavailable.'});

export function dossierActivityQuery(search) {
  const allowed=['reference','member','section','lang','offset','target-offset','limit','stage','committee','participant-offset'];
  for(const key of search.keys())if(!allowed.includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated dossier parameter.');
  const reference=procedureReference(search.get('reference')),member=search.get('member'),section=search.get('section')||'roles';
  if(member!==null&&(!/^[1-9]\d*$/.test(member)||!Number.isSafeInteger(Number(member))))throw new HttpError(400,'invalid_member','Use an exact person identifier.');
  if(!sectionNames.includes(section)||section!=='roles'&&!member)throw new HttpError(400,'invalid_section','Choose an activity section and person.');
  const stageFilter=search.get('stage')||'all',committee=search.get('committee');
  if(!['all','committee','plenary'].includes(stageFilter))throw new HttpError(400,'invalid_stage','Choose all, committee or plenary amendments.');
  if(committee!==null&&!committeeCode(committee))throw new HttpError(400,'invalid_committee','Choose an exact committee code.');
  const integer=(key,fallback,max)=>{const raw=search.get(key)??String(fallback),n=Number(raw);if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(n)||n>max||key==='limit'&&n<1)throw new HttpError(400,'invalid_query','Invalid dossier page.');return n;};
  return {reference,member,section,language:odpLanguage(search.get('lang')||'en'),offset:integer('offset',0,100000),targetOffset:integer('target-offset',0,1000),limit:integer('limit',25,50),stage:stageFilter,committee,participantOffset:integer('participant-offset',0,100000)};
}

export function dossierReferencesQuery(search) {
  for(const key of search.keys())if(!['procedures','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated procedure parameter.');
  const ids=(search.get('procedures')||'').split(',');
  if(!ids.length||ids.length>3||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_procedures','Choose up to three exact procedure identifiers.');
  return {ids,language:odpLanguage(search.get('lang')||'en')};
}

export function amendmentTabling(procedure,listId,procedureSource) {
  const observations=array(procedure.consists_of).filter(event=>['TABLING_PLENARY','COMMITTEE_TABLING_AMENDMENT'].includes(tail(event.had_activity_type))&&refs(event.based_on_a_realization_of).includes('eli/dl/doc/'+listId))
    .map(event=>({id:canonical(event.id),date:date(event.activity_date),stage:stage(event.occured_at_stage),source:procedureSource}));
  const dates=[...new Set(observations.map(item=>item.date))],known=dates.filter(Boolean);
  return {status:dates.length===1&&known.length===1?'recorded':known.length>1?'conflicting':'unavailable',date:dates.length===1?known[0]||null:null,observations};
}

// Recheck the retained mandate evidence when exact tabling and document dates differ.
// A name match on the document date cannot establish a mandate on a different day.
function authorAtTabling(record,member,tabling) {
  if(!amendmentAuthorMatch(record,member).aggregateMatched)return false;
  if(tabling.status==='conflicting')return false;
  if(!tabling.date||tabling.date===record.proposerDate)return true;
  return array(record.authors).filter(author=>resolvedAmendmentAuthorId(author)===member).some(author=>array(author.evidence).some(proof=>array(proof.mandates).some(period=>validDay(period.start)&&period.start<=tabling.date&&(!period.end||validDay(period.end)&&period.end>=tabling.date))));
}

/** A read-only view over public source clients and the store already owned by the app. */
export class DossierActivity {
  constructor(store,{reader,votes=memberVotes,readAmendments=amendmentsPage,...options}={}) {
    this.store=store;this.reader=reader||new LegislationInsights(store,options);this.votes=votes;this.readAmendments=readAmendments;
  }
  async procedure(id,language,reference=null) {
    const record=await this.reader.record('/procedures/'+id);
    const nodes=record.payload.data.filter(node=>canonical(node.id)==='eli/dl/proc/'+id);
    if(nodes.length!==1)throw new HttpError(502,'dossier_identity','The exact procedure source is unavailable.');
    const work=nodes[0],label=work.label,code=classifyProcedure(work).code;
    if(typeof label!=='string'||!/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(label)||label.split('(')[0]!==id.replace('-','/')||reference&&label!==reference||code&&label!==id.replace('-','/')+'('+code+')')throw new HttpError(502,'dossier_reference','The procedure reference does not match its source.');
    return {work,procedure:{id,reference:label,...pick(work.process_title,language,label),source:source(record)}};
  }
  async references({ids,language}) {
    const items=[],gaps=[];
    for(const id of ids)try{items.push((await this.procedure(id,language)).procedure);}catch(error){if(isLocalRequestFailure(error))throw error;gaps.push({id,...errorGap(error)});}
    return {version:DOSSIER_ACTIVITY_VERSION,items,coverage:{status:gaps.length?'partial':'complete',gaps}};
  }
  localRoles(work,procedure,generation) {
    const items=[],gaps=[];let documents=0;
    if(!Array.isArray(work.had_participation))gaps.push('Procedure role records are unavailable.');
    const add=(participations,from,documentId=null,documentDate=null)=>{
      for(const part of array(participations))for(const value of array(part.had_participant_person)) {
        if(items.length>DOSSIER_ACTIVITY_LIMITS.roles)return;
        const id=personId(value);if(!id)continue;
        const recorded=date(part.activity_date);
        items.push({kind:'role',id:(canonical(part.id)||[documentId||procedure.id,tail(part.participation_role),stage(part.occured_at_stage)].join(':'))+'@'+id,participationId:canonical(part.id)||null,personId:id,role:tail(part.participation_role)||'UNSPECIFIED',committee:tail(part.participation_in_name_of)||null,date:recorded||(documentId?date(documentDate):null),dateBasis:recorded||!documentId?'recorded':'document',stage:stage(part.occured_at_stage),source:from,...(documentId?{documentId}:{})});
      }
    };
    add(work.had_participation,procedure.source);
    const roleDocuments=function*(store){if(store.reportsForProcedure)yield*store.reportsForProcedure(generation,procedure.id);if(store.committeeDocumentsForProcedure)yield*store.committeeDocumentsForProcedure(generation,procedure.id);};
    for(const report of roleDocuments(this.store)) {
      if(documents++>=DOSSIER_ACTIVITY_LIMITS.documents){gaps.push('Some linked role documents are outside this page.');break;}
      if(!refs(report.work.inverse_created_a_realization_of).includes('eli/dl/proc/'+procedure.id))continue;
      add(report.work.workHadParticipation,source({url:apiUrl(report.key),fetchedAt:report.fetchedAt}),tail(report.work.id),report.work.document_date);
    }
    if(items.length>DOSSIER_ACTIVITY_LIMITS.roles)gaps.push('Some recorded roles are outside this page.');
    const roles=unique(sorted(items)).slice(0,DOSSIER_ACTIVITY_LIMITS.roles),participants=new Map();
    for(const role of roles) {
      let person=participants.get(role.personId);
      if(!person){const row=this.store.db.prepare('SELECT body FROM members WHERE id=?').get(role.personId),member=row?JSON.parse(row.body):null;person={id:role.personId,name:member?[member.firstName||member.givenName,member.lastName||member.familyName].filter(Boolean).join(' ')||member.name||member.label||null:null,roles:[]};participants.set(person.id,person);}
      person.roles.push(role);
    }
    return {roles,participants:[...participants.values()],gaps};
  }
  async participants(result,work,query) {
    // Reuse the exact debate-child projection, without fetching individual people
    // or speeches. A procedural role is not a prerequisite for a contribution.
    const speechResult={...result,items:[],coverage:{status:'complete',gaps:[],sources:[result.procedure.source],checkedTargets:[],uncheckedTargets:[]},pagination:{...result.pagination,next:null}};
    await this.speeches(speechResult,work,{...query,offset:0},(items,next)=>{speechResult.items=items;speechResult.pagination.next=next;});
    result.participantCoverage=speechResult.coverage;
    const people=new Map(result.participants.map(person=>[person.id,{...person,speeches:[]}]));
    this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation){result.participantCoverage={...speechResult.coverage,status:'unavailable',retryable:true,gaps:['The activity index changed. Retry participants.']};return;}
      for(const speech of speechResult.items){
        let person=people.get(speech.personId);
        if(!person){const row=this.store.db.prepare('SELECT body FROM members WHERE id=?').get(speech.personId),member=row?JSON.parse(row.body):null;person={id:speech.personId,name:member?[member.firstName||member.givenName,member.lastName||member.familyName].filter(Boolean).join(' ')||member.name||member.label||null:null,roles:[],speeches:[]};people.set(person.id,person);}
        person.speeches.push({id:speech.id,debateId:speech.debateId,date:speech.date,source:speech.source});
      }
    });
    this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation)return;
      const contributions=amendmentContributors(this.store,{procedures:[result.procedure.id],offset:query.participantOffset||query.offset||0,limit:DOSSIER_ACTIVITY_LIMITS.speechRows});
      result.amendmentGeneration=amendmentGeneration(this.store);
      result.participantPagination={offset:query.participantOffset||query.offset||0,next:contributions.next};
      const targets=amendmentProcedureTargets(this.store,result.procedure.id,{limit:1001});
      const failed=targets.filter(target=>target.proposerComplete===false||contributions.truncated).map(target=>target.listId||target.targetDocumentId||target.id);
      const checked=targets.filter(target=>target.proposerComplete===true&&!contributions.truncated).map(target=>target.listId||target.targetDocumentId||target.id);
      result.participantCoverage.checkedTargets=[...new Set([...result.participantCoverage.checkedTargets,...checked])];
      for(const item of contributions.items)if(item.source?.url)result.participantCoverage.sources.push(item.source);
      result.participantCoverage.uncheckedTargets=[...new Set([...result.participantCoverage.uncheckedTargets,...failed])];
      result.participantCoverage.retryable ||= failed.length>0;
      if((failed.length||contributions.truncated||result.participantCoverage.status==='unavailable'&&contributions.items.length)&&result.participantCoverage.status!=='partial')result.participantCoverage.status='partial';
      result.participantCoverage.amendments={status:contributions.items.length?'partial':'unavailable',truncated:contributions.truncated};
      for(const contribution of contributions.items){
        let person=people.get(contribution.personId);
        if(!person){const row=this.store.db.prepare('SELECT body FROM members WHERE id=?').get(contribution.personId),member=row?JSON.parse(row.body):null;person={id:contribution.personId,name:member?[member.firstName||member.givenName,member.lastName||member.familyName].filter(Boolean).join(' ')||member.name||member.label||null:null,roles:[],speeches:[]};people.set(person.id,person);}
        person.amendments||=[];const {id,scope,listId,targetDocumentId,date,source,countConflict}=contribution;person.amendments.push({id,scope,listId,targetDocumentId,date,source,...(countConflict?{countConflict:true}:{})});
      }
      for(const person of people.values()){person.amendments||=[];person.amendmentCounts={committee:null,plenary:null};for(const scope of ['committee','plenary']){const ids=new Set(person.amendments.filter(value=>value.scope===scope).map(value=>value.id));if(ids.size&&!person.amendments.some(value=>value.scope===scope&&value.countConflict))person.amendmentCounts[scope]=ids.size;}}
      if(contributions.next!==null&&!result.pagination.next)result.pagination.next={offset:contributions.next,targetOffset:query.targetOffset||0};
    });
    result.participants=[...people.values()];
    result.pagination.next ||= speechResult.pagination.next;
    result.coverage.truncated=Boolean(result.pagination.next);
  }
  async query(query) {
    const {reference,language,member,section,offset,targetOffset,limit}=query,id=reference.split('(')[0].replace('/','-');
    const {work,procedure}=await this.procedure(id,language,reference);
    const local=this.store.readSnapshot(()=>{const generation=this.store.status().servingGeneration;return {generation,...this.localRoles(work,procedure,generation)};});
    const coverage={status:'complete',gaps:section==='roles'?[...local.gaps]:[],sources:[procedure.source],checkedTargets:[],uncheckedTargets:[],checkedScope:section,observedCount:null,truncated:false},pagination={offset,targetOffset,limit,next:null};
    const result={version:DOSSIER_ACTIVITY_VERSION,procedure,memberId:member,participants:local.participants.map(person=>({...person,amendmentCounts:{committee:null,plenary:null},amendments:[]})),section,items:[],pagination,coverage,generation:local.generation};
    const page=(items,nextTarget=null)=>{result.items=items.slice(offset,offset+limit);pagination.next=offset+limit<items.length?{offset:offset+limit,targetOffset}:nextTarget;coverage.observedCount=items.length;coverage.truncated=Boolean(pagination.next);};
    if(section==='roles') {
      const roles=local.roles.filter(role=>!member||role.personId===member);page(roles);coverage.status=!Array.isArray(work.had_participation)&&!roles.length?'unavailable':local.gaps.length?'partial':'complete';
      if(!member)await this.participants(result,work,query);
    }else if(section==='speeches')await this.speeches(result,work,query,page);
    else if(section==='amendments'){result.stage=query.stage||'all';result.committee=query.committee||null;await this.amendments(result,work,query);}
    else await this.ballots(result,work,query);
    coverage.checkedComplete ??= coverage.status==='complete'&&!coverage.gaps.length;
    if(coverage.status==='complete'&&(coverage.gaps.length||coverage.uncheckedTargets.length))coverage.status='partial';
    if(coverage.status==='unavailable')coverage.observedCount=null;
    coverage.gaps=[...new Set(coverage.gaps)];
    coverage.sources=[...new Map(coverage.sources.map(s=>[JSON.stringify([s.url,s.fetchedAt,s.contentHash||null]),s])).values()];
    result.snapshotId=createHash('sha256').update(JSON.stringify([result.generation,result.section,result.items,result.participants,result.participantCoverage,result.coverage,result.pagination])).digest('hex');
    requestSignal()?.throwIfAborted();return result;
  }
  async speeches(result,work,query,page) {
    const {coverage}=result,{targetOffset,language,member}=query;
    coverage.retryable=false;coverage.failedDebates=[];coverage.missingSpeechIds=[];coverage.checkedComplete=false;
    if(!Array.isArray(work.consists_of)){coverage.status='unavailable';coverage.gaps.push('Linked debate records are unavailable.');return;}
    const declaredDebates=work.consists_of.filter(event=>tail(event.had_activity_type)==='PLENARY_DEBATE');
    const debates=sorted(declaredDebates.filter(event=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(canonical(event.id))).map(event=>({...event,date:date(event.activity_date)})));
    if(debates.length!==declaredDebates.length)coverage.gaps.push('A linked debate has an invalid identifier.');
    const selected=debates.slice(targetOffset,targetOffset+DOSSIER_ACTIVITY_LIMITS.debatesPerPage),children=new Map();
    coverage.checkedTargets=selected.map(event=>tail(event.id));
    coverage.uncheckedTargets=[...new Set(debates.map(event=>tail(event.id)))].filter(id=>!coverage.checkedTargets.includes(id));
    for(const event of selected)try {
      const id=tail(event.id),record=await this.reader.record('/events/'+id),nodes=record.payload.data.filter(node=>canonical(node.id)===canonical(event.id));
      if(nodes.length!==1||event.date&&date(nodes[0].activity_date)!==event.date||!Array.isArray(nodes[0].consists_of))throw new HttpError(502,'debate_identity','The exact debate is unavailable.');
      const ids=refs(nodes[0].consists_of).filter(value=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(value));
      if(ids.length>DOSSIER_ACTIVITY_LIMITS.children)coverage.gaps.push('Some debate children are outside this page.');
      for(const child of ids.slice(0,DOSSIER_ACTIVITY_LIMITS.children))children.set(tail(child),[...(children.get(tail(child))||[]),{...event,jointDebate:/joint debate/i.test(nodes[0].activity_label?.en||'')}]);
      const observation=source(record);coverage.sources.push(observation);
    }catch(error){if(isLocalRequestFailure(error))throw error;coverage.retryable=true;coverage.failedDebates.push(tail(event.id));coverage.gaps.push('A linked debate is unavailable.');}
    const retained=this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation)return null;
      if(!children.size)return {rows:[],missing:[]};
      const ids=[...children.keys()],slots=ids.map(()=>'?').join(',');
      const indexed=new Set(this.store.db.prepare('SELECT DISTINCT source_id FROM items WHERE generation=? AND source_id IN ('+slots+')').all(result.generation,...ids).map(row=>row.source_id));
      const sources=new Set(this.store.db.prepare("SELECT key FROM sources WHERE generation=? AND kind='speech' AND key IN ("+slots+')').all(result.generation,...ids.map(id=>'/speeches/'+id)).map(row=>row.key));
      const classifications=this.store.db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='event' AND key IN ("+slots+')').all(result.generation,...ids.map(id=>'/events/'+id)).flatMap(row=>{
        const event=JSON.parse(row.body);
        return row.key==='/events/'+event.id&&event.classificationVersion===1&&event.declaredBy&&children.get(event.id)?.some(parent=>tail(parent.id)===event.declaredBy)&&/^[A-Z][A-Z0-9_]+$/.test(event.kind)&&!['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT'].includes(event.kind)&&event.source?.url===apiUrl(row.key)+'?format=application%2Fld%2Bjson'&&Number.isFinite(Date.parse(event.source?.fetchedAt))?[event]:[];
      });
      const classified=new Set(classifications.map(event=>event.id));
      const missing=ids.filter(id=>!indexed.has(id)&&!sources.has('/speeches/'+id)&&!classified.has(id));
      const rows=this.store.db.prepare('SELECT body,source_key FROM items WHERE generation=?'+(member?' AND mep=?':'')+' AND source_id IN ('+slots+') ORDER BY date,source_id,mep LIMIT ?').all(result.generation,...(member?[member]:[]),...ids,DOSSIER_ACTIVITY_LIMITS.speechRows+1).map(row=>({...row,saved:this.store.source(result.generation,row.source_key)}));
      return {rows,missing,classifications};
    });
    if(retained===null){coverage.status='unavailable';coverage.retryable=true;coverage.gaps.push('The activity index changed. Retry speeches.');return;}
    const {rows,missing}=retained;coverage.missingSpeechIds=missing;
    for(const event of retained.classifications||[])coverage.sources.push({...event.source,language:null,stale:true});
    if(missing.length){coverage.retryable=true;coverage.gaps.push('Some linked contributions are not saved.');}
    const items=[];
    for(const row of rows.slice(0,DOSSIER_ACTIVITY_LIMITS.speechRows)) {
      const speech=JSON.parse(row.body),parents=children.get(speech.sourceId)||[];
      const speaker=String(speech.mepId);
      if(speech.recordKind!=='speech'||!personId('person/'+speaker)||member&&speaker!==member)continue;
      if(parents.length!==1){coverage.gaps.push('A contribution has conflicting debate links.');continue;}
      const actualParents=refs(row.saved?.work?.inverse_consists_of);
      if(actualParents.length&&(!actualParents.includes(canonical(parents[0].id))||actualParents.some(parent=>parent!==canonical(parents[0].id)))){coverage.gaps.push('A contribution has conflicting debate links.');continue;}
      const from={url:speech.provenance.apiUrl,fetchedAt:speech.provenance.sourceFetchedAt,language:null};
      items.push({kind:'speech',id:speech.sourceId,personId:speaker,date:date(speech.date),start:speech.start||null,stage:stage(parents[0].occured_at_stage),...pick(speech.titles,language,speech.speechKind==='PLENARY_DEBATE_WRITTEN_STATEMENT'?'Written statement':'Speech'),debateId:tail(parents[0].id),jointDebate:parents[0].jointDebate,source:from});
    }
    if(rows.length>DOSSIER_ACTIVITY_LIMITS.speechRows)coverage.gaps.push('Some saved speech records are outside this page.');
    const nextTarget=targetOffset+selected.length<debates.length?{offset:0,targetOffset:targetOffset+selected.length}:null;
    page(sorted([...new Map(items.map(item=>[item.id+'@'+item.personId,item])).values()]),nextTarget);
    coverage.checkedComplete=!coverage.gaps.length;
    coverage.status=coverage.failedDebates.length===selected.length&&selected.length?'unavailable':coverage.gaps.length||coverage.uncheckedTargets.length?'partial':'complete';
  }
  async amendments(result,work,query) {
    const {coverage,procedure}=result,{member,language,targetOffset,offset,limit}=query;
    const retained=this.store.readSnapshot(()=>{
      const ids=[];
      if(this.store.reportsForProcedure)for(const report of this.store.reportsForProcedure(result.generation,procedure.id)){
        if(ids.length>DOSSIER_ACTIVITY_LIMITS.documents)break;
        if(refs(report.work.inverse_created_a_realization_of).includes('eli/dl/proc/'+procedure.id))ids.push(tail(report.work.id));
      }
      return ids;
    });
    // A joint debate can name other dossiers' reports. Its document list never
    // establishes this procedure's amendment targets.
    const candidates=[...new Set([...retained,...array(work.consists_of).filter(event=>tail(event.had_activity_type)==='TABLING_PLENARY').flatMap(event=>refs(event.based_on_a_realization_of)).map(tail)].filter(id=>/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(id)))].sort();
    const committeeTargets=this.store.readSnapshot(()=>amendmentProcedureTargets(this.store,procedure.id,{scope:'committee',committee:query.committee,limit:1001}));
    const stageFilter=query.stage||'all';
    const allTargets=[...(stageFilter==='committee'||query.committee?[]:candidates),...(stageFilter==='plenary'?[]:committeeTargets.map(value=>value.id))];
    const targets=allTargets;
    if(committeeTargets.length>=1001)coverage.gaps.push('Some amendment targets are outside this checked scope.');
    if(targetOffset>=targets.length){coverage.status='unavailable';coverage.retryable=false;coverage.gaps.push('No checked amendment target is linked in this procedure observation.');return;}
    const target=targets[targetOffset];let record,targetWork;
    coverage.checkedTargets=[target];coverage.uncheckedTargets=targets.filter(id=>id!==target);
    result.checkedTarget=target;
    const committeeTarget=committeeTargets.find(value=>value.id===target);
    try {
      if(committeeTarget){record={url:committeeTarget.sources?.[0]?.url,fetchedAt:committeeTarget.sources?.[0]?.fetchedAt};targetWork={inverse_foresees_change_of:[]};}
      else {record=await this.reader.record('/plenary-documents/'+target);
      const nodes=record.payload.data.filter(node=>canonical(node.id)==='eli/dl/doc/'+target);
      if(nodes.length!==1||!refs(nodes[0].inverse_created_a_realization_of).includes('eli/dl/proc/'+procedure.id))throw new HttpError(502,'dossier_amendment_target','The exact amendment target is unavailable.');
      targetWork=nodes[0];}
    }catch(error){
      if(isLocalRequestFailure(error))throw error;
      coverage.status='unavailable';coverage.gaps.push('Amendment target '+target+' is unavailable.');
      result.pagination.next=targetOffset+1<targets.length?{offset:0,targetOffset:targetOffset+1}:null;
      coverage.truncated=Boolean(result.pagination.next);return;
    }
    coverage.sources.push(source(record));
    const captured=this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation)throw new HttpError(409,'dossier_generation_changed','The activity index changed. Retry amendments.');
      const generation=amendmentGeneration(this.store),data=this.readAmendments(this.store,{...(committeeTarget?{scope:'committee',list:committeeTarget.listId,procedure:procedure.id,committee:query.committee}:{document:target}),member,language,offset,limit});
      return {generation,data};
    });
    result.amendmentGeneration=captured.generation;
    const data=captured.data,items=[];
    for(const row of data.items) {
      const match=amendmentAuthorMatch(row,member),variants=match.aggregateMatched?[row]:(row.variants||[]).filter(variant=>match.variantListIds.includes(variant.listId));
      for(const variant of variants) {
        const tabling=amendmentTabling(work,variant.listId,procedure.source);
        if(!authorAtTabling(variant,member,tabling)){coverage.gaps.push('An author’s mandate could not be checked on the tabling date.');continue;}
        const stages=[...new Set(tabling.observations.map(event=>event.stage))];
        const amendment={...row,...variant,conflicted:match.aggregateMatched?row.conflicted:false,variants:match.aggregateMatched?row.variants:undefined,authorMatch:{...row.authorMatch,variantListIds:match.variantListIds}};
        const from=variant.proposerSource||variant.metadataSource||variant.sources?.[0]||source(record);
        items.push({kind:'amendment',id:row.id+'@'+(variant.listId||'aggregate'),date:tabling.date||date(variant.documentDate)||date(variant.date),dateBasis:tabling.date?'tabling':'document',stage:stages.length===1?stages[0]:null,tabling,amendment,source:source(from,from.language||null)});
      }
    }
    const declared=refs(targetWork.inverse_foresees_change_of).some(value=>value.match(/^eli\/dl\/doc\/((?:A|B|RC)-10-\d{4}-\d{4,6})-AM-\d{1,5}(?:-\d{1,5})?$/)?.[1]===target);
    result.items=sorted(items);coverage.observedCount=items.length;coverage.status=data.coverage.observationComplete?'complete':data.total>0||declared||committeeTarget?'partial':'unavailable';
    if(coverage.status==='unavailable')coverage.retryable=false;
    coverage.gaps.push(...array(data.coverage.targetGaps||data.coverage.gaps).filter(gap=>typeof gap==='string'));
    coverage.discovery=data.coverage.discovery||null;
    result.checkedTarget=committeeTarget?.listId||target;
    result.amendmentScope=committeeTarget?'committee':'plenary';
    result.pagination.next=offset+limit<data.total?{offset:offset+limit,targetOffset}:targetOffset+1<targets.length?{offset:0,targetOffset:targetOffset+1}:null;
    coverage.truncated=Boolean(result.pagination.next);
  }
  async ballots(result,work,query) {
    const {coverage}=result,{offset,member,language}=query;
    const events=array(work.consists_of).filter(event=>tail(event.had_activity_type)==='PLENARY_VOTE_RESULTS'&&/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-VOT-ITM-\d+$/.test(canonical(event.id)));
    const sittings=[...new Set(events.map(event=>tail(event.id).match(/^MTG-PL-\d{4}-\d{2}-\d{2}/)[0]))].sort();
    if(offset>=sittings.length){coverage.status='unavailable';coverage.retryable=false;coverage.gaps.push('No plenary decision event is linked in this procedure observation.');return;}
    const sitting=sittings[offset],snapshot=await this.votes.snapshot({sitting,week:null,language,snapshot:null}),allowed=new Set(events.map(event=>canonical(event.id)));
    coverage.checkedTargets=[sitting];coverage.uncheckedTargets=sittings.filter(id=>id!==sitting);
    const items=snapshot.days.flatMap(day=>projectMemberSitting(day,member,language).items).filter(vote=>{
      const parents=vote.context.resultIds.map(eventRef);
      return !vote.sourceConflicts&&!['ambiguous','unlinked'].includes(vote.resultRelationship.binding)&&parents.length===1&&allowed.has(parents[0]);
    });
    for(const vote of items.slice(0,DOSSIER_ACTIVITY_LIMITS.votes)) {
      const event=events.find(event=>canonical(event.id)===eventRef(vote.context.resultIds[0]));
      const from=vote.sources.decisions[0];
      result.items.push({kind:'vote',id:vote.id,date:vote.date,stage:stage(event?.occured_at_stage),vote,source:from?{...from,language:vote.titleLanguage}:result.procedure.source});
      coverage.sources.push(...vote.sources.decisions.map(s=>({...s,language:null})),...vote.sources.results.map(s=>({...s,language:null})));
    }
    coverage.status=snapshot.coverage.status;coverage.observedCount=items.length;
    if(snapshot.coverage.status!=='complete')coverage.gaps.push('Named-vote source coverage is incomplete.');
    if(items.length>DOSSIER_ACTIVITY_LIMITS.votes)coverage.gaps.push('Some decisions are outside this page.');
    result.pagination.next=offset+1<sittings.length?{offset:offset+1,targetOffset:0}:null;
    coverage.truncated=Boolean(result.pagination.next)||items.length>DOSSIER_ACTIVITY_LIMITS.votes;
    result.voteSnapshotId=snapshot.id;
  }
}
