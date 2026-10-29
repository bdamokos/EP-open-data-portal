export const dossierSections=['roles','speeches','amendments','votes'];
export const dossierFilters=['all',...dossierSections];
export const fullDossierReference=value=>typeof value==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(value);
export const validDossierPerson=value=>typeof value==='string'&&/^[1-9]\d{0,12}$/.test(value);

export function dossierHref(reference,person,language='en',base=location.href) {
  const url=new URL(base);url.search='';url.hash='';
  url.searchParams.set('view','legislation');url.searchParams.set('pl-mode','dossier');url.searchParams.set('dossier-ref',reference);url.searchParams.set('lang',language);
  if(validDossierPerson(String(person??'')))url.searchParams.set('dossier-person',String(person));
  return url.pathname+url.search;
}

const matchesDecision=(decision,row)=>decision.id===row.vote.id||Boolean(decision.partId&&[...(row.vote.context?.componentIds||[]),...(row.vote.parts||[]).map(part=>part.componentId)].includes(decision.partId));

// A shared procedure, title, amendment number or tally never binds a ballot.
export function dossierAmendmentVotes(item,votes) {
  if(item.amendment.conflicted)return [];
  const decisions=item.amendment.decisions||[];
  return votes.filter(row=>decisions.some(decision=>matchesDecision(decision,row)));
}

export function dossierVoteCards(amendments,votes) {
  const rendered=new Set(),cards=new Map();
  for(const amendment of amendments){
    const own=[],shared=[];
    for(const vote of dossierAmendmentVotes(amendment,votes)){
      if(rendered.has(vote.id))shared.push(vote);
      else {rendered.add(vote.id);own.push(vote);}
    }
    const unloaded=!amendment.amendment.conflicted&&(amendment.amendment.decisions||[]).some(decision=>!votes.some(vote=>matchesDecision(decision,vote)));
    // A component ballot cannot stand in for the amendment's overall result.
    const item=amendment.amendment,bound=[...own,...shared];
    const whole=!item.splitParts?.length&&!item.splitCoverage?.length&&item.splitCoverageComplete!==false&&(item.decisions||[]).some(decision=>
      !decision.partId&&decision.partNumber==null&&!decision.componentBinding&&!decision.componentReferences?.length&&bound.some(vote=>decision.id===vote.vote.id));
    cards.set(amendment.id,{votes:own,shared,unloaded,showOutcome:!whole});
  }
  return cards;
}

export function dossierTimeline(items) {
  const groups=new Map();
  for(const item of items){
    if(item.kind==='role'&&item.dateBasis==='document')continue;
    const key=item.kind==='amendment'?JSON.stringify(['amendment-list',item.amendment.listId||item.id,item.date,item.stage]):item.kind+':'+item.id;
    const group=groups.get(key)||{id:key,date:item.date,kind:item.kind,items:[]};group.items.push(item);groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id));
}

function mergeCoverage(before,after,unavailableStatus=null) {
  const checkedTargets=[...new Set([...(before.checkedTargets||[]),...(after.checkedTargets||[])])];
  const uncheckedTargets=[...new Set([...(before.uncheckedTargets||[]),...(after.uncheckedTargets||[])])].filter(id=>!checkedTargets.includes(id));
  const gaps=[...new Set([...before.gaps,...after.gaps])];
  const otherPartial=[before,after].some(coverage=>coverage.checkedComplete===false||coverage.checkedComplete===undefined&&coverage.status==='partial'&&!coverage.uncheckedTargets?.length);
  return {...after,status:unavailableStatus||(gaps.length||uncheckedTargets.length||otherPartial?'partial':'complete'),checkedComplete:!otherPartial&&!unavailableStatus,checkedTargets,uncheckedTargets,gaps,
    retryable:Boolean(before.retryable||after.retryable),failedDebates:[...new Set([...(before.failedDebates||[]),...(after.failedDebates||[])])],
    missingSpeechIds:[...new Set([...(before.missingSpeechIds||[]),...(after.missingSpeechIds||[])])],retained:Boolean(before.retained||after.retained),
    sources:[...new Map([...before.sources,...after.sources].map(source=>[JSON.stringify(source),source])).values()]};
}

export function mergeDossierPage(previous,page) {
  if(!previous)return page;
  const items=new Map(previous.items.map(item=>[item.id,item]));for(const item of page.items)items.set(item.id,item);
  const unavailable=previous.coverage.status==='unavailable'||page.coverage.status==='unavailable';
  const coverage=mergeCoverage(previous.coverage,page.coverage,unavailable?(items.size?'partial':'unavailable'):null);
  const participants=new Map(previous.participants.map(person=>[person.id,person]));
  for(const person of page.participants){const old=participants.get(person.id);participants.set(person.id,{...person,roles:[...new Map([...(old?.roles||[]),...person.roles].map(role=>[role.id,role])).values()],speeches:[...new Map([...(old?.speeches||[]),...(person.speeches||[])].map(speech=>[speech.id,speech])).values()]});}
  const before=previous.participantCoverage,after=page.participantCoverage;
  const participantCoverage=before&&after?mergeCoverage(before,after,before.status==='unavailable'||after.status==='unavailable'?before.status==='unavailable'&&after.status==='unavailable'?'unavailable':'partial':null):after||before;
  return {...page,items:[...items.values()],participants:[...participants.values()],participantCoverage,coverage};
}

export function retainDossierContributors(previous,page) {
  const coverage=page.participantCoverage;
  if(!previous||previous.generation!==page.generation||previous.procedure.reference!==page.procedure.reference||previous.memberId!==page.memberId||previous.section!==page.section||previous.pagination.offset!==page.pagination.offset||previous.pagination.targetOffset!==page.pagination.targetOffset||!coverage||!coverage.retryable&&coverage.status!=='unavailable')return page;
  const people=new Map(page.participants.map(person=>[person.id,person]));let retained=false;
  for(const old of previous.participants){
    const current=people.get(old.id),known=new Set((current?.speeches||[]).map(speech=>speech.id)),earlier=(old.speeches||[]).filter(speech=>!known.has(speech.id)&&(coverage.failedDebates?.length?coverage.failedDebates.includes(speech.debateId):coverage.status==='unavailable'));
    if(!earlier.length)continue;
    retained=true;
    // Retain only established contribution evidence. Fresh role observations
    // still replace old roles, and a successful retry can remove stale rows.
    people.set(old.id,{id:old.id,name:current?.name||old.name,roles:current?.roles||[],speeches:[...earlier,...(current?.speeches||[])]});
  }
  if(!retained)return page;
  return {...page,participants:[...people.values()],pagination:{...page.pagination,next:page.pagination.next||previous.pagination.next},participantCoverage:{...coverage,status:'partial',retained:true,sources:[...new Map([...(previous.participantCoverage?.sources||[]),...coverage.sources].map(source=>[JSON.stringify(source),source])).values()]}};
}

export const dossierEmptyLabel=coverage=>coverage.status==='complete'&&!coverage.gaps.length?'No linked records.':coverage.status==='unavailable'?'Records unavailable.':'No records available yet.';
