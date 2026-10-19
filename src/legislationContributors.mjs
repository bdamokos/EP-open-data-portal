// Evidence belongs to a speech, never permanently to a person who chaired it.
export function mergeSpeechSpeakers(previous, speeches) {
  const next={...previous};let changed=false;
  for(const speech of speeches) {
    const people={...next[speech.id]};
    for(const person of speech.people) {
      const old=people[person.id];
      const value={name:person.name||old?.name||null,role:old?.role==='Chairing the sitting'?old.role:person.role};
      if(!old||old.name!==value.name||old.role!==value.role){people[person.id]=value;changed=true;}
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
