// Activity strips bucket recorded contributions per calendar month for the
// term and 12-month periods, and per sitting day for a single month. Sitting
// days are the dates on which any listed speaker contributed.
const monthKeys=(from,to)=>{
  const keys=[];if(!/^\d{4}-\d{2}/.test(from||'')||!/^\d{4}-\d{2}/.test(to||''))return keys;
  for(let y=Number(from.slice(0,4)),m=Number(from.slice(5,7));`${y}-${String(m).padStart(2,'0')}`<=to.slice(0,7);m===12?(y++,m=1):m++)keys.push(`${y}-${String(m).padStart(2,'0')}`);
  return keys;
};
export function activityBuckets(window,period,people){
  if(/^\d{4}-\d{2}$/.test(period||'')){
    const days=new Set();for(const p of people)for(const day of Object.keys(p.days||{}))if(day.startsWith(period))days.add(day);
    return {unit:'day',keys:[...days].sort()};
  }
  return {unit:'month',keys:monthKeys(window?.from,window?.to)};
}
export function activityCounts(days,{unit,keys}){
  const counts=new Map(keys.map(key=>[key,0]));
  for(const [day,n] of Object.entries(days||{})){const key=unit==='day'?day:day.slice(0,7);if(counts.has(key))counts.set(key,counts.get(key)+n);}
  return keys.map(key=>counts.get(key));
}
export function sumActivity(people){
  const days={};for(const p of people)for(const [day,n] of Object.entries(p.days||{}))days[day]=(days[day]||0)+n;
  return days;
}
// Five shades on one scale shared by every strip on the page, so cells
// compare across rows. Level 0 is an observed zero.
export const activityLevel=(count,max)=>count>0?Math.min(4,Math.max(1,Math.ceil(Math.sqrt(count/Math.max(1,max))*4))):0;
