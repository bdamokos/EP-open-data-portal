// The window controls refresh starts; running builds have no window deadline.
export function topicBuildWindowOpen(now=Date.now(),window=process.env.TOPICS_REBUILD_WINDOW||'03:00-05:00'){
 const match=/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);if(!match)throw Error('TOPICS_REBUILD_WINDOW must be HH:MM-HH:MM.');
 const [,sh,sm,eh,em]=match.map(Number),start=sh*60+sm,end=eh*60+em;
 if(sh>23||sm>59||eh>24||em>59||eh===24&&em!==0||start===end)throw Error('Invalid TOPICS_REBUILD_WINDOW.');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),minute=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
 return start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
