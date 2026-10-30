import {useId,useState} from 'react';
import {useData} from './data';
import {plenaryMonday,validateVotePeriods,votePeriodWeek,voteWeekNeighbours,type VotePeriodsResponse} from './plenaryPeriods.mjs';
import type {MemberVoteSittingCoverage} from './MemberVotesTypes';
import type {MemberVotesState} from './MemberVotes';
import './VotePeriodNavigation.css';
const format=(date:string,language:string,day=false)=>!plenaryMonday(date)?date:new Intl.DateTimeFormat(language,{...(day?{weekday:'short' as const}:{}),day:'numeric',month:'short',...(!day?{year:'numeric' as const}:{}),timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const compactDay=(date:string,language:string)=>new Intl.DateTimeFormat(language,{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
function weekLabel(week:{week:string;sittings:{date:string}[]},language:string){
  const dates=week.sittings.map(s=>new Date(s.date+'T12:00:00Z')),formatter=new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  return formatter.formatRange(dates[0],dates.at(-1)!)+` · ${dates.length} sitting ${dates.length===1?'day':'days'}`;
}
export function VotePeriodNavigation({state,resolvedWeek,language,sittingCoverage=[],onPeriod}:{state:MemberVotesState;resolvedWeek?:string|null;language:string;sittingCoverage?:MemberVoteSittingCoverage[];onPeriod:(week:string,sittingId?:string|null)=>void}){
  const id=useId(),request=useData<VotePeriodsResponse>('vote-periods'),[error,setError]=useState('');
  const calendar=validateVotePeriods(request.data)?request.data:null,weeks=calendar?.weeks||[];
  const week=votePeriodWeek(state,resolvedWeek,weeks),days=weeks.find(item=>item.week===week)?.sittings||[],neighbours=voteWeekNeighbours(weeks,week);
  const unavailable=Boolean(request.error||!request.loading&&(!calendar||calendar.coverage.status==='unavailable'));
  const years=[...new Set(weeks.map(item=>item.week.slice(0,4)))];
  const choose=(value:string,sittingId:string|null=null)=>{setError('');onPeriod(value,sittingId);};
  const jumps=[{label:'First plenary week',paths:['m11 6-6 6 6 6','m19 6-6 6 6 6'],target:weeks.at(-1)?.week},{label:'Previous plenary week',paths:['m15 6-6 6 6 6'],target:neighbours.previous},{label:'Next plenary week',paths:['m9 6 6 6-6 6'],target:neighbours.next},{label:'Latest plenary week',paths:['m5 6 6 6-6 6','m13 6 6 6-6 6'],target:weeks[0]?.week}];
  const chevron=(jump:typeof jumps[number])=><button key={jump.label} type="button" aria-label={jump.label} title={jump.label} disabled={!jump.target||jump.target===week} onClick={()=>jump.target&&choose(jump.target)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{jump.paths.map(path=><path key={path} d={path}/>)}</svg></button>;
  const dayButton=(day:{sittingId:string;date:string})=>{
    const noVotes=Array.isArray(sittingCoverage)&&sittingCoverage.some(observed=>observed&&typeof observed==='object'&&observed.sittingId===day.sittingId&&observed.date===day.date&&observed.state==='complete'&&observed.observedDecisionCount===0);
    const fullDate=new Intl.DateTimeFormat(language,{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'));
    const label=fullDate+(noVotes?', no votes recorded':'');
    return <button className={noVotes?'vote-period-no-votes':undefined} key={day.sittingId} type="button" aria-label={label} title={label} aria-pressed={state.sittingId===day.sittingId} onClick={()=>choose(week,day.sittingId)}><span className="vote-period-full" aria-hidden="true">{format(day.date,language,true)}</span><span className="vote-period-compact" aria-hidden="true">{compactDay(day.date,language)}</span></button>;
  };
  return <div className="member-votes-period-navigation">
    {request.loading&&!calendar&&<p role="status">Loading plenary dates…</p>}
    {unavailable?<><p className="member-votes-calendar-notice">The plenary calendar could not be loaded.</p><label htmlFor={id+'-date'}>Choose any date in the week<input id={id+'-date'} type="date" value={week==='latest'?'':week} aria-describedby={error?id+'-error':undefined} onChange={event=>{const monday=plenaryMonday(event.target.value);if(monday)choose(monday);else setError('Choose a valid date.');}}/></label><button type="button" onClick={request.retry}>Retry calendar</button></>:calendar&&<>
      {calendar.coverage.status==='partial'&&<p className="member-votes-calendar-notice">Some plenary dates could not be loaded.</p>}
      {calendar.coverage.status==='complete'&&!weeks.length&&<p className="member-votes-calendar-notice">No plenary weeks yet.</p>}
      <label htmlFor={id}>Plenary week</label>
      <div className="member-votes-week-navigation">{jumps.slice(0,2).map(chevron)}<select id={id} value={week} onChange={event=>choose(event.target.value)}>
        {!weeks.some(item=>item.week===week)&&<option value={week}>{week==='latest'?'Latest sitting week':'Week of '+format(week,language)}</option>}
        {years.map(year=><optgroup key={year} label={year}>{weeks.filter(item=>item.week.startsWith(year)).map(item=><option key={item.week} value={item.week}>{weekLabel(item,language)}</option>)}</optgroup>)}
      </select>{jumps.slice(2).map(chevron)}</div>
      {week!=='latest'&&<div className="member-votes-days" role="group" aria-label="Sitting days"><button type="button" aria-label="Whole week" aria-pressed={!state.sittingId} onClick={()=>choose(week)}><span className="vote-period-full" aria-hidden="true">Whole week</span><span className="vote-period-compact" aria-hidden="true">Week</span></button>{state.sittingId&&!days.some(s=>s.sittingId===state.sittingId)&&dayButton({sittingId:state.sittingId,date:state.sittingId.slice(7)})}{days.map(dayButton)}</div>}
    </>}
    {error&&<p id={id+'-error'} role="alert">{error}</p>}
  </div>;
}
