const REFERRAL_EVENT='PLENARY_REFER_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS';
/** The exact same-date event on the procedure; wording never establishes a referral. */
export function referredForTalksOn(procedure,date) {
  const events=Array.isArray(procedure?.consists_of)?procedure.consists_of:[];
  return Boolean(date)&&events.some(event=>typeof event?.had_activity_type==='string'&&event.had_activity_type.split('/').at(-1)===REFERRAL_EVENT&&event.activity_date===date);
}
