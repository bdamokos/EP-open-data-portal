import {resolveAmendmentAuthors} from '../../server/amendment-authors.mjs';
import {parseProcedureReference} from '../../src/procedureReference.mjs';

export const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const identity = value => typeof value === 'object' ? value?.id : value;
export const tail = value => String(identity(value) || '').split('/').at(-1);
export const evidence = record => ({url:record.url,fetchedAt:record.fetchedAt,language:null});
const node = record => record?.payload?.data?.[0];
const people = activity => array(activity?.had_participation).flatMap(p=>array(p.had_participant_person).map(tail));
const namedRoles = procedure => array(procedure.had_participation).filter(p=>array(p.had_participant_person).length);
const names = person => [person.givenName,person.familyName].filter(Boolean).join(' ') || person.label || person.identifier;
export const roleLabel = role => ({RAPPORTEUR:'Rapporteur',RAPPORTEUR_CO:'Co-rapporteur',RAPPORTEUR_SHADOW:'Shadow rapporteur',RAPPORTEUR_OPINION:'Opinion rapporteur',RAPPORTEUR_SHADOW_OPINION:'Opinion shadow'})[role] || role;

export function recordedPosition(decision, personId) {
  const fields=['favor','against','abstention'];
  if(!/ROLLCALL|ROLL_CALL/.test(tail(decision.decision_method)))return {position:null,status:'not-named'};
  if(!fields.every(field=>Array.isArray(decision['had_voter_'+field])))return {position:null,status:'unavailable'};
  const positions=fields.filter(field=>decision['had_voter_'+field].map(identity).includes('person/'+personId));
  return {position:positions.length===1?({favor:'For',against:'Against',abstention:'Abstained'})[positions[0]]:null,status:positions.length>1?'conflicting':positions.length?'recorded':'not-recorded'};
}

/** A bounded projection of supplied public observations. It never fetches or writes sources. */
export function buildExamples({procedures,reports,results,decisions,catalogues,speechDetails=[],profiles,roster,extractions,examplePairs}) {
  const profileMap=new Map(profiles.filter(node).map(r=>[String(node(r).identifier),{...node(r),sourceUrl:r.url,fetchedAt:r.fetchedAt}]));
  const members=array(roster?.payload?.data).map(p=>({...p,...profileMap.get(String(p.identifier)),id:p.identifier}));
  const personMap=new Map(members.map(p=>[String(p.identifier),{id:String(p.identifier),name:names(p)}]));
  const allSpeechRecords=new Map();
  for(const record of catalogues.filter(r=>r.payload))for(const activity of record.payload.data)allSpeechRecords.set(activity.id,{activity,record});
  const allDecisions=new Map(decisions.filter(node).map(r=>[node(r).id,r]));
  const resultParents=new Map();
  for(const record of results.filter(node))for(const id of array(node(record).consists_of).map(identity))resultParents.set(id,[...(resultParents.get(id)||[]),record]);
  const dossiers=procedures.filter(node).map(record=>{
    const p=node(record),pid=tail(p.id),reference=parseProcedureReference(p.label).reference;
    if(!reference)throw new Error('Procedure reference unavailable: '+pid);
    const linkedReports=reports.filter(r=>array(node(r)?.inverse_created_a_realization_of).map(identity).includes(p.id));
    const linkedResults=results.filter(r=>array(p.consists_of).some(e=>e.id===node(r)?.id&&tail(e.had_activity_type)==='PLENARY_VOTE_RESULTS'));
    const debateIds=array(p.consists_of).filter(e=>tail(e.had_activity_type)==='PLENARY_DEBATE').map(e=>e.id);
    const speeches=[...allSpeechRecords.values()].filter(({activity})=>array(activity.inverse_consists_of).map(identity).some(id=>debateIds.includes(id)));
    const roles=namedRoles(p).flatMap(part=>array(part.had_participant_person).map(id=>({personId:tail(id),role:tail(part.participation_role),date:part.activity_date||null,stage:tail(part.occured_at_stage)||null,id:part.id,committee:tail(part.participation_in_name_of)||null,source:evidence(record)})));
    const ballots=linkedResults.flatMap(parent=>array(node(parent).consists_of).flatMap(id=>{
      const source=allDecisions.get(identity(id)),d=node(source);
      // A decision shared by contradictory parents is withheld.
      return d&&resultParents.get(d.id)?.length===1?[{activity:d,source:evidence(source),resultId:node(parent).id,resultSource:evidence(parent)}]:[];
    }));
    const amendments=linkedReports.flatMap(report=>{
      const w=node(report),lists=array(w.inverse_foresees_change_of).filter(l=>array(l.foresees_change_of).map(identity).includes(w.id));
      return lists.flatMap(list=>extractions.filter(x=>x.meta.listId===tail(list)&&x.meta.targetDocumentId===tail(w)).flatMap(x=>x.extraction.amendments.map(a=>{
        const tablingObservations=array(p.consists_of).filter(event=>tail(event.had_activity_type)==='TABLING_PLENARY'&&array(event.based_on_a_realization_of).map(identity).includes(identity(list))).map(event=>({id:event.id,date:event.activity_date||null,stage:tail(event.occured_at_stage)||null,source:evidence(record)}));
        const dates=[...new Set(tablingObservations.map(event=>event.date))];
        const tablingDate=dates.length===1&&dates[0]?dates[0]:null;
        const documentDate=a.documentDate||a.date||null;
        const tablingStatus=tablingDate?'recorded':dates.filter(Boolean).length>1?'conflicting':'unavailable';
        const resolved=resolveAmendmentAuthors(a.authors,{members,date:tablingDate||documentDate});
        const targets=['eli/dl/doc/'+tail(w)+'-AM-'+a.number,'eli/dl/doc/'+tail(w)+'-AM-'+String(a.number).padStart(3,'0')];
        const outcomes=ballots.filter(b=>array(b.activity.decided_on_a_realization_of).map(identity).some(id=>targets.includes(id)));
        return {...a,id:tail(w)+'-AM-'+a.number,documentDate,tablingDate,tablingStatus,tablingObservations,metadataDate:list.document_date||null,metadataSource:evidence(report),dateDiscrepancy:Boolean(tablingDate&&documentDate&&tablingDate!==documentDate),authors:resolved,source:{...evidence(x.meta),language:a.language},outcomes:outcomes.map(b=>({id:b.activity.id,outcome:tail(b.activity.decision_outcome),source:b.source})),gaps:x.extraction.gaps.filter(g=>g.number==null||g.number===a.number)};
      })));
    });
    const listCount=linkedReports.reduce((n,r)=>n+array(node(r).inverse_foresees_change_of).length,0);
    const failedCatalogues=catalogues.filter(r=>r.error);
    return {id:pid,reference,title:p.process_title?.en||reference,source:evidence(record),roles,debateIds,speeches,ballots,amendments,listCount,
      coverage:{roleRecords:roles.length,datedRoles:roles.filter(r=>r.date).length,debates:debateIds.length,speechRecords:speeches.length,lists:listCount,parsedAmendments:amendments.length,wording:amendments.filter(a=>a.originalText!==null&&a.proposedText!==null).length,ballots:ballots.length,declaredBallots:linkedResults.reduce((n,r)=>n+array(node(r).consists_of).length,0),press:null,catalogueErrors:debateIds.length?failedCatalogues.map(r=>({url:r.url,error:r.error})):[]}};
  });
  const examples=examplePairs.map(([pid,personId])=>{
    const dossier=dossiers.find(d=>d.id===pid),person=personMap.get(personId);
    if(!dossier||!person)throw new Error('Example identity unavailable');
    const events=[];
    for(const role of dossier.roles.filter(r=>r.personId===personId))events.push({id:role.id,kind:'role',date:role.date,stage:role.stage,title:roleLabel(role.role)+' recorded',detail:role.committee,source:role.source});
    for(const {activity,record} of dossier.speeches.filter(({activity})=>people(activity).includes(personId))){
      const detail=speechDetails.find(r=>node(r)?.id===activity.id&&people(node(r)).includes(personId));
      const xml=array(node(detail)?.recorded_in_a_realization_of).map(d=>d['api:xmlFragment']?.en).filter(x=>typeof x==='string').join('\n')||null;
      events.push({id:activity.id,kind:'speech',date:activity.activity_date,start:activity.activity_start_date,stage:tail(array(node(procedures.find(r=>tail(node(r)?.id)===pid)).consists_of).find(e=>dossier.debateIds.includes(e.id))?.occured_at_stage)||null,title:tail(activity.had_activity_type)==='PLENARY_DEBATE_WRITTEN_STATEMENT'?'Written statement':'Speech in joint debate',detail:'Joint debate on the defence readiness package',source:{...evidence(detail||record),language:xml?'en':null},catalogueSource:evidence(record),xml,translation:xml?.includes('-mtec')?'Machine translation':null,parents:array(activity.inverse_consists_of).map(identity)});
    }
    for(const amendment of dossier.amendments.filter(a=>a.authors.some(author=>String(author.personId)===personId&&author.status==='resolved'))){
      const stages=[...new Set(amendment.tablingObservations.map(event=>event.stage))];
      events.push({id:amendment.id+'@'+amendment.listId,kind:'amendment',date:amendment.tablingDate||amendment.documentDate,dateBasis:amendment.tablingDate?'tabling':'document',stage:stages.length===1?stages[0]:null,title:(amendment.tablingDate?'Tabled amendment ':'Amendment ')+amendment.number,detail:amendment.targetLabel==='–'?'':amendment.targetLabel,amendment,source:amendment.source});
    }
    for(const ballot of dossier.ballots){
      const d=ballot.activity,position=recordedPosition(d,personId);
      events.push({id:d.id,kind:'vote',date:d.activity_date,start:d.activity_start_date,stage:tail(array(node(procedures.find(r=>tail(node(r)?.id)===pid)).consists_of).find(e=>e.id===ballot.resultId)?.occured_at_stage)||null,title:d.referenceText?.en||'Vote',position,outcome:tail(d.decision_outcome)||null,amendmentNumber:d.decisionAboutId||null,intentions:['favor','against','abstention'].filter(k=>array(d['had_voter_intended_'+k]).map(identity).includes('person/'+personId)),source:{...ballot.source,language:'en'},resultId:ballot.resultId,resultSource:ballot.resultSource});
    }
    events.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.start||'').localeCompare(b.start||'')||a.id.localeCompare(b.id));
    return {id:pid+':'+personId,dossierId:pid,person,roles:dossier.roles.filter(r=>r.personId===personId),events};
  });
  return {dossiers:dossiers.map(({speeches,ballots,amendments,...d})=>d),examples,sourceDates:[...procedures,...reports,...results,...decisions,...catalogues,...profiles].map(r=>r.fetchedAt).filter(Boolean).sort(),scope:'Three selected dossiers; public observations, not the production index.'};
}
