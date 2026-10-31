import {UiMessage, useUiI18n} from './UiI18nReact';
import type {AnalysisPeriod} from '../server/analysis-period.mjs';

export function AnalysisPeriodControl({value,onChange,periods,label: labelProp}:{value:AnalysisPeriod;onChange:(period:AnalysisPeriod)=>void;periods:readonly number[];label?:string}) {
  const ui = useUiI18n();
const label = labelProp ?? ui.t("plenaryPeriod.select.1");

  return <label lang={ui.language}>{label}<select value={value} onChange={event=>onChange((event.target.value==='term') ? 'term' : Number(event.target.value))}>
    {periods.map(days=><option key={days} value={days}><UiMessage id="batch6.analysisperiod.days.days.5" values={{days: days}} counts={{days: days}}/></option>)}
    <option value="term"><UiMessage id="batch6.analysisperiod.current.term.6"/></option>
  </select></label>;
}
