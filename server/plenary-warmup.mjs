import {brusselsDay} from './analysis-period.mjs';
import {calendarMonday} from './plenary-calendar.mjs';
import {latestCatalogueSitting} from './meetings-reader.mjs';

// Count sitting weeks, not calendar weeks: recesses must not displace agendas.
export function recentPlenaryWeeks(catalogue,now=Date.now()) {
  const latest=latestCatalogueSitting(catalogue,brusselsDay(now));
  if(!latest)return [];
  const week=calendarMonday(latest.activity_date);
  return [...new Set(catalogue.sittings.map(s=>calendarMonday(s.activity_date)).filter(value=>value<=week))].sort().reverse().slice(0,4);
}

// Runs in the source-owning server, never as a second process or index writer.
export function startPlenaryWarmup(warm,{intervalMs=5*60_000,log=console.warn}={}) {
  let running=false,stopped=false;
  const tick=async()=>{
    if(stopped||running)return;
    running=true;
    try {await warm();}catch(error){log('[plenary-warmup]',error.message);}finally{running=false;}
  };
  const timer=setInterval(()=>void tick(),intervalMs);timer.unref();
  void tick();
  return ()=>{stopped=true;clearInterval(timer);};
}
