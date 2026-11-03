import {choiceAgreement,outcomePosition} from './yourVoteStore.mjs';

// Keep the list's contiguous subject groups and physical row order. Equal
// labels in different sections are not evidence that the groups are identical.
export function ballotGroups(rows) {
  const groups=[];
  for(const row of rows){const subject=row.subject||[],key=JSON.stringify(subject),last=groups.at(-1);
    if(last?.key===key)last.rows.push(row);else groups.push({key,subject,rows:[row]});}
  return groups;
}
export function summarizeVotes(entries,comparisons,people) {
  const result={agreed:0,total:0},groups=new Map(),members=new Map(people.map(p=>[p.id,{...p,agreed:0,total:0}]));
  const add=(count,choice,position)=>{const agreement=choiceAgreement(choice,position);if(agreement!==null){count.total++;if(agreement)count.agreed++;}};
  for(const entry of entries){
    add(result,entry.choice,outcomePosition(entry.outcome));
    const data=comparisons[entry.decisionId];
    if(data?.integrity!=='complete')continue;
    for(const group of data.majorities||[]){const count=groups.get(group.id)||{id:group.id,agreed:0,total:0};add(count,entry.choice,group.position);groups.set(group.id,count);}
    for(const voter of data.voters||[]){if(voter.status==='recorded'&&members.has(voter.personId))add(members.get(voter.personId),entry.choice,voter.position);}
  }
  const order=(a,b)=>b.agreed/b.total-a.agreed/a.total||b.total-a.total||a.id.localeCompare(b.id);
  return {result,groups:[...groups.values()].filter(g=>g.total).sort(order),members:[...members.values()].filter(p=>p.total)};
}
export function sessionDateRange(dates,language) {
  const sorted=[...new Set(dates)].sort(),formatter=new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  return formatter.formatRange(new Date(sorted[0]+'T12:00Z'),new Date(sorted.at(-1)+'T12:00Z'));
}

export const brusselsToday=(now=Date.now())=>new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Brussels'}).format(new Date(now));
export const ballotVisible=(sitting,source,now=Date.now())=>sitting.slice(7)>=brusselsToday(now)||['voting-list','retained'].includes(source);
