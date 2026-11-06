const positions=['for','against','abstaining'];
const fold=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase();

// The voters shown in the panel: everyone who recorded a position, narrowed by country, group and a name search.
// The counts ignore the chosen position tab so each tab shows what it would list.
export function panelVoters(positionsByName,{groupOf,matchesCountry=()=>true,group=null,query=''}={}) {
  const wanted=fold(query).trim(),rows=[],counts={all:0,for:0,against:0,abstaining:0};
  for(const position of positions)for(const person of positionsByName?.[position]||[]) {
    const personGroup=groupOf?.(person.id)||'unavailable';
    if(!matchesCountry(person.country))continue;
    if(group&&personGroup!==group)continue;
    if(wanted&&!fold(person.name).includes(wanted))continue;
    rows.push({id:String(person.id),name:person.name||null,country:person.country||null,group:personGroup,position});
    counts.all++;counts[position]++;
  }
  const rank=Object.fromEntries(positions.map((position,index)=>[position,index]));
  const sorted=[...rows].sort((a,b)=>rank[a.position]-rank[b.position]||String(a.name||'').localeCompare(String(b.name||''))||a.id.localeCompare(b.id,undefined,{numeric:true}));
  return {rows:sorted,counts};
}
export const listFor=(rows,position)=>position==='all'?rows:rows.filter(row=>row.position===position);
