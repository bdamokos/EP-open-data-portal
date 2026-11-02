import {filterCountry} from './countries.mjs';
const positions=['for','against','abstaining'];
const eligible=group=>Boolean(group)&&!['NI','unavailable'].includes(group);
export function groupMajorities(rows) {
  const groups=new Map();
  for(const row of rows) {
    if(!eligible(row.group)||!positions.includes(row.position))continue;
    if(!groups.has(row.group))groups.set(row.group,{code:row.group,counts:{for:0,against:0,abstaining:0},voters:0});
    const group=groups.get(row.group);group.counts[row.position]++;group.voters++;
  }
  return [...groups.values()].map(group=>{
    const ranked=[...positions].sort((a,b)=>group.counts[b]-group.counts[a]);
    const majority=group.counts[ranked[0]]===group.counts[ranked[1]]?null:ranked[0];
    return {...group,majority,unity:majority?group.counts[majority]/group.voters:null};
  });
}
export function differentFromMajority(rows) {
  return groupMajorities(rows).reduce((sum,g)=>sum+(g.majority?g.voters-g.counts[g.majority]:0),0);
}
export function allGroupsAgree(groups) {
  return groups.length>=2&&groups.every(g=>g.majority!==null&&g.majority===groups[0].majority);
}
export function fisherExactTwoSided(a,b,c,d) {
  const n=a+b+c+d,logs=[0];
  for(let i=1;i<=n;i++)logs[i]=logs[i-1]+Math.log(i);
  const choose=(n,k)=>logs[n]-logs[k]-logs[n-k];
  const row=a+b,column=a+c;
  const logP=x=>choose(column,x)+choose(n-column,row-x)-choose(n,row);
  const observed=logP(a),terms=[];
  for(let x=Math.max(0,row-(n-column));x<=Math.min(row,column);x++) {
    const p=logP(x);if(p<=observed+1e-10)terms.push(p);
  }
  const max=Math.max(...terms);
  return Math.min(1,Math.exp(max)*terms.reduce((sum,p)=>sum+Math.exp(p-max),0));
}
// EU protocol order; EL is the shared country-filter identifier for Greece.
const countryOrder=['BE','BG','CZ','DK','DE','EE','IE','EL','ES','FR','HR','IT','CY','LV','LT','LU','HU','MT','NL','AT','PL','PT','RO','SI','SK','FI','SE'];
export function delegationBreaks(rows,{minVoting=3,alpha=0.001}={}) {
  const result=[];
  for(const group of groupMajorities(rows)) {
    if(!['for','against'].includes(group.majority))continue;
    const known=rows.filter(r=>r.group===group.code&&r.country&&['for','against'].includes(r.position));
    for(const country of new Set(known.map(r=>filterCountry(r.country)))) {
      const delegation=known.filter(r=>filterCountry(r.country)===country),rest=known.filter(r=>filterCountry(r.country)!==country);
      const count=(people,p)=>people.filter(r=>r.position===p).length;
      const a=count(delegation,'for'),b=count(delegation,'against'),c=count(rest,'for'),d=count(rest,'against');
      if(a+b<minVoting||a===b||c===d||(a-b)*(c-d)>=0)continue;
      if((a>b?'for':'against')===group.majority)continue;
      const p=fisherExactTwoSided(a,b,c,d);
      if(p<alpha)result.push({group:group.code,country,for:a,against:b,restFor:c,restAgainst:d,size:a+b,p});
    }
  }
  return result.sort((a,b)=>a.p-b.p||b.size-a.size||countryOrder.indexOf(a.country)-countryOrder.indexOf(b.country)||a.country.localeCompare(b.country)||a.group.localeCompare(b.group));
}
