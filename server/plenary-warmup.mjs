import {brusselsDay} from './analysis-period.mjs';
import {calendarMonday} from './plenary-calendar.mjs';
import {latestCatalogueSitting} from './meetings-reader.mjs';
import {PLENARY_REFRESH_MS} from './plenary-cache-policy.mjs';

// Count sitting weeks, not calendar weeks: recesses must not displace agendas.
export function recentPlenaryWeeks(catalogue,now=Date.now()) {
  const latest=latestCatalogueSitting(catalogue,brusselsDay(now));
  if(!latest)return [];
  const week=calendarMonday(latest.activity_date);
  return [...new Set(catalogue.sittings.map(s=>calendarMonday(s.activity_date)).filter(value=>value<=week))].sort().reverse().slice(0,4);
}

// Runs in the source-owning server, never as a second process or index writer.
export function startPlenaryWarmup(warm,{clock=Date.now,log=console.warn}={}) {
  let stopped=false,timer,running=false,wakePending=false;
  const schedule=at=>{
    if(stopped||at===null)return;
    timer=setTimeout(()=>{if(clock()<at)schedule(at);else void tick();},Math.min(Math.max(1,at-clock()),2**31-1));timer.unref();
  };
  const tick=async()=>{
    if(stopped)return;
    if(running){wakePending=true;return;}
    running=true;
    let delay=PLENARY_REFRESH_MS;
    try {delay=await warm();}catch(error){log('[plenary-warmup]',error.message);}
    running=false;
    if(wakePending){wakePending=false;schedule(clock()+1);}
    else schedule(delay===null?null:clock()+(delay??PLENARY_REFRESH_MS));
  };
  void tick();
  const stop=()=>{stopped=true;clearTimeout(timer);};
  stop.wake=()=>{if(stopped)return;clearTimeout(timer);void tick();};
  return stop;
}
