import {procedureSteps} from './procedure-steps.mjs';

const hasTally=vote=>Boolean(vote?.totals)&&['for','against','abstaining'].every(key=>Number.isSafeInteger(vote.totals[key]));
const code=value=>String(value||'').replace(/^.*\//,'');
const latestDate=(events,type)=>events.filter(event=>code(event.had_activity_type)===type&&event.activity_date).map(event=>event.activity_date).sort().at(-1)||null;

// Outside ordinary legislation only the exact subject's main vote settles a file.
export function resolutionStage(vote) {
  return vote?.outcome==='ADOPTED'?'resolution-adopted':'unknown';
}

/** Merge the Council, signature and Journal events the client reads later.
 * Ordinary legislative files recompute; other families keep the server's stage.
 */
export function mergeDossierStatus(status,{cellarEvents=[],summaries=[],asOf}) {
  const merged=procedureSteps({reference:status.reference,indexEvents:status.indexEvents||[],cellarEvents,summaries,asOf});
  return {...merged,stage:merged.family==='COD'?merged.stage:status.stage||'unknown'};
}

/** A fixed template and its held values for the current stage. Nothing is
 * inferred from wording. A tally shows only when its vote has the sentence's date.
 */
export function dossierStatusLines({stage,steps=[],councilApproval=null,latest=null,indexEvents=[],slots={},cellarEvents=[]}) {
  const stepDate=key=>steps.find(step=>step.key===key)?.date||null;
  const committees=slots.committees||[],named=committees.length>0,vote=slots.mainVote||null;
  const voted=date=>{
    if(!vote||vote.date!==date)return {tally:null,rejected:false};
    return {tally:hasTally(vote)?vote.totals:null,rejected:vote.outcome==='REJECTED'};
  };
  const parliament=(id,date,next)=>{
    const {tally,rejected}=voted(date);
    if(rejected)return {sentence:{id:tally?'dossierstatus.rejected':'dossierstatus.rejected_no_tally',values:{date,tally}},next:null};
    return {sentence:{id:tally?'dossierstatus.'+id:'dossierstatus.'+id+'_no_tally',values:{date,tally}},next:next?{id:next}:null};
  };
  if(vote?.outcome==='REJECTED'&&stage==='unknown'&&vote.date){const {tally}=voted(vote.date);return {sentence:{id:tally?'dossierstatus.rejected':'dossierstatus.rejected_no_tally',values:{date:vote.date,tally}},next:null};}
  switch(stage) {
    case 'proposal':return {sentence:{id:'dossierstatus.proposal',values:{date:stepDate('proposal')}},next:{id:'dossierstatus.next_committee_takes_up'}};
    case 'referred':{
      const date=latestDate(indexEvents,'REFERRAL');
      return {sentence:{id:named?'dossierstatus.referred':'dossierstatus.referred_no_committee',values:{committees,date}},next:{id:'dossierstatus.next_committee_vote'}};
    }
    case 'drafting':{
      const amendments=latestDate(indexEvents,'COMMITTEE_TABLING_AMENDMENT'),date=amendments||latestDate(indexEvents,'COMMITTEE_TABLING_REPORT');
      const id=amendments?'dossierstatus.drafting_amendments':'dossierstatus.drafting_report';
      return {sentence:{id:named?id:id+'_no_committee',values:{committees,date}},next:{id:'dossierstatus.next_committee_vote'}};
    }
    case 'reported':return {sentence:{id:named?'dossierstatus.reported':'dossierstatus.reported_no_committee',values:{committees,date:stepDate('committee')}},next:slots.plenaryDate?{id:'dossierstatus.next_plenary_vote_on',values:{date:slots.plenaryDate}}:{id:'dossierstatus.next_plenary_vote'}};
    case 'position-talks':return parliament('position_talks',stepDate('parliament'),'dossierstatus.next_talks');
    // After a deal, this vote closes the deal. Both institutions' positions with
    // no referral and no deal leave no recorded next step.
    case 'position':return stepDate('final')?parliament('final_vote',stepDate('final'),'dossierstatus.next_signature'):parliament('position',stepDate('parliament'),steps.some(step=>step.state==='current')?'dossierstatus.next_council_reading':null);
    case 'deal':return {sentence:{id:'dossierstatus.deal',values:{date:stepDate('deal')}},next:{id:'dossierstatus.next_plenary_vote'}};
    case 'council-approved':return {sentence:{id:'dossierstatus.council_approved',values:{date:councilApproval?.date??null}},next:{id:'dossierstatus.next_signature'}};
    case 'signed':return {sentence:{id:'dossierstatus.signed',values:{date:stepDate('signed')}},next:{id:'dossierstatus.next_journal'}};
    case 'journal':return {sentence:{id:'dossierstatus.journal',values:{date:stepDate('journal')}},next:null};
    case 'resolution-adopted':{
      const {tally}=voted(vote?.date);
      return {sentence:{id:tally?'dossierstatus.resolution_adopted':'dossierstatus.resolution_adopted_no_tally',values:{date:vote?.date,tally}},next:null};
    }
    default:{
      // The index has no labels. A labelled Cellar event supplies the source's wording.
      const labelled=latest?.label&&latest?.date?latest:cellarEvents.filter(event=>event.status==='recorded'&&event.label&&event.date).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
      return labelled?{sentence:{id:'dossierstatus.latest',values:{label:labelled.label,labelLanguage:labelled.labelLanguage||null,date:labelled.date}},next:null}:{sentence:null,next:null};
    }
  }
}
