import { HttpError } from './http-utils.mjs';
import { odp } from './odp.mjs';
import { array,tail } from './activity-index-model.mjs';
import { canonical,demographicStats,memberPeople } from './insights-model.mjs';
import { savedMetadata,brusselsDay } from './insights-store.mjs';
import { agendaTopics,classifyProcedure,topicRoles,topicVotes,finalVotePatterns,refs,committeeEvent } from './insights-legislation-model.mjs';
import {speakerNameIsSpecific} from './speech-speakers.mjs';
import {CURRENT_TERM_START} from './analysis-period.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {retainedSpeechMetadata} from './corpus-speeches.mjs';

export const LEGISLATION_LIMITS=Object.freeze({agendaPages:2,agendaTopics:100,decisions:250,rawBytes:8*1024*1024,cacheEntries:24,cacheMs:6*60*60_000,selectedDocuments:30,roleRows:3000,detailDocuments:2,debateEvents:2,contributions:200});
export const LEGISLATION_VIEW_VERSION='plenary-weeks-v3';
// This primary-source locator is revalidated; it is not an inferred counterpart.
const verifiedSpeechAnchors={
  'MTG-PL-2026-10-07-OJ-ITM-D-69':{speechId:'MTG-PL-2026-10-07-OTH-2017097993206',observedAt:'2026-10-14T09:24:49.429Z'}
};
function sourceNode(record,kind,id) {
  const node=record.payload.data.find(n=>canonical(n.id)===`eli/dl/${kind}/${id}`);
  if(!node)throw new HttpError(502,'insights_source_identity','Parliament did not return the requested source identity.');
  return node;
}
function reusableRecord(endpoint,work) {
  if(endpoint.startsWith('/procedures/'))return Boolean(classifyProcedure(work).code)&&typeof work.label==='string'&&Array.isArray(work.consists_of)&&work.consists_of.every(event=>typeof event?.activity_id==='string');
  return Array.isArray(work.inverse_based_on_a_realization_of);
}
export class LegislationInsights {
  constructor(store,{request=odp,clock=Date.now,loadMetadata=savedMetadata,readSpeechMetadata=request===odp?retainedSpeechMetadata:null}={}) {this.store=store;this.request=request;this.clock=clock;this.loadMetadata=loadMetadata;this.readSpeechMetadata=readSpeechMetadata;this.cache=new Map();this.pending=new Map();this.failures=new Map();}
  async record(endpoint,params={}) {
    requestSignal()?.throwIfAborted();
    if(!Object.keys(params).length) {
      if(/^\/(procedures|plenary-documents|committee-documents|parliamentary-questions)\/[A-Z0-9-]+$/.test(endpoint)) {
        const saved=this.store.source(this.store.status().servingGeneration,endpoint);
        const id=endpoint.split('/').at(-1);
        if(saved?.work&&reusableRecord(endpoint,saved.work)&&Number.isFinite(Date.parse(saved.fetchedAt))&&(saved.work.identifier===id||tail(saved.work.id)===id))return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse(saved.fetchedAt),payload:{data:[saved.work]}};
      }
      if(endpoint.startsWith('/speeches/')&&this.readSpeechMetadata) {
        const saved=await this.readSpeechMetadata(endpoint.slice('/speeches/'.length));
        requestSignal()?.throwIfAborted();
        if(saved)return {url:saved.sourceUrl,fetchedAt:Date.parse(saved.fetchedAt),payload:{data:[saved.activity]}};
      }
    }
    const key=JSON.stringify([endpoint,params]);const old=this.cache.get(key);
    if(old&&this.clock()-old.at<LEGISLATION_LIMITS.cacheMs)return old.value;
    const failed=this.failures.get(key);if(failed&&this.clock()-failed.at<60_000)throw failed.error;
    if(this.pending.has(key))return waitForRequest(this.pending.get(key));
    const job=sharedRequest(async()=>{const value=await this.request(endpoint,params,{priority:'interactive',staleWhileRevalidate:true});requestSignal()?.throwIfAborted();if(!Array.isArray(value.payload?.data))throw new HttpError(502,'insights_source_shape','Parliament returned an unreadable insight source.');
      if(Buffer.byteLength(JSON.stringify(value.payload))>LEGISLATION_LIMITS.rawBytes)throw new HttpError(502,'insights_source_size','Parliament source exceeds the bounded insight response size.');
      this.cache.set(key,{at:this.clock(),value});this.failures.delete(key);while(this.cache.size>LEGISLATION_LIMITS.cacheEntries)this.cache.delete(this.cache.keys().next().value);return value;
    }).catch(error=>{if(!isLocalRequestFailure(error))this.failures.set(key,{at:this.clock(),error});while(this.failures.size>24)this.failures.delete(this.failures.keys().next().value);throw error;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,job);return waitForRequest(job);
  }
  async catalogue() {
    const today=brusselsDay(this.clock()),year=Number(today.slice(0,4)),years=Array.from({length:year-Number(CURRENT_TERM_START.slice(0,4))+1},(_,i)=>Number(CURRENT_TERM_START.slice(0,4))+i),nodes=new Map(),sources=[];
    for(let offset=0;;offset+=50) {
      let r;
      try{r=await this.record('/meetings',{year:years.join(','),limit:50,offset});}
      catch(error){if(offset>0&&error.code==='odp_no_content')break;throw error;}
      const before=nodes.size;
      for(const node of r.payload.data)nodes.set(node.activity_id,node);
      sources.push({apiUrl:r.url,fetchedAt:new Date(r.fetchedAt).toISOString()});
      if(r.payload.data.length<50)break;
      if(nodes.size===before)throw new HttpError(502,'insights_catalogue_paging','Parliament repeated a meetings page; the full sitting history could not be read.');
    }
    const all=[...nodes.values()].filter(n=>tail(n.had_activity_type)==='PLENARY_SITTING'&&n.activity_date>=CURRENT_TERM_START);
    const upcoming=all.filter(n=>n.activity_date>today).sort((a,b)=>a.activity_date.localeCompare(b.activity_date));
    const past=all.filter(n=>n.activity_date<=today).sort((a,b)=>b.activity_date.localeCompare(a.activity_date));
    const sittings=[...past,...upcoming];
    return {sittings,sources,complete:true,year,years,start:CURRENT_TERM_START};
  }
  async query(query,savedCatalogue=null) {
    const status=this.store.status();if(!status.currentMeps||!status.servingGeneration)throw new HttpError(503,'insights_loading','The saved MEP index is not available yet.');
    const catalogue=savedCatalogue||await this.catalogue();
    if(query.week) {
      const today=brusselsDay(this.clock()),held=catalogue.sittings.filter(s=>s.activity_date<=today).sort((a,b)=>b.activity_date.localeCompare(a.activity_date)),anchor=held[0]||[...catalogue.sittings].sort((a,b)=>a.activity_date.localeCompare(b.activity_date))[0];
      const monday=anchor&&new Date(anchor.activity_date+'T12:00:00Z');
      if(monday)monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
      const week=query.week==='latest'?monday?.toISOString().slice(0,10):query.week;
      const end=week&&new Date(Date.parse(week+'T12:00:00Z')+6*86400_000).toISOString().slice(0,10);
      const sittings=catalogue.sittings.filter(s=>s.activity_date>=week&&s.activity_date<=end).sort((a,b)=>a.activity_date.localeCompare(b.activity_date));
      if(!sittings.length||sittings.length>5)throw new HttpError(404,'sitting_not_found','Choose a listed plenary week.');
      const days=[];
      // Only this week's published sittings, using the same bounded daily source reads.
      for(const sitting of sittings)days.push(await this.query({language:query.language,sitting:sitting.activity_id},catalogue));
      const base=days[0];
      return {...base,week,topics:days.flatMap(day=>day.topics.map(topic=>({...topic,sittingId:day.sitting.id}))),agendaSittings:days.map(day=>({...day.sitting,agendaComplete:day.coverage.agendaComplete,agendaError:day.coverage.agendaError})),coverage:{...base.coverage,agendaComplete:days.every(day=>day.coverage.agendaComplete),agendaError:days.filter(day=>day.coverage.agendaError).map(day=>day.sitting.date+': '+day.coverage.agendaError).join('; ')||null,sources:[...new Map(days.flatMap(day=>day.coverage.sources).map(source=>[source.apiUrl,source])).values()]}};
    }
    const sitting=catalogue.sittings.find(s=>s.activity_id===(query.sitting||catalogue.sittings[0]?.activity_id));
    if(!sitting)throw new HttpError(404,'sitting_not_found','Choose a listed sitting from the current parliamentary term.');
    const today=brusselsDay(this.clock()),phase=sitting.activity_date>today?'upcoming':sitting.activity_date===today?'today':'past';
    if(phase==='upcoming'&&query.vote)throw new HttpError(400,'vote_not_held','This plenary vote has not taken place.');
    const meeting={payload:{data:[sitting]}};const agendaNodes=[],agendaSources=[];let agendaComplete=false,agendaError=null;
    for(let page=0;page<LEGISLATION_LIMITS.agendaPages;page++) {
      try {const r=await this.record('/meetings/'+sitting.activity_id+'/foreseen-activities',{limit:50,offset:page*50});agendaNodes.push(...r.payload.data);agendaSources.push({apiUrl:r.url,fetchedAt:new Date(r.fetchedAt).toISOString()});if(r.payload.data.length<50){agendaComplete=true;break;}}
      catch(error){agendaError=error.message;break;}
    }
    const foreseen={url:agendaSources[0]?.apiUrl||'https://data.europarl.europa.eu/api/v2/meetings/'+sitting.activity_id+'/foreseen-activities',fetchedAt:agendaSources[0]?.fetchedAt||null,payload:{data:agendaNodes}};
    const topics=agendaTopics(meeting,foreseen).slice(0,LEGISLATION_LIMITS.agendaTopics);
    const localize=n=>({...n,title:n.titles[query.language]||n.titles.en||Object.values(n.titles)[0]||n.id,titleLanguage:n.titles[query.language]?query.language:n.titles.en?'en':Object.keys(n.titles)[0]||null});
    let detail=null;
    if(query.topic) {
      const topic=topics.find(t=>t.id===query.topic);if(!topic)throw new HttpError(404,'topic_not_found','That agenda topic is not in the selected sitting.');
      const members=new Map(this.store.db.prepare('SELECT id,body FROM members ORDER BY id').all().map(r=>[r.id,JSON.parse(r.body)]));
      const metadata=await this.loadMetadata({members});
      const docs=topic.documentIds.slice(0,LEGISLATION_LIMITS.selectedDocuments);
      const documents=docs.length?this.store.db.prepare(`SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind='document' AND json_extract(body,'$.identifier') IN (${docs.map(()=>'?').join(',')}) LIMIT ?`).all(status.servingGeneration,...docs,LEGISLATION_LIMITS.selectedDocuments).map(r=>({key:r.key,work:JSON.parse(r.body),fetchedAt:r.fetched_at})):[];
      const rows=docs.length?this.store.db.prepare(`SELECT body FROM items WHERE generation=? AND source_id IN (${docs.map(()=>'?').join(',')}) LIMIT ?`).all(status.servingGeneration,...docs,LEGISLATION_LIMITS.roleRows).map(r=>JSON.parse(r.body)):[];
      const roles=topicRoles(topic,rows,documents,members,metadata);
      for(const id of topic.agendaCreatorIds||[])if(!roles.some(r=>r.id===id))roles.push({...memberPeople([id],members,metadata)[0],role:'AGENDA_CONTRIBUTOR',sourceId:topic.id,date:topic.date,dateBasis:'agenda date',apiUrl:topic.evidence.apiUrl,fetchedAt:topic.evidence.fetchedAt,relationships:['agenda.structuredContent.creators label typeof=person → exact person resource'],participationId:null,stage:null,procedureId:null});
      const missingDocuments=topic.documentIds.filter(id=>!documents.some(d=>d.work.identifier===id));
      const procedures=[];const gaps=[];const committeeWork=[];
      const debateCandidates=new Map(),speechSources=[];
      // At most two selected, explicitly supplied procedure IDs, never inferred from titles.
      for(const id of topic.procedureIds.slice(0,2)) {
        try {const record=await this.record('/procedures/'+id);const work=sourceNode(record,'proc',id);const classification=classifyProcedure(work);const reference=work.label===`${id.replace('-', '/')}(${classification.code})`?work.label:null;
          procedures.push({id,...classification,reference,websiteUrl:reference?'https://oeil.europarl.europa.eu/oeil/'+(query.language==='fr'?'fr':'en')+'/procedure-file?reference='+encodeURIComponent(reference):null,apiUrl:record.url,fetchedAt:new Date(record.fetchedAt).toISOString()});
          for(const event of array(work.consists_of))if(tail(event?.had_activity_type).startsWith('COMMITTEE_')&&event.activity_date&&event.activity_date<=today)committeeWork.push(committeeEvent(event,id,record,query.language));
          for(const event of array(work.consists_of))if(tail(event?.had_activity_type)==='PLENARY_DEBATE'&&event.activity_date<=today&&event.activity_date<=sitting.activity_date&&/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(event.activity_id||''))debateCandidates.set(event.activity_id,{procedureId:id,apiUrl:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),relationship:'agenda.inverse_was_scheduled_in → procedure.consists_of → actual debate'});}
        catch(error){procedures.push({id,code:null,classification:'unresolved',label:'Procedure unavailable',apiUrl:'https://data.europarl.europa.eu/api/v2/procedures/'+id,fetchedAt:null});gaps.push({source:'procedure',message:error.message});}
      }

      for(const source of documents.slice(0,LEGISLATION_LIMITS.detailDocuments)) {
        try {
          const record=await this.record(source.key);const work=sourceNode(record,'doc',source.work.identifier);
          for(const uri of refs(work?.inverse_based_on_a_realization_of).filter(uri=>/^eli\/dl\/event\/MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(uri)))debateCandidates.set(tail(uri),{documentId:work.identifier,apiUrl:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),relationship:'agenda.based_on_a_realization_of → document.inverse_based_on_a_realization_of → actual debate'});
        }catch(error){gaps.push({source:'document debate association',message:error.message});}
      }
      const anchor=verifiedSpeechAnchors[topic.id];
      if(anchor&&phase!=='upcoming')try {
        const record=await this.record('/speeches/'+anchor.speechId);const speech=sourceNode(record,'event',anchor.speechId);
        for(const uri of refs(speech?.inverse_consists_of).filter(uri=>refs(sitting.consists_of).includes(uri)))debateCandidates.set(tail(uri),{speechId:anchor.speechId,anchorObservedAt:anchor.observedAt,apiUrl:record.url,fetchedAt:new Date(record.fetchedAt).toISOString(),relationship:'verified speech.inverse_consists_of → actual debate.executed → agenda item'});
      }catch(error){gaps.push({source:'speech association',message:error.message});}
      const contributionIds=new Set();let contributionsTruncated=false;
      for(const [eventId,evidence] of [...debateCandidates].filter(([id])=>id.slice(7,17)<=today&&id.slice(7,17)<=sitting.activity_date).sort(([a],[b])=>b.slice(7,17).localeCompare(a.slice(7,17))).slice(0,LEGISLATION_LIMITS.debateEvents))try {
        const record=await this.record('/events/'+eventId);const event=sourceNode(record,'event',eventId);
        if(tail(event?.had_activity_type)!=='PLENARY_DEBATE'||!event.activity_date||event.activity_date>today||event.activity_date>sitting.activity_date)continue;
        if(evidence.speechId && !refs(event.executed).includes(topic.uri))continue;
        if(evidence.documentId && !topic.documentIds.includes(evidence.documentId))continue;
        const children=refs(event.consists_of);for(const uri of children)contributionIds.add(tail(uri));
        speechSources.push({...evidence,eventId,eventDate:event.activity_date,eventApiUrl:record.url,eventFetchedAt:new Date(record.fetchedAt).toISOString(),executedAgendaIds:refs(event.executed).map(tail),contributionIds:children.map(tail)});
      }catch(error){gaps.push({source:'actual debate event',message:error.message});}
      if(contributionIds.size>LEGISLATION_LIMITS.contributions)contributionsTruncated=true;
      const selectedContributions=[...contributionIds].slice(0,LEGISLATION_LIMITS.contributions);
      const speechRows=selectedContributions.length?this.store.db.prepare(`SELECT body FROM items WHERE generation=? AND category='plenary-contributions' AND source_id IN (${selectedContributions.map(()=>'?').join(',')}) LIMIT 1000`).all(status.servingGeneration,...selectedContributions).map(r=>JSON.parse(r.body)):[];
      const speeches=[...new Map(speechRows.map(r=>[r.sourceId,r])).values()].map(row=>({sourceId:row.sourceId,date:row.date,title:row.titles?.[query.language]||row.titles?.en||row.reference,kind:row.speechKind,start:row.start,end:row.end,people:memberPeople(speechRows.filter(r=>r.sourceId===row.sourceId).map(r=>r.mepId),members,metadata),provenance:row.provenance}));
      const participantIds=[...roles.map(r=>r.id),...speechRows.map(r=>String(r.mepId))];
      const people=memberPeople(participantIds,members,metadata).map(person=>({...person,
        demographics:person.currentMep?Object.fromEntries(Object.entries(demographicStats([person.id],members,metadata,sitting.activity_date).dimensions).map(([key,rows])=>[key,rows[0].label])):null}));
      // Resolve only guests actually linked to selected contributions, never the roster or voters.
      const guests=new Set(speeches.flatMap(speech=>speech.people.filter(person=>!person.currentMep&&!speakerNameIsSpecific(person.name)).map(person=>person.id)));
      for(const id of [...guests].slice(0,4))try {
        const record=await this.record('/meps/'+id);
        const person=record.payload.data.find(node=>String(node.identifier)===id&&canonical(node.id)==='person/'+id);
        const name=person&&([person.givenName,person.familyName].filter(Boolean).join(' ')||person.label);
        if(!speakerNameIsSpecific(name))continue;
        for(const target of [...people,...roles,...speeches.flatMap(speech=>speech.people)].filter(person=>person.id===id))Object.assign(target,{name,profileUrl:'https://www.europarl.europa.eu/meps/en/'+id,nameSource:{apiUrl:record.url,fetchedAt:new Date(record.fetchedAt).toISOString()}});
      }catch{/* An unresolved guest retains its exact source identity, without an invented name. */}
      let votes=[];let voteCoverage={available:false,sourceDecisionCount:null,truncated:false,sourceUrl:null,fetchedAt:null,error:null};
      if(topic.kind==='PLENARY_VOTE'&&phase!=='upcoming') {
        try {
          const results=await this.record('/meetings/'+sitting.activity_id+'/vote-results',{limit:50,offset:0});
          // Observed decisions endpoint returns the whole sitting regardless of limit.
          // No false paging, no filter-output=voters (that removes named voters).
          const decisions=await this.record('/meetings/'+sitting.activity_id+'/decisions',{'vote-method':'ROLL_CALL_EV',limit:1,offset:0});
          const truncated=decisions.payload.data.length>LEGISLATION_LIMITS.decisions;
          votes=topicVotes(topic,results,{...decisions,payload:{...decisions.payload,data:decisions.payload.data.slice(0,LEGISLATION_LIMITS.decisions)}},members,metadata,sitting.activity_date);
          voteCoverage={available:true,sourceDecisionCount:decisions.payload.data.length,truncated,sourceUrl:decisions.url,fetchedAt:new Date(decisions.fetchedAt).toISOString(),error:null};
        } catch(error){voteCoverage.error=error.message;gaps.push({source:'named roll-calls',message:error.message});}
      }
      const selectedVote=query.vote?votes.find(v=>v.id===query.vote):votes[0]||null;
      if(query.vote&&!selectedVote)throw new HttpError(404,'vote_not_found','That roll-call is not joined to this agenda topic.');
      detail={...localize(topic),phase,procedures,committeeWork:[...new Map(committeeWork.map(e=>[e.id,e])).values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12),roles,speeches,people,stats:demographicStats(participantIds,members,metadata,sitting.activity_date),
        votes:votes.map(v=>({id:v.id,date:v.date,title:v.titles[query.language]||v.titles.en||v.id,subject:v.subjects[query.language]||v.subjects.en||null,scope:v.scope,outcome:v.outcome,namedVotersAvailable:v.namedVotersAvailable,aggregateTotals:v.aggregateTotals,uniqueNamedVoters:v.uniqueNamedVoters})),
        selectedVote,finalVotePatterns:finalVotePatterns(votes,members,metadata),voteCoverage,
        coverage:{missingDocumentIds:missingDocuments,roleRowsTruncated:rows.length>=LEGISLATION_LIMITS.roleRows,speechAssociations:{status:speechSources.length?'exact-bounded-joins':phase==='upcoming'?'not-yet-held':'source-unavailable',context:phase==='upcoming'?'previous-debates':'debates',count:speechSources.length?speeches.length:null,exactChildReferences:contributionIds.size,childrenWithoutSavedContributionRows:selectedContributions.filter(id=>!speeches.some(s=>s.sourceId===id)).length,truncated:contributionsTruncated||debateCandidates.size>LEGISLATION_LIMITS.debateEvents,sources:speechSources,reason:speechSources.length?'Speakers are joined only from exact actual-debate child IDs to saved contribution rows. Document-backed debates can precede the selected sitting. Unmatched child refs include chair/non-contribution activities and unresolved records; they are not a count of missing speeches. This bounded selection is not a full corpus.':'No exact debate association was resolved within the selected source bounds. Whole-day activities/procedure-event listing timed out in verification. No title matching or inferred counterpart IDs are used.'},gaps}};
    }
    return {version:1,view:'legislation',requestedLanguage:query.language,sitting:{id:sitting.activity_id,phase,date:sitting.activity_date,title:sitting.activity_label?.[query.language]||sitting.activity_label?.en||sitting.activity_id,agendaDocumentIds:array(sitting.documented_by_a_realization_of).map(tail)},
      sittings:catalogue.sittings.map(s=>({id:s.activity_id,phase:s.activity_date>today?'upcoming':s.activity_date===today?'today':'past',date:s.activity_date,title:s.activity_label?.[query.language]||s.activity_label?.en||s.activity_id})),topics:topics.map(localize),detail,
      coverage:{indexComplete:status.complete,servingGeneration:status.servingGeneration,rosterFetchedAt:status.rosterFetchedAt,lastSuccessfulRefresh:status.lastSuccessfulRefresh,pendingSpeechRecoveries:status.pendingSpeechRecoveries?.count||0,catalogueYear:catalogue.year,catalogueYears:catalogue.years,catalogueStart:catalogue.start,catalogueComplete:catalogue.complete,agendaComplete,agendaError,scope:'Current-term catalogue-listed plenary sittings, with exact agenda/document/procedure joins. This is activity in a selected sitting, not an assertion that each procedure remains open or legislative.',sources:[...catalogue.sources,...agendaSources]},
      attribution:'European Parliament Open Data API v2, CC BY 4.0',limits:LEGISLATION_LIMITS};
  }
}
