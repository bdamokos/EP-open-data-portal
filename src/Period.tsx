import {UiMessage} from './UiI18nReact';
import {ongoingLabels} from './memberships.mjs';

export const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;

// A date range that omits missing dates; an open end reads as ongoing only for a current member.
export function Period({start,end,ongoing,lang,date}:{start:unknown;end:unknown;ongoing:boolean;lang:string;date:(value:string,lang:string)=>string}) {
  const from=validDate(start) ? <span lang={lang}>{date(start,lang)}</span> : null;
  const to=validDate(end) ? <span lang={lang}>{date(end,lang)}</span> : null;
  if(to)return from ? <><>{from} — {to}</></> : <><UiMessage id="period.until.to" values={{to}}/></>;
  if(ongoing)return from ? <><>{from} — {<span lang={lang}>{ongoingLabels[lang as keyof typeof ongoingLabels]||ongoingLabels.en}</span>}</></> : <span lang={lang}>{ongoingLabels[lang as keyof typeof ongoingLabels]||ongoingLabels.en}</span>;
  return from ? <><UiMessage id="period.from.from" values={{from}}/></> : null;
}
