const keys=['proposal','committee','parliament','council','talks','deal','final','signed','journal'];
const mapping={
  ADP_PROPLEG_byCOM:'proposal', COMMITTEE_ADOPTING_REPORT:'committee', ADP_REP_byEP_CMT:'committee',
  PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS:'parliament', PLENARY_AMEND:'parliament', PLENARY_ADOPT_POSITION:'parliament',
  REF_toCMT_NGTINST_byEP_PLEN:'parliament', AMEND_R1_byEP:'parliament', ADP_R1_POS_byEP:'parliament',
  ADP_APPRGEN_byCONSIL:'council', ADP_MAND_NGT_INST_COREPER_byCONSIL:'council', PART_APPRGEN_byCONSIL:'council', ADP_PARNEGM_byCOREPER:'council', APR_R1_byCONSIL:'council',
  ENDORSE_AGRPROV_COREPER_byCONSIL:'deal', APR_AGRPROV_CONSIL_byEP_CMT:'deal',
  SIGN_byEP_CONSIL:'signed', SIGNATURE:'signed', PUB_OJ:'journal', PUBLICATION_OFFICIAL_JOURNAL:'journal',
};
const partialCodes=new Set(['PART_APPRGEN_byCONSIL','ADP_PARNEGM_byCOREPER']);
const referrals=new Set(['PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS','REF_toCMT_NGTINST_byEP_PLEN']);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)&&Number.isFinite(Date.parse(value))?value.slice(0,10):null;
// Accept the source's code or its exact namespace form; never match a label.
const indexCode=value=>typeof value==='string'?value.replace(/^(?:https:\/\/data\.europarl\.europa\.eu\/)?def\/ep-activities\//,''):'';

/** Pure projection of held events. `latest` retains the original source object.
 * Missing dates remain null. Undated events cannot establish temporal milestones.
 * `asOf` is explicit so replay never depends on the machine's clock.
 */
export function procedureSteps({reference,indexEvents=[],cellarEvents=[],summaries=[],asOf}) {
  const family=String(reference||'').match(/\(([A-Z]+)\)$/)?.[1]||null;
  const cutoff=day(asOf);
  const events=[
    ...indexEvents.map(event=>({event,date:day(event.activity_date),codes:[indexCode(event.had_activity_type)]})),
    ...cellarEvents.filter(event=>event.status!=='cancelled').map(event=>({event,date:day(event.date),codes:(event.types||[]).map(type=>type.code)})),
    ...summaries.map(event=>({event,date:day(event.date),codes:event.stage==='proposal'?['ADP_PROPLEG_byCOM']:[]})),
  ].filter(row=>row.date&&(!cutoff||row.date<=cutoff)).sort((a,b)=>a.date.localeCompare(b.date));
  const latest=events.at(-1)?.event??null;
  if(family!=='COD')return {family,steps:[],stage:'unknown',latest};
  const done=new Map();
  for(const row of events)for(const code of row.codes){
    const key=Object.hasOwn(mapping,code)?mapping[code]:null;if(!key)continue;
    done.set(key,{date:row.date,partial:partialCodes.has(code)});
    if(code==='ADP_R1_POS_byEP'&&done.has('deal')&&row.date>=done.get('deal').date)done.set('final',{date:row.date,partial:false});
  }
  // OEIL dates the proposal document, whereas Cellar may date its registration.
  const proposal=events.find(row=>row.event.stage==='proposal'&&row.event.documentReference);
  if(proposal)done.set('proposal',{date:proposal.date,partial:false});
  const lastDone=Math.max(-1,...[...done.keys()].map(key=>keys.indexOf(key)));
  const parliamentDate=done.get('parliament')?.date;
  const forTalks=events.some(row=>row.date===parliamentDate&&row.codes.some(code=>referrals.has(code)));
  const current=forTalks&&lastDone<5?'talks':keys[lastDone+1];
  const steps=keys.filter(key=>!done.has('journal')||done.has(key)).map(key=>({key,state:done.has(key)?'done':key===current?'current':'open',date:done.get(key)?.date??null,partial:done.get(key)?.partial??false}));
  // Council mandates can precede Parliament's work; only approval of the act
  // changes the status to council-approved.
  const has=code=>events.some(row=>row.codes.includes(code));
  const stage=done.has('journal')?'journal':done.has('signed')?'signed':has('APR_R1_byCONSIL')?'council-approved':done.has('deal')?'deal':done.has('parliament')?(forTalks?'position-talks':'position'):done.has('committee')?'reported':has('COMMITTEE_TABLING_AMENDMENT')||has('COMMITTEE_TABLING_REPORT')?'drafting':has('REFERRAL')?'referred':done.has('proposal')?'proposal':'unknown';
  return {family,steps,stage,latest};
}
