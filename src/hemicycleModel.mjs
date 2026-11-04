const fold=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase();

// A number finds that seat; anything else finds Members by name.
export function seatMatches(seat,{query='',group=null,country=null}={},matchesCountry=(a,b)=>!a||a===b) {
  if(!seat.member)return false;
  if(group&&seat.group!==group)return false;
  if(!matchesCountry(country,seat.country))return false;
  const wanted=fold(query).trim();
  if(!wanted)return true;
  return /^\d+$/.test(wanted)?String(seat.seat)===wanted:fold(`${seat.firstName} ${seat.name}`).includes(wanted);
}

export function groupCounts(seats) {
  const counts=new Map();
  for(const seat of seats)if(seat.member)counts.set(seat.group,(counts.get(seat.group)||0)+1);
  return [...counts].map(([group,count])=>({group,count})).sort((a,b)=>b.count-a.count||a.group.localeCompare(b.group));
}

// Seats are a few pixels wide on a phone, so a press selects the closest one within reach.
export function nearestSeat(seats,x,y,reach) {
  let best=null,distance=Infinity;
  for(const seat of seats){
    const d=Math.hypot(seat.x-x,seat.y-y);
    if(d<distance&&d<=Math.max(reach,seat.r)){best=seat;distance=d;}
  }
  return best;
}
