// Nearby days share a target; the panel keeps every exact sitting date.
export function clusterOutsideDays(days,start,end,width,gap=34) {
  const span=Math.max(86400000,Date.parse(end)-Date.parse(start)), usable=Math.max(1,width-36);
  const intervals=Math.max(1,Math.floor(usable/gap)),step=usable/intervals;
  const points=days.map(day=>({...day,x:18+Math.max(0,Math.min(1,(Date.parse(day.date)-Date.parse(start))/span))*usable})).sort((a,b)=>a.x-b.x);
  const groups=[];
  for(const point of points) {
    const bin=Math.round((point.x-18)/step),last=groups.at(-1);
    if(last && last.bin===bin)last.points.push(point);
    else groups.push({points:[point],bin});
  }
  return groups.map(({points,bin})=>({x:18+bin*step,dates:points.map(p=>p.date),items:points.reduce((sum,p)=>sum+p.itemIds.length,0),contributions:points.reduce((sum,p)=>sum+p.contributions,0),formal:points.some(p=>p.formal),legislative:points.some(p=>p.legislative)}));
}
