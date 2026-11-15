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
  // A rejected main vote ends the stages before Parliament's position, unless a later report reopens the file.
  const beforePosition=['unknown','proposal','referred','drafting','reported'].includes(stage);
  if(vote?.outcome==='REJECTED'&&vote.date&&beforePosition&&!(stepDate('committee')>vote.date)){const {tally}=voted(vote.date);return {sentence:{id:tally?'dossierstatus.rejected':'dossierstatus.rejected_no_tally',values:{date:vote.date,tally}},next:null};}
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

/** The Publications Office's forecast of Parliament's vote, when it is still ahead. */
export function projectedPlenaryVote(cellarEvents=[],asOf) {
  return cellarEvents.filter(event=>event.status==='projected'&&event.date&&event.date>=asOf&&(event.types||[]).some(type=>code(type.code||type.id)==='VOTE_byEP')).map(event=>event.date).sort()[0]||null;
}
/** Which plain line the voting list takes on the dossier page. With nothing to say there is none. */
export function votingListAnswerId(counts) {
  if(!counts)return null;
  const stem='dossierstatus.answer.vote.',duplicates=counts.identical>0;
  if(counts.blockAmendments>0)return stem+(counts.individual>0?(duplicates?'block_then_duplicates':'block_then'):'block_only');
  return counts.individual>0?stem+(duplicates?'individual_duplicates':'individual_only'):null;
}
/** The dossier page's labelled lines: Now, Next and Earlier. Next names the
 * plenary day when the agenda or the Publications Office holds it. Earlier
 * states a held tally the Now line does not already carry.
 */
export function dossierAnswerLines(input) {
  const {sentence,next}=dossierStatusLines(input),{stage,steps=[],slots={},cellarEvents=[],asOf}=input;
  const stepDate=key=>steps.find(step=>step.key===key)?.date||null,vote=slots.mainVote||null;
  let nextLine=null;
  if(next){
    const plenary=next.id==='dossierstatus.next_plenary_vote'||next.id==='dossierstatus.next_plenary_vote_on';
    if(plenary){
      const date=slots.plenaryDate||projectedPlenaryVote(cellarEvents,asOf),deal=stage==='deal';
      nextLine={id:'dossierstatus.answer.next_'+(deal?'deal_vote':'plenary_vote')+(date?'_on':''),values:date?{date}:undefined};
    }else nextLine={id:next.id.replace('dossierstatus.next_','dossierstatus.answer.next_')};
  }
  let earlier=null;
  const tally=vote?.date&&hasTally(vote)&&vote.outcome!=='REJECTED'?vote.totals:null;
  if(tally&&stage==='deal'&&vote.date===stepDate('parliament'))earlier={id:'dossierstatus.answer.earlier_position',values:{date:vote.date,tally}};
  else if(tally&&['council-approved','signed','journal'].includes(stage)&&vote.date===stepDate('final'))earlier={id:'dossierstatus.final_vote',values:{date:vote.date,tally}};
  return {now:sentence,next:nextLine,earlier};
}
