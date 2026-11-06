// Overview items for the MEP page. A count shows only when its source read
// succeeded and reported the category as complete; anything else is unknown
// and is left out, never shown as zero.
const ACTIVITY_ITEMS=[
  {key:'speeches',category:'plenary-contributions',target:'speeches',one:'followUpdates.count_speech',other:'followUpdates.count_speeches',zero:true},
  {key:'reports-rapporteur',category:'reports-rapporteur',target:'activities',one:'followUpdates.count_report_as_rapporteur',other:'followUpdates.count_reports_as_rapporteur'},
  {key:'reports-shadow',category:'reports-shadow',target:'activities',one:'memberoverview.count_shadow_report',other:'memberoverview.count_shadow_reports'},
  {key:'opinions-rapporteur',category:'opinions-rapporteur',target:'activities',one:'followUpdates.count_opinion_as_rapporteur',other:'followUpdates.count_opinions_as_rapporteur'},
  {key:'opinions-shadow',category:'opinions-shadow',target:'activities',one:'memberoverview.count_shadow_opinion',other:'memberoverview.count_shadow_opinions'},
];

const known=(coverage,category)=>{
  const row=coverage?.[category];
  return row?.status==='available'&&Number.isSafeInteger(row.indexedCount)&&row.indexedCount>=0?row.indexedCount:null;
};

export function memberOverviewItems({activities,votes}) {
  const coverage=activities?.categoryCoverage,items=[];
  const add=(item,count)=>{if(count!==null&&(count>0||item.zero))items.push({...item,count});};
  add(ACTIVITY_ITEMS[0],known(coverage,'plenary-contributions'));
  for(const item of ACTIVITY_ITEMS.slice(1))add(item,known(coverage,item.category));
  // Questions open one category, so a person with both kinds gets one item each.
  const written=known(coverage,'written-questions'),oral=known(coverage,'oral-questions');
  if(written!==null&&oral!==null&&written>0&&oral>0){
    items.push({key:'written-questions',category:'written-questions',target:'activities',one:'followUpdates.count_written_question',other:'followUpdates.count_written_questions',count:written});
    items.push({key:'oral-questions',category:'oral-questions',target:'activities',one:'followUpdates.count_oral_question',other:'followUpdates.count_oral_questions',count:oral});
  } else if(written!==null&&oral!==null&&written+oral>0)items.push({key:'questions',category:written?'written-questions':'oral-questions',target:'activities',one:'memberoverview.count_question',other:'memberoverview.count_questions',count:written+oral});
  add({key:'motions',category:'motions',target:'activities',one:'followUpdates.count_motion',other:'followUpdates.count_motions'},known(coverage,'motions'));
  const recorded=votes?.coverage?.status==='complete'?votes.pagination?.recordedTotal:null,against=votes?.alignmentCounts?.against;
  if(Number.isSafeInteger(recorded)&&Number.isSafeInteger(against)&&votes.period?.week)items.push({key:'votes',target:'votes',week:votes.period.week,one:'memberoverview.last_week_one',other:'memberoverview.last_week',count:recorded,against});
  return items;
}

export function memberOverviewVotesRoute(memberId) {
  return `member-votes/${memberId}?week=latest&view=summary`;
}
