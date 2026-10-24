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

// A shared procedure, title, amendment number or tally never binds a ballot.
export function dossierAmendmentVotes(item,votes) {
  if(item.amendment.conflicted)return [];
  const decisions=item.amendment.decisions||[];
  return votes.filter(row=>decisions.some(decision=>decision.id===row.vote.id||decision.partId&&[...(row.vote.context?.componentIds||[]),...(row.vote.parts||[]).map(part=>part.componentId)].includes(decision.partId)));
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
  return {...page,items:[...items.values()],coverage:{...page.coverage,status,gaps:[...new Set([...previous.coverage.gaps,...page.coverage.gaps])],sources:[...sources.values()]}};
}
