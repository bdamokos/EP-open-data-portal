// RSS belongs to the whole Node process, including other worker threads.
// Sample only while a build is active; keep its lifetime high-water mark too.
export function topicBuildMetrics(details,{now=()=>performance.now(),rss=()=>process.memoryUsage.rss(),usage=()=>process.resourceUsage(),log=console.info}={}){
 const started=now();let peak=null,finished=false;
 const sample=()=>{try{const value=rss();if(Number.isFinite(value))peak=peak===null?value:Math.max(peak,value);}catch{/* Missing telemetry must not stop the writer. */}};
 sample();const timer=setInterval(sample,250);timer.unref?.();
 return (outcome,extra={})=>{
  if(finished)return;finished=true;clearInterval(timer);sample();
  let lifetime=null;try{lifetime=usage().maxRSS/1024;}catch{}
  const mib=value=>value===null?null:Math.round(value*100)/100;
  try{log('[topics-build]',JSON.stringify({...details,outcome,...extra,durationMs:Math.round(now()-started),peakRssMiB:mib(peak===null?null:peak/1048576),processLifetimePeakRssMiB:mib(lifetime),rssScope:'process',rssSampleMs:250}));}catch{/* Logging cannot change build publication or cancellation. */}
 };
}
