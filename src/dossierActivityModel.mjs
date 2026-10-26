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

export function mergeDossierPage(previous,page) {
  if(!previous)return page;
  const items=new Map(previous.items.map(item=>[item.id,item]));for(const item of page.items)items.set(item.id,item);
  const sources=new Map([...previous.coverage.sources,...page.coverage.sources].map(source=>[JSON.stringify(source),source]));
  const unavailable=previous.coverage.status==='unavailable'||page.coverage.status==='unavailable';
  const status=unavailable?(items.size?'partial':'unavailable'):previous.coverage.status==='partial'||page.coverage.status==='partial'?'partial':'complete';
  const participants=new Map(previous.participants.map(person=>[person.id,person]));
  for(const person of page.participants){const old=participants.get(person.id);participants.set(person.id,{...person,roles:[...new Map([...(old?.roles||[]),...person.roles].map(role=>[role.id,role])).values()],speeches:[...new Map([...(old?.speeches||[]),...(person.speeches||[])].map(speech=>[speech.id,speech])).values()]});}
  const before=previous.participantCoverage,after=page.participantCoverage;
  const participantCoverage=before&&after?{...after,status:before.status==='complete'&&after.status==='complete'?'complete':before.status==='unavailable'&&after.status==='unavailable'?'unavailable':'partial',gaps:[...new Set([...before.gaps,...after.gaps])],sources:[...new Map([...before.sources,...after.sources].map(source=>[JSON.stringify(source),source])).values()]}:after||before;
  return {...page,items:[...items.values()],participants:[...participants.values()],participantCoverage,coverage:{...page.coverage,status,gaps:[...new Set([...previous.coverage.gaps,...page.coverage.gaps])],sources:[...sources.values()]}};
}

export const dossierEmptyLabel=coverage=>coverage.status==='complete'&&!coverage.gaps.length&&!coverage.discovery?.pending&&!coverage.discovery?.refreshGaps&&!coverage.discovery?.capacityGaps.length?'No linked records.':coverage.status==='unavailable'?'Records unavailable.':'No records available yet.';
