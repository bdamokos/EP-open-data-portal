import {contributorOffice} from './speakerRoles.mjs';
// Evidence belongs to a speech, never permanently to a person who chaired it.
export function mergeSpeechSpeakers(previous, speeches) {
  const next={...previous};let changed=false;
  for(const speech of speeches) {
    const people={...next[speech.id]};
    for(const person of speech.people) {
      const old=people[person.id];
      const oldTime=Date.parse(old?.roleSource?.fetchedAt),newTime=Date.parse(person.roleSource?.fetchedAt);
      if(Number.isFinite(oldTime)&&(!Number.isFinite(newTime)||newTime<oldTime))continue;
      const oldRevision=old?.roleSource?.evidenceRevision,newRevision=person.roleSource?.evidenceRevision;
      if(Number.isSafeInteger(oldRevision)&&Number.isSafeInteger(newRevision)&&newRevision<oldRevision)continue;
      if(Number.isSafeInteger(oldRevision)&&!Number.isSafeInteger(newRevision)&&!(newTime>oldTime))continue;
      if(Number.isSafeInteger(oldRevision)&&newRevision===oldRevision&&old?.roleSource?.historyComplete===false&&person.roleSource?.historyComplete!==false)continue;
      const sameRole=person.role===old?.role&&person.roleLanguage===old?.roleLanguage;
      const sameEvidence=sameRole&&Number.isSafeInteger(newRevision)&&newRevision===oldRevision&&person.roleSource?.historyComplete===true&&old?.roleSource?.historyComplete===true;
      const value={name:person.name||old?.name||null,role:old?.role==='Chairing the sitting'?old.role:person.role===undefined?old?.role??null:person.role,
        roleLanguage:person.roleLanguage??(sameRole?old?.roleLanguage:null)??null,
        roleLabels:sameEvidence?{...old?.roleLabels,...person.roleLabels}:person.roleLabels||(sameRole?old?.roleLabels:null)||{},roleSource:person.roleSource||old?.roleSource};
      if(!old||JSON.stringify(old)!==JSON.stringify(value)){people[person.id]=value;changed=true;}
    }
    next[speech.id]=people;
  }
  return changed?next:previous;
}

// Group sizes describe the full current roster, never this debate or a country subset.
export function orderLegislationPeople(people, roles, members=[]) {
  const ranks=new Map(),sizes=new Map();
  const roleRanks={RAPPORTEUR:0,RAPPORTEUR_OPINION:1,RAPPORTEUR_SHADOW:2,RAPPORTEUR_SHADOW_OPINION:3};
  for(const {id,role} of roles)ranks.set(id,Math.min(ranks.get(id)??4,roleRanks[role]??4));
  for(const member of members)if(member.groupCode)sizes.set(member.groupCode,(sizes.get(member.groupCode)||0)+1);
  const rank=person=>person.currentMep?ranks.get(person.id)??4:-1;
  const groupRank=person=>!person.group||person.group==='Unknown'?2:person.group==='NI'?1:0;
  return [...people].sort((a,b)=>rank(a)-rank(b)
    || (a.currentMep&&b.currentMep?(groupRank(a)-groupRank(b)
      || (sizes.get(b.group)||0)-(sizes.get(a.group)||0)
      || (a.group||'').localeCompare(b.group||'')):0)
    || Number(!a.name)-Number(!b.name)
    || (a.name||'').localeCompare(b.name||'')
    || a.id.localeCompare(b.id));
}

export function legislationContributors(detail, headers) {
  const chairing=(speech,id)=>headers[speech.sourceId]?.[id]?.role==='Chairing the sitting';
  const roles=[...detail.roles,...detail.speeches.flatMap(speech=>speech.people.filter(person=>!chairing(speech,person.id)).map(person=>({id:person.id,role:speech.kind==='PLENARY_DEBATE_WRITTEN_STATEMENT'?'WRITTEN_STATEMENT':'SPEAKER'})))];
  const included=new Set(roles.map(person=>person.id)),people=detail.people.filter(person=>included.has(person.id));
  const excluded=detail.people.filter(person=>!included.has(person.id)),stats={...detail.stats};
  stats.uniquePeople=people.length;stats.uniqueCurrentMeps=people.filter(person=>person.currentMep).length;
  stats.peopleOutsideCurrentRoster=people.length-stats.uniqueCurrentMeps;stats.denominator=stats.uniqueCurrentMeps;
  stats.dimensions=Object.fromEntries(Object.entries(detail.stats.dimensions).map(([dimension,rows])=>{
    const counts=new Map(rows.map(row=>[row.label,row.count]));
    for(const person of excluded.filter(person=>person.currentMep)) {
      const label=person.demographics[dimension];counts.set(label,(counts.get(label)||0)-1);
    }
    return [dimension,[...counts].filter(([,count])=>count>0).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))];
  }));
  return {people,roles,stats,excludedCount:excluded.length};
}

// Only the latest contribution in this item can supply its office. Other items,
// late callbacks and a person's generic profile never supply an office here.
export function legislationOffice(detail,headers,personId,language='en') {
  const speeches=detail.speeches.filter(speech=>speech.people.some(person=>person.id===personId)&&headers[speech.sourceId]?.[personId]?.role!=='Chairing the sitting')
    .toSorted((a,b)=>b.date.localeCompare(a.date)||(Date.parse(b.start)||0)-(Date.parse(a.start)||0)||a.sourceId.localeCompare(b.sourceId));
  if(!speeches.length)return null;
  const latest=speeches[0],person=headers[latest.sourceId]?.[personId];
  if(!person)return contributorOffice(null,language);
  const label=contributorOffice(person,language);
  // Unknown ordering among same-day observations cannot pick between roles.
  const ambiguous=speeches.filter(speech=>speech.date===latest.date&&(!speech.start||!latest.start||Date.parse(speech.start)===Date.parse(latest.start)));
  if(ambiguous.some(speech=>contributorOffice(headers[speech.sourceId]?.[personId],language).text!==label.text))return contributorOffice(null,language);
  return label;
}
