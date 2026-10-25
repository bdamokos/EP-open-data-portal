import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {procedureReference} from './official-context.mjs';
import {canonical,personId} from './insights-model.mjs';
import {array,tail} from './activity-index-model.mjs';
import {classifyProcedure,refs} from './insights-legislation-model.mjs';
import {LegislationInsights,sourceCacheState} from './insights-legislation.mjs';
import {languagePreference} from './language-order.mjs';
import {amendmentsPage,amendmentAuthorMatch,amendmentGeneration} from './amendments-store.mjs';
import {resolvedAmendmentAuthorId} from './amendments.mjs';
import {memberVotes} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {requestSignal,isLocalRequestFailure} from './request-budget.mjs';

export const DOSSIER_ACTIVITY_VERSION=3;
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
  const allowed=['reference','member','section','lang','offset','target-offset','limit'];
  for(const key of search.keys())if(!allowed.includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated dossier parameter.');
  const reference=procedureReference(search.get('reference')),member=search.get('member'),section=search.get('section')||'roles';
  if(member!==null&&(!/^[1-9]\d*$/.test(member)||!Number.isSafeInteger(Number(member))))throw new HttpError(400,'invalid_member','Use an exact person identifier.');
  if(!sectionNames.includes(section)||section!=='roles'&&!member)throw new HttpError(400,'invalid_section','Choose an activity section and person.');
  const integer=(key,fallback,max)=>{const raw=search.get(key)??String(fallback),n=Number(raw);if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(n)||n>max||key==='limit'&&n<1)throw new HttpError(400,'invalid_query','Invalid dossier page.');return n;};
  return {reference,member,section,language:odpLanguage(search.get('lang')||'en'),offset:integer('offset',0,100000),targetOffset:integer('target-offset',0,1000),limit:integer('limit',25,50)};
}

export function dossierReferencesQuery(search) {
  for(const key of search.keys())if(!['procedures','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated procedure parameter.');
  const ids=(search.get('procedures')||'').split(',');
  if(!ids.length||ids.length>3||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_procedures','Choose up to three exact procedure identifiers.');
  return {ids,language:odpLanguage(search.get('lang')||'en')};
}

export function amendmentTabling(procedure,listId,procedureSource) {
  const observations=array(procedure.consists_of).filter(event=>tail(event.had_activity_type)==='TABLING_PLENARY'&&refs(event.based_on_a_realization_of).includes('eli/dl/doc/'+listId))
    .map(event=>({id:canonical(event.id),date:date(event.activity_date),stage:stage(event.occured_at_stage),source:procedureSource}));
  const dates=[...new Set(observations.map(item=>item.date))],known=dates.filter(Boolean);
  return {status:dates.length===1&&known.length===1?'recorded':known.length>1?'conflicting':'unavailable',date:dates.length===1?known[0]||null:null,observations};
}

// Recheck the retained mandate evidence when exact tabling and document dates differ.
// A name match on the document date cannot establish a mandate on a different day.
function authorAtTabling(record,member,tabling) {
  if(!amendmentAuthorMatch(record,member).aggregateMatched)return false;
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
    if(this.store.reportsForProcedure)for(const report of this.store.reportsForProcedure(generation,procedure.id)) {
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
  async query(query) {
    const {reference,language,member,section,offset,targetOffset,limit}=query,id=reference.split('(')[0].replace('/','-');
    const {work,procedure}=await this.procedure(id,language,reference);
    const local=this.store.readSnapshot(()=>{const generation=this.store.status().servingGeneration;return {generation,...this.localRoles(work,procedure,generation)};});
    const coverage={status:'partial',gaps:[...local.gaps],sources:[procedure.source],checkedScope:section,observedCount:null,truncated:false},pagination={offset,targetOffset,limit,next:null};
    const result={version:DOSSIER_ACTIVITY_VERSION,procedure,memberId:member,participants:local.participants,section,items:[],pagination,coverage,generation:local.generation};
    const page=(items,nextTarget=null)=>{result.items=items.slice(offset,offset+limit);pagination.next=offset+limit<items.length?{offset:offset+limit,targetOffset}:nextTarget;coverage.observedCount=items.length;coverage.truncated=Boolean(pagination.next);};
    if(section==='roles') {
      const roles=local.roles.filter(role=>!member||role.personId===member);page(roles);coverage.status=!Array.isArray(work.had_participation)&&!roles.length?'unavailable':local.gaps.length?'partial':'complete';
    }else if(section==='speeches')await this.speeches(result,work,query,page);
    else if(section==='amendments')await this.amendments(result,work,query);
    else await this.ballots(result,work,query);
    if(coverage.sources.some(s=>s.stale||s.refreshInProgress||s.refreshError)){coverage.status='partial';coverage.gaps.push('Some source observations are refreshing.');}
    if(coverage.status==='unavailable')coverage.observedCount=null;
    coverage.gaps=[...new Set(coverage.gaps)];
    coverage.sources=[...new Map(coverage.sources.map(s=>[JSON.stringify([s.url,s.fetchedAt,s.contentHash||null]),s])).values()];
    result.snapshotId=createHash('sha256').update(JSON.stringify([result.generation,result.section,result.items,result.coverage,result.pagination])).digest('hex');
    requestSignal()?.throwIfAborted();return result;
  }
  async speeches(result,work,query,page) {
    const {coverage}=result,{targetOffset,language,member}=query;
    const debates=sorted(array(work.consists_of).filter(event=>tail(event.had_activity_type)==='PLENARY_DEBATE'&&/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(canonical(event.id))).map(event=>({...event,date:date(event.activity_date)})));
    const selected=debates.slice(targetOffset,targetOffset+DOSSIER_ACTIVITY_LIMITS.debatesPerPage),children=new Map();
    for(const event of selected)try {
      const id=tail(event.id),record=await this.reader.record('/events/'+id),nodes=record.payload.data.filter(node=>canonical(node.id)===canonical(event.id));
      if(nodes.length!==1||event.date&&date(nodes[0].activity_date)!==event.date||!Array.isArray(nodes[0].consists_of))throw new HttpError(502,'debate_identity','The exact debate is unavailable.');
      const ids=refs(nodes[0].consists_of).filter(value=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(value));
      if(ids.length>DOSSIER_ACTIVITY_LIMITS.children)coverage.gaps.push('Some debate children are outside this page.');
      for(const child of ids.slice(0,DOSSIER_ACTIVITY_LIMITS.children))children.set(tail(child),[...(children.get(tail(child))||[]),{...event,jointDebate:/joint debate/i.test(nodes[0].activity_label?.en||'')}]);
      coverage.sources.push(source(record));
    }catch(error){if(isLocalRequestFailure(error))throw error;coverage.gaps.push('A linked debate is unavailable.');}
    const rows=this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation)return null;
      if(!children.size)return [];
      return this.store.db.prepare('SELECT body,source_key FROM items WHERE generation=? AND mep=? AND source_id IN ('+[...children].map(()=>'?').join(',')+') ORDER BY date,source_id LIMIT ?').all(result.generation,member,...children.keys(),DOSSIER_ACTIVITY_LIMITS.speechRows+1).map(row=>({...row,saved:this.store.source(result.generation,row.source_key)}));
    });
    if(rows===null){coverage.status='unavailable';coverage.gaps.push('The activity index changed. Retry speeches.');return;}
    const items=[];
    for(const row of rows.slice(0,DOSSIER_ACTIVITY_LIMITS.speechRows)) {
      const speech=JSON.parse(row.body),parents=children.get(speech.sourceId)||[];
      if(speech.recordKind!=='speech'||String(speech.mepId)!==member)continue;
      if(parents.length!==1){coverage.gaps.push('A contribution has conflicting debate links.');continue;}
      const actualParents=refs(row.saved?.work?.inverse_consists_of);
      if(actualParents.length&&(!actualParents.includes(canonical(parents[0].id))||actualParents.some(parent=>parent!==canonical(parents[0].id)))){coverage.gaps.push('A contribution has conflicting debate links.');continue;}
      const from={url:speech.provenance.apiUrl,fetchedAt:speech.provenance.sourceFetchedAt,language:null};
      items.push({kind:'speech',id:speech.sourceId,date:date(speech.date),start:speech.start||null,stage:stage(parents[0].occured_at_stage),...pick(speech.titles,language,speech.speechKind==='PLENARY_DEBATE_WRITTEN_STATEMENT'?'Written statement':'Speech'),debateId:tail(parents[0].id),jointDebate:parents[0].jointDebate,source:from});
    }
    if(rows.length>DOSSIER_ACTIVITY_LIMITS.speechRows)coverage.gaps.push('Some saved speech records are outside this page.');
    coverage.gaps.push('Showing saved contributions linked to the checked debates.');
    const nextTarget=targetOffset+selected.length<debates.length?{offset:0,targetOffset:targetOffset+selected.length}:null;
    page(sorted(unique(items)),nextTarget);
    if(selected.length&&!children.size)coverage.status='unavailable';
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
    const targets=candidates.slice(0,DOSSIER_ACTIVITY_LIMITS.documents);
    if(candidates.length>targets.length)coverage.gaps.push('Some amendment targets are outside this checked scope.');
    if(targetOffset>=targets.length){coverage.gaps.push('No checked amendment target is linked in this procedure observation.');return;}
    const target=targets[targetOffset];let record;
    result.checkedTarget=target;
    try {
      record=await this.reader.record('/plenary-documents/'+target);
      const nodes=record.payload.data.filter(node=>canonical(node.id)==='eli/dl/doc/'+target);
      if(nodes.length!==1||!refs(nodes[0].inverse_created_a_realization_of).includes('eli/dl/proc/'+procedure.id))throw new HttpError(502,'dossier_amendment_target','The exact amendment target is unavailable.');
    }catch(error){
      if(isLocalRequestFailure(error))throw error;
      coverage.status='unavailable';coverage.gaps.push('Amendment target '+target+' is unavailable.');
      result.pagination.next=targetOffset+1<targets.length?{offset:0,targetOffset:targetOffset+1}:null;
      coverage.truncated=Boolean(result.pagination.next);return;
    }
    coverage.sources.push(source(record));
    const captured=this.store.readSnapshot(()=>{
      if(this.store.status().servingGeneration!==result.generation)throw new HttpError(409,'dossier_generation_changed','The activity index changed. Retry amendments.');
      const generation=amendmentGeneration(this.store),data=this.readAmendments(this.store,{document:target,member,language,offset,limit});
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
    result.items=sorted(items);coverage.observedCount=items.length;coverage.status=data.coverage.observationComplete?'complete':'partial';
    coverage.gaps.push(...array(data.coverage.targetGaps||data.coverage.gaps).filter(gap=>typeof gap==='string'));
    coverage.discovery=data.coverage.discovery||null;
    result.checkedTarget=target;
    result.pagination.next=offset+limit<data.total?{offset:offset+limit,targetOffset}:targetOffset+1<targets.length?{offset:0,targetOffset:targetOffset+1}:null;
    coverage.truncated=Boolean(result.pagination.next);
  }
  async ballots(result,work,query) {
    const {coverage}=result,{offset,member,language}=query;
    const events=array(work.consists_of).filter(event=>tail(event.had_activity_type)==='PLENARY_VOTE_RESULTS'&&/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-VOT-ITM-\d+$/.test(canonical(event.id)));
    const sittings=[...new Set(events.map(event=>tail(event.id).match(/^MTG-PL-\d{4}-\d{2}-\d{2}/)[0]))].sort();
    if(offset>=sittings.length){coverage.gaps.push('No plenary decision event is linked in this procedure observation.');return;}
    const sitting=sittings[offset],snapshot=await this.votes.snapshot({sitting,week:null,language,snapshot:null}),allowed=new Set(events.map(event=>canonical(event.id)));
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
