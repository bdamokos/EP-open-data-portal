import type {AnalysisPeriod} from '../server/analysis-period.mjs';

export function PocAnalysisPeriod({value,onChange,periods,label='Period'}:{value:AnalysisPeriod;onChange:(period:AnalysisPeriod)=>void;periods:readonly number[];label?:string}) {
  return <label>{label}<select value={value} onChange={event=>onChange(event.target.value==='term'?'term':Number(event.target.value))}>
    {periods.map(days=><option key={days} value={days}>{days} days</option>)}
    <option value="term">Current term</option>
  </select></label>;
}
