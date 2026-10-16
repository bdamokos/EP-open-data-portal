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
